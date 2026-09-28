/**
 * Layout glue of the map panel that main.ts would otherwise grow with:
 *   - the "Filters · …" disclosure around the category chips and the relevance switch, whose
 *     summary always states what is really filtered (mobiel-3, owner decision 5);
 *   - the detail mode (`.panel.is-detail`): answer, filters and list bar step aside, and on a
 *     phone Terug / Deel move into the grip row (mobiel-6, overzicht-10);
 *   - the skip links, which focus and scroll inside the panel instead of scrolling the page.
 *
 * `filtersSummaryText` is pure (tested); the rest only wires elements it is given.
 */
import type { Category } from '../data/types';
import { CATEGORY_META } from './categories';
import { plural } from './format';
import { ICONS } from './icons';
import type { PanelController } from './panel';

export interface FiltersState {
  /** The selected categories; null = all of them. */
  cats: ReadonlySet<Category> | null;
  /** "Alleen relevant voor …" is on. */
  hideNvt: boolean;
  /** How many items the relevance switch hides right now (0 when it is off). */
  hidden: number;
}

/**
 * "Filters · alle soorten", "Filters · alleen afsluitingen", "Filters · 2 soorten", plus
 * " · 12 meldingen voor ander verkeer verborgen" while the relevance switch hides items, or
 * " · ook voor ander verkeer" while it is off. Collapsed, this line is all a reader sees of the
 * filters, so it never says "alles" while something is hidden.
 */
export function filtersSummaryText(s: FiltersState): string {
  const cats = s.cats && s.cats.size > 0 ? [...s.cats] : null;
  const first = cats?.[0];
  const kinds = !cats ? 'alle soorten' : cats.length === 1 && first ? `alleen ${CATEGORY_META[first].plural.toLowerCase()}` : `${cats.length} soorten`;
  const relevance = !s.hideNvt ? ' · ook voor ander verkeer' : s.hidden > 0 ? ` · ${plural(s.hidden, 'melding', 'meldingen')} voor ander verkeer verborgen` : '';
  return `Filters · ${kinds}${relevance}`;
}

/** True when the filters differ from the default "alle soorten, alleen relevant". */
export function filtersActive(s: FiltersState): boolean {
  return (s.cats !== null && s.cats.size > 0) || !s.hideNvt;
}

const FILTERS_OPEN_KEY = 'wegwerk:filters-open';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(FILTERS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(FILTERS_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the disclosure just starts closed next time.
  }
}

export interface PanelLayoutEls {
  panel: HTMLElement;
  filters: HTMLDetailsElement;
  filtersSummary: HTMLElement;
  detailBar: HTMLElement;
  detail: HTMLElement;
}

export interface PanelLayoutCallbacks {
  onBack(): void;
  onShare(): void;
}

export interface PanelLayout {
  /** Rewrites the filters summary for the current state. */
  setFilters(s: FiltersState): void;
  /** Enters or leaves the detail mode (idempotent; opening scrolls the panel to the top once). */
  setDetail(open: boolean): void;
  /** Focuses the visible "Terug" (grip row on a phone, top of the detail on desktop) without scrolling the page. */
  focusBack(): void;
}

export function mountPanelLayout(els: PanelLayoutEls, panel: PanelController, cb: PanelLayoutCallbacks): PanelLayout {
  const { filters, filtersSummary, detailBar } = els;

  filters.open = readOpen();
  filters.addEventListener('toggle', () => storeOpen(filters.open));
  // The text sits in its own span so the chevron can follow it.
  filtersSummary.innerHTML = `${ICONS.slidersHorizontal}<span data-filters-text>${filtersSummary.textContent ?? ''}</span>${ICONS.chevronDown}`;
  const summaryText = filtersSummary.querySelector<HTMLElement>('[data-filters-text]');

  const back = detailBar.querySelector<HTMLButtonElement>('[data-panel-back]');
  const share = detailBar.querySelector<HTMLButtonElement>('[data-panel-share]');
  if (!summaryText || !back || !share) throw new Error('panel-layout markup ontbreekt');
  back.innerHTML = `${ICONS.arrowLeft}<span>Terug</span>`;
  share.innerHTML = `${ICONS.share2}<span>Deel</span>`;
  back.addEventListener('click', () => cb.onBack());
  share.addEventListener('click', () => cb.onShare());

  wireSkipLinks(panel);

  return {
    setFilters(s) {
      summaryText.textContent = filtersSummaryText(s);
      filters.classList.toggle('is-active', filtersActive(s));
    },
    setDetail(open) {
      const was = els.panel.classList.contains('is-detail');
      els.panel.classList.toggle('is-detail', open);
      detailBar.hidden = !open;
      // A melding opens at its verdict; a repaint (other mode or moment) keeps the reader's place.
      if (open && !was) panel.scrollEl.scrollTop = 0;
    },
    focusBack() {
      // Both exist in detail mode; CSS shows one of them, and only a rendered one takes focus.
      const target = [back, els.detail.querySelector<HTMLElement>('[data-back]')].find((b) => b && b.getClientRects().length > 0);
      target?.focus({ preventScroll: true });
    },
  };
}

/**
 * "Naar zoeken" / "Naar de meldingen": the native fragment jump scrolls every ancestor of the
 * target, the page included, which on a phone moved the map out of view. Focus without scrolling
 * and scroll only the panel instead. Without JS the links still work as plain fragments.
 */
function wireSkipLinks(panel: PanelController): void {
  document.querySelectorAll<HTMLAnchorElement>('a[data-skip]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href')?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      panel.ensureAtLeast('half');
      target.focus({ preventScroll: true });
      panel.scrollTo(target);
    });
  });
}
