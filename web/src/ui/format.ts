/**
 * Dutch formatting helpers (dates in Europe/Amsterdam, durations, labels).
 * Pure functions; safe to unit-test in Node.
 */
import {
  MS,
  SHORT_HORIZON_MS,
  TIME_ZONE,
  isActiveAt,
  isLongRunning,
  itemInterval,
  nextStartAfter,
  toMs,
  zonedParts,
  type TimeSpan,
} from '../data/time';
import type { DelayBand, Direction, Hindrance, ItemDetail, Probability } from '../data/types';

const LOCALE = 'nl-NL';

const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const dayTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFullFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const weekdayShortFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: 'short' });

function clean(s: string): string {
  return s.replace(/\./g, '').replace(/,\s*/g, ' ').replace(' om ', ' ').trim();
}

/** "21:45" */
export function fmtTime(ms: number): string {
  return Number.isFinite(ms) ? timeFmt.format(ms) : '–';
}

/** "za 13 sep" */
export function fmtDay(ms: number): string {
  return Number.isFinite(ms) ? clean(dayFmt.format(ms)) : '–';
}

/** "za 13 sep 22:00" */
export function fmtDayTime(ms: number): string {
  return Number.isFinite(ms) ? clean(dayTimeFmt.format(ms)) : '–';
}

/** "za 13 sep 22:00", or "31 mei 2028 16:00" when the year is not the current one. */
export function fmtDayTimeYear(ms: number, now: number): string {
  if (!Number.isFinite(ms)) return '–';
  return zonedParts(ms).year === zonedParts(now).year ? fmtDayTime(ms) : `${fmtDate(ms)} ${fmtTime(ms)}`;
}

/** "13 september 2026" */
export function fmtDate(ms: number): string {
  return Number.isFinite(ms) ? dateFmt.format(ms) : '–';
}

/** "zaterdag 13 september 2026 om 22:00" */
export function fmtDateTimeFull(ms: number): string {
  return Number.isFinite(ms) ? dateTimeFullFmt.format(ms) : '–';
}

/** "ma" */
export function fmtWeekdayShort(ms: number): string {
  return weekdayShortFmt.format(ms).replace('.', '');
}

