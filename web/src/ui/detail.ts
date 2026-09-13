/**
 * Detail view of one item. Verdict-first: the banner ("Weg dicht · richting Utrecht · nog
 * 2 u 15 min") for the chosen vehicle mode, the detour (text, and "Omleiding in Google Maps"
 * when the wegbeheerder published its geometry), then header, timeline, impact rows from the
 * detail shard, description, periods, source and actions.
 */
import { itemVerdict } from '../data/forecast';
import { summarizePeriods } from '../data/periods';
import { itemInterval, toMs } from '../data/time';
import type { ItemDetail, ItemProperties } from '../data/types';
import { slugify } from '../data/types';
import type { VehicleMode } from '../data/verdict';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import {
  delayLabel,
  directionLabel,
  durationLabel,
  esc,
  fmtDayTime,
  fmtDayTimeYear,
  fmtPeriodMs,
  hindLabel,
  lanesLabel,
  planningStatusLabel,
  probabilityLabel,
  queueLabel,
  relatedNote,
  statusLine,
  subLabel,
  vehiclesLabel,
  whenLabel,
} from './format';
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
}

export interface DetailCallbacks {
  onBack(): void;
  onShare(): void;
  onRetry(): void;
  /** Road badge clicked: enter road mode. */
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

function timeline(p: ItemProperties, now: number): string {
  const { start, end } = itemInterval(p);
  const open = !Number.isFinite(end);
  const total = open ? Number.NaN : end - start;
  let progress: number;
  if (now < start) progress = 0;
  else if (open) progress = 1;
  else progress = Math.max(0, Math.min(1, (now - start) / Math.max(total, 1)));
  const nowPct = Math.round(progress * 1000) / 10;
  // Same wording as the list line: never "5 jaar" next to "Langdurige maatregel".
  const duration = durationLabel(p, now);
  const state = now < start ? 'upcoming' : !open && now > end ? 'past' : 'active';
  // The year is part of the label when it is not the current one: a measure that runs from
  // 2023 to 2028 must not print two bare "31 mei" style dates.
  const startLabel = fmtDayTimeYear(start, now);
  const endLabel = open ? 'einddatum onbekend' : fmtDayTimeYear(end, now);
  return `<div class="timeline timeline--${state}" role="img" aria-label="Periode van ${esc(startLabel)} tot ${esc(open ? 'onbekend' : endLabel)}">
      <div class="timeline__bar"><span class="timeline__elapsed" style="width:${nowPct}%"></span>
        ${state === 'active' ? `<span class="timeline__now" style="left:${nowPct}%"><span>NU</span></span>` : ''}
      </div>
      <div class="timeline__labels">
        <span><span class="timeline__k">Start</span><time datetime="${esc(p.start)}">${esc(startLabel)}</time></span>
        <span class="timeline__dur">${esc(duration)}</span>
        <span><span class="timeline__k">Einde</span>${open ? '<span>onbekend</span>' : `<time datetime="${esc(p.end ?? '')}">${esc(endLabel)}</time>`}</span>
      </div>
    </div>`;
}

function periodsBlock(d: ItemDetail, now: number): string {
  const summary = summarizePeriods(d.periods, now);
  if (summary.kind === 'none') return '';
  if (summary.kind === 'pattern') {
    return `<section class="detail__section">
        <h3 class="detail__h">Werktijden</h3>
        <p class="detail__pattern">${ICONS.clock}<span><strong>${esc(summary.days)} ${esc(summary.from)}–${esc(summary.to)}</strong><br>
        ${esc(summary.count)} keer, van ${esc(fmtDayTime(summary.first))} tot ${esc(fmtDayTime(summary.last))}</span></p>
      </section>`;
  }
  return `<section class="detail__section">
      <h3 class="detail__h">Komende periodes</h3>
      <ul class="detail__periods">${summary.items.map((it) => `<li><time datetime="${new Date(it.start).toISOString()}">${esc(fmtPeriodMs(it.start, it.end))}</time></li>`).join('')}</ul>
      ${summary.more > 0 ? `<p class="detail__more">+ ${summary.more} meer</p>` : ''}
    </section>`;
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

export const GMAPS_DETOUR_NOTE =
  'Google Maps kent de omleiding niet zelf; we sturen de route langs de omleidingsborden. Controleer onderweg de borden.';

export function renderDetail(root: HTMLElement, state: DetailState, now: number, cb: DetailCallbacks): void {
  const { props: p, detail: d } = state;
  const meta = CATEGORY_META[p.cat];
  const at = state.at ?? now;
  const status = statusLine(p, now);
  const verdict = itemVerdict({ f: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: p }, d }, state.mode, at);
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

  const badge = p.road
    ? `<button type="button" class="item__badge detail__badge" data-road="${esc(p.road)}" title="Alleen de ${esc(p.road)} tonen">${roadBadge(p.road, p.roadType, { size: 'xl', place: p.woonplaats ?? p.gemeente })}</button>`
    : roadBadge(p.road, p.roadType, { size: 'xl', place: p.woonplaats ?? p.gemeente });

  root.innerHTML = `<article class="detail" data-cat="${p.cat}" data-verdict="${verdict.level}" aria-labelledby="detail-title">
      <div class="detail__top">
        <button type="button" class="btn btn--ghost detail__back" data-back>${ICONS.arrowLeft}<span>Terug</span></button>
        <button type="button" class="btn btn--ghost detail__share" data-share aria-label="Link kopiëren">${ICONS.share2}<span>Deel</span></button>
      </div>
      ${renderVerdictBanner(verdict, [whenLabel(p, now)])}
      ${
        detourText
          ? `<div class="detail__detour">${ICONS.signpost}<div><strong>Omleiding</strong><p>${esc(detourText)}</p></div></div>`
          : detourCoords
            ? `<div class="detail__detour">${ICONS.signpost}<div><strong>Omleiding</strong><p>De wegbeheerder heeft een omleidingsroute uitgezet; hij staat <span class="swatch--detour" aria-hidden="true"></span> gestippeld blauw op de kaart.</p></div></div>`
            : ''
      }
      <header class="detail__head">
        ${badge}
        <div>
          <p class="detail__cat" style="--cat-color: var(${meta.color})">${meta.icon}<span>${esc(meta.label)}${subLabel(p.sub) ? ` · ${esc(subLabel(p.sub))}` : ''}</span></p>
          <h2 class="detail__title" id="detail-title">${esc(p.title)}</h2>
          <p class="detail__status detail__status--${status.kind}">${esc(status.text)}</p>
        </div>
      </header>
      ${timeline(p, now)}
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
      ${desc ? `<section class="detail__section"><h3 class="detail__h">Toelichting</h3><p class="detail__desc">${esc(desc)}</p></section>` : ''}
      ${d ? periodsBlock(d, now) : ''}
      <div class="detail__actions">
        ${detourUrl ? `<a class="btn btn--primary" href="${esc(detourUrl)}" target="_blank" rel="noopener noreferrer" data-gmaps-detour>${ICONS.signpost}<span>Omleiding in Google Maps</span></a>` : ''}
        ${route ? `<a class="btn ${detourUrl ? 'btn--secondary' : 'btn--primary'}" href="${esc(route)}" target="_blank" rel="noopener noreferrer" data-gmaps-route>${ICONS.navigation}<span>Route hiernaartoe</span></a>` : ''}
        ${links.join('')}
      </div>
      ${detourUrl ? `<p class="detail__gmaps-note">${esc(GMAPS_DETOUR_NOTE)}</p>` : ''}
      <footer class="detail__source">
        <p>Bron: <strong>${esc(d?.src ?? p.src)}</strong>${d?.upd ? ` · bijgewerkt <time datetime="${esc(d.upd)}">${esc(fmtDayTime(toMs(d.upd)))}</time>` : ''}</p>
        <p class="detail__id">Melding ${esc(p.id)}</p>
        ${merged ? `<p class="detail__merged">${esc(merged)}</p>` : ''}
      </footer>
    </article>`;

  root.querySelector('[data-back]')?.addEventListener('click', () => cb.onBack());
  root.querySelector('[data-share]')?.addEventListener('click', () => cb.onShare());
  root.querySelector('[data-retry]')?.addEventListener('click', () => cb.onRetry());
  root.querySelector<HTMLElement>('.detail__badge[data-road]')?.addEventListener('click', (e) => {
    const road = (e.currentTarget as HTMLElement).dataset.road;
    if (road && cb.onRoad) cb.onRoad(road);
  });
}
