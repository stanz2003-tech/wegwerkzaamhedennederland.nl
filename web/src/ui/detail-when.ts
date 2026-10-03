/**
 * The time parts of the detail view, all relative to the moment the reader chose (`at`), not to
 * "now" (overzicht-10, vooruit-3, vooruit-11, taal-3):
 *   - the "Wanneer" block: "Op wo 21 okt 12:00: bezig (tot en met do 29 okt)" and the working-time
 *     pattern;
 *   - "Wanneer wat": one row per stretch of the v4 timeline, "vr 2 okt 22:00 – za 3 okt 06:00 ·
 *     Rijbaan dicht", starting at the chosen moment;
 *   - the start–end bar with a marker at the chosen moment ("21 OKT") and a faint NU tick;
 *   - the list of coming periods for v3 data without a timeline.
 * Every label comes from `itemVerdict`, so no verdict rule is added here. Split from detail.ts to
 * keep that file about layout.
 */
import { itemVerdict, type ForecastItem } from '../data/forecast';
import { summarizePeriods } from '../data/periods';
import { itemInterval, toMs } from '../data/time';
import { parseTimeline, periodsFromTimeline } from '../data/timeline';
import type { ItemDetail, ItemProperties } from '../data/types';
import type { Verdict, VehicleMode } from '../data/verdict';
import { durationLabel, esc, fmtDayTime, fmtDayTimeYear, fmtPeriodMs, statusAt } from './format';
import { ICONS } from './icons';
import { renderVerdictPill } from './verdict-pill';

/** Rows of "Wanneer wat" shown before "Meer tijdvakken". */
export const PHASE_ROWS = 6;

/** Within a minute counts as the same moment (the panel passes `at = now` for "Nu"). */
const SAME_MS = 60_000;

const SHORT_DATE = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short' });

export function isNow(at: number, now: number): boolean {
  return Math.abs(at - now) < SAME_MS;
}

/** The pattern of the working times, "ma–vr 22:00–05:00", from the periods or the timeline. */
function periodPairs(d: ItemDetail | null): readonly (readonly [string, string])[] | undefined {
  if (!d) return undefined;
  const segments = parseTimeline(d.tl);
  return segments.length > 0 ? periodsFromTimeline(segments) : d.periods;
}

/** "Wanneer": the status at the chosen moment and, when regular, the working-time pattern. */
export function whenBlock(p: ItemProperties, d: ItemDetail | null, now: number, at: number): string {
  const status = statusAt(p, now, at);
  const summary = summarizePeriods(periodPairs(d), at);
  const pattern =
    summary.kind === 'pattern'
      ? `<p class="detail__pattern">${ICONS.clock}<span><strong>${esc(summary.days)} ${esc(summary.from)}–${esc(summary.to)}</strong><br>${esc(summary.count)} keer, van ${esc(fmtDayTime(summary.first))} tot ${esc(fmtDayTime(summary.last))}</span></p>`
      : '';
  return `<section class="detail__section detail__when" aria-labelledby="detail-when-h">
      <h3 class="detail__h" id="detail-when-h">Wanneer</h3>
      <p class="detail__status detail__status--${status.kind}">${esc(status.text)}</p>
      ${pattern}
    </section>`;
}

interface PhaseRow {
  start: number;
  end: number;
  /** null for a gap: no measure in that stretch. */
  verdict: Verdict | null;
}

/** The timeline as rows: back-to-back stretches with the same verdict merged, gaps named. */
export function phaseRows(item: ForecastItem, mode: VehicleMode): PhaseRow[] {
  const rows: PhaseRow[] = [];
  for (const seg of parseTimeline(item.d?.tl)) {
    // +1 ms: the verdict of the stretch itself, not of whatever ends exactly at its start.
    const verdict = itemVerdict(item, mode, seg.start + 1);
    const last = rows[rows.length - 1];
    if (last && last.verdict && Math.abs(seg.start - last.end) < SAME_MS && last.verdict.level === verdict.level && last.verdict.label === verdict.label) {
      last.end = Math.max(last.end, seg.end);
      continue;
    }
    if (last && seg.start - last.end >= SAME_MS) rows.push({ start: last.end, end: seg.start, verdict: null });
    rows.push({ start: seg.start, end: seg.end, verdict });
  }
  return rows;
}

function phaseRow(r: PhaseRow, at: number, now: number): string {
  const here = r.start <= at && at < r.end;
  const what = r.verdict ? renderVerdictPill(r.verdict, { size: 'sm' }) : '<span class="phase__gap">geen maatregel</span>';
  const mark = here ? `<span class="phase__mark">${isNow(at, now) ? 'nu' : 'gekozen moment'}</span>` : '';
  return `<li class="phase${here ? ' is-chosen' : ''}"${here ? ' aria-current="true"' : ''}><time datetime="${new Date(r.start).toISOString()}">${esc(fmtPeriodMs(r.start, r.end))}</time><span class="phase__what">${what}${mark}</span></li>`;
}

/**
 * "Wanneer wat" (vooruit-11): what the measure does when, from the stretch that contains or
 * follows the chosen moment. '' without a timeline.
 */
