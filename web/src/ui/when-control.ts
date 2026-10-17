/**
 * "Wanneer?" — the row that decides the moment every verdict is computed for: the chips
 * Nu · Vandaag · Morgen · Dit weekend and an always-visible date input with day-part chips
 * (ui/date-pick.ts, Europe/Amsterdam). A date alone asks about the whole day; only "Precies
 * tijdstip" makes a moment. A chosen date deselects the chips; a chip clears the date.
 *
 * Under the chips the chosen window is spelled out ("Weekend: vr 2 okt 20:00 – ma 5 okt 06:00"):
 * what "Dit weekend" covers used to live in a `title` tooltip only, which touch and keyboard
 * users never see (vooruit-6).
 *
 * On a phone, once a road or place is chosen, the row folds into one line "Wanneer: nu · wijzig"
 * (`setCompact`): chips and date row stood above the answer card and pushed it three quarters
 * down the screen (review 2026-10-16). One tap opens the row again; a chip tapped there folds it
 * back with the new moment in the line. The CSS (panel-controls.css) folds on phones only.
 */
import { horizonDateLabel } from '../data/answer';
import { DAY_PARTS, TIME_WINDOWS, WHEN_WINDOWS, dayWindow, timeWindowBounds, timeWindowRange, type TimeWindowId } from '../data/time';
import { mountDatePick, pickHintKind, whenHint, type DatePick } from './date-pick';
import { esc, fmtDay, fmtDayTime } from './format';
import { ICONS } from './icons';

/** The moment in the folded line: "nu", "dit weekend", "zo 18 okt, ochtend", "zo 18 okt 08:00". */
export function whenSummaryText(id: TimeWindowId, pick: DatePick | null): string {
  if (pick?.kind === 'moment') return fmtDayTime(pick.at);
  if (pick?.kind === 'day') {
    const day = dayWindow(pick.date);
    const part = DAY_PARTS.find((p) => p.id === pick.part)?.label.toLowerCase();
    if (day) return part ? `${fmtDay(day.from)}, ${part}` : fmtDay(day.from);
  }
  return (TIME_WINDOWS.find((w) => w.id === id)?.label ?? 'nu').toLowerCase();
}

/**
 * The window a chip stands for, in words; '' for "Nu". Uses the same clamped range the answer
 * is computed for (`timeWindowRange`), so inside the weekend it says "nu tot ma 5 okt 06:00".
 */
export function whenRangeLabel(id: TimeWindowId, now: number): string {
  if (id === 'nu') return '';
  const { from, to } = timeWindowRange(id, now);
  const started = from > timeWindowBounds(id, now).from;
  switch (id) {
    case 'vandaag':
      return `Vandaag: ${fmtDay(now)}, van nu tot 24:00`;
    case 'morgen':
      return `Morgen: ${fmtDay(from)}, hele dag`;
    case 'weekend':
      return `Weekend: ${started ? 'nu' : fmtDayTime(from)} tot ${fmtDayTime(to)}`;
    default: {
      const label = TIME_WINDOWS.find((w) => w.id === id)?.label ?? id;
      return `${label}: ${fmtDay(from)} tot ${fmtDay(to)}`;
    }
  }
}

export interface WhenControl {
  root: HTMLElement;
  setSelected(id: TimeWindowId): void;
  /** Shows an exact moment as the active choice (null = back to the chips). */
  setMoment(ms: number | null): void;
  /** Shows a date, a date with a day part, or a moment as the active choice (null = the chips). */
  setPick(pick: DatePick | null): void;
  /** Re-reads the clock for the range line (the day can roll over while the page is open). */
  refresh(): void;
  /**
   * The last moment the planning covers (`Meta.horizon.until`), shown under the date input as
   * "Planning bekend tot 21 oktober" before anyone picks a later date; undefined hides it.
   */
  setHorizon(ms: number | undefined): void;
  /** Folds the row into one line (phones, a road or place chosen); false unfolds it for good. */
  setCompact(on: boolean): void;
}

export interface WhenCallbacks {
  onChange(id: TimeWindowId): void;
  /** A date (+ part) or an exact moment was picked, or cleared (null). */
  onPick(pick: DatePick | null): void;
}

