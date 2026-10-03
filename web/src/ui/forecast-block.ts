/**
 * "Kan ik woensdag 30 september over de A2?" — the block under the hero of a road / gemeente /
 * woonplaats page: the vehicle mode, the answer card for the chosen moment, "Wanneer?" with a
 * 14-day strip (ui/forecast-strip.ts; a day filters the list to that day) and the date control
 * (ui/date-pick.ts): a date alone or a day part is a window, only "Precies tijdstip" a moment.
 *
 * The block owns its state (mode, selection) and tells the page what to list via `onChange`.
 * After a change by the user it also speaks the new answer (ui/announce.ts); a data refresh
 * through `setItems` re-renders silently.
 */
import { answerFor, horizonDateLabel, type AnswerSubject } from '../data/answer';
import { PAGE_STRIP_DAYS, relativeDayLabel, selectAtMoment, selectInWindow, type DayCell, type ForecastItem, type When } from '../data/forecast';
import { horizonMs } from '../data/horizon';
import { dayWindow, localDateKey, windowFromNow, type DayPart } from '../data/time';
import type { VehicleMode } from '../data/verdict';
import { announce } from './announce';
import { answerAnnouncement, renderAnswerCard, type AnswerCardModel } from './answer-card';
import { mountDatePick, pickHintKind, whenHint, type DatePick } from './date-pick';
import { mountForecastStrip, type StripChoice } from './forecast-strip';
import { fmtDay, fmtDayTime } from './format';
import { mountModeSelect } from './mode-select';
import { buildStripModel, type StripModel } from './strip-model';
import { dayQuestionWords, momentLong, relativeDayLong } from './when-words';

export type ForecastSelection =
  | { kind: 'all' }
  | { kind: 'day'; cell: DayCell; index: number }
  /** A date outside the strip, or a part of a day: a window, answered with its heaviest verdict. */
  | { kind: 'window'; date: string; part: DayPart | null; from: number; to: number }
  | { kind: 'moment'; at: number };

export interface ForecastState {
  mode: VehicleMode;
  selection: ForecastSelection;
  /** The moment the list's verdicts should be computed for. */
  at: number;
  /**
   * For a day picked in the strip or a date (+ part): the window itself. A day is a window, not a
   * moment — computing the list for 00:00 (the hour at which day work by definition does not
   * apply) made the strip say "Doorrijden mogelijk · 4 hinder" above four rows reading "Geen
   * hinder · buiten werktijden".
   */
  window?: { from: number; to: number };
  /** Items the list should show for the selection (null = the page's default grouping). */
  items: ForecastItem[] | null;
  whenLabel: string;
}

export interface ForecastBlockOptions {
  items: readonly ForecastItem[];
  subject: AnswerSubject;
  /** Road badge type for the answer card (road pages). */
  roadType?: 'A' | 'N' | 'S' | 'E' | 'lokaal' | null;
  mode: VehicleMode;
  /** Initial exact moment (from `?t=`), if any. */
  moment?: number | null;
  /** Initial day (from `?dag=` / `&deel=`), if any; `moment` wins. */
  day?: { date: string; part: DayPart | null } | null;
  /** "20:17" while the data is stale (see AnswerCardModel.dataAsOf); omit when it is current. */
  dataAsOf?: string;
  now?: () => number;
  onChange(state: ForecastState): void;
}

export interface ForecastBlock {
  root: HTMLElement;
  setItems(items: readonly ForecastItem[]): void;
  getState(): ForecastState;
}

/** The window a selection asks about, from `now` on; undefined for "nu" and a moment. */
function windowOf(selection: ForecastSelection, now: number): { from: number; to: number } | undefined {
  if (selection.kind === 'day') return windowFromNow(selection.cell, now);
  if (selection.kind === 'window') return windowFromNow(selection, now);
  return undefined;
}

function whenOf(selection: ForecastSelection, now: number): When {
  if (selection.kind === 'moment') return { kind: 'moment', at: selection.at };
  const w = windowOf(selection, now);
  return w ? { kind: 'window', ...w } : { kind: 'moment', at: now };
}

function whenLabelOf(selection: ForecastSelection, now: number): string {
  if (selection.kind === 'moment') return fmtDayTime(selection.at);
  if (selection.kind === 'day') return relativeDayLabel(selection.cell, now, fmtDay(selection.cell.from));
  if (selection.kind === 'window') return selection.part ? `${fmtDay(selection.from)}, ${selection.part}` : fmtDay(selection.from);
  return 'nu';
}

