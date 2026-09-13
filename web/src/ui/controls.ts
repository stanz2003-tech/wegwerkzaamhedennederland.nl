/**
 * Small controls: the "Alleen in beeld" switch and the sort select.
 */
import { SORT_OPTIONS, isSortId, type SortId } from '../data/filter';
import { esc } from './format';
import { ICONS } from './icons';

export interface ToggleSwitch {
  root: HTMLElement;
  set(on: boolean): void;
  get(): boolean;
  /** Renames the switch (the relevance switch follows the vehicle mode). */
  setLabel(label: string): void;
}

export function mountSwitch(root: HTMLElement, label: string, initial: boolean, onChange: (on: boolean) => void): ToggleSwitch {
  root.classList.add('switch');
  root.innerHTML = `<button type="button" class="switch__btn" role="switch" aria-checked="${initial ? 'true' : 'false'}">
      <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
      <span class="switch__label">${esc(label)}</span>
    </button>`;
  const btn = root.querySelector<HTMLButtonElement>('.switch__btn');
  if (!btn) throw new Error('switch markup ontbreekt');
  let on = initial;
  const render = (): void => {
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  btn.addEventListener('click', () => {
    on = !on;
    render();
    onChange(on);
  });
  return {
    root,
    set(v) {
      on = v;
      render();
    },
    get: () => on,
    setLabel(label) {
      const el = btn.querySelector<HTMLElement>('.switch__label');
      if (el) el.textContent = label;
    },
  };
}

export interface SortSelect {
  root: HTMLElement;
  set(id: SortId): void;
}

export function mountSortSelect(root: HTMLElement, initial: SortId, onChange: (id: SortId) => void): SortSelect {
  root.classList.add('sort');
  const id = `sort-${Math.random().toString(36).slice(2, 7)}`;
  root.innerHTML = `<label class="sort__label" for="${id}">${ICONS.arrowUpDown}<span class="sr-only">Sorteren op</span></label>
    <select id="${id}" class="sort__select">
      ${SORT_OPTIONS.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}
    </select>`;
  const select = root.querySelector<HTMLSelectElement>('select');
  if (!select) throw new Error('sort markup ontbreekt');
  select.value = initial;
  select.addEventListener('change', () => {
    if (isSortId(select.value)) onChange(select.value);
  });
  return {
    root,
    set(v) {
      select.value = v;
    },
  };
}
