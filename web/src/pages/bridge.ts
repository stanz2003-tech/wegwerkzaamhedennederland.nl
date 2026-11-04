/**
 * Entry script for /brug/<slug>/ (template `web/templates/bridge.html`).
 *
 * A bridge in a road (`data-road`, 286 of the 429) answers "Kan ik over de Merwedebrug?" like a
 * road page does, from the meldingen of its road that touch the bridge (pages/bridge-road.ts,
 * data/bridge-select.ts); its openings, if it has any, follow below the answer.
 *
 * A bridge without a road is an openings page, as before: loads bruggen.json, looks the bridge up
 * by its RIS id, renders the current status and the planned openings grouped per day, and draws
 * the bridge plus the roadworks within 2 km.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/answer-card.css';
import '../styles/entity-list.css';
import '../styles/pages.css';
import '../styles/answer-bar.css';

import { itemsWithinKm, mapFeatures, parseCoord } from '../data/entity';
import { loadIndexAll, rowsToItems, type IndexItem } from '../data/index';
import { loadBridges } from '../data/load';
import { startOfDay } from '../data/time';
import type { BridgeEntry, ItemFeature, Severity } from '../data/types';
import { mountPageMap, upgradeMapGeometry } from '../ui/entity-map-mount';
import { openingsHtml, parseOpenings, type Opening } from '../ui/bridge-openings';
import { esc, fmtDayTime, fmtTime } from '../ui/format';
import { bodyAttr, bootPage, setEmptyVisible, stampUpdated } from '../ui/page-boot';
import { releaseForecastSlot } from '../ui/forecast-slot';
import { runRoadBridge } from './bridge-road';

/** Radius around the bridge for the roadworks shown on the map. */
const NEARBY_KM = 2;
const BRIDGE_ZOOM = 14;
const BRIDGE_SEVERITY: Severity = 2;

const bridgeId = bodyAttr('bridgeId');
const openingsEl = document.getElementById('bridge-openings');
const statusEl = document.getElementById('bridge-status');
/** A bridge in a road: answer + list first, the openings block only when there are openings. */
const isRoadBridge = bodyAttr('road') !== undefined;
const forecastEl = document.getElementById('entity-forecast');

/** Placeholder rows inside the <ol> so it already has its height (no layout shift). */
function placeholderOpenings(el: HTMLElement): void {
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = `<li class="bridge-openings__day is-placeholder" aria-hidden="true">
    <span class="skeleton__lines"><span></span><span></span></span>
  </li>`;
}

/** Quiet Dutch notice as a list item (the container is an <ol>). */
function noticeOpenings(el: HTMLElement, text: string): void {
  el.setAttribute('aria-busy', 'false');
  el.innerHTML = `<li class="bridge-openings__notice" role="status">${esc(text)}</li>`;
}

// The build may have written the morning's openings into the list (scripts/lib/snapshot.mjs);
// they stay until the live openings replace them.
if (openingsEl && !openingsEl.hasAttribute('data-snapshot') && !isRoadBridge) placeholderOpenings(openingsEl);

const boot = bootPage();