/** The moment as part of the question: "nu", "vandaag", "woensdag 30 september in de ochtend (06:00–12:00)". */
function questionWhenOf(selection: ForecastSelection, now: number): string {
  if (selection.kind === 'moment') return momentLong(selection.at);
  if (selection.kind === 'day') return relativeDayLong(selection.cell.from, now);
  if (selection.kind === 'window') return dayQuestionWords(selection.date, selection.part, now);
  return 'nu';
}

/** The date control's view of a selection: a strip day shows its date, so a part can narrow it. */
function pickOf(selection: ForecastSelection): DatePick | null {
  if (selection.kind === 'moment') return { kind: 'moment', at: selection.at };
  if (selection.kind === 'day') return { kind: 'day', date: localDateKey(selection.cell.from), part: null };
  if (selection.kind === 'window') return { kind: 'day', date: selection.date, part: selection.part };
  return null;
}

/**
 * A date (+ part) as a selection: the strip cell when it is a whole day inside the strip, else a
 * window from dayWindow — so a date 20 days out still gets an answer, not "nu".
 */
export function selectionForDay(date: string, part: DayPart | null, cells: readonly DayCell[]): ForecastSelection {
  if (part === null) {
    const index = cells.findIndex((c) => localDateKey(c.from) === date);
    const cell = cells[index];
    if (cell) return { kind: 'day', cell, index };
  }
  const w = dayWindow(date, part);
  return w ? { kind: 'window', date, part, ...w } : { kind: 'all' };
}

