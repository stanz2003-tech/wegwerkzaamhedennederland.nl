/**
 * "Wanneer?" — the row that decides the moment every verdict is computed for: the chips
 * Nu · Vandaag · Morgen · Dit weekend and an always-visible `datetime-local` input
 * (Europe/Amsterdam). A chosen date deselects the chips; a chip clears the date.
 *
 * Under the chips the chosen window is spelled out ("Weekend: vr 2 okt 20:00 – ma 5 okt 06:00"):
 * what "Dit weekend" covers used to live in a `title` tooltip only, which touch and keyboard
 * users never see (vooruit-6).
 */
import { horizonDateLabel } from '../data/answer';
import { TIME_WINDOWS, WHEN_WINDOWS, timeWindowBounds, timeWindowRange, type TimeWindowId } from '../data/time';
import { formatLocalDateTime, parseLocalDateTime } from '../data/url-state';
import { esc, fmtDay, fmtDayTime } from './format';
import { ICONS } from './icons';

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
  onMoment(ms: number | null): void;
}

export function mountWhenControl(root: HTMLElement, initial: { time: TimeWindowId; moment: number | null }, cb: WhenCallbacks): WhenControl {
  root.classList.add('when');
  let current = initial.time;
  let moment = initial.moment;

  const chips = WHEN_WINDOWS.map((id) => TIME_WINDOWS.find((w) => w.id === id))
    .filter((w): w is (typeof TIME_WINDOWS)[number] => w !== undefined)
    .map((w) => `<button type="button" class="chip chip--time" role="radio" data-time="${w.id}" aria-checked="false">${esc(w.label)}</button>`)
    .join('');

  root.innerHTML = `<span class="when__label" id="when-label">Wanneer?</span>
    <div class="chips chips--time when__chips" role="radiogroup" aria-labelledby="when-label" data-when-chips>${chips}</div>
    <div class="when__date" data-when-date>
      <label class="when__date-label" for="when-input">${ICONS.calendarClock}<span>Kies datum en tijd</span></label>
      <input id="when-input" class="when__input" type="datetime-local" step="300" aria-describedby="when-range when-hint when-horizon" />
      <button type="button" class="when__clear" data-when-clear aria-label="Datum wissen" hidden>${ICONS.x}</button>
    </div>
    <p class="when__hint" id="when-hint" hidden></p>
    <div class="when__notes">
      <p class="when__range" id="when-range" hidden></p>
      <p class="when__horizon" id="when-horizon" hidden></p>
    </div>`;

  const chipsEl = root.querySelector<HTMLElement>('[data-when-chips]');
  const input = root.querySelector<HTMLInputElement>('#when-input');
  const clear = root.querySelector<HTMLButtonElement>('[data-when-clear]');
  const hint = root.querySelector<HTMLElement>('#when-hint');
  const horizonEl = root.querySelector<HTMLElement>('#when-horizon');
  const rangeEl = root.querySelector<HTMLElement>('#when-range');
  if (!chipsEl || !input || !clear || !hint || !horizonEl || !rangeEl) throw new Error('when markup ontbreekt');

  const render = (): void => {
    chipsEl.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => {
      const on = moment === null && btn.dataset.time === current;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      btn.tabIndex = on || (moment !== null && btn.dataset.time === WHEN_WINDOWS[0]) ? 0 : -1;
    });
    const has = moment !== null;
    root.classList.toggle('has-moment', has);
    root.classList.toggle('is-now', !has && current === 'nu');
    if (has && moment !== null) {
      const v = formatLocalDateTime(moment);
      if (input.value !== v) input.value = v;
    } else if (document.activeElement !== input) {
      input.value = '';
    }
    clear.hidden = !has;
    hint.hidden = !has;
    hint.textContent = has ? 'Je ziet wat er op dat moment geldt. Werk op vaste uren telt alleen binnen die uren mee als de wegbeheerder de uren heeft gemeld; anders rekenen we het de hele periode mee.' : '';
    const range = has ? '' : whenRangeLabel(current, Date.now());
    rangeEl.textContent = range;
    rangeEl.hidden = range === '';
  };

  const select = (id: TimeWindowId, focus: boolean): void => {
    const changed = id !== current || moment !== null;
    current = id;
    if (moment !== null) {
      moment = null;
      cb.onMoment(null);
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

  const applyInput = (): void => {
    const ms = parseLocalDateTime(input.value);
    if (ms === null) {
      if (input.value === '' && moment !== null) {
        moment = null;
        render();
        cb.onMoment(null);
      }
      return;
    }
    if (ms === moment) return;
    moment = ms;
    render();
    cb.onMoment(ms);
  };
  input.addEventListener('change', applyInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyInput();
    }
  });
  clear.addEventListener('click', () => {
    moment = null;
    input.value = '';
    render();
    cb.onMoment(null);
    input.focus();
  });

  render();
  return {
    root,
    setSelected(id) {
      current = id;
      render();
    },
    setMoment(ms) {
      moment = ms;
      render();
    },
    refresh: render,
    setHorizon(ms) {
      horizonEl.hidden = ms === undefined;
      horizonEl.textContent = ms === undefined ? '' : `Planning bekend tot ${horizonDateLabel(ms)}`;
    },
  };
}
