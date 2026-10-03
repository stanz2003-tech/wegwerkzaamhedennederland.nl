/**
 * Detail view of one item, verdict-first and answered for the moment the reader chose:
 *   1. the banner ("Voor auto's · wo 21 okt 12:00", "Rijbaan dicht · richting Utrecht · tot za
 *      3 okt 10:00") for the chosen vehicle mode,
 *   2. title, then "Wanneer" (status at the chosen moment, the working-time pattern),
 *   3. the detour and the route buttons ("Omleiding in Google Maps", "Route hiernaartoe"),
 *   4. impact rows from the detail shard, "Wanneer wat" (v4 timeline), the start–end bar,
 *      the description, links and the source.
 * The order follows what a driver looking ahead needs first (overzicht-10): when, and how to go
 * around, before the background. The time parts live in ui/detail-when.ts.
 */
import { itemVerdict, type ForecastItem } from '../data/forecast';
import { toMs } from '../data/time';
import { phraseAt } from '../data/time-phrase';
import { parseTimeline, segmentAt } from '../data/timeline';
import type { ItemDetail, ItemProperties } from '../data/types';
import { slugify } from '../data/types';
import { PERIOD_HINT, othersNoun, type Verdict, type VehicleMode } from '../data/verdict';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import {
  delayLabel,
  directionLabel,
  esc,
  fmtDayTime,
  hindLabel,
  kindLabel,
  lanesLabel,
  planningStatusLabel,
  probabilityLabel,
  queueLabel,
  relatedNote,
  subLabel,
  vehiclesLabel,
} from './format';
import { isNow, periodsBlock, phasesBlock, timelineBar, whenBlock } from './detail-when';
import { ICONS } from './icons';
import { renderVerdictBanner } from './verdict-pill';

export interface DetailState {
  props: ItemProperties;
  /** Representative point for the route link. */
  center: [number, number] | null;
  detail: ItemDetail | null;
  loading: boolean;
  error: boolean;
  /** Vehicle mode the verdict banner is computed for. */
  mode: VehicleMode;
  /** The moment the verdict is asked for (the "Wanneer?" choice); defaults to now. */
  at?: number;
  /** The road the app is already showing on its own (`?weg=`); "Alleen de A27 bekijken" is then moot. */
  roadMode?: string | null;
}

export interface DetailCallbacks {
  onBack(): void;
  onShare(): void;
  onRetry(): void;
  /** "Alleen de A27 bekijken" clicked: enter road mode. */
  onRoad?(road: string): void;
}

interface Row {
  icon: string;
  label: string;
  value: string;
}

function impactRows(p: ItemProperties, d: ItemDetail | null): Row[] {
  const rows: Row[] = [];
  const push = (icon: string, label: string, value: string | null): void => {
    if (value) rows.push({ icon, label, value });
  };
  if (d) {
    push(ICONS.milestone, 'Rijstroken', lanesLabel(d.lanes));
    push(ICONS.gauge, 'Maximumsnelheid', typeof d.speed === 'number' ? `${d.speed} km/u` : null);
    push(ICONS.timer, 'Vertraging', delayLabel(d.delay, d.delaySec));
    push(ICONS.carFront, 'Filelengte', queueLabel(d.queueM));
    push(ICONS.route, 'Traject', directionLabel(d.dir, d.from, d.to));
    push(ICONS.truck, 'Geldt voor', vehiclesLabel(d.vehicles ?? p.veh));
    push(ICONS.construction, 'Soort werk', subLabel(d.works) ?? (d.works && !/^[a-z]+([A-Z][a-z]+)*$/.test(d.works) ? d.works : null));
  } else {
    push(ICONS.gauge, 'Maximumsnelheid', typeof p.spd === 'number' ? `${p.spd} km/u` : null);
    push(ICONS.milestone, 'Rijstroken', typeof p.lc === 'number' ? `${p.lc} ${p.lc === 1 ? 'rijstrook' : 'rijstroken'} dicht` : null);
    push(ICONS.truck, 'Geldt voor', vehiclesLabel(p.veh));
  }
  push(ICONS.triangleAlert, 'Hinder', hindLabel(p.hind));
  const status = planningStatusLabel(d?.status);
  const prob = probabilityLabel(p.prob);
  push(ICONS.info, 'Status', [status, prob && prob !== 'zeker' ? prob : null].filter(Boolean).join(' · ') || null);
  return rows;
}