export function phasesBlock(item: ForecastItem, mode: VehicleMode, now: number, at: number): string {
  const rows = phaseRows(item, mode);
  if (rows.length === 0) return '';
  const from = rows.findIndex((r) => r.end > at);
  const knownUntil = toMs(item.d?.tlTo ?? null);
  const tail = Number.isFinite(knownUntil) ? `<p class="detail__more">Na ${esc(fmtDayTime(knownUntil))}: werktijden nog niet bekend</p>` : '';
  if (from < 0) {
    return `<section class="detail__section"><h3 class="detail__h">Wanneer wat</h3><p class="detail__more">Na het gekozen moment staan er geen tijdvakken meer.</p>${tail}</section>`;
  }
  const visible = rows.slice(from);
  const first = visible.slice(0, PHASE_ROWS).map((r) => phaseRow(r, at, now)).join('');
  const rest = visible.slice(PHASE_ROWS);
  const more = rest.length
    ? `<details class="phases__more"><summary>Meer tijdvakken (${rest.length})</summary><ul class="phases">${rest.map((r) => phaseRow(r, at, now)).join('')}</ul></details>`
    : '';
  return `<section class="detail__section" aria-labelledby="detail-phases-h">
      <h3 class="detail__h" id="detail-phases-h">Wanneer wat</h3>
      <ul class="phases">${first}</ul>
      ${more}
      ${tail}
    </section>`;
}

/** v3 data without a timeline: the coming periods, from the one around the chosen moment. */
export function periodsBlock(d: ItemDetail, now: number, at: number): string {
  if (parseTimeline(d.tl).length > 0) return '';
  const summary = summarizePeriods(d.periods, at);
  if (summary.kind !== 'list') return '';
  const items = summary.items
    .map((it) => {
      const here = it.start <= at && at <= it.end;
      return `<li${here ? ' class="is-chosen" aria-current="true"' : ''}><time datetime="${new Date(it.start).toISOString()}">${esc(fmtPeriodMs(it.start, it.end))}</time>${here ? ` <span class="phase__mark">${isNow(at, now) ? 'nu' : 'gekozen moment'}</span>` : ''}</li>`;
    })
    .join('');
  return `<section class="detail__section">
      <h3 class="detail__h">Komende periodes</h3>
      <ul class="detail__periods">${items}</ul>
      ${summary.more > 0 ? `<p class="detail__more">+ ${summary.more} meer</p>` : ''}
    </section>`;
}

function pct(t: number, start: number, end: number): number {
  if (!Number.isFinite(end)) return t >= start ? 100 : 0;
  return Math.round(Math.max(0, Math.min(1, (t - start) / Math.max(end - start, 1))) * 1000) / 10;
}

/**
 * The start–end bar. The shading runs to now; the marker sits at the chosen moment, labelled with
 * its date ("21 OKT"), and a faint NU tick keeps today in view. At "Nu" it is the one NU marker.
 */
export function timelineBar(p: ItemProperties, now: number, at: number): string {
  const { start, end } = itemInterval(p);
  const open = !Number.isFinite(end);
  const nowPct = now < start ? 0 : pct(now, start, end);
  // Same wording as the list line: never "5 jaar" next to "Langdurige maatregel".
  const duration = durationLabel(p, now);
  const state = now < start ? 'upcoming' : !open && now > end ? 'past' : 'active';
  // The year is part of the label when it is not the current one: a measure that runs from
  // 2023 to 2028 must not print two bare "31 mei" style dates.
  const startLabel = fmtDayTimeYear(start, now);
  // An open end is said once, in the status line of "Wanneer" (taal-7): the bar shows a dash.
  const endLabel = open ? '–' : fmtDayTimeYear(end, now);
  const chosenInSpan = at >= start && (open || at <= end);
  let markers = '';
  let spoken = '';
  if (isNow(at, now)) {
    if (state === 'active') markers = `<span class="timeline__now" style="left:${nowPct}%"><span>NU</span></span>`;
  } else {
    const atPct = pct(at, start, end);
    const label = SHORT_DATE.format(at).replace('.', '').toUpperCase();
    if (state === 'active' && !(open && chosenInSpan)) markers += `<span class="timeline__tick" style="left:${nowPct}%" aria-hidden="true"><span>NU</span></span>`;
    if (chosenInSpan) {
      markers += `<span class="timeline__now timeline__chosen" style="left:${atPct}%"><span>${esc(label)}</span></span>`;
      spoken = `, gekozen moment ${fmtDayTime(at)}`;
    }
  }
  return `<div class="timeline timeline--${state}" role="img" aria-label="Periode vanaf ${esc(startLabel)}${open ? ', einde niet opgegeven' : ` tot ${esc(endLabel)}`}${esc(spoken)}">
      <div class="timeline__bar"><span class="timeline__elapsed" style="width:${nowPct}%"></span>
        ${markers}
      </div>
      <div class="timeline__labels">
        <span><span class="timeline__k">Start</span><time datetime="${esc(p.start)}">${esc(startLabel)}</time></span>
        <span class="timeline__dur">${esc(duration)}</span>
        <span><span class="timeline__k">Einde</span>${open ? '<span>–</span>' : `<time datetime="${esc(p.end ?? '')}">${esc(endLabel)}</time>`}</span>
      </div>
    </div>`;
}
