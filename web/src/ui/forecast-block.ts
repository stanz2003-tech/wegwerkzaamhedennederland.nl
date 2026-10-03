/**
 * "Kan ik op <datum> over de A2?" — the block under the hero of a road / gemeente / woonplaats
 * page: the vehicle mode, the answer headline for the chosen moment, a 7-day strip (worst
 * verdict per day with counts; a click filters the list to that day) and an "Andere datum…"
 * `datetime-local` input (Europe/Amsterdam) that answers exactly, using `periods` when present.
 *
 * The block owns its state (mode, selection) and tells the page what to list via `onChange`.
 * After a change by the user it also speaks the new answer (ui/announce.ts); a data refresh
 * through `setItems` re-renders silently.
 */
import { answerFor, horizonDateLabel, type AnswerSubject } from '../data/answer';
import { dayStrip, relativeDayLabel, selectAtMoment, selectInWindow, type DayCell, type ForecastItem, type When } from '../data/forecast';
import { MS } from '../data/time';
import { formatLocalDateTime, parseLocalDateTime } from '../data/url-state';
import { VERDICT_META, countsLine, type VehicleMode } from '../data/verdict';
import { announce } from './announce';
import { answerAnnouncement, renderAnswerCard, type AnswerCardModel } from './answer-card';
import { esc, fmtDay, fmtDayTime, fmtWeekdayShort } from './format';
import { ICONS } from './icons';
import { mountModeSelect } from './mode-select';
import { horizonMs } from '../data/horizon';

export type ForecastSelection =
  | { kind: 'all' }
  | { kind: 'day'; cell: DayCell; index: number }
  | { kind: 'moment'; at: number };

export interface ForecastState {
  mode: VehicleMode;
  selection: ForecastSelection;
  /** The moment the list's verdicts should be computed for. */
  at: number;
  /**
   * For a day picked in the strip: the day itself. A day is a window, not a moment — computing the
   * list for 00:00 (the hour at which day work by definition does not apply) made the strip say
   * "Doorrijden mogelijk · 4 hinder" above four rows reading "Geen hinder · buiten werktijden".
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
  /** Initial selection (a strip day from `?t=vandaag`); wins over `moment`. */
  selection?: ForecastSelection;
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

function whenOf(selection: ForecastSelection, now: number): When {
  if (selection.kind === 'moment') return { kind: 'moment', at: selection.at };
  if (selection.kind === 'day') return { kind: 'window', from: Math.max(selection.cell.from, now), to: selection.cell.to };
  return { kind: 'moment', at: now };
}

function whenLabelOf(selection: ForecastSelection, now: number): string {
  if (selection.kind === 'moment') return fmtDayTime(selection.at);
  if (selection.kind === 'day') return relativeDayLabel(selection.cell, now, fmtDay(selection.cell.from));
  return 'nu';
}

export function mountForecastBlock(root: HTMLElement, opts: ForecastBlockOptions): ForecastBlock {
  const nowFn = opts.now ?? ((): number => Date.now());
  let items = opts.items;
  let mode = opts.mode;
  let selection: ForecastSelection = opts.selection ?? (opts.moment ? { kind: 'moment', at: opts.moment } : { kind: 'all' });

  root.classList.add('forecast');
  root.innerHTML = `<div class="forecast__mode" data-fc-mode></div>
    <div class="forecast__answer" data-fc-answer></div>
    <div class="forecast__strip" role="radiogroup" aria-label="Komende zeven dagen" data-fc-strip></div>
    <div class="forecast__date" data-fc-date>
      <label class="forecast__date-label" for="fc-input">${ICONS.calendarClock}<span>Andere datum…</span></label>
      <input id="fc-input" class="forecast__input" type="datetime-local" step="300" />
      <button type="button" class="forecast__clear" data-fc-clear aria-label="Datum wissen" hidden>${ICONS.x}</button>
    </div>
    <p class="when__horizon forecast__horizon" id="fc-horizon" hidden></p>`;
  const modeEl = root.querySelector<HTMLElement>('[data-fc-mode]');
  const answerEl = root.querySelector<HTMLElement>('[data-fc-answer]');
  const stripEl = root.querySelector<HTMLElement>('[data-fc-strip]');
  const input = root.querySelector<HTMLInputElement>('#fc-input');
  const clear = root.querySelector<HTMLButtonElement>('[data-fc-clear]');
  const horizonEl = root.querySelector<HTMLElement>('#fc-horizon');
  if (!modeEl || !answerEl || !stripEl || !input || !clear || !horizonEl) throw new Error('forecast markup ontbreekt');
  input.setAttribute('aria-describedby', 'fc-horizon');

  const state = (): ForecastState => {
    const now = nowFn();
    const at = selection.kind === 'moment' ? selection.at : selection.kind === 'day' ? Math.max(selection.cell.from, now) : now;
    let listed: ForecastItem[] | null = null;
    // The same call dayStrip makes for the cell, so list and strip always hold the same items —
    // but worst first. In input order the day's closures sat under 22 "Doorrijden mogelijk" rows,
    // most of them behind "Toon meer" (vooruit-1).
    if (selection.kind === 'day') listed = selectInWindow(items, mode, Math.max(selection.cell.from, now), selection.cell.to, now).items.map((x) => x.item);
    if (selection.kind === 'moment') listed = selectAtMoment(items, mode, selection.at, now).items.map((x) => x.item);
    const window = selection.kind === 'day' ? { from: Math.max(selection.cell.from, now), to: selection.cell.to } : undefined;
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
      mode,
      answer,
      total: items.length,
      exit: false,
      ...(opts.dataAsOf ? { dataAsOf: opts.dataAsOf } : {}),
    };
    answerEl.innerHTML = renderAnswerCard(card);
  };

