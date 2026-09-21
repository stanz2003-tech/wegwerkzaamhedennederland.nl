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
import { selectWhen, type AnsweredItem, type ForecastItem, type When } from './forecast';
import { countLevels, modeNoun, type VehicleMode, type VerdictLevel } from './verdict';

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
  /** At most `MAX_SPECIFICS` short lines, worst first. */
  specifics: string[];
  /** Relevant items, worst first (the list under the card). */
  items: AnsweredItem[];
  /** Items that apply in time but not to the vehicle mode. */
  hidden: AnsweredItem[];
  counts: Record<VerdictLevel, number>;
  /** Distinct road numbers among the dicht/rijbaan items, plus one per item without a road. */
  closedPlaces: number;
  closedRoads: number;
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

function beyondHorizonNote(horizonMs: number): string {
  const d = new Date(horizonMs);
  const datum = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' }).format(d);
  return `Wegbeheerders melden hun werk meestal een paar weken vooruit aan; onze planning reikt nu tot ${datum}. Kijk dichter bij de datum nog eens.`;
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

/** Where the measure is, for the headline: "tussen Vianen en Everdingen" / "bij Hank" / "". */
export function wherePhrase(x: AnsweredItem, subject: AnswerSubject): string {
  const d = x.item.d ?? null;
  const p = x.item.f.properties;
  if (d?.from && d?.to) return `tussen ${d.from} en ${d.to}`;
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
    if (p.woonplaats) return `Bij ${p.woonplaats}`;
    const section = itemSection(x.item);
    return section !== p.title ? section : p.gemeente ? `Bij ${p.gemeente}` : '';
  }
  if (subject.kind === 'gebied') {
    return p.road ? `${p.road}${p.woonplaats ? ` bij ${p.woonplaats}` : ''}` : (itemPlaceName(x.item) ?? '');
  }
  return itemPlaceName(x.item) ?? (p.woonplaats && p.woonplaats !== subject.name ? p.woonplaats : '');
}

/** "Bij Hank: 1 rijstrook dicht · tot 10 min vertraging" */
export function specificLine(x: AnsweredItem, subject: AnswerSubject): string {
  const place = placeLabel(x, subject);
  const what = x.verdict.level === 'dicht' || x.verdict.level === 'rijbaan' ? [x.verdict.label.toLowerCase(), x.verdict.detail] : [x.verdict.detail ?? x.verdict.label.toLowerCase()];
  const text = what.filter((s): s is string => typeof s === 'string' && s !== '').join(' · ');
  return place ? `${place}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
}

function headlineFor(sel: AnsweredItem[], worst: VerdictLevel | null, subject: AnswerSubject): string {
  if (worst === null || sel.length === 0) return 'Geen hinder gemeld';
  const first = sel[0] as AnsweredItem;
  if (worst === 'dicht' || worst === 'rijbaan') {
    const where = wherePhrase(first, subject);
    const to = first.item.d?.to;
    const dir = to ? `, richting ${to}` : '';
    const what = worst === 'rijbaan' ? 'Rijbaan dicht' : 'Dicht';
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
  const closed = sel.items.filter((x) => x.verdict.level === 'dicht' || x.verdict.level === 'rijbaan');
  const roads = new Set<string>();
  let noRoad = 0;
  for (const x of closed) {
    const r = x.item.f.properties.road;
    if (r) roads.add(r.toUpperCase());
    else noRoad += 1;
  }
  // Only an EMPTY result can be unknown: a measure that already runs and lasts past the horizon
  // is something we do know about, and its verdict stands.
  const unknown =
    sel.items.length === 0 &&
    typeof horizonMs === 'number' &&
    Number.isFinite(horizonMs) &&
    askedFrom(when) > horizonMs;

  return {
    level: unknown ? 'onbekend' : sel.worst,
    headline: unknown ? BEYOND_HORIZON_HEADLINE : headlineFor(sel.items, sel.worst, subject),
    specifics: unknown
      ? [beyondHorizonNote(horizonMs as number)]
      : uniqueLines(sel.items.map((x) => specificLine(x, subject))).slice(0, MAX_SPECIFICS),
    items: sel.items,
    hidden: sel.hidden,
    counts: countLevels(sel.items.map((x) => x.verdict.level)),
    closedPlaces: closed.length,
    closedRoads: roads.size + noRoad,
  };
}

/* --------------------------------- sentences --------------------------------- */

function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The summary line of the map panel outside road mode — a verdict sentence, never a bare count:
 * "In beeld: 3 wegen dicht, 12 plekken met hinder, 40 meldingen gelden niet voor auto's (verborgen)".
 */
export function areaSentence(a: Answer, mode: VehicleMode, hiddenVisible: boolean): string {
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
  if (parts.length === 0) return 'In beeld: geen meldingen';
  return `In beeld: ${parts.join(', ')}`;
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
