/**
 * The answer to the one question the site exists for: "Kan ik erdoor?" — for a road (road mode
 * on the map, the headline of /weg/<slug>/), a gemeente or woonplaats page, or the area in view,
 * for one vehicle mode and one moment or window.
 *
 *   { level: 'rijbaan', headline: 'Rijbaan dicht tussen Vianen en Everdingen, richting Utrecht',
 *     specifics: ['Vianen–Everdingen: rijbaan dicht · richting Utrecht · dagelijks 22:00–05:00',
 *                 'Bij Hank: 1 rijstrook dicht · tot 10 min vertraging', …] }
 *
 * Pure; unit-tested in web/test/answer.test.mjs with the fixture roads.
 */
import { compareByImpact } from './filter';
import { selectWhen, type AnsweredItem, type ForecastItem, type When } from './forecast';
import { toMs } from './time';
import { phraseAt, phraseIn } from './time-phrase';
import { VERDICT_SEVERITY, countLevels, modeNoun, type VehicleMode, type VerdictLevel } from './verdict';

export interface AnswerSubject {
  kind: 'road' | 'gemeente' | 'woonplaats' | 'gebied';
  /** "A2", "Utrecht"; ignored for `gebied`. */
  name: string;
}

export interface Answer {
  /** Worst verdict among the relevant items; null when nothing applies. */
  level: VerdictLevel | null;
  /** One line a driver can act on. */
  headline: string;
  /**
   * How long the headline's closure lasts, from the asked moment or inside the asked window:
   * "tot za 3 okt 10:00", "einde niet opgegeven", "hele dag" (data/time-phrase.ts). '' when the
   * headline names no closure or nothing true can be said.
   */
  timePhrase: string;
  /**
   * What a "rijbaan dicht" means for the reader: "Rijd je richting Eemnes, houd dan rekening met
   * een omleiding." '' for every other answer, and when one closure is not the whole story.
   */
  subline: string;
  /** At most `MAX_SPECIFICS` short lines, worst first. */
  specifics: string[];
  /** Distinct lines left out of `specifics` ("+ nog 4 plekken, zie de lijst"). */
  moreCount: number;
  /** Relevant items, worst first, in the deterministic answer order (see `answerOrder`). */
  items: AnsweredItem[];
  /** Items that apply in time but not to the vehicle mode. */
  hidden: AnsweredItem[];
  counts: Record<VerdictLevel, number>;
  /** Distinct road numbers among the dicht/rijbaan items, plus one per item without a road. */
  closedPlaces: number;
  closedRoads: number;
  /**
   * The question lies past the data horizon, whatever was found. A non-empty answer there is
   * still true for what IS published, but more work may follow; the card says so next to it.
   * The level and the headline are never changed by this flag.
   */
  beyondHorizon: boolean;
  /** The horizon this answer was computed against (`Meta.horizon.until` in ms), null if unknown. */
  horizonMs: number | null;
}

export const MAX_SPECIFICS = 3;

/**
 * The moment a question is about: the chosen instant, or the start of the chosen window.
 * Used to see whether the question lies beyond what the dataset actually covers.
 */
function askedFrom(when: When): number {
  return when.kind === 'moment' ? when.at : when.from;
}

/**
 * What to say when the question is about a date the dataset does not reach. The pipeline drops
 * measures that start more than `Meta.horizon.days` ahead, so for a date past that boundary an
 * empty result means "not published yet", not "nothing is going on" — and those two must never
 * share a sentence. Without this the site answered a question about a date six weeks out with
 * "Geen hinder gemeld", in the same confident wording it uses for a genuinely quiet road, while
 * 1.765 closures for that period simply were not in its files.
 */
export const BEYOND_HORIZON_HEADLINE = 'Nog niet bekend';

const HORIZON_DATE_FMT = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' });

/** "21 oktober": how the planning horizon is named everywhere (answer card, date inputs). */
export function horizonDateLabel(horizonMs: number): string {
  return HORIZON_DATE_FMT.format(new Date(horizonMs));
}