function routeUrl(center: [number, number] | null): string | null {
  if (!center) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${center[1].toFixed(5)},${center[0].toFixed(5)}&travelmode=driving`;
}

/** Up to `count` evenly spaced interior indices of a polyline with `n` points (never the ends). */
export function waypointIndices(n: number, count = 3): number[] {
  if (n <= 2 || count <= 0) return [];
  const interior = n - 2;
  const k = Math.min(count, interior);
  const out: number[] = [];
  for (let i = 1; i <= k; i++) {
    const idx = Math.round((i * (n - 1)) / (k + 1));
    if (idx > 0 && idx < n - 1 && !out.includes(idx)) out.push(idx);
  }
  return out;
}

/**
 * Google Maps directions along the signed detour: origin/destination = first/last point, at most
 * three evenly spaced waypoints in between (`|` encoded as %7C). Google Maps knows nothing about
 * the detour itself; we only send the route along its points. No departure time: the URL API
 * cannot carry one.
 */
export function detourMapsUrl(coords: readonly [number, number][]): string | null {
  if (coords.length < 2) return null;
  const fmt = (c: [number, number]): string => `${c[1].toFixed(5)},${c[0].toFixed(5)}`;
  const first = coords[0] as [number, number];
  const last = coords[coords.length - 1] as [number, number];
  const via = waypointIndices(coords.length)
    .map((i) => coords[i])
    .filter((c): c is [number, number] => c !== undefined)
    .map(fmt);
  const waypoints = via.length ? `&waypoints=${via.join('%7C')}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${fmt(first)}&destination=${fmt(last)}${waypoints}&travelmode=driving`;
}

const MODE_FOR: Record<VehicleMode, string> = { auto: "Voor auto's", vracht: 'Voor vrachtverkeer', fiets: 'Voor fietsers' };

/**
 * The kind line over the title. When the measure does not concern the mode, it says who it is
 * for ("Afsluiting voor fietsers"), not the DATEX effect: "Afsluiting · weg afgesloten" under
 * "Geldt niet voor auto's" contradicted the banner (taal-2).
 */
function kindLine(p: ItemProperties, d: ItemDetail | null, verdict: Verdict, at: number): string {
  if (verdict.level !== 'nvt') return kindLabel(p.cat, p.sub, { spd: p.spd ?? null });
  const veh = segmentAt(parseTimeline(d?.tl), at)?.veh ?? p.veh ?? null;
  return `${p.cat === 'afsluiting' ? 'Afsluiting' : 'Maatregel'} voor ${othersNoun(veh)}`;
}

/** Inside the detail "tijden in het detail" points at itself; the times follow right below. */
function bannerVerdict(v: Verdict): Verdict {
  if (!v.detail?.includes(PERIOD_HINT)) return v;
  const detail = v.detail.split(' · ').filter((part) => part !== PERIOD_HINT).join(' · ');
  return { level: v.level, label: v.label, ...(detail ? { detail } : {}) };
}

export const GMAPS_DETOUR_NOTE =
  'Google Maps kent de omleiding niet zelf; we sturen de route langs de omleidingsborden. Controleer onderweg de borden.';

export function renderDetail(root: HTMLElement, state: DetailState, now: number, cb: DetailCallbacks): void {
  const { props: p, detail: d } = state;
  const meta = CATEGORY_META[p.cat];
  const at = state.at ?? now;
  const item: ForecastItem = { f: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: p }, d };
  const verdict = itemVerdict(item, state.mode, at);
  const kicker = isNow(at, now) ? '' : `${MODE_FOR[state.mode]} · ${fmtDayTime(at)}`;
  const rows = impactRows(p, d);
  const route = routeUrl(state.center);
  const detourCoords = d?.detourGeom && d.detourGeom.length >= 2 ? d.detourGeom : null;
  const detourUrl = detourCoords ? detourMapsUrl(detourCoords) : null;
  const detourText = d?.detour?.trim();
  const desc = d?.desc?.trim();
  // The pipeline folds the planning object and the actual measure of one roadwork into a single
  // item; say so, otherwise the reader cannot tell why one id covers two publications.
  const merged = relatedNote(d?.related);

  const links: string[] = [];
  if (d?.url) links.push(`<a class="btn btn--link" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${ICONS.externalLink}<span>Meer info bij wegbeheerder</span></a>`);
  if (p.road) links.push(`<a class="btn btn--link" href="/weg/${esc(slugify(p.road))}/">${ICONS.milestone}<span>Wegpagina ${esc(p.road)}</span></a>`);
  if (p.gemeente) links.push(`<a class="btn btn--link" href="/gemeente/${esc(slugify(p.gemeente))}/">${ICONS.mapPin}<span>Gemeente ${esc(p.gemeente)}</span></a>`);

  const badge = roadBadge(p.road, p.roadType, { size: 'xl', place: p.woonplaats ?? p.gemeente });
  // A visible, focusable button instead of a clickable badge with only a title: the badge route to
  // "alleen deze weg" worked for a mouse and for nobody else (toeg-13). The small badge inside is
  // decoration; the button's name is its text.
  const onlyRoad =
    p.road && cb.onRoad && p.road.toUpperCase() !== (state.roadMode ?? '').toUpperCase()
      ? `<button type="button" class="btn btn--secondary detail__road" data-road="${esc(p.road)}"><span class="detail__road-badge" aria-hidden="true">${roadBadge(p.road, p.roadType, { size: 'sm' })}</span><span>Alleen de ${esc(p.road)} bekijken</span></button>`
      : '';

  root.innerHTML = `<article class="detail" data-cat="${p.cat}" data-verdict="${verdict.level}" aria-labelledby="detail-title">
      <div class="detail__top">
        <button type="button" class="btn btn--ghost detail__back" data-back>${ICONS.arrowLeft}<span>Terug</span></button>
        <button type="button" class="btn btn--ghost detail__share" data-share aria-label="Link kopiëren">${ICONS.share2}<span>Deel</span></button>
      </div>
      ${renderVerdictBanner(bannerVerdict(verdict), [phraseAt(item, state.mode, at)], kicker)}
      <header class="detail__head">
        ${badge}
        <div>
          <p class="detail__cat" style="--cat-color: var(${meta.color})">${meta.icon}<span>${esc(kindLine(p, d, verdict, at))}</span></p>
          <h2 class="detail__title" id="detail-title">${esc(p.title)}</h2>
        </div>
      </header>
      ${whenBlock(p, d, now, at)}
      ${
        detourText
          ? `<div class="detail__detour">${ICONS.signpost}<div><strong>Omleiding</strong><p>${esc(detourText)}</p></div></div>`
          : detourCoords
            ? `<div class="detail__detour">${ICONS.signpost}<div><strong>Omleiding</strong><p>De wegbeheerder heeft een omleidingsroute uitgezet; hij staat <span class="swatch--detour" aria-hidden="true"></span> gestippeld blauw op de kaart.</p></div></div>`
            : ''
      }
      ${
        detourUrl || route
          ? `<div class="detail__actions">
        ${detourUrl ? `<a class="btn btn--primary" href="${esc(detourUrl)}" target="_blank" rel="noopener noreferrer" data-gmaps-detour>${ICONS.signpost}<span>Omleiding in Google Maps</span></a>` : ''}
        ${route ? `<a class="btn ${detourUrl ? 'btn--secondary' : 'btn--primary'}" href="${esc(route)}" target="_blank" rel="noopener noreferrer" data-gmaps-route>${ICONS.navigation}<span>Route hiernaartoe</span></a>` : ''}
      </div>`
          : ''
      }
      ${detourUrl ? `<p class="detail__gmaps-note">${esc(GMAPS_DETOUR_NOTE)}</p>` : ''}
      ${onlyRoad}
      ${
        state.loading
          ? `<div class="skeleton skeleton--detail" aria-hidden="true"><span></span><span></span><span></span></div><p class="sr-only">Details worden geladen</p>`
          : ''
      }
      ${
        state.error
          ? `<div class="banner banner--warn" role="status">${ICONS.circleAlert}<div><p class="banner__title">Details konden niet worden geladen.</p></div><button type="button" class="btn btn--secondary" data-retry>${ICONS.refreshCw}<span>Opnieuw</span></button></div>`
          : ''
      }
      ${
        rows.length
          ? `<dl class="impact">${rows.map((r) => `<div class="impact__row">${r.icon}<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl>`
          : ''
      }
      ${phasesBlock(item, state.mode, now, at)}
      ${d ? periodsBlock(d, now, at) : ''}
      ${timelineBar(p, now, at)}
      ${desc ? `<section class="detail__section"><h3 class="detail__h">Toelichting</h3><p class="detail__desc">${esc(desc)}</p></section>` : ''}
      ${links.length ? `<div class="detail__actions">${links.join('')}</div>` : ''}
      <footer class="detail__source">
        <p>Bron: <strong>${esc(d?.src ?? p.src)}</strong>${d?.upd ? ` · bijgewerkt <time datetime="${esc(d.upd)}">${esc(fmtDayTime(toMs(d.upd)))}</time>` : ''}</p>
        <p class="detail__id">Melding ${esc(p.id)}</p>
        ${merged ? `<p class="detail__merged">${esc(merged)}</p>` : ''}
      </footer>
    </article>`;

  root.querySelector('[data-back]')?.addEventListener('click', () => cb.onBack());
  root.querySelector('[data-share]')?.addEventListener('click', () => cb.onShare());
  root.querySelector('[data-retry]')?.addEventListener('click', () => cb.onRetry());
  root.querySelector<HTMLElement>('.detail__road[data-road]')?.addEventListener('click', (e) => {
    const road = (e.currentTarget as HTMLElement).dataset.road;
    if (road && cb.onRoad) cb.onRoad(road);
  });
}
