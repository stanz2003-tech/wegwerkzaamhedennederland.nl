/**
 * Entry script for /brug/<slug>/ (template `web/templates/bridge.html`).
 * Loads bruggen.json, looks the bridge up by its RIS id, renders the current status and the
 * planned openings grouped per day, and draws the bridge plus the roadworks within 2 km.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/pages.css';

import { itemsWithinKm, mapFeatures, parseCoord } from '../data/entity';
import { loadIndexAll, rowsToItems, type IndexItem } from '../data/index';
import { loadBridges } from '../data/load';
import { startOfDay, toMs } from '../data/time';
import type { BridgeEntry, ItemFeature, Severity } from '../data/types';
import { mountPageMap, upgradeMapGeometry } from '../ui/entity-map-mount';
import { esc, fmtDay, fmtDayTime, fmtDuration, fmtTime, plural } from '../ui/format';
import { bodyAttr, bootPage, setEmptyVisible, stampUpdated } from '../ui/page-boot';

/** Radius around the bridge for the roadworks shown on the map. */
const NEARBY_KM = 2;
const BRIDGE_ZOOM = 14;
const BRIDGE_SEVERITY: Severity = 2;

const bridgeId = bodyAttr('bridgeId');
const openingsEl = document.getElementById('bridge-openings');
const statusEl = document.getElementById('bridge-status');

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

if (openingsEl) placeholderOpenings(openingsEl);

const boot = bootPage();

interface Opening {
  start: number;
  end: number;
}

function parseOpenings(entry: BridgeEntry, now: number): Opening[] {
  const out: Opening[] = [];
  for (const pair of entry.openings ?? []) {
    const start = toMs(pair[0]);
    const end = toMs(pair[1]);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    if (end < now) continue;
    out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

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

/** Day label in the openings list: "Vandaag", "Morgen" or "Za 13 sep". */
function dayLabel(ms: number, now: number): string {
  const day = startOfDay(ms);
  if (day === startOfDay(now)) return 'Vandaag';
  if (day === startOfDay(now, 1)) return 'Morgen';
  const label = fmtDay(ms);
  return label.charAt(0).toUpperCase() + label.slice(1);
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

  const groups = new Map<number, Opening[]>();
  for (const o of openings) {
    const day = startOfDay(o.start);
    const list = groups.get(day);
    if (list) list.push(o);
    else groups.set(day, [o]);
  }

  const html = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => {
      const rows = list
        .map((o) => {
          const duration = fmtDuration(o.end - o.start);
          const running = o.start <= now && o.end >= now;
          return `<li class="bridge-openings__slot${running ? ' is-now' : ''}">
            <time datetime="${esc(new Date(o.start).toISOString())}">${esc(fmtTime(o.start))}</time>–<time datetime="${esc(new Date(o.end).toISOString())}">${esc(fmtTime(o.end))}</time>
            ${duration ? `<span class="bridge-openings__duration">${esc(duration)}</span>` : ''}
            ${running ? '<span class="bridge-openings__now">nu open</span>' : ''}
          </li>`;
        })
        .join('');
      return `<li class="bridge-openings__day">
        <h3 class="bridge-openings__day-title">${esc(dayLabel(day, now))} <span class="bridge-openings__count">${esc(plural(list.length, 'opening', 'openingen'))}</span></h3>
        <ul class="bridge-openings__slots">${rows}</ul>
      </li>`;
    })
    .join('');

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

async function main(): Promise<void> {
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

void main();
