/**
 * Segmented control "Auto · Vracht · Fiets": the vehicle mode every verdict is computed for.
 * Radio-group semantics (arrow keys move the selection), ≥ 44 px targets.
 */
import { VEHICLE_MODES, type VehicleMode } from '../data/verdict';
import { esc } from './format';
import { ICONS } from './icons';

const MODE_ICON: Record<VehicleMode, string> = { auto: ICONS.car, vracht: ICONS.truck, fiets: ICONS.bike };

export interface ModeSelect {
  root: HTMLElement;
  get(): VehicleMode;
  set(mode: VehicleMode): void;
}

export function mountModeSelect(root: HTMLElement, initial: VehicleMode, onChange: (mode: VehicleMode) => void): ModeSelect {
  root.classList.add('mode');
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', 'Voor welk verkeer wil je de gevolgen zien?');
  let current = initial;

  root.innerHTML = VEHICLE_MODES.map(
    (m) =>
      `<button type="button" class="mode__btn" role="radio" data-mode="${m.id}" aria-checked="false" title="${esc(m.title)}">${MODE_ICON[m.id]}<span>${esc(m.label)}</span></button>`,
  ).join('');

  const render = (): void => {
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      const on = btn.dataset.mode === current;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      btn.tabIndex = on ? 0 : -1;
    });
  };

  const select = (mode: VehicleMode, focus: boolean): void => {
    if (mode === current) return;
    current = mode;
    render();
    if (focus) root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
    onChange(mode);
  };

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (btn) select(btn.dataset.mode as VehicleMode, false);
  });

  root.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const ids = VEHICLE_MODES.map((m) => m.id);
    const i = ids.indexOf(current);
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
    get: () => current,
    set(mode) {
      current = mode;
      render();
    },
  };
}
