/**
 * The result list: batches of 40 with "Toon meer", skeleton while loading, empty state with a
 * reset action, error banner with retry. Items are buttons (keyboard: arrows move between them);
 * the open one carries `aria-current`, not `aria-pressed` — a row opens the details, it is no
 * toggle, and "schakelknop, niet ingedrukt" on every row said otherwise (toeg-13).
 *
 * The list is NOT a live region: re-rendered on every pan, it made screen readers read thousands
 * of characters (toeg-1). ui/announce.ts speaks the short answer after a user action instead.
 *
 * Focus moves never scroll by themselves (`preventScroll`): inside the clipped bottom sheet the
 * browser scrolled the whole page to reach the row (mobiel-2). `reveal` scrolls the panel.
 *
 * Rows that say the same thing (a nightly series, one street in parts) are folded into one row
 * with an expandable list of its members (ui/list-group.ts); batches count those folded rows.
 */
import type { VehicleMode } from '../data/verdict';
import { esc, formatCount, plural } from './format';
import { ICONS } from './icons';
import { groupSeries, memberCount, type ListGroup } from './list-group';
import { renderGroupHtml } from './list-group-row';
import { listItemVerdict, renderListItem, type ListItemModel } from './list-item';

export const LIST_BATCH = 40;
const SKELETON_ROWS = 6;

export interface ListCallbacks {
  onSelect(id: string): void;
  onHover(id: string | null): void;
  onReset(): void;
  onRetry(): void;
  /** A road badge inside a row was clicked: enter road mode for that road. */
  onRoad?(road: string): void;
  /** "Zoekopdracht wissen" in the empty state of a text filter. */
  onClearQuery?(): void;
  /** Brings a row that just got focus into view inside the panel (ui/panel.ts `scrollTo`). */
  reveal?(el: HTMLElement): void;
}

/** A spelling suggestion for the empty text-filter state ("Bedoelde je Gorinchem?"). */
export interface DidYouMean {
  label: string;
  onPick(): void;
}

export interface ListRenderOptions {
  mode?: VehicleMode;
  /** The moment the verdicts are computed for (defaults to `now`). */
  at?: number;
  /** A picked date (`?dag=`): the verdicts are computed for that window and win over `at`. */
  window?: { from: number; to: number };
  /**
   * The free-text filter behind this list, when there is one. An empty result then gets its own
   * state: "no match for what you typed" is not "nothing going on in this area", and the old
   * "Geen meldingen in dit gebied · Zoom uit" for a typo read as "the road is free" (zoek-3).
   */
  emptyQuery?: string;
  /**
   * Hook for the fuzzy place lookup (P4): when set, the empty text-filter state offers this
   * suggestion as a button above "Zoekopdracht wissen". Nothing sets it yet.
   */
  didYouMean?: DidYouMean;
  /**
   * How many items matched before the caller capped the models it passes (main.ts: 800). When
   * larger than the items given, a visible line under the list says that the rest is missing.
   */
  total?: number;
}

/** "Je ziet de eerste 800 van 1.234 meldingen. …" — or '' when nothing was cut off. */
export function capLine(shown: number, total: number | undefined): string {
  if (total === undefined || total <= shown) return '';
  return `Je ziet de eerste ${formatCount(shown)} van ${plural(total, 'melding', 'meldingen')}. Zoom in of zoek een weg om de rest te zien.`;
}

export interface ListView {
  root: HTMLElement;
  setItems(items: readonly ListItemModel[], now: number, selectedId: string | null, opts?: ListRenderOptions): void;
  setLoading(): void;
  setError(message: string): void;
  setSelected(id: string | null): void;
  /** Moves keyboard focus to the first item (used after closing the detail view). */
  focusItem(id: string | null): void;
}