function beyondHorizonNote(horizonMs: number): string {
  return `Wegbeheerders melden hun werk meestal een paar weken vooruit aan; onze planning reikt nu tot ${horizonDateLabel(horizonMs)}. Kijk dichter bij de datum nog eens.`;
}

/** Words after which a free-text title stops naming the place and starts describing the measure. */
const TITLE_CUT = /\s+(?:dicht|afgesloten|gesloten|geopend|open|versmald|voor|wegens|vanwege|i\.?v\.?m\.?|t\.?b\.?v\.?|tijdens|door|ter hoogte van|thv)(?:\s.*)?$/i;

/**
 * The place a title names: "Croeselaan" from "Croeselaan, Utrecht", "A2" from "A2 · Vinkeveen →
 * Holendrecht", "Coolsingel" from "Coolsingel dicht voor herinrichting" — so a headline can say
 * "Coolsingel dicht" without repeating the title's own wording.
 */
export function itemName(item: ForecastItem): string {
  const t = item.f.properties.title;
  const head = (t.split(/\s·\s|,/)[0] ?? t).trim();
  const cut = head.replace(TITLE_CUT, '').trim();
  return cut !== '' ? cut : head;
}

/** Titles that name a category instead of a place ("Overige", "Met name hinder", "Werkzaamheden"). */
const GENERIC_NAME = /^(?:overige?|werkzaamheden|wegwerkzaamheden|afsluiting(?:en)?|met name hinder|hinder|evenement(?:en)?|onbekend|melding|maatregel)$/i;

/** The place a title names, or null when the wegbeheerder only typed a category word. */
export function itemPlaceName(item: ForecastItem): string | null {
  const name = itemName(item);
  return GENERIC_NAME.test(name) ? null : name;
}

/** The part of the title after the road prefix: "Vinkeveen → Holendrecht" from "A2 · Vinkeveen → Holendrecht". */
export function itemSection(item: ForecastItem): string {
  const p = item.f.properties;
  const t = p.title;
  if (p.road) {
    const prefix = `${p.road} · `;
    if (t.toLowerCase().startsWith(prefix.toLowerCase())) return t.slice(prefix.length).trim();
  }
  return t;
}

/**
 * The section and direction a title spells with an arrow: "Rijnsweerd → Eemnes" gives
 * { from: 'Rijnsweerd', to: 'Eemnes' }. The map has no detail shard (`d: null`), but the title
 * already holds what `d.from`/`d.to` would say; without it the headline fell back to "bij De Bilt".
 */
export function arrowSection(item: ForecastItem): { from: string; to: string } | null {
  const m = /^(.+?)\s*→\s*(.+?)(?:\s·\s.*)?$/.exec(itemSection(item));
  const from = m?.[1]?.trim();
  const to = m?.[2]?.trim();
  return from && to ? { from, to } : null;
}

/** From and to of the measure: the detail's, else the title's arrow; null when neither has both. */
function fromTo(x: AnsweredItem): { from: string; to: string } | null {
  const d = x.item.d ?? null;
  if (d?.from && d?.to) return { from: d.from, to: d.to };
  return arrowSection(x.item);
}

/** The direction that is closed, when the data says it ("Eemnes"); null when it does not. */
export function directionOf(x: AnsweredItem): string | null {
  return x.item.d?.to ?? arrowSection(x.item)?.to ?? null;
}

/** Where the measure is, for the headline: "tussen Vianen en Everdingen" / "bij Hank" / "". */
export function wherePhrase(x: AnsweredItem, subject: AnswerSubject): string {
  const p = x.item.f.properties;
  const ft = fromTo(x);
  if (ft) return `tussen ${ft.from} en ${ft.to}`;
  if (subject.kind === 'road') {
    const place = p.woonplaats ?? p.gemeente;
    return place ? `bij ${place}` : '';
  }
  return p.woonplaats && subject.kind === 'gemeente' && p.woonplaats !== subject.name ? `in ${p.woonplaats}` : '';
}

