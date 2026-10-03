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
import type { Category, DelayBand, Direction, Hindrance, ItemDetail, Probability } from '../data/types';
import { CATEGORY_META } from './categories';

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
 * The "when" of a list row, without the "Nu actief" preamble the verdict pill already implies,
 * in clock times rather than a countdown (taal-3: "nog 5 u 56 min" said neither from when nor
 * until what): "tot di 29 sep 05:00" / "tot en met vr 25 sep" / "langdurig · tot 31 mei 2031" /
 * "begint za 13 sep 22:00" / "einde niet opgegeven". `now` is the reference moment: the caller
 * passes the chosen moment when the reader looks ahead.
 */
export function whenLabel(p: TimeSpan, now: number): string {
  const { end } = itemInterval(p);
  if (isActiveAt(p, now) && Number.isFinite(end) && end - now <= SHORT_HORIZON_MS) return `tot ${fmtDayTime(end)}`;
  return statusLine(p, now)
    .text.replace(/^Nu actief · einde nog onbekend$/, 'einde niet opgegeven')
    .replace(/^Nu actief · /, '')
    .replace(new RegExp(`^${LONG_RUNNING_LABEL} · einddatum onbekend$`), `${LONG_RUNNING_TAG} · einde niet opgegeven`)
    .replace(new RegExp(`^${LONG_RUNNING_LABEL} · `), `${LONG_RUNNING_TAG} · `)
    .replace(new RegExp(` · ${LONG_RUNNING_LABEL_LOWER}$`), ` · ${LONG_RUNNING_TAG}`)
    .replace(/^Start /, 'begint ')
    .replace(/^Afgelopen · /, 'afgelopen · ')
    .replace(/^Gepland$/, 'gepland');
}

/**
 * Status relative to the chosen moment, for the detail (overzicht-10, taal-3): "Nu actief · …"
 * when that moment is now, else "Op wo 21 okt 12:00: bezig (tot en met do 29 okt)".
 */
export function statusAt(p: TimeSpan, now: number, at: number): StatusLine {
  if (Math.abs(at - now) < MS.minute) return statusLine(p, now);
  const s = statusLine(p, at);
  const when = `Op ${fmtDayTime(at)}`;
  if (s.kind === 'active') return { kind: 'active', text: `${when}: bezig (${whenLabel(p, at)})` };
  if (s.kind === 'upcoming') return { kind: 'upcoming', text: `${when}: nog niet begonnen (${whenLabel(p, at)})` };
  return { kind: 'past', text: `${when}: al afgelopen (${fmtDayTimeYear(itemInterval(p).end, at)})` };
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
  if (!Number.isFinite(end)) return `vanaf ${fmtDayTime(start)}`;
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

/**
 * Sub types that only describe the effect, which the verdict pill already says in plain words.
 * Next to the pill they repeated it in DATEX terms or contradicted it: "Weg dicht" over
 * "Afsluiting · rijbaan afgesloten", "Geldt niet voor auto's" over "weg afgesloten" (taal-2).
 * Not here: contraflow ("tegenverkeer" says something the pill does not), and the work and event
 * subs ("nieuw asfalt", "festival").
 */
const EFFECT_SUBS: ReadonlySet<string> = new Set(['roadClosed', 'carriagewayClosures', 'laneClosures', 'narrowLanes']);

/**
 * The muted kind line of a row or the detail: "Werkzaamheden · nieuw asfalt", "Afsluiting",
 * "stilstaand verkeer" (files and incidents: the sub alone). A speed restriction is only left
 * out when the speed is known, because only then does the pill name it ("max 70 km/u").
 */
export function kindLabel(cat: Category, sub: string | null | undefined, opts: { spd?: number | null } = {}): string {
  const label = CATEGORY_META[cat].label;
  const text = subLabel(sub);
  const repeats = !!sub && (EFFECT_SUBS.has(sub) || (sub === 'speedRestrictionInOperation' && typeof opts.spd === 'number' && opts.spd > 0));
  if (!text || repeats) return label;
  return cat === 'file' || cat === 'incident' ? text : `${label} · ${text}`;
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
