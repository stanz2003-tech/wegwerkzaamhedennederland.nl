/**
 * Item lists on the generated SEO pages: grouped sections ("Nu actief" / "Gepland"), rendered
 * in batches with a "Toon meer" button, every item a link to `/?id=<id>` (deep link into the
 * map). Uses the same list-item component as the app panel.
 */
import { countCategories } from '../data/entity';
import type { IndexItem } from '../data/index';
import type { Category, ItemDetail } from '../data/types';
import type { VehicleMode } from '../data/verdict';
import { esc, formatCount, plural } from './format';
import { modelFromIndexItem, renderListItem } from './list-item';

/** Default number of items rendered before "Toon meer". */
export const ENTITY_BATCH = 25;

/** Singular / plural nouns per category, for the summary sentence. */
const CATEGORY_NOUN: Record<Category, [one: string, many: string]> = {
  werk: ['werkzaamheid', 'werkzaamheden'],
  afsluiting: ['afsluiting', 'afsluitingen'],
  file: ['file', 'files'],
  incident: ['incident', 'incidenten'],
  brug: ['brugopening', 'brugopeningen'],
  evenement: ['evenement', 'evenementen'],
  overig: ['melding', 'meldingen'],
};

/** Order the categories appear in the summary sentence. */
const NOUN_ORDER: readonly Category[] = ['werk', 'afsluiting', 'file', 'incident', 'brug', 'evenement', 'overig'];

/** "3 werkzaamheden, 1 afsluiting" — empty string when there is nothing to count. */
export function countsSentence(items: readonly IndexItem[]): string {
  const counts = countCategories(items);
  const parts: string[] = [];
  for (const cat of NOUN_ORDER) {
    const n = counts.get(cat) ?? 0;
    const noun = CATEGORY_NOUN[cat];
    if (n > 0) parts.push(plural(n, noun[0], noun[1]));
  }
  return parts.join(', ');
}

/**
 * The one-line summary under the heading:
 * "3 werkzaamheden, 1 afsluiting nu actief · 12 gepland".
 */
export function summaryText(active: readonly IndexItem[], upcoming: readonly IndexItem[]): string {
  const parts: string[] = [];
  const nu = countsSentence(active);
  if (nu) parts.push(`${nu} nu actief`);
  else parts.push('Nu niets actief');
  if (upcoming.length > 0) parts.push(`${formatCount(upcoming.length)} gepland`);
  if (active.length === 0 && upcoming.length === 0) return 'Geen actuele of geplande meldingen bekend';
  return parts.join(' · ');
}

export interface EntitySection {
  /** Heading above the group; omitted for a single ungrouped list. */
  title?: string;
  items: readonly IndexItem[];
  /**
   * Render the group as a collapsed `<details>` instead of an open section. Used for the
   * background measures on the window pages ("loopt al langer"): they are honest context, not
   * the news of that window, so they must not push the actual changes off the screen.
   */
  collapsed?: boolean;
  /** One-line explanation shown inside a collapsed group, above the items. */
  note?: string;
}

export interface EntityListOptions {
  batch?: number;
  /** Extra query parameters appended to the deep link, e.g. `cat=file`. */
  linkQuery?: string;
  /** Vehicle mode the verdict pills are computed for (default: auto). */
  mode?: VehicleMode;
  /** The moment the verdicts are asked for (period check); defaults to `now`. */
  at?: number;
  /** Full details by id when the page has them (EntityFile): periods, from/to. */
  details?: ReadonlyMap<string, ItemDetail>;
}

function itemHref(id: string, query: string | undefined): string {
  const q = query ? `&${query}` : '';
  return `/?id=${encodeURIComponent(id)}${q}`;
}