/** Short location label for a specifics line: "Vianen–Everdingen" / "Bij Hank" / "Croeselaan". */
export function placeLabel(x: AnsweredItem, subject: AnswerSubject): string {
  const d = x.item.d ?? null;
  const p = x.item.f.properties;
  if (d?.from && d?.to) return `${d.from}–${d.to}`;
  if (subject.kind === 'road') {
    // "Rijnsweerd → Eemnes" says where AND which way; "Bij Utrecht" says neither.
    if (arrowSection(x.item)) return itemSection(x.item);
    if (p.woonplaats) return `Bij ${p.woonplaats}`;
    const section = itemSection(x.item);
    return section !== p.title ? section : p.gemeente ? `Bij ${p.gemeente}` : '';
  }
  if (subject.kind === 'gebied') {
    return p.road ? `${p.road}${p.woonplaats ? ` bij ${p.woonplaats}` : ''}` : (itemPlaceName(x.item) ?? '');
  }
  return itemPlaceName(x.item) ?? (p.woonplaats && p.woonplaats !== subject.name ? p.woonplaats : '');
}

/**
 * "Bij Hank: 1 rijstrook dicht · tot 10 min vertraging"; a closure carries its time phrase:
 * "Hintham–Vught: rijbaan dicht · richting Vught · tot za 3 okt 10:00".
 */
