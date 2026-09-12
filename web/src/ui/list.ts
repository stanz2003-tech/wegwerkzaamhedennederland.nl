/**
 * The result list: batches of 40 with "Toon meer", skeleton while loading, empty state with a
 * reset action, error banner with retry. Items are buttons (keyboard: arrows move between them).
 */
import { esc, plural } from './format';
import { ICONS } from './icons';
import { renderListItem, type ListItemModel } from './list-item';

export const LIST_BATCH = 40;
const SKELETON_ROWS = 6;

export interface ListCallbacks {
  onSelect(id: string): void;
  onHover(id: string | null): void;
  onReset(): void;
  onRetry(): void;
}

export interface ListView {
  root: HTMLElement;
  setItems(items: readonly ListItemModel[], now: number, selectedId: string | null): void;
  setLoading(): void;
  setError(message: string): void;
  setSelected(id: string | null): void;
  /** Moves keyboard focus to the first item (used after closing the detail view). */
  focusItem(id: string | null): void;
}

export function mountList(root: HTMLElement, cb: ListCallbacks): ListView {
  root.classList.add('list');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Meldingen');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-busy', 'false');

  let items: readonly ListItemModel[] = [];
  let shown = 0;
  let now = Date.now();
  let selectedId: string | null = null;

  const renderMore = (): void => {
    const next = items.slice(shown, shown + LIST_BATCH);
    const html = next.map((m, i) => renderListItem(m, now, { selected: m.id === selectedId, index: shown === 0 ? i : 99 })).join('');
    const more = root.querySelector<HTMLElement>('.list__more');
    const container = root.querySelector<HTMLElement>('.list__items');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', html);
    shown += next.length;
    if (more) {
      if (shown < items.length) {
        more.hidden = false;
        more.textContent = `Toon meer (${plural(items.length - shown, 'melding', 'meldingen')})`;
      } else {
        more.hidden = true;
      }
    }
  };

  const renderAll = (): void => {
    root.setAttribute('aria-busy', 'false');
    if (items.length === 0) {
      root.innerHTML = `<div class="empty">
          <div class="empty__sign" aria-hidden="true">${ICONS.trafficCone}</div>
          <p class="empty__title">Geen meldingen in dit gebied</p>
          <p class="empty__text">Zoom uit, kies een andere periode of zet de categorieën weer aan.</p>
          <button type="button" class="btn btn--secondary" data-reset>${ICONS.refreshCw}<span>Filters wissen</span></button>
        </div>`;
      return;
    }
    root.innerHTML = `<div class="list__items"></div><button type="button" class="btn btn--ghost list__more" hidden></button>`;
    shown = 0;
    renderMore();
  };

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-reset]')) {
      cb.onReset();
      return;
    }
    if (target.closest('[data-retry]')) {
      cb.onRetry();
      return;
    }
    if (target.closest('.list__more')) {
      const before = shown;
      renderMore();
      root.querySelector<HTMLElement>(`.item:nth-child(${before + 1})`)?.focus();
      return;
    }
    const item = target.closest<HTMLElement>('.item[data-id]');
    if (item?.dataset.id) cb.onSelect(item.dataset.id);
  });

  root.addEventListener('pointerover', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.item[data-id]');
    cb.onHover(item?.dataset.id ?? null);
  });
  root.addEventListener('pointerleave', () => cb.onHover(null));
  root.addEventListener('focusin', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.item[data-id]');
    if (item?.dataset.id) cb.onHover(item.dataset.id);
  });

  root.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>('.item'));
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    e.preventDefault();
    let next = current;
    if (e.key === 'ArrowDown') next = Math.min(current + 1, focusables.length - 1);
    if (e.key === 'ArrowUp') next = Math.max(current - 1, 0);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = focusables.length - 1;
    focusables[next]?.focus();
  });

  return {
    root,
    setItems(next, at, selected) {
      items = next;
      now = at;
      selectedId = selected;
      renderAll();
    },
    setLoading() {
      root.setAttribute('aria-busy', 'true');
      root.innerHTML = `<div class="skeleton" aria-hidden="true">${Array.from(
        { length: SKELETON_ROWS },
        () => `<div class="skeleton__row"><span class="skeleton__badge"></span><span class="skeleton__lines"><span></span><span></span><span></span></span></div>`,
      ).join('')}</div><p class="sr-only">Meldingen worden geladen</p>`;
    },
    setError(message) {
      root.setAttribute('aria-busy', 'false');
      root.innerHTML = `<div class="banner banner--error" role="alert">
          ${ICONS.circleAlert}
          <div><p class="banner__title">De gegevens konden niet worden geladen.</p><p class="banner__text">${esc(message)}</p></div>
          <button type="button" class="btn btn--secondary" data-retry>${ICONS.refreshCw}<span>Opnieuw proberen</span></button>
        </div>`;
    },
    setSelected(id) {
      selectedId = id;
      root.querySelectorAll<HTMLElement>('.item[data-id]').forEach((el) => {
        const on = el.dataset.id === id;
        el.classList.toggle('is-selected', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    },
    focusItem(id) {
      const el = id ? root.querySelector<HTMLElement>(`.item[data-id="${CSS.escape(id)}"]`) : root.querySelector<HTMLElement>('.item');
      el?.focus();
    },
  };
}
