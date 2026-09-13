/**
 * Category chips: multi-toggle with counts. (The "Wanneer?" row lives in ui/when-control.ts.)
 */
import type { Category } from '../data/types';
import { ALL_CATEGORIES, CATEGORY_META } from './categories';
import { esc, formatCount } from './format';

export interface CategoryChips {
  root: HTMLElement;
  setSelected(cats: ReadonlySet<Category> | null): void;
  setCounts(counts: Partial<Record<Category, number>>): void;
}

/**
 * Category chips. `null` selection = all categories shown as active.
 * Clicking toggles one category; when all are selected, a click isolates that category
 * (so "show only closures" is one click instead of six).
 */
export function mountCategoryChips(
  root: HTMLElement,
  onChange: (cats: Set<Category> | null) => void,
): CategoryChips {
  root.classList.add('chips', 'chips--cats');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Categorieën');
  let selected: Set<Category> | null = null;

  root.innerHTML = ALL_CATEGORIES.map((cat) => {
    const meta = CATEGORY_META[cat];
    return `<button type="button" class="chip chip--cat" data-cat="${cat}" aria-pressed="true" style="--chip-color: var(${meta.color})">
      <span class="chip__bar" aria-hidden="true"></span>
      <span class="chip__icon">${meta.icon}</span>
      <span class="chip__label">${esc(meta.plural)}</span>
      <span class="chip__count" data-count hidden></span>
    </button>`;
  }).join('');

  const render = (): void => {
    root.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((btn) => {
      const cat = btn.dataset.cat as Category;
      const on = selected === null || selected.has(cat);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
    });
  };

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cat]');
    if (!btn) return;
    const cat = btn.dataset.cat as Category;
    const all = new Set(ALL_CATEGORIES);
    if (selected === null) {
      selected = new Set([cat]);
    } else if (selected.has(cat)) {
      selected.delete(cat);
      if (selected.size === 0) selected = null;
    } else {
      selected.add(cat);
      if (selected.size === all.size) selected = null;
    }
    render();
    onChange(selected ? new Set(selected) : null);
  });

  render();
  return {
    root,
    setSelected(cats) {
      selected = cats ? new Set(cats) : null;
      if (selected && selected.size === ALL_CATEGORIES.length) selected = null;
      render();
    },
    setCounts(counts) {
      root.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((btn) => {
        const cat = btn.dataset.cat as Category;
        const n = counts[cat] ?? 0;
        const el = btn.querySelector<HTMLElement>('[data-count]');
        if (!el) return;
        el.textContent = formatCount(n);
        el.hidden = n === 0;
        btn.classList.toggle('is-empty', n === 0);
      });
    },
  };
}
