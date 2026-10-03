/**
 * Entry script for the seven list pages (template `web/templates/list.html`).
 *
 * `afsluitingen`, `files`, `vandaag` and `dit-weekend` are data-driven: they load the index
 * (plus live.geojson for the files page), filter by category and time window, and render the
 * result in batches. `wegen`, `plaatsen` and `bruggen` are fully pre-rendered by the generator;
 * there we only add a small state label next to the existing links ("rijbaan dicht gemeld",
 * "nu open") and never touch that markup itself.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/entity-list.css';
import '../styles/pages.css';
import '../styles/list-filter.css';

import { compareImpact, compareStart, dedupeItems, roadKey } from '../data/entity';
import { groupByWindow, normalizeText } from '../data/filter';
import { indexItemFromRow, loadIndexAll, rowsToItems, type IndexItem } from '../data/index';
import { isIndexRow, loadBridges, loadLive } from '../data/load';
import { MEDIUM_RUN_MS, toMs } from '../data/time';
import { slugify, type BridgeEntry } from '../data/types';
import type { VerdictLevel } from '../data/verdict';
import { renderEntityList, renderEntityNotice, renderEntitySkeleton, type EntitySection } from '../ui/entity-list';
import { esc, fmtDayTime, formatCount, plural } from '../ui/format';
import {
  BACKGROUND_TITLE,
  LIST_TITLES,
  LIST_WINDOW,
  listSummary,
  type DataList,
  type ListCounts,
} from '../ui/list-summary';
import { bodyAttr, bootPage, setEmptyVisible, setText, stampUpdated } from '../ui/page-boot';
import { roadStateHtml, worstActiveByKey } from '../ui/road-state';
import { FILTER_LABELS, mountListFilter } from './list-filter';

const DATA_NOTICE = 'De actuele meldingen konden niet worden geladen. Probeer het later nog eens of bekijk de kaart.';

type PrerenderedList = 'wegen' | 'plaatsen' | 'bruggen';

/** Which items a page shows, and whether it needs live.geojson merged in. */
interface ListConfig {
  match(it: IndexItem): boolean;
  /** Merge live.geojson so files/incidents show up even if the index lags behind. */
  live: boolean;
}

const CONFIG: Record<DataList, ListConfig> = {
  afsluitingen: { match: (it) => it.cat === 'afsluiting' || it.closed, live: false },
  files: { match: (it) => it.cat === 'file', live: true },
  vandaag: { match: () => true, live: true },
  weekend: { match: () => true, live: true },
};

function isDataList(v: string | undefined): v is DataList {
  return v === 'afsluitingen' || v === 'files' || v === 'vandaag' || v === 'weekend';
}

function isPrerenderedList(v: string | undefined): v is PrerenderedList {
  return v === 'wegen' || v === 'plaatsen' || v === 'bruggen';
}

const list = bodyAttr('list');
const itemsEl = document.getElementById('list-items');
if (itemsEl && isDataList(list)) renderEntitySkeleton(itemsEl, 5);

const boot = bootPage();

// The pre-rendered lists are long (342 gemeenten, 550 N-roads): a filter field on top (zoek-9).
const groupsEl = document.querySelector<HTMLElement>('.list-groups');
if (groupsEl && isPrerenderedList(list)) mountListFilter(groupsEl, FILTER_LABELS[list]);

/* ------------------------------ data-driven lists ----------------------------- */

/** Live features that the index does not know yet, as index items (so they render identically). */
async function liveExtras(known: ReadonlySet<string>): Promise<IndexItem[]> {
  const features = await loadLive();
  const extras: IndexItem[] = [];
  for (const f of features) {
    const p = f.properties;
    if (known.has(p.id)) continue;
    const row: unknown = [
      p.id,
      p.cat,
      p.sub ?? null,
      p.sev,
      p.title,
      p.road ?? null,
      p.roadType ?? null,
      p.gemeente ?? null,
      p.woonplaats ?? null,
      p.prov ?? null,
      p.start,
      p.end ?? null,
      f.geometry.type === 'Point' ? (f.geometry.coordinates[0] ?? 0) : 0,
      f.geometry.type === 'Point' ? (f.geometry.coordinates[1] ?? 0) : 0,
      p.closed === true ? 1 : 0,
      p.hind ?? null,
      1,
      // Contract v3 positions; `imp` is absent in v2 files and then read as `onbekend`.
      p.imp ?? 'onbekend',
      p.veh ?? null,
      p.per ? 1 : 0,
      p.spd ?? null,
      p.lc ?? null,
    ];
    if (isIndexRow(row)) extras.push(indexItemFromRow(row));
  }
  return extras;
}

