/**
 * "Wanneer?" — the row that decides the moment every verdict is computed for: the chips
 * Nu · Vandaag · Morgen · Dit weekend and an always-visible date input with day-part chips
 * (ui/date-pick.ts, Europe/Amsterdam). A date alone asks about the whole day; only "Precies
 * tijdstip" makes a moment. A chosen date deselects the chips; a chip clears the date.
 *
 * Under the chips the chosen window is spelled out ("Weekend: vr 2 okt 20:00 – ma 5 okt 06:00"):
 * what "Dit weekend" covers used to live in a `title` tooltip only, which touch and keyboard
 * users never see (vooruit-6).
 */
import { horizonDateLabel } from '../data/answer';
import { TIME_WINDOWS, WHEN_WINDOWS, timeWindowBounds, timeWindowRange, type TimeWindowId } from '../data/time';
import { mountDatePick, pickHintKind, whenHint, type DatePick } from './date-pick';
import { esc, fmtDay, fmtDayTime } from './format';

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

  root.innerHTML = `<span class="when__label" id="when-label">Wanneer?</span>
    <div class="chips chips--time when__chips" role="radiogroup" aria-labelledby="when-label" data-when-chips>${chips}</div>
    <div class="when__pick" data-when-pick></div>
    <p class="when__hint" id="when-hint" hidden></p>
    <div class="when__notes">
      <p class="when__range" id="when-range" hidden></p>
      <p class="when__horizon" id="when-horizon" hidden></p>
    </div>`;

  const chipsEl = root.querySelector<HTMLElement>('[data-when-chips]');
  const pickEl = root.querySelector<HTMLElement>('[data-when-pick]');
  const hint = root.querySelector<HTMLElement>('#when-hint');
  const horizonEl = root.querySelector<HTMLElement>('#when-horizon');
  const rangeEl = root.querySelector<HTMLElement>('#when-range');
  if (!chipsEl || !pickEl || !hint || !horizonEl || !rangeEl) throw new Error('when markup ontbreekt');

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
    if (btn) select(btn.dataset.time as TimeWindowId, false);
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
  };
}