/**
 * Compact Dutch duration: "45 min", "2 u 15 min", "3 dagen", "6 weken", "4 maanden".
 * Negative or non-finite input → "".
 */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.round(ms / MS.minute);
  if (minutes < 1) return 'minder dan 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes - hours * 60;
    return rest > 0 ? `${hours} u ${rest} min` : `${hours} u`;
  }
  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? '1 dag' : `${days} dagen`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weken`;
  const months = Math.round(days / 30.4);
  if (months < 18) return months === 1 ? '1 maand' : `${months} maanden`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 jaar' : `${years} jaar`;
}

/** "nog 2 u 15 min"; "" when open ended. */
export function fmtRemaining(endMs: number, now: number): string {
  if (!Number.isFinite(endMs)) return '';
  const d = fmtDuration(endMs - now);
  return d ? `nog ${d}` : '';
}

/** Wording for a long-running (semi-permanent) measure — used in the status line and as a tag. */
export const LONG_RUNNING_LABEL = 'Langdurige maatregel';
/** Same wording mid-sentence. */
export const LONG_RUNNING_LABEL_LOWER = 'langdurige maatregel';
/** Compact marker in the list, next to the category tag. */
export const LONG_RUNNING_TAG = 'langdurig';

export interface StatusLine {
  kind: 'active' | 'upcoming' | 'past';
  /** Short Dutch text, e.g. "Nu actief · nog 2 u 15 min" */
  text: string;
}

/**
 * The one-line status shown in list items and the detail header. The wording follows how far
 * away the end is, because "nog 13 jaar" is honest but useless:
 *   ≤ 7 days   "Nu actief · nog 2 u 15 min" / "nog 3 dagen"
 *   ≤ 90 days  "Nu actief · tot en met vr 25 sep"
 *   > 90 days  "Langdurige maatregel · tot 31 mei 2031"
 *   no end     "Nu actief · einde nog onbekend", or "· einddatum onbekend" when it has already
 *              been running for months.
 */
export function statusLine(p: TimeSpan, now: number): StatusLine {
  const { end } = itemInterval(p);
  const long = isLongRunning(p, now);
  if (isActiveAt(p, now)) {
    if (!Number.isFinite(end)) {
      return long
        ? { kind: 'active', text: `${LONG_RUNNING_LABEL} · einddatum onbekend` }
        : { kind: 'active', text: 'Nu actief · einde nog onbekend' };
    }
    if (end - now <= SHORT_HORIZON_MS) return { kind: 'active', text: `Nu actief · ${fmtRemaining(end, now)}` };
    if (long) return { kind: 'active', text: `${LONG_RUNNING_LABEL} · tot ${fmtDate(end)}` };
    return { kind: 'active', text: `Nu actief · tot en met ${fmtDay(end)}` };
  }
  const next = nextStartAfter(p, now);
  if (next !== null) {
    const startsIn = next - now;
    const when = startsIn < 7 * MS.day ? fmtDayTime(next) : fmtDate(next);
    return { kind: 'upcoming', text: long ? `Start ${when} · ${LONG_RUNNING_LABEL_LOWER}` : `Start ${when}` };
  }
  if (Number.isFinite(end) && end < now) return { kind: 'past', text: `Afgelopen · ${fmtDayTimeYear(end, now)}` };
  return { kind: 'upcoming', text: 'Gepland' };
}

/**
 * The "when" of a list row, without the "Nu actief" preamble the verdict pill already implies:
 * "nog 2 u 15 min" / "tot en met vr 25 sep" / "langdurig · tot 31 mei 2031" / "start za 13 sep 22:00".
 */
export function whenLabel(p: TimeSpan, now: number): string {
  return statusLine(p, now)
    .text.replace(/^Nu actief · /, '')
    .replace(new RegExp(`^${LONG_RUNNING_LABEL} · `), `${LONG_RUNNING_TAG} · `)
    .replace(new RegExp(` · ${LONG_RUNNING_LABEL_LOWER}$`), ` · ${LONG_RUNNING_TAG}`)
    .replace(/^Start /, 'start ')
    .replace(/^Afgelopen · /, 'afgelopen · ')
    .replace(/^Gepland$/, 'gepland');
}

/**
 * Middle label of the detail timeline. Kept in the same words as `statusLine` so the list line
 * and the timeline cannot contradict each other ("nog 2 jaar" vs "5 jaar").
 */
export function durationLabel(p: TimeSpan, now: number): string {
  const { start, end } = itemInterval(p);
  if (!Number.isFinite(end)) return 'einddatum onbekend';
  if (isLongRunning(p, now)) return LONG_RUNNING_LABEL_LOWER;
  return fmtDuration(end - start);
}

/** "za 13 sep 22:00 – ma 15 sep 05:00" or "za 13 sep 22:00–05:00" when on the same day. */
export function fmtPeriod(startIso: string, endIso: string | null | undefined): string {
  const s = toMs(startIso);
  const e = toMs(endIso);
  if (Number.isNaN(e)) return `vanaf ${fmtDayTime(s)}`;
  const sameDay = fmtDay(s) === fmtDay(e);
  return sameDay ? `${fmtDay(s)} ${fmtTime(s)}–${fmtTime(e)}` : `${fmtDayTime(s)} – ${fmtDayTime(e)}`;
}

export function fmtPeriodMs(start: number, end: number): string {
  const sameDay = fmtDay(start) === fmtDay(end);
  return sameDay ? `${fmtDay(start)} ${fmtTime(start)}–${fmtTime(end)}` : `${fmtDayTime(start)} – ${fmtDayTime(end)}`;
}

/* ------------------------------- domain labels ------------------------------- */

const DELAY_LABELS: Record<DelayBand, string> = {
  negligible: 'geen noemenswaardige vertraging',
  upToTenMinutes: 'tot 10 minuten',
  betweenTenMinutesAndThirtyMinutes: '10 tot 30 minuten',
  betweenThirtyMinutesAndOneHour: '30 tot 60 minuten',
  betweenOneHourAndThreeHours: '1 tot 3 uur',
  longerThanThreeHours: 'meer dan 3 uur',
};

export function delayLabel(band: DelayBand | undefined, seconds: number | undefined): string | null {
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    const min = Math.round(seconds / 60);
    return min < 1 ? 'minder dan 1 min' : `${min} min`;
  }
  if (band && band in DELAY_LABELS) return DELAY_LABELS[band];
  return null;
}

/** "3,2 km" / "600 m" */
export function queueLabel(metres: number | undefined): string | null {
  if (typeof metres !== 'number' || !Number.isFinite(metres) || metres <= 0) return null;
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(metres / 1000)} km`;
}

const HIND_LABELS: Record<Hindrance, string> = {
  A: 'zeer veel hinder',
  B: 'veel hinder',
  C: 'matige hinder',
  D: 'weinig hinder',
  E: 'nauwelijks hinder',
};

export function hindLabel(h: Hindrance | null | undefined): string | null {
  return h ? HIND_LABELS[h] : null;
}

export function lanesLabel(lanes: ItemDetail['lanes']): string | null {
  if (!lanes) return null;
  const parts: string[] = [];
  if (typeof lanes.closed === 'number') parts.push(`${lanes.closed} ${lanes.closed === 1 ? 'rijstrook' : 'rijstroken'} dicht`);
  if (typeof lanes.open === 'number') parts.push(`${lanes.open} open`);
  if (parts.length === 0 && typeof lanes.total === 'number') parts.push(`${lanes.total} rijstroken`);
  return parts.length ? parts.join(' · ') : null;
}

const DIR_LABELS: Record<Direction, string> = {
  positive: 'oplopende hectometrering',
  negative: 'aflopende hectometrering',
  both: 'beide richtingen',
};

export function directionLabel(dir: Direction | undefined, from?: string, to?: string): string | null {
  if (from && to) return `${from} → ${to}`;
  if (from) return `vanaf ${from}`;
  if (to) return `tot ${to}`;
  if (dir) return DIR_LABELS[dir];
  return null;
}