export function specificLine(x: AnsweredItem, subject: AnswerSubject, timePhrase = ''): string {
  const place = placeLabel(x, subject);
  const what = isClosed(x) ? [x.verdict.label.toLowerCase(), x.verdict.detail, timePhrase] : [x.verdict.detail ?? x.verdict.label.toLowerCase()];
  const text = what.filter((s): s is string => typeof s === 'string' && s !== '').join(' · ');
  return place ? `${place}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
}

function isClosed(x: AnsweredItem): boolean {
  return x.verdict.level === 'dicht' || x.verdict.level === 'rijbaan';
}

/**
 * The order the answer reads its items in, so every view with the same items names the same
 * headline: the map took the first item of actueel.geojson, /weg/a27/ the first of roads/a27.json,
 * and the two said "bij De Bilt" and "tussen Werkendam en Gorinchem" for one road at one moment.
 * Worst verdict first; then what runs at the asked moment (or starts first inside the window);
 * then the impact order of the lists; then id. A sorted copy: only the order changes, never a
 * verdict.
 */
export function answerOrder(items: readonly AnsweredItem[], when: When, now: number): AnsweredItem[] {
  const asked = askedFrom(when);
  const startOf = (x: AnsweredItem): number => {
    const s = toMs(x.item.f.properties.start);
    return Number.isFinite(s) ? Math.max(s, asked) : asked;
  };
  return [...items].sort(
    (a, b) =>
      VERDICT_SEVERITY.indexOf(a.verdict.level) - VERDICT_SEVERITY.indexOf(b.verdict.level) ||
      startOf(a) - startOf(b) ||
      compareByImpact(a.item.f.properties, b.item.f.properties, now) ||
      a.item.f.properties.id.localeCompare(b.item.f.properties.id),
  );
}

/** One key per place, the same for both directions of one stretch ("gorinchem|werkendam"). */
function placeKey(x: AnsweredItem): string {
  const ft = fromTo(x);
  if (ft) return [ft.from, ft.to].map((s) => s.toLowerCase()).sort().join('|');
  const p = x.item.f.properties;
  return (p.woonplaats ?? p.gemeente ?? itemSection(x.item)).toLowerCase();
}

/** True when the worst level occurs at two or more different places. */
function severalPlaces(sel: readonly AnsweredItem[], worst: VerdictLevel): boolean {
  return new Set(sel.filter((x) => x.verdict.level === worst).map(placeKey)).size > 1;
}

function headlineFor(sel: AnsweredItem[], worst: VerdictLevel | null, subject: AnswerSubject): string {
  if (worst === null || sel.length === 0) return 'Geen hinder gemeld';
  const first = sel[0] as AnsweredItem;
  if (worst === 'dicht' || worst === 'rijbaan') {
    const where = wherePhrase(first, subject);
    const to = directionOf(first);
    const dir = to ? `, richting ${to}` : '';
    const what = worst === 'rijbaan' ? 'Rijbaan dicht' : 'Dicht';
    if (severalPlaces(sel, worst)) {
      // Naming one place as if it were the only one hid the other closures on the road.
      const local = subject.kind === 'gemeente' || subject.kind === 'woonplaats';
      const named = local ? (itemPlaceName(first.item) ?? where) : subject.kind === 'gebied' ? placeLabel(first, subject) : where;
      const lead = local && worst === 'dicht' ? 'Weg dicht' : what;
      return `${lead} op meerdere plekken${named ? `, o.a. ${named}` : ''}`;
    }
    if (subject.kind === 'road' || subject.kind === 'gebied') {
      const road = subject.kind === 'gebied' && first.item.f.properties.road ? `${first.item.f.properties.road} ` : '';
      return `${road}${road ? what.toLowerCase() : what}${where ? ` ${where}` : ''}${dir}`;
    }
    const name = itemPlaceName(first.item);
    if (!name) {
      // "Weg dicht in Vleuten" / "Weg dicht in Utrecht": the title itself named no street.
      const inPlace = where || (subject.name ? `in ${subject.name}` : '');
      return `${worst === 'rijbaan' ? 'Rijbaan dicht' : 'Weg dicht'}${inPlace ? ` ${inPlace}` : ''}${dir}`;
    }
    return `${name} ${what.toLowerCase()}${where ? ` ${where}` : ''}${dir}`;
  }
  if (worst === 'hinder') return 'Doorrijden mogelijk';
  if (worst === 'geen') return 'Geen hinder';
  return 'Hinder onbekend';
}

/**
 * Under a "rijbaan dicht" headline: what it means for the reader. Only for one place: with
 * several, one direction would suggest the others are open. "Richting niet gemeld" only when the
 * detail is loaded and has none; on the map (`d: null`) the direction may simply not be loaded.
 */
function sublineFor(sel: readonly AnsweredItem[], worst: VerdictLevel | null): string {
  const first = sel[0];
  if (worst !== 'rijbaan' || !first || severalPlaces(sel, worst)) return '';
  const dir = directionOf(first);
  if (dir) return `Rijd je richting ${dir}, houd dan rekening met een omleiding.`;
  return first.item.d ? 'De richting is niet gemeld; houd rekening met een omleiding.' : '';
}

/** The time phrase of one item for the asked moment or window. */
function phraseFor(x: AnsweredItem, mode: VehicleMode, when: When): string {
  return when.kind === 'moment' ? phraseAt(x.item, mode, when.at) : phraseIn(x.item, mode, when.from, when.to);
}

/** Both directions of one closure produce the same line; say it once. */
function uniqueLines(lines: readonly string[]): string[] {
  return Array.from(new Set(lines));
}

/**
 * @param horizonMs  `Meta.horizon.until` as ms; omit when unknown (older data files). An empty
 *                   result past this boundary is reported as unknown instead of as "no hindrance".
 */
export function answerFor(
  items: readonly ForecastItem[],
  mode: VehicleMode,
  when: When,
  subject: AnswerSubject,
  now?: number,
  horizonMs?: number,
): Answer {
  const sel = selectWhen(items, mode, when, now);
  const ordered = answerOrder(sel.items, when, now ?? askedFrom(when));
  const closed = ordered.filter(isClosed);
  const roads = new Set<string>();
  let noRoad = 0;
  for (const x of closed) {
    const r = x.item.f.properties.road;
    if (r) roads.add(r.toUpperCase());
    else noRoad += 1;
  }
  const knownHorizon = typeof horizonMs === 'number' && Number.isFinite(horizonMs) ? horizonMs : null;
  const beyondHorizon = knownHorizon !== null && askedFrom(when) > knownHorizon;
  // Only an EMPTY result can be unknown: a measure that already runs and lasts past the horizon
  // is something we do know about, and its verdict stands. A non-empty answer past the horizon
  // keeps its level and headline; `beyondHorizon` lets the card add that more may follow.
  const unknown = sel.items.length === 0 && beyondHorizon;
  const lines = uniqueLines(ordered.map((x) => specificLine(x, subject, isClosed(x) ? phraseFor(x, mode, when) : '')));
  const top = ordered[0];

  return {
    level: unknown ? 'onbekend' : sel.worst,
    headline: unknown ? BEYOND_HORIZON_HEADLINE : headlineFor(ordered, sel.worst, subject),
    timePhrase: top && isClosed(top) ? phraseFor(top, mode, when) : '',
    subline: sublineFor(ordered, sel.worst),
    specifics: unknown ? [beyondHorizonNote(knownHorizon as number)] : lines.slice(0, MAX_SPECIFICS),
    moreCount: unknown ? 0 : Math.max(0, lines.length - MAX_SPECIFICS),
    items: ordered,
    hidden: sel.hidden,
    counts: countLevels(sel.items.map((x) => x.verdict.level)),
    closedPlaces: closed.length,
    closedRoads: roads.size + noRoad,
    beyondHorizon,
    horizonMs: knownHorizon,
  };
}

/* --------------------------------- sentences --------------------------------- */

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The summary line of the map panel outside road mode — a verdict sentence, never a bare count:
 * "In beeld: 3 wegen dicht, 12 plekken met hinder, 40 meldingen gelden niet voor auto's (verborgen)".
 *
 * @param prefix  What the sentence is about. "In beeld" for the viewport; with a text filter the
 *                list is no longer the viewport, so the caller passes `Met “Almkerk”` instead —
 *                "In beeld: geen meldingen" for a typo read as "the road is free".
 */
export function areaSentence(a: Answer, mode: VehicleMode, hiddenVisible: boolean, prefix = 'In beeld'): string {
  const parts: string[] = [];
  const closed = a.counts.dicht + a.counts.rijbaan;
  if (closed > 0) {
    const allRoads = a.closedRoads > 0 && a.closedRoads <= closed && a.items.filter((x) => (x.verdict.level === 'dicht' || x.verdict.level === 'rijbaan') && !x.item.f.properties.road).length === 0;
    parts.push(allRoads ? n(a.closedRoads, 'weg dicht', 'wegen dicht') : n(closed, 'plek dicht', 'plekken dicht'));
  }
  if (a.counts.hinder > 0) parts.push(n(a.counts.hinder, 'plek met hinder', 'plekken met hinder'));
  if (a.counts.geen > 0) parts.push(n(a.counts.geen, 'melding zonder hinder', 'meldingen zonder hinder'));
  if (a.counts.onbekend > 0) parts.push(n(a.counts.onbekend, 'melding met onbekende hinder', 'meldingen met onbekende hinder'));
  if (a.hidden.length > 0) {
    parts.push(`${n(a.hidden.length, 'melding geldt', 'meldingen gelden')} niet voor ${modeNoun(mode)} (${hiddenVisible ? 'vervaagd' : 'verborgen'})`);
  }
  if (parts.length === 0) return `${prefix}: geen meldingen`;
  return `${prefix}: ${parts.join(', ')}`;
}

/** "12 meldingen alleen voor fietsers verborgen" — the toggle line under the relevance switch. */
export function hiddenSentence(hidden: readonly AnsweredItem[], mode: VehicleMode): string {
  if (hidden.length === 0) return '';
  const groups = new Set<string>();
  for (const x of hidden) {
    for (const v of x.item.f.properties.veh ?? []) groups.add(v === 'moped' ? 'bicycle' : v);
  }
  const NOUN: Record<string, string> = {
    car: "auto's",
    lorry: 'vrachtverkeer',
    bicycle: 'fietsers',
    bus: 'bussen',
    agricultural: 'landbouwverkeer',
    other: 'overig verkeer',
  };
  const who = groups.size === 1 ? (NOUN[[...groups][0] ?? ''] ?? 'ander verkeer') : 'ander verkeer';
  void mode;
  return `${n(hidden.length, 'melding', 'meldingen')} alleen voor ${who} verborgen`;
}