function setStatus(state: string, text: string): void {
  if (!statusEl) return;
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function renderStatus(entry: BridgeEntry, openings: readonly Opening[], now: number): void {
  if (entry.openNow) {
    setStatus('open', 'Nu open voor scheepvaart');
    return;
  }
  const next = openings.find((o) => o.start > now);
  if (!next) {
    setStatus('unknown', 'Geen geplande openingen bekend');
    return;
  }
  const sameDay = startOfDay(next.start) === startOfDay(now);
  const when = sameDay ? `om ${fmtTime(next.start)}` : fmtDayTime(next.start);
  setStatus('closed', `Nu dicht voor scheepvaart, volgende opening ${when}`);
}

function renderOpenings(openings: readonly Opening[], now: number): void {
  if (!openingsEl) return;
  if (openings.length === 0) {
    openingsEl.replaceChildren();
    openingsEl.setAttribute('aria-busy', 'false');
    setEmptyVisible('entity-empty', true);
    return;
  }
  setEmptyVisible('entity-empty', false);
  const html = openingsHtml(openings, now);

  openingsEl.setAttribute('aria-busy', 'false');
  openingsEl.innerHTML = html;
}

function bridgeFeature(entry: BridgeEntry, openings: readonly Opening[]): ItemFeature {
  const first = openings[0];
  return {
    type: 'Feature',
    id: entry.id,
    geometry: { type: 'Point', coordinates: [entry.lon, entry.lat] },
    properties: {
      id: entry.id,
      cat: 'brug',
      sev: BRIDGE_SEVERITY,
      // An open bridge closes the road for everyone (contract v3 impact rule for `brug`).
      imp: 'dicht',
      title: entry.name,
      start: first ? new Date(first.start).toISOString() : new Date().toISOString(),
      ...(first ? { end: new Date(first.end).toISOString() } : {}),
      ...(entry.road ? { road: entry.road } : {}),
      ...(entry.gemeente ? { gemeente: entry.gemeente } : {}),
      ...(entry.woonplaats ? { woonplaats: entry.woonplaats } : {}),
      src: 'NDW',
    },
  };
}

async function drawMap(entry: BridgeEntry | null, lon: number | null, lat: number | null, openings: readonly Opening[]): Promise<void> {
  const center: [number, number] | null = entry
    ? [entry.lon, entry.lat]
    : lon !== null && lat !== null
      ? [lon, lat]
      : null;
  if (!center) return;

  const bridgeOnly: ItemFeature[] = entry ? [bridgeFeature(entry, openings)] : [];
  const features: ItemFeature[] = [...bridgeOnly];
  let nearby: IndexItem[] = [];
  try {
    const index = await loadIndexAll();
    nearby = itemsWithinKm(rowsToItems(index.rows), center, NEARBY_KM).filter((it) => it.id !== entry?.id);
    features.push(...mapFeatures(nearby));
  } catch (err) {
    console.warn('[wegwerk] werkzaamheden in de buurt niet geladen:', err instanceof Error ? err.message : String(err));
  }
  const map = await mountPageMap(features, { center, zoom: BRIDGE_ZOOM });
  // The nearby works come from the index (points only); load their real line geometry too.
  void upgradeMapGeometry(map, nearby, { keep: bridgeOnly });
}

/**
 * The openings of a movable road bridge, under the answer. The block stays hidden for a bridge
 * without published openings (the VILD bridges never have any): "geen openingen" under a fixed
 * motorway bridge would only confuse.
 */
async function roadBridgeOpenings(now: number): Promise<void> {
  const block = document.getElementById('bridge-openings-block');
  if (!block || !bridgeId) return;
  let entry: BridgeEntry | null = null;
  try {
    entry = (await loadBridges()).bridges.find((b) => b.id === bridgeId) ?? null;
  } catch (err) {
    // The build's snapshot (if any) stays: it names the moment of its data.
    console.warn('[wegwerk] bruggen.json niet geladen:', err instanceof Error ? err.message : String(err));
    return;
  }
  const openings = entry ? parseOpenings(entry, now) : [];
  if (!entry || (openings.length === 0 && !entry.openNow)) {
    // The live file has no openings: the build's list of this morning is out of date.
    block.hidden = true;
    return;
  }
  block.hidden = false;
  if (statusEl) statusEl.hidden = false;
  renderStatus(entry, openings, now);
  if (openingsEl && openings.length > 0) {
    openingsEl.setAttribute('aria-busy', 'false');
    openingsEl.innerHTML = openingsHtml(openings, now);
  }
}

async function mainRoadBridge(): Promise<void> {
  const meta = await boot.meta;
  stampUpdated(meta);
  await Promise.all([runRoadBridge(meta), roadBridgeOpenings(Date.now())]);
}

/** A bridge without a road: its openings, as before. */
async function mainOpenings(): Promise<void> {
  stampUpdated(await boot.meta);

  const lon = parseCoord(bodyAttr('lon'), 3.2, 7.3);
  const lat = parseCoord(bodyAttr('lat'), 50.5, 53.7);
  const now = Date.now();

  let entry: BridgeEntry | null = null;
  try {
    const file = await loadBridges();
    entry = file.bridges.find((b) => b.id === bridgeId) ?? null;
  } catch (err) {
    console.warn('[wegwerk] bruggen.json niet geladen:', err instanceof Error ? err.message : String(err));
    setStatus('unknown', 'De actuele brugstatus is nu niet beschikbaar');
    if (openingsEl) noticeOpenings(openingsEl, 'De geplande openingen konden niet worden geladen. Probeer het later nog eens.');
    await drawMap(null, lon, lat, []);
    return;
  }

  if (!entry) {
    setStatus('unknown', 'Geen geplande openingen bekend');
    renderOpenings([], now);
    await drawMap(null, lon, lat, []);
    return;
  }

  const openings = parseOpenings(entry, now);
  renderStatus(entry, openings, now);
  renderOpenings(openings, now);
  await drawMap(entry, lon, lat, openings);
}

async function main(): Promise<void> {
  if (!isRoadBridge) {
    await mainOpenings();
    return;
  }
  try {
    await mainRoadBridge();
  } finally {
    // Whatever happened, the reserved forecast slot of a road bridge must not stay a skeleton.
    releaseForecastSlot(forecastEl);
  }
}

boot.adsAfter(main());