export function mountWhenControl(root: HTMLElement, initial: { time: TimeWindowId; pick: DatePick | null }, cb: WhenCallbacks): WhenControl {
  root.classList.add('when');
  let current = initial.time;
  let pick = initial.pick;

  const chips = WHEN_WINDOWS.map((id) => TIME_WINDOWS.find((w) => w.id === id))
    .filter((w): w is (typeof TIME_WINDOWS)[number] => w !== undefined)
    .map((w) => `<button type="button" class="chip chip--time" role="radio" data-time="${w.id}" aria-checked="false">${esc(w.label)}</button>`)
    .join('');

  // `.when__body` is `display: contents` (its children lay out in the row as before) except when
  // folded: hidden, or opened as a panel over the answer card (panel-controls.css).
  root.innerHTML = `<button type="button" class="when__summary" data-when-summary aria-expanded="true" aria-controls="when-body">
      ${ICONS.calendarClock}<span class="when__summary-text">Wanneer: <strong data-when-summary-value></strong></span>
      <span class="when__summary-edit">wijzig</span>${ICONS.chevronDown}
    </button>
    <span class="when__label" id="when-label">Wanneer?</span>
    <div class="when__body" id="when-body">
      <div class="chips chips--time when__chips" role="radiogroup" aria-labelledby="when-label" data-when-chips>${chips}</div>
      <div class="when__pick" data-when-pick></div>
      <p class="when__hint" id="when-hint" hidden></p>
      <div class="when__notes">
        <p class="when__range" id="when-range" hidden></p>
        <p class="when__horizon" id="when-horizon" hidden></p>
      </div>
    </div>`;

  const chipsEl = root.querySelector<HTMLElement>('[data-when-chips]');
  const pickEl = root.querySelector<HTMLElement>('[data-when-pick]');
  const hint = root.querySelector<HTMLElement>('#when-hint');
  const horizonEl = root.querySelector<HTMLElement>('#when-horizon');
  const rangeEl = root.querySelector<HTMLElement>('#when-range');
  const summary = root.querySelector<HTMLButtonElement>('[data-when-summary]');
  const summaryValue = root.querySelector<HTMLElement>('[data-when-summary-value]');
  if (!chipsEl || !pickEl || !hint || !horizonEl || !rangeEl || !summary || !summaryValue) throw new Error('when markup ontbreekt');

  /** Folded into one line: `compact` while a road or place is chosen, `open` after a tap on it. */
  let compact = false;
  let open = false;
  const fold = (): void => {
    root.classList.toggle('is-compact', compact);
    root.classList.toggle('is-open', compact && open);
    summary.setAttribute('aria-expanded', !compact || open ? 'true' : 'false');
  };

  const datePick = mountDatePick(pickEl, {
    block: 'when',
    id: 'when',
    describedBy: 'when-range when-hint when-horizon',
    onPick: (next) => {
      pick = next;
      render();
      cb.onPick(next);
    },
  });
  datePick.set(pick);

  const render = (): void => {
    chipsEl.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => {
      const on = pick === null && btn.dataset.time === current;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      btn.tabIndex = on || (pick !== null && btn.dataset.time === WHEN_WINDOWS[0]) ? 0 : -1;
    });
    const has = pick !== null;
    root.classList.toggle('has-moment', has);
    root.classList.toggle('is-now', !has && current === 'nu');
    const text = has ? whenHint(pickHintKind(pick)) : '';
    hint.hidden = text === '';
    hint.textContent = text;
    const range = has ? '' : whenRangeLabel(current, Date.now());
    rangeEl.textContent = range;
    rangeEl.hidden = range === '';
    summaryValue.textContent = whenSummaryText(current, pick);
  };

  const select = (id: TimeWindowId, focus: boolean): void => {
    const changed = id !== current || pick !== null;
    current = id;
    if (pick !== null) {
      pick = null;
      datePick.set(null);
    }
    render();
    if (focus) chipsEl.querySelector<HTMLButtonElement>(`[data-time="${id}"]`)?.focus();
    if (changed) cb.onChange(id);
  };

  chipsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-time]');
    if (!btn) return;
    select(btn.dataset.time as TimeWindowId, false);
    // Opened from the folded line for this one tap: fold back, so the new answer is in view.
    // (Arrow keys walk the chips without folding; a date may still get a day part, so it stays.)
    if (compact && open) {
      open = false;
      fold();
      summary.focus({ preventScroll: true });
    }
  });

  summary.addEventListener('click', () => {
    open = !open;
    fold();
    if (open) chipsEl.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  });

  // Escape closes the opened panel first (and only that: main.ts would also lower the sheet).
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !compact || !open) return;
    e.preventDefault();
    e.stopPropagation();
    open = false;
    fold();
    summary.focus({ preventScroll: true });
  });

  chipsEl.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const ids = [...WHEN_WINDOWS];
    const i = Math.max(0, ids.indexOf(current));
    let next = i;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + ids.length) % ids.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ids.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = ids.length - 1;
    const id = ids[next];
    if (id) select(id, true);
  });

  render();
  return {
    root,
    setSelected(id) {
      current = id;
      render();
    },
    setMoment(ms) {
      pick = ms === null ? null : { kind: 'moment', at: ms };
      datePick.set(pick);
      render();
    },
    setPick(next) {
      pick = next;
      datePick.set(next);
      render();
    },
    refresh: render,
    setHorizon(ms) {
      horizonEl.hidden = ms === undefined;
      horizonEl.textContent = ms === undefined ? '' : `Planning bekend tot ${horizonDateLabel(ms)}`;
    },
    setCompact(on) {
      compact = on;
      open = false;
      fold();
    },
  };
}