export function mountList(root: HTMLElement, cb: ListCallbacks): ListView {
  root.classList.add('list');
  root.setAttribute('role', 'region');
  // Named by the visible-to-AT heading above the list bar (index.html), which the skip link
  // "Naar de meldingen" targets; a bare label is the fallback.
  if (document.getElementById('list-heading')) root.setAttribute('aria-labelledby', 'list-heading');
  else root.setAttribute('aria-label', 'Meldingen');
  root.setAttribute('aria-busy', 'false');

  let items: readonly ListItemModel[] = [];
  let groups: ListGroup<ListItemModel>[] = [];
  let shown = 0;
  let now = Date.now();
  let selectedId: string | null = null;
  let renderOpts: ListRenderOptions = {};

  const focusRow = (el: HTMLElement | null | undefined): void => {
    if (!el) return;
    el.focus({ preventScroll: true });
    cb.reveal?.(el);
  };

  const rowOpts = (): { mode: NonNullable<ListRenderOptions['mode']>; at?: number; window?: { from: number; to: number } } => ({
    mode: renderOpts.mode ?? 'auto',
    ...(renderOpts.at !== undefined ? { at: renderOpts.at } : {}),
    ...(renderOpts.window ? { window: renderOpts.window } : {}),
  });

  /** Rows the keyboard can reach: not the members of a folded group that is closed. */
  const visibleRows = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('.item')).filter((el) => !el.closest('details:not([open])'));

  const renderMore = (): void => {
    const next = groups.slice(shown, shown + LIST_BATCH);
    const html = next
      .map((g, i) =>
        renderGroupHtml(g, (m, extra) =>
          renderListItem(m, now, {
            selected: m.id === selectedId,
            index: shown === 0 ? i : 99,
            ...rowOpts(),
            ...extra,
          }),
        ),
      )
      .join('');
    const more = root.querySelector<HTMLElement>('.list__more');
    const container = root.querySelector<HTMLElement>('.list__items');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', html);
    shown += next.length;
    if (more) {
      if (shown < groups.length) {
        more.hidden = false;
        more.textContent = `Toon meer (${plural(memberCount(groups.slice(shown)), 'melding', 'meldingen')})`;
      } else {
        more.hidden = true;
      }
    }
  };

  const renderEmptyQuery = (query: string): void => {
    const suggestion = renderOpts.didYouMean;
    root.innerHTML = `<div class="empty empty--query">
        <div class="empty__sign" aria-hidden="true">${ICONS.search}</div>
        <p class="empty__title">Niets gevonden voor “${esc(query)}”</p>
        <p class="empty__text">Dat betekent niet dat de weg vrij is. Controleer de spelling of zoek op een wegnummer (A27) of plaatsnaam.</p>
        ${suggestion ? `<button type="button" class="btn btn--primary" data-did-you-mean>Bedoelde je ${esc(suggestion.label)}?</button>` : ''}
        <button type="button" class="btn btn--secondary" data-clear-query>${ICONS.x}<span>Zoekopdracht wissen</span></button>
      </div>`;
  };

  const renderAll = (): void => {
    root.setAttribute('aria-busy', 'false');
    if (items.length === 0 && renderOpts.emptyQuery) {
      renderEmptyQuery(renderOpts.emptyQuery);
      return;
    }
    if (items.length === 0) {
      root.innerHTML = `<div class="empty">
          <div class="empty__sign" aria-hidden="true">${ICONS.trafficCone}</div>
          <p class="empty__title">Geen meldingen in dit gebied</p>
          <p class="empty__text">Zoom uit, kies een andere periode of zet de categorieën weer aan.</p>
          <button type="button" class="btn btn--secondary" data-reset>${ICONS.refreshCw}<span>Filters wissen</span></button>
        </div>`;
      return;
    }
    const cap = capLine(items.length, renderOpts.total);
    root.innerHTML = `<div class="list__items"></div><button type="button" class="btn btn--ghost list__more" hidden></button>${cap ? `<p class="list__cap">${esc(cap)}</p>` : ''}`;
    const o = rowOpts();
    groups = groupSeries(items, (m) => listItemVerdict(m, now, o).level, (m) => m);
    shown = 0;
    renderMore();
  };

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-reset]')) {
      cb.onReset();
      return;
    }
    if (target.closest('[data-clear-query]')) {
      cb.onClearQuery?.();
      return;
    }
    if (target.closest('[data-did-you-mean]')) {
      renderOpts.didYouMean?.onPick();
      return;
    }
    if (target.closest('[data-retry]')) {
      cb.onRetry();
      return;
    }
    if (target.closest('.list__more')) {
      const before = shown;
      renderMore();
      const next = root.querySelector('.list__items')?.children[before];
      focusRow(next?.matches('.item') ? (next as HTMLElement) : next?.querySelector<HTMLElement>('.item'));
      return;
    }
    const badge = target.closest<HTMLElement>('.item__badge[data-road]');
    if (badge?.dataset.road && cb.onRoad) {
      e.preventDefault();
      e.stopPropagation();
      cb.onRoad(badge.dataset.road);
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
    const focusables = visibleRows();
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    e.preventDefault();
    let next = current;
    if (e.key === 'ArrowDown') next = Math.min(current + 1, focusables.length - 1);
    if (e.key === 'ArrowUp') next = Math.max(current - 1, 0);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = focusables.length - 1;
    focusRow(focusables[next]);
  });

  return {
    root,
    setItems(next, at, selected, opts = {}) {
      items = next;
      now = at;
      selectedId = selected;
      renderOpts = opts;
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
        if (on) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      });
    },
    focusItem(id) {
      const el = id ? root.querySelector<HTMLElement>(`.item[data-id="${CSS.escape(id)}"]`) : root.querySelector<HTMLElement>('.item');
      // A member of a folded group: open the group so the focused row is visible.
      const fold = el?.closest('details');
      if (fold) fold.open = true;
      focusRow(el);
    },
  };
}
