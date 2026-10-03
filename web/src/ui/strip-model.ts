/**
 * What every cell of the 14-day strip on a road or place page says, as plain data (the DOM is
 * ui/forecast-strip.ts). Pure; unit-tested in web/test/strip-model.test.mjs.
 *
 * A strip where every day read "Rijbaan dicht · 17 rijbaan · 31 hinder" could not answer "which
 * day is better?" (vooruit-2, taal-9, overzicht-5). So:
 *   - the headline of a cell stays its heaviest verdict over ALL items (`cell.worst`, never lighter);
 *   - measures that are the same every day, all day ("einde onbekend" closures) are named once
 *     above the strip and drawn as a top edge in every cell, instead of making all days look alike;
 *   - a four-part bar (nacht · ochtend · middag · avond) shows what else applies, and when;
 *   - the second line names where ("bij Houten en 2 andere plekken") and when ("18:00–06:00"),
 *     never a count of level ids.
 * Every level here comes from selectInWindow through data/forecast.ts; nothing is judged anew.
 */
import { itemPlaceName, wherePhrase, type AnswerSubject } from '../data/answer';
import {
  PAGE_STRIP_DAYS,
  constantIds,
  dayParts,
  dayStrip,
  heaviestSpan,
  relativeDayLabel,
  selectInWindow,
  type AnsweredItem,
  type ConstantItem,
  type DayCell,
  type DayPartCell,
  type ForecastItem,
} from '../data/forecast';
import { MS } from '../data/time';
import { VERDICT_META, type VehicleMode, type VerdictLevel } from '../data/verdict';
import { fmtDayTime, fmtWeekdayShort } from './format';
import { dayLong } from './when-words';

/** How many "Elke dag, de hele dag" sentences are written out before "en N andere". */
export const MAX_CONSTANT_LINES = 2;

export interface StripCellModel {
  cell: DayCell;
  /** "vandaag" / "morgen" / "wo 30" */
  name: string;
  /** The cell's headline level: the heaviest verdict of every item that day (`cell.worst`). */
  level: VerdictLevel | null;
  /** "Rijbaan dicht", or "Niets gemeld" for an empty day. */
  headline: string;
  /** Night, morning, afternoon, evening — without the every-day measures. */
  parts: DayPartCell[];
  /** Level of the every-day measures (the cell's top edge); null when there are none. */
  edge: VerdictLevel | null;
  /** "bij Houten en 2 andere plekken · 18:00–06:00", "+ doorrijden mogelijk bij Hank", "verder niets", ''. */
  line: string;
  /** The whole cell as one sentence, for screen readers (there is no tooltip). */
  aria: string;
}

export interface StripModel {
  cells: StripCellModel[];
  /** The every-day measures, heaviest first. */
  constants: ConstantItem[];
  /** "Elke dag, de hele dag: rijbaan dicht bij Gorinchem (einde onbekend)", at most MAX_CONSTANT_LINES. */
  constantLines: string[];
  /** Every-day measures beyond the written-out lines. */
  moreConstants: number;
}

const lower = (level: VerdictLevel): string => VERDICT_META[level].label.toLowerCase();

/** "bij Houten" / "tussen Vianen en Everdingen" on a road page; the street on a place page. */
export function placeOf(x: AnsweredItem, subject: AnswerSubject): string {
  if (subject.kind === 'road') return wherePhrase(x, subject);
  return itemPlaceName(x.item) ?? wherePhrase(x, subject);
}

/** "bij Houten en 2 andere plekken" — the places of the given rows, the first one named. */
export function placesPhrase(rows: readonly AnsweredItem[], subject: AnswerSubject): string {
  const names = Array.from(new Set(rows.map((x) => placeOf(x, subject)).filter((s) => s !== '')));
  const first = names[0];
  if (!first) return '';
  const others = names.length - 1;
  return others > 0 ? `${first} en ${others} ${others === 1 ? 'andere plek' : 'andere plekken'}` : first;
}

function constantLine(c: ConstantItem, item: ForecastItem | undefined, subject: AnswerSubject): string {
  if (!item) return `Elke dag, de hele dag: ${lower(c.level)}`;
  const place = placeOf({ item, verdict: { level: c.level, label: VERDICT_META[c.level].label } }, subject);
  const end = item.f.properties.end ? Date.parse(item.f.properties.end) : Number.NaN;
  const until = Number.isFinite(end) ? `tot ${fmtDayTime(end)}` : 'einde onbekend';
  return `Elke dag, de hele dag: ${lower(c.level)}${place ? ` ${place}` : ''} (${until})`;
}

function cellModel(cell: DayCell, items: readonly ForecastItem[], kept: readonly ForecastItem[], edge: VerdictLevel | null, excluded: ReadonlySet<string>, mode: VehicleMode, now: number, subject: AnswerSubject): StripCellModel {
  const name = relativeDayLabel(cell, now, `${fmtWeekdayShort(cell.from)} ${new Date(cell.from + 12 * MS.hour).getUTCDate()}`);
  const parts = dayParts(items, mode, cell, now, excluded);
  const day = dayLong(cell.from);
  if (cell.worst === null) {
    return { cell, name, level: null, headline: 'Niets gemeld', parts, edge: null, line: '', aria: `${day}: niets gemeld` };
  }
  const headline = VERDICT_META[cell.worst].label;
  const rest = selectInWindow(kept, mode, Math.max(cell.from, now), cell.to, now);
  const restWorst = rest.worst;
  let line: string;
  let aria: string;
  if (restWorst === null) {
    line = edge ? 'verder niets' : '';
    aria = `${day}: ${headline.toLowerCase()}${edge ? '; verder niets' : ''}`;
  } else {
    const where = placesPhrase(rest.items.filter((x) => x.verdict.level === restWorst), subject);
    const span = heaviestSpan(parts);
    const what = [where, span].filter((s): s is string => !!s);
    if (edge) {
      // Another level than the headline: name it, so "bij Houten" cannot be read as the closure.
      line = [`+ ${lower(restWorst)}${where ? ` ${where}` : ''}`, span].filter(Boolean).join(' · ');
      aria = `${day}: ${headline.toLowerCase()}; daarnaast ${[lower(restWorst), ...what].join(' ')}`;
    } else {
      line = what.join(' · ');
      aria = `${day}: ${[headline.toLowerCase(), ...what].join(' ')}`;
    }
  }
  return { cell, name, level: cell.worst, headline, parts, edge, line, aria };
}

export function buildStripModel(items: readonly ForecastItem[], mode: VehicleMode, now: number, subject: AnswerSubject, days = PAGE_STRIP_DAYS): StripModel {
  const cells = dayStrip(items, mode, now, days);
  const constants = constantIds(cells, items, mode, now);
  const excluded = new Set(constants.map((c) => c.id));
  const kept = excluded.size > 0 ? items.filter((it) => !excluded.has(it.f.properties.id)) : items;
  const edge = constants[0]?.level ?? null;
  const byId = new Map(items.map((it) => [it.f.properties.id, it]));
  return {
    cells: cells.map((cell) => cellModel(cell, items, kept, cell.worst === null ? null : edge, excluded, mode, now, subject)),
    constants,
    constantLines: constants.slice(0, MAX_CONSTANT_LINES).map((c) => constantLine(c, byId.get(c.id), subject)),
    moreConstants: Math.max(0, constants.length - MAX_CONSTANT_LINES),
  };
}