const PROB_LABELS: Record<Probability, string> = {
  certain: 'zeker',
  probable: 'waarschijnlijk',
  riskOf: 'kans op',
};

export function probabilityLabel(p: Probability | undefined): string | null {
  return p ? PROB_LABELS[p] : null;
}

const STATUS_LABELS: Record<string, string> = {
  published: 'planning',
  initial: 'planning',
  alignmentFinished: 'planning',
  running: 'actuele maatregel',
  final: 'actuele maatregel',
  active: 'actuele maatregel',
};

export function planningStatusLabel(status: string | undefined): string | null {
  if (!status) return null;
  return STATUS_LABELS[status] ?? null;
}

const SUB_LABELS: Record<string, string> = {
  laneClosures: 'rijstrookafzetting',
  roadClosed: 'weg afgesloten',
  carriagewayClosures: 'rijbaan afgesloten',
  speedRestrictionInOperation: 'snelheidsbeperking',
  slowTraffic: 'langzaam rijdend verkeer',
  stationaryTraffic: 'stilstaand verkeer',
  queueingTraffic: 'filevorming',
  accident: 'ongeval',
  brokenDownVehicle: 'pechgeval',
  vehicleObstruction: 'voertuig op de weg',
  generalObstruction: 'obstakel op de weg',
  bridgeSwingInOperation: 'brug open',
  festival: 'festival',
  sportsEvent: 'sportevenement',
  maintenanceWork: 'onderhoud',
  resurfacingWork: 'nieuw asfalt',
  constructionWork: 'bouwwerkzaamheden',
  roadMaintenance: 'wegonderhoud',
  narrowLanes: 'versmalde rijstroken',
  contraflow: 'tegenverkeer',
  rerouting: 'omleiding',
};

/** Human label for a DATEX sub type / works label; null when unknown. */
export function subLabel(sub: string | null | undefined): string | null {
  if (!sub) return null;
  return SUB_LABELS[sub] ?? null;
}

const VEHICLE_LABELS: Record<string, string> = {
  bicycle: 'fietsers',
  pedestrian: 'voetgangers',
  lorry: 'vrachtverkeer',
  heavyGoodsVehicle: 'vrachtverkeer',
  bus: 'bussen',
  car: "auto's",
  motorcycle: 'motoren',
  agriculturalVehicle: 'landbouwverkeer',
  anyVehicle: 'alle voertuigen',
};

export function vehiclesLabel(vehicles: string[] | undefined): string | null {
  if (!vehicles || vehicles.length === 0) return null;
  return vehicles.map((v) => VEHICLE_LABELS[v] ?? v).join(', ');
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

/** Dutch pluralisation helper: `plural(1, 'melding', 'meldingen')` → "1 melding". */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/**
 * Honest summary line for a window view ("vandaag", "dit weekend"). `changes` is what starts or
 * ends inside the window, `active` how many of those are already running, and `background` the
 * long-running measures that merely overlap the window — those are counted separately instead of
 * being reported as "nu actief" (which produced 4.763 for one weekend).
 */
export interface WindowSummaryCounts {
  changes: number;
  active: number;
  background: number;
}

export function windowSummary(counts: WindowSummaryCounts, windowLabel: string): string {
  const { changes, active, background } = counts;
  if (changes === 0 && background === 0) return `Er is nog niets aangemeld voor ${windowLabel}`;
  const parts: string[] = [];
  parts.push(changes > 0 ? `${plural(changes, 'melding', 'meldingen')} ${windowLabel}` : `Niets nieuws ${windowLabel}`);
  if (active > 0) parts.push(`${formatCount(active)} nu al actief`);
  if (background > 0) parts.push(backgroundPhrase(background));
  return parts.join(' · ');
}

/**
 * The tail every window summary ends with: "4.729 langdurige maatregelen lopen al langer".
 * One sentence for the whole site, so /vandaag/, /dit-weekend/, /afsluitingen/ and /files/
 * all name the same thing the same way.
 */
export function backgroundPhrase(n: number): string {
  return n === 1
    ? '1 langdurige maatregel loopt al langer'
    : `${plural(n, 'langdurige maatregel', 'langdurige maatregelen')} lopen al langer`;
}

/**
 * Explains a merged double publication in the detail view. The pipeline folds the planning
 * object and the actual measure of one roadwork into a single item (`ItemDetail.related`), and
 * the reader has to be able to see that: the ids differ, the work does not.
 */
export function relatedNote(related: readonly string[] | undefined): string | null {
  const ids = (related ?? []).filter((id) => typeof id === 'string' && id.trim() !== '');
  if (ids.length === 0) return null;
  const list = ids.join(', ');
  return ids.length === 1
    ? `Deze melding en de planning van de wegbeheerder (${list}) gaan over dezelfde werkzaamheid en zijn samengevoegd.`
    : `Deze melding is samengevoegd met ${formatCount(ids.length)} planningsmeldingen (${list}) over dezelfde werkzaamheid.`;
}

/** Escape text for insertion into innerHTML. */
export function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