export function mountForecastBlock(root: HTMLElement, opts: ForecastBlockOptions): ForecastBlock {
  const nowFn = opts.now ?? ((): number => Date.now());
  let items = opts.items;
  let mode = opts.mode;
  let model: StripModel = buildStripModel(items, mode, nowFn(), opts.subject, PAGE_STRIP_DAYS);
  let selection: ForecastSelection = opts.moment
    ? { kind: 'moment', at: opts.moment }
    : opts.day
      ? selectionForDay(opts.day.date, opts.day.part, model.cells.map((c) => c.cell))
      : { kind: 'all' };

  root.classList.add('forecast');
  root.innerHTML = `<div class="forecast__mode" data-fc-mode></div>
    <div class="forecast__answer" data-fc-answer></div>
    <div class="forecast__when">
      <p class="when__label forecast__label" id="fc-when-label">Wanneer?</p>
      <div class="forecast__strip" data-fc-strip></div>
      <div class="forecast__datepick" data-fc-date></div>
      <p class="when__hint forecast__hint" id="fc-hint" hidden></p>
      <p class="when__horizon forecast__horizon" id="fc-horizon" hidden></p>
    </div>`;
  const modeEl = root.querySelector<HTMLElement>('[data-fc-mode]');
  const answerEl = root.querySelector<HTMLElement>('[data-fc-answer]');
  const stripEl = root.querySelector<HTMLElement>('[data-fc-strip]');
  const dateEl = root.querySelector<HTMLElement>('[data-fc-date]');
  const hintEl = root.querySelector<HTMLElement>('#fc-hint');
  const horizonEl = root.querySelector<HTMLElement>('#fc-horizon');
  if (!modeEl || !answerEl || !stripEl || !dateEl || !hintEl || !horizonEl) throw new Error('forecast markup ontbreekt');

  const state = (): ForecastState => {
    const now = nowFn();
    const window = windowOf(selection, now);
    const at = selection.kind === 'moment' ? selection.at : window ? window.from : now;
    let listed: ForecastItem[] | null = null;
    // The same call dayStrip makes for the cell, so list and strip always hold the same items —
    // but worst first. In input order the day's closures sat under 22 "Doorrijden mogelijk" rows,
    // most of them behind "Toon meer" (vooruit-1).
    if (window) listed = selectInWindow(items, mode, window.from, window.to, now).items.map((x) => x.item);
    if (selection.kind === 'moment') listed = selectAtMoment(items, mode, selection.at, now).items.map((x) => x.item);
    return { mode, selection, at, ...(window ? { window } : {}), items: listed, whenLabel: whenLabelOf(selection, now) };
  };

  /** The card as last rendered: the spoken answer after a change is built from the same model. */
  let card: AnswerCardModel | null = null;

  const renderAnswer = (): void => {
    const now = nowFn();
    const answer = answerFor(items, mode, whenOf(selection, now), opts.subject, now, horizonMs());
    card = {
      road: opts.subject.kind === 'road' ? opts.subject.name : null,
      roadType: opts.roadType ?? null,
      subject: opts.subject.kind === 'gemeente' ? `de gemeente ${opts.subject.name}` : opts.subject.name,
      whenLabel: whenLabelOf(selection, now),
      questionWhen: questionWhenOf(selection, now),
      backToNow: selection.kind !== 'all',
      mode,
      answer,
      total: items.length,
      exit: false,
      ...(opts.dataAsOf ? { dataAsOf: opts.dataAsOf } : {}),
    };
    answerEl.innerHTML = renderAnswerCard(card);
  };

  /** The strip radio that is on: "Nu", a day, the day of a part, or none for a date outside it. */
  const checkedChoice = (): StripChoice | undefined => {
    if (selection.kind === 'all') return null;
    if (selection.kind === 'day') return selection.index;
    if (selection.kind === 'window') {
      const date = selection.date;
      const i = model.cells.findIndex((c) => localDateKey(c.cell.from) === date);
      return i >= 0 ? i : undefined;
    }
    return undefined;
  };

  const rebuild = (): void => {
    model = buildStripModel(items, mode, nowFn(), opts.subject, PAGE_STRIP_DAYS);
    if (selection.kind === 'day') {
      const c = model.cells[selection.index];
      selection = c ? { kind: 'day', cell: c.cell, index: selection.index } : { kind: 'all' };
    }
  };

  const renderAll = (): void => {
    renderAnswer();
    strip.update(model, checkedChoice());
    datePick.set(pickOf(selection));
    const kind = selection.kind === 'all' ? 'nu' : selection.kind === 'day' ? 'day' : pickHintKind(pickOf(selection));
    const hint = whenHint(kind);
    hintEl.hidden = hint === '';
    hintEl.textContent = hint;
    root.classList.toggle('has-moment', selection.kind !== 'all');
    // Always visible when known: how far ahead the planning reaches, before anyone picks a date
    // past it (vooruit-5). No min/max on the input — looking further stays possible.
    const until = horizonMs();
    horizonEl.hidden = until === undefined;
    horizonEl.textContent = until === undefined ? '' : `Planning bekend tot ${horizonDateLabel(until)}`;
  };

  // Only the user's own changes come through here (mode, a day, a date, clearing it).
  const emit = (): void => {
    renderAll();
    opts.onChange(state());
    if (card) announce(answerAnnouncement(card));
  };

  mountModeSelect(modeEl, mode, (m) => {
    mode = m;
    rebuild();
    emit();
  });

  // A radio cannot be switched off by clicking it again: "Nu" is the way back (toeg-3).
  const strip = mountForecastStrip(stripEl, PAGE_STRIP_DAYS, 'fc-when-label', (choice) => {
    const c = choice === null ? undefined : model.cells[choice];
    const next: ForecastSelection = c && choice !== null ? { kind: 'day', cell: c.cell, index: choice } : { kind: 'all' };
    const same = next.kind === 'all' ? selection.kind === 'all' : selection.kind === 'day' && next.kind === 'day' && selection.index === next.index;
    if (same) return;
    selection = next;
    emit();
  });

  const datePick = mountDatePick(dateEl, {
    block: 'forecast',
    id: 'fc',
    describedBy: 'fc-hint fc-horizon',
    onPick: (pick) => {
      if (pick === null) selection = { kind: 'all' };
      else if (pick.kind === 'moment') selection = { kind: 'moment', at: pick.at };
      else selection = selectionForDay(pick.date, pick.part, model.cells.map((c) => c.cell));
      emit();
    },
  });

  // "Terug naar nu" lives in the card, which is re-rendered: listen on the stable container.
  answerEl.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-answer-now]')) return;
    selection = { kind: 'all' };
    emit();
    strip.focusChecked();
  });

  renderAll();
  return {
    root,
    setItems(next) {
      items = next;
      rebuild();
      renderAll();
    },
    getState: state,
  };
}
