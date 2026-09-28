/**
 * Category chips: "Alles" plus one chip per category, with counts. (The "Wanneer?" row lives in
 * ui/when-control.ts.)
 *
 * The chips are neutral — icon and label, no category tint: colour belongs to the verdict, and a
 * red "Afsluitingen" chip next to red "Weg dicht" pills read as "afsluiting = dicht"
 * (overzicht-6). On and off differ by more than colour: a check mark, weight and fill (toeg-6).
 */
import type { Category } from '../data/types';
import { ALL_CATEGORIES, CATEGORY_META } from './categories';
import { esc, formatCount } from './format';
import { ICONS } from './icons';

export interface CategoryChips {
  root: HTMLElement;
  setSelected(cats: ReadonlySet<Category> | null): void;
  setCounts(counts: Partial<Record<Category, number>>): void;
}

/**
 * The selection after a click on `cat` (`null` = "Alles"). From "Alles" a click isolates that
 * category, so "alleen afsluitingen" stays one click instead of six; after that clicks add and
 * remove. Switching off the last one, or selecting all of them, is "Alles" again.
 */
export function toggleCategory(selected: ReadonlySet<Category> | null, cat: Category): Set<Category> | null {
  if (selected === null) return new Set([cat]);
  const next = new Set(selected);
  if (next.has(cat)) next.delete(cat);
  else next.add(cat);
  return next.size === 0 || next.size === ALL_CATEGORIES.length ? null : next;
}

/** Whether the chip of `cat` shows as pressed. In the "Alles" state only "Alles" is pressed. */
export function categoryPressed(selected: ReadonlySet<Category> | null, cat: Category): boolean {
  return selected !== null && selected.has(cat);
}

function chipHtml(attr: string, icon: string, label: string, count: boolean): string {
  return `<button type="button" class="chip chip--cat" ${attr} aria-pressed="false">
      <span class="chip__icon" aria-hidden="true">${icon}</span>
      <span class="chip__check" aria-hidden="true">${ICONS.check}</span>
      <span class="chip__label">${esc(label)}</span>
      ${count ? '<span class="chip__count" data-count hidden></span>' : ''}
    </button>`;
}

export function mountCategoryChips(root: HTMLElement, onChange: (cats: Set<Category> | null) => void): CategoryChips {
  root.classList.add('chips', 'chips--cats');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Soorten meldingen');
  let selected: Set<Category> | null = null;

  root.innerHTML =
    chipHtml('data-cat-all', ICONS.layers, 'Alles', false) +
    ALL_CATEGORIES.map((cat) => chipHtml(`data-cat="${cat}"`, CATEGORY_META[cat].icon, CATEGORY_META[cat].plural, true)).join('');

  const render = (): void => {
    root.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
      const cat = btn.dataset.cat as Category | undefined;
      const on = cat ? categoryPressed(selected, cat) : selected === null;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
    });
  };

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip');
    if (!btn) return;
    const cat = btn.dataset.cat as Category | undefined;
    const next = cat ? toggleCategory(selected, cat) : null;
    if (next === null && selected === null) return;
    selected = next;
    render();
    onChange(selected ? new Set(selected) : null);
  });

  render();
  return {
    root,
    setSelected(cats) {
      selected = cats && cats.size > 0 && cats.size < ALL_CATEGORIES.length ? new Set(cats) : null;
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