function renderBatch(container: HTMLElement, items: readonly IndexItem[], from: number, count: number, now: number, opts: EntityListOptions): void {
  const slice = items.slice(from, from + count);
  const html = slice
    .map((it, i) => {
      const d = opts.details?.get(it.id);
      return renderListItem(modelFromIndexItem(it), now, {
        href: itemHref(it.id, opts.linkQuery),
        index: from === 0 ? i : 99,
        mode: opts.mode ?? 'auto',
        ...(opts.at !== undefined ? { at: opts.at } : {}),
        ...(d?.periods ? { periods: d.periods } : {}),
        ...(d?.to ? { to: d.to } : {}),
        ...(d?.from ? { from: d.from } : {}),
      });
    })
    .join('');
  container.insertAdjacentHTML('beforeend', html);
}

/** `<h2>` heading of an open group, or the `<summary>` of a collapsed one. */
function buildHeading(section: EntitySection): HTMLElement {
  const count = `<span class="entity-list__group-count">${formatCount(section.items.length)}</span>`;
  if (section.collapsed) {
    const summary = document.createElement('summary');
    summary.className = 'entity-list__group-title';
    summary.innerHTML = `<span>${esc(section.title ?? '')}</span> ${count}`;
    return summary;
  }
  const h = document.createElement('h2');
  h.className = 'entity-list__group-title';
  h.innerHTML = `${esc(section.title ?? '')} ${count}`;
  return h;
}

function buildSection(section: EntitySection, now: number, opts: EntityListOptions): HTMLElement {
  const batch = opts.batch ?? ENTITY_BATCH;
  const group = document.createElement(section.collapsed ? 'details' : 'section');
  group.className = section.collapsed ? 'entity-list__group entity-list__group--collapsed' : 'entity-list__group';

  if (section.title) group.appendChild(buildHeading(section));
  if (section.note) {
    const note = document.createElement('p');
    note.className = 'entity-list__group-note';
    note.textContent = section.note;
    group.appendChild(note);
  }

  const items = document.createElement('div');
  items.className = 'entity-list__items';
  group.appendChild(items);
  renderBatch(items, section.items, 0, batch, now, opts);

  let shown = Math.min(batch, section.items.length);
  if (shown < section.items.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn--secondary entity-list__more';
    const label = (): void => {
      more.textContent = `Toon meer (${plural(section.items.length - shown, 'melding', 'meldingen')})`;
    };
    label();
    more.addEventListener('click', () => {
      const before = shown;
      renderBatch(items, section.items, shown, batch, now, opts);
      shown = Math.min(shown + batch, section.items.length);
      if (shown >= section.items.length) more.remove();
      else label();
      items.querySelectorAll<HTMLElement>('.item')[before]?.focus();
    });
    group.appendChild(more);
  }
  return group;
}

/** Replaces the contents of `root` with the given sections. Empty sections are skipped. */
export function renderEntityList(
  root: HTMLElement,
  sections: readonly EntitySection[],
  now: number,
  opts: EntityListOptions = {},
): void {
  root.setAttribute('aria-busy', 'false');
  const filled = sections.filter((s) => s.items.length > 0);
  if (filled.length === 0) {
    root.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const section of filled) frag.appendChild(buildSection(section, now, opts));
  root.replaceChildren(frag);
}

/**
 * Placeholder rows so the list has its final height before the data arrives (no layout shift).
 * Rendered synchronously at page start; replaced by `renderEntityList`.
 */
export function renderEntitySkeleton(root: HTMLElement, rows = 4): void {
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = `<div class="skeleton" aria-hidden="true">${Array.from(
    { length: rows },
    () => '<div class="skeleton__row"><span class="skeleton__badge"></span><span class="skeleton__lines"><span></span><span></span><span></span></span></div>',
  ).join('')}</div><p class="sr-only">Meldingen worden geladen</p>`;
}

/** Quiet Dutch notice in place of the list when the data could not be loaded. */
export function renderEntityNotice(root: HTMLElement, text: string): void {
  root.setAttribute('aria-busy', 'false');
  root.innerHTML = `<p class="entity-list__notice" role="status">${esc(text)}</p>`;
}