  const renderStrip = (): void => {
    const now = nowFn();
    const cells = dayStrip(items, mode, now);
    stripEl.innerHTML = cells
      .map((cell, i) => {
        const level = cell.worst;
        const meta = level ? VERDICT_META[level] : null;
        const on = selection.kind === 'day' && selection.index === i;
        const label = relativeDayLabel(cell, now, `${fmtWeekdayShort(cell.from)} ${new Date(cell.from + 12 * MS.hour).getUTCDate()}`);
        const line = level ? countsLine(cell.counts) : 'niets gemeld';
        const title = level ? `${label}: ${meta?.label ?? ''} · ${line}` : `${label}: niets gemeld`;
        return `<button type="button" class="forecast__day forecast__day--${level ?? 'leeg'}${on ? ' is-on' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-fc-day="${i}" title="${esc(title)}" style="--vpill-color: var(${meta?.color ?? '--border'})">
          <span class="forecast__day-name">${esc(label)}</span>
          <span class="forecast__day-bar" aria-hidden="true"></span>
          <span class="forecast__day-verdict">${esc(meta?.label ?? 'niets gemeld')}</span>
          <span class="forecast__day-counts">${esc(line)}</span>
        </button>`;
      })
      .join('');
  };

  const renderDate = (): void => {
    const has = selection.kind === 'moment';
    root.classList.toggle('has-moment', has);
    clear.hidden = !has;
    if (has && selection.kind === 'moment') {
      const v = formatLocalDateTime(selection.at);
      if (input.value !== v) input.value = v;
    } else if (document.activeElement !== input) {
      input.value = '';
    }
  };

  // Always visible when known: how far ahead the planning reaches, before anyone picks a date
  // past it (vooruit-5). No min/max on the input — looking further stays possible.
  const renderHorizon = (): void => {
    const until = horizonMs();
    horizonEl.hidden = until === undefined;
    horizonEl.textContent = until === undefined ? '' : `Planning bekend tot ${horizonDateLabel(until)}`;
  };

  const renderAll = (): void => {
    renderAnswer();
    renderStrip();
    renderDate();
    renderHorizon();
  };

  // Only the user's own changes come through here (mode, a day, a date, clearing it).
  const emit = (): void => {
    renderAll();
    opts.onChange(state());
    if (card) announce(answerAnnouncement(card));
  };

  mountModeSelect(modeEl, mode, (m) => {
    mode = m;
    emit();
  });

  stripEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fc-day]');
    if (!btn) return;
    const index = Number(btn.dataset.fcDay);
    const cell = dayStrip(items, mode, nowFn())[index];
    if (!cell) return;
    selection = selection.kind === 'day' && selection.index === index ? { kind: 'all' } : { kind: 'day', cell, index };
    emit();
  });

  const applyInput = (): void => {
    const ms = parseLocalDateTime(input.value);
    if (ms === null) {
      if (input.value === '' && selection.kind === 'moment') {
        selection = { kind: 'all' };
        emit();
      }
      return;
    }
    if (selection.kind === 'moment' && selection.at === ms) return;
    selection = { kind: 'moment', at: ms };
    emit();
  };
  input.addEventListener('change', applyInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyInput();
    }
  });
  clear.addEventListener('click', () => {
    selection = { kind: 'all' };
    input.value = '';
    emit();
    input.focus();
  });

  renderAll();
  return {
    root,
    setItems(next) {
      items = next;
      if (selection.kind === 'day') {
        const cell = dayStrip(items, mode, nowFn())[selection.index];
        selection = cell ? { kind: 'day', cell, index: selection.index } : { kind: 'all' };
      }
      renderAll();
    },
    getState: state,
  };
}