async function renderDataList(id: DataList): Promise<void> {
  const cfg = CONFIG[id];
  let rows: IndexItem[];
  try {
    const index = await loadIndexAll();
    rows = rowsToItems(index.rows);
  } catch (err) {
    console.warn('[wegwerk] index niet geladen:', err instanceof Error ? err.message : String(err));
    if (itemsEl) renderEntityNotice(itemsEl, DATA_NOTICE);
    return;
  }

  if (cfg.live) {
    try {
      rows = dedupeItems([...rows, ...(await liveExtras(new Set(rows.map((r) => r.id))))]);
    } catch (err) {
      console.warn('[wegwerk] live.geojson niet geladen:', err instanceof Error ? err.message : String(err));
    }
  }

  const now = Date.now();
  const matched = rows.filter((it) => {
    if (!cfg.match(it)) return false;
    const end = toMs(it.end);
    // Anything that is already over is not news for any window.
    return Number.isNaN(end) || end >= now;
  });

  // What actually happens inside the window, separated from the semi-permanent measures that
  // merely overlap it. Without this split every years-long width restriction that happens to
  // cross Friday 20:00 was reported as "nu actief" — 4.544 of them for one weekend.
  // "Vandaag" and "dit weekend" answer "what happens then", so a measure that has already stood
  // for a month belongs in the collapsed background group rather than at the top of the page.
  // The broader 7-day and "nu" lists keep the 90-day default.
  const longRunMs = id === 'vandaag' || id === 'weekend' ? MEDIUM_RUN_MS : undefined;
  const groups = groupByWindow(matched, LIST_WINDOW[id], now, { longRunMs });
  const active = groups.changes.filter((it) => it.active).sort((a, b) => compareImpact(a, b, now));
  const upcoming = groups.changes.filter((it) => !it.active).sort(compareStart);
  const background = [...groups.background].sort((a, b) => compareImpact(a, b, now));

  const counts: ListCounts = {
    changes: groups.changes.length,
    active: active.length,
    upcoming: upcoming.length,
    background: background.length,
  };
  const titles = LIST_TITLES[id];
  setText('list-summary', listSummary(id, counts));
  setEmptyVisible('list-empty', counts.changes === 0 && counts.background === 0);

  if (!itemsEl) return;
  const sections: EntitySection[] = [{ title: titles.active, items: active }];
  if (titles.upcoming) sections.push({ title: titles.upcoming, items: upcoming });
  sections.push({ title: BACKGROUND_TITLE, items: background, collapsed: true, note: titles.backgroundNote });
  renderEntityList(itemsEl, sections, now, { linkQuery: id === 'files' ? 'cat=file' : undefined });
}

/* ----------------------------- pre-rendered lists ---------------------------- */

/**
 * Puts a small label NEXT TO a pre-rendered link, once. Never inside it: text inside the badge
 * link ran on from the road number ("A1" + "29" read "A129"), and the link's own markup must stay
 * exactly what the generator wrote.
 */
function addSiblingLabel(a: HTMLAnchorElement, html: string): void {
  if (!html || a.dataset.stateLabel === '1') return;
  a.dataset.stateLabel = '1';
  a.insertAdjacentHTML('afterend', html);
  // The badge rows lay their <li> out with `display: contents`; this keeps badge and label together.
  a.parentElement?.classList.add('has-state');
}

function slugFromHref(href: string, prefix: string): string | null {
  if (!href.startsWith(prefix)) return null;
  const rest = href.slice(prefix.length).replace(/\/$/, '');
  return rest === '' || rest.includes('/') ? null : rest;
}

