/**
 * "Wanneer?" — the row that decides the moment every verdict is computed for: the chips
 * Nu · Vandaag · Morgen · Dit weekend and an always-visible `datetime-local` input
 * (Europe/Amsterdam). A chosen date deselects the chips; a chip clears the date.
 */
import { TIME_WINDOWS, WHEN_WINDOWS, type TimeWindowId } from '../data/time';
import { formatLocalDateTime, parseLocalDateTime } from '../data/url-state';
import { esc } from './format';
import { ICONS } from './icons';

export interface WhenControl {
  root: HTMLElement;
  setSelected(id: TimeWindowId): void;
  /** Shows an exact moment as the active choice (null = back to the chips). */
  setMoment(ms: number | null): void;
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
    .map((w) => `<button type="button" class="chip chip--time" role="radio" data-time="${w.id}" aria-checked="false" title="${esc(w.title)}">${esc(w.label)}</button>`)
    .join('');

  root.innerHTML = `<span class="when__label" id="when-label">Wanneer?</span>
    <div class="chips chips--time when__chips" role="radiogroup" aria-labelledby="when-label" data-when-chips>${chips}</div>
    <div class="when__date" data-when-date>
      <label class="when__date-label" for="when-input">${ICONS.calendarClock}<span>Kies datum en tijd</span></label>
      <input id="when-input" class="when__input" type="datetime-local" step="300" aria-describedby="when-hint" />
      <button type="button" class="when__clear" data-when-clear aria-label="Datum wissen" hidden>${ICONS.x}</button>
    </div>
    <p class="when__hint" id="when-hint" hidden></p>`;

  const chipsEl = root.querySelector<HTMLElement>('[data-when-chips]');
  const input = root.querySelector<HTMLInputElement>('#when-input');
  const clear = root.querySelector<HTMLButtonElement>('[data-when-clear]');
  const hint = root.querySelector<HTMLElement>('#when-hint');
  if (!chipsEl || !input || !clear || !hint) throw new Error('when markup ontbreekt');

  const render = (): void => {
    chipsEl.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((btn) => {
      const on = moment === null && btn.dataset.time === current;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      btn.tabIndex = on || (moment !== null && btn.dataset.time === WHEN_WINDOWS[0]) ? 0 : -1;
    });
    const has = moment !== null;
    root.classList.toggle('has-moment', has);
    if (has && moment !== null) {
      const v = formatLocalDateTime(moment);
      if (input.value !== v) input.value = v;
    } else if (document.activeElement !== input) {
      input.value = '';
    }
    clear.hidden = !has;
    hint.hidden = !has;
    hint.textContent = has ? 'Je ziet wat op dat moment geldt. Werk dat alleen op bepaalde tijden geldt, wordt zo gemeld.' : '';
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
  };
}