function decorate(prefix: string, worst: ReadonlyMap<string, VerdictLevel>, keyOf: (slug: string, a: HTMLAnchorElement) => string | null): void {
  document.querySelectorAll<HTMLAnchorElement>(`.list-groups a[href^="${prefix}"]`).forEach((a) => {
    const slug = slugFromHref(a.getAttribute('href') ?? '', prefix);
    if (!slug) return;
    const key = keyOf(slug, a);
    addSiblingLabel(a, roadStateHtml(key ? worst.get(key) : null));
  });
}

async function decorateRoadsOrPlaces(id: 'wegen' | 'plaatsen'): Promise<void> {
  const index = await loadIndexAll();
  const rows = rowsToItems(index.rows);
  const now = Date.now();
  if (id === 'wegen') {
    const worst = worstActiveByKey(rows, (it) => {
      const key = roadKey(it.road);
      return key ? [key] : [];
    }, now);
    decorate('/weg/', worst, (slug) => roadKey(slug));
    return;
  }
  // Keyed by both the normalised name and the slug, so either lookup works.
  const keysOfName = (name: string | null): string[] => (name ? [normalizeText(name), slugify(name)] : []);
  const places = worstActiveByKey(rows, (it) => keysOfName(it.woonplaats), now);
  const gemeenten = worstActiveByKey(rows, (it) => keysOfName(it.gemeente), now);
  const byText = (slug: string, a: HTMLAnchorElement): string => normalizeText(a.textContent ?? '') || slug;
  decorate('/plaats/', places, (slug, a) => (places.has(byText(slug, a)) ? byText(slug, a) : slug));
  // The gemeente link reads "Alle werkzaamheden in de gemeente X": look it up by its slug.
  decorate('/gemeente/', gemeenten, (slug, a) => (a.dataset.gemeente ? normalizeText(a.dataset.gemeente) : slug));
}

/** "nu open" or "volgende opening do 1 okt 10:30" next to a bridge link; nothing without either. */
function bridgeLabel(entry: BridgeEntry, now: number): string {
  if (entry.openNow) return '<span class="road-state road-state--brug">nu open</span>';
  const next = (entry.openings ?? []).map(([start]) => toMs(start)).find((ms) => Number.isFinite(ms) && ms > now);
  return next === undefined ? '' : `<span class="road-state road-state--plain">volgende opening ${esc(fmtDayTime(next))}</span>`;
}

async function decorateBridges(): Promise<void> {
  const file = await loadBridges();
  const bySlug = new Map<string, BridgeEntry>();
  for (const b of file.bridges) bySlug.set(b.slug, b);
  const now = Date.now();
  let open = 0;
  let planned = 0;
  document.querySelectorAll<HTMLAnchorElement>('.list-groups a[href^="/brug/"]').forEach((a) => {
    const slug = slugFromHref(a.getAttribute('href') ?? '', '/brug/');
    const entry = slug ? bySlug.get(slug) : undefined;
    if (!entry) return;
    if (entry.openNow) open += 1;
    else if ((entry.openings?.length ?? 0) > 0) planned += 1;
    addSiblingLabel(a, bridgeLabel(entry, now));
  });
  if (open > 0 || planned > 0) {
    const parts: string[] = [];
    if (open > 0) parts.push(`${plural(open, 'brug', 'bruggen')} nu open`);
    if (planned > 0) parts.push(`${formatCount(planned)} met geplande openingen`);
    setText('list-summary', parts.join(' · '));
  }
}

async function renderPrerendered(id: PrerenderedList): Promise<void> {
  try {
    if (id === 'bruggen') await decorateBridges();
    else await decorateRoadsOrPlaces(id);
  } catch (err) {
    // The page is complete without the hints; stay quiet.
    console.warn('[wegwerk] actuele stand niet toegevoegd:', err instanceof Error ? err.message : String(err));
  }
}

async function main(): Promise<void> {
  stampUpdated(await boot.meta);
  if (isDataList(list)) {
    await renderDataList(list);
    return;
  }
  if (isPrerenderedList(list)) {
    await renderPrerendered(list);
    return;
  }
  if (itemsEl) renderEntityNotice(itemsEl, 'Deze lijst is niet beschikbaar.');
}

void main();
