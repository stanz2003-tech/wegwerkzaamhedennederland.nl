/**
 * Item lists on the generated SEO pages: grouped sections ("Nu actief" / "Gepland"), rendered
 * in batches with a "Toon meer" button, every item a link to `/#id=<id>` (deep link into the
 * map; map-link.ts `mapHashHref` says why the hash). Uses the same list-item component as the
 * app panel.
 */
import type { IndexItem } from '../data/index';
import { closedBothWays } from '../data/forecast';
import type { ItemDetail } from '../data/types';
import { VERDICT_SEVERITY, type Verdict, type VehicleMode } from '../data/verdict';
import { esc, formatCount, plural } from './format';
import { groupSeries, memberCount, type GroupFields, type ListGroup } from './list-group';
import { renderGroupHtml } from './list-group-row';
import { listItemVerdict, modelFromIndexItem, renderListItem, type ListItemOptions } from './list-item';
import { mapHashHref } from './map-link';

/** Default number of items rendered before "Toon meer". */
export const ENTITY_BATCH = 25;

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
  /**
   * The page's vehicle and moment or day (`v=vracht&dag=2026-10-06`, `t=2026-10-03T08:00`; built by
   * ui/map-link.ts), appended to every deep link so the map opens on the verdict the row's pill
   * shows instead of "nu" for auto (zoek-10).
   */
  mapQuery?: string;
  /** Vehicle mode the verdict pills are computed for (default: auto). */
  mode?: VehicleMode;
  /** The moment the verdicts are asked for (period check); defaults to `now`. */
  at?: number;
  /** A window instead of a moment (a day picked in the strip); wins over `at`. */
  window?: { from: number; to: number };
  /** Full details by id when the page has them (EntityFile): periods, timeline, from/to. */
  details?: ReadonlyMap<string, ItemDetail>;
  /**
   * Render every closure ("Weg dicht" / "Rijbaan dicht") of a section in its first batch, so
   * none sits behind "Toon meer". Road and place pages turn this on; the list pages whose whole
   * subject is closures (/afsluitingen/) keep plain batches.
   */
  revealClosures?: boolean;
}

export function itemHref(id: string, opts: Pick<EntityListOptions, 'mapQuery' | 'linkQuery'> = {}): string {
  return mapHashHref(`id=${encodeURIComponent(id)}`, opts.mapQuery, opts.linkQuery);
}

/** The list-item options of one row: mode, moment or window, and the detail when the page has it. */
function rowOptions(it: IndexItem, opts: EntityListOptions): ListItemOptions {
  const d = opts.details?.get(it.id);
  return {
    mode: opts.mode ?? 'auto',
    ...(opts.at !== undefined ? { at: opts.at } : {}),
    ...(opts.window ? { window: opts.window } : {}),
    ...(d?.periods ? { periods: d.periods } : {}),
    ...(d?.tl ? { tl: d.tl } : {}),
    ...(d?.tlTo ? { tlTo: d.tlTo } : {}),
    ...(d?.to ? { to: d.to } : {}),
    ...(d?.from ? { from: d.from } : {}),
    ...(closedBothWays(d) ? { both: true } : {}),
  };
}

/** The verdict the row's pill shows for these options (same inputs as renderBatch). */
export function rowVerdict(it: IndexItem, now: number, opts: EntityListOptions = {}): Verdict {
  return listItemVerdict(modelFromIndexItem(it), now, rowOptions(it, opts));
}

/**
 * Worst row verdict first; a stable sort, so within one level the caller's order (impact) stays.
 * Only the order changes — every row keeps the pill it had.
 */
export function sortByVerdict(items: readonly IndexItem[], now: number, opts: EntityListOptions = {}): IndexItem[] {
  const rank = new Map(items.map((it) => [it.id, VERDICT_SEVERITY.indexOf(rowVerdict(it, now, opts).level)]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? VERDICT_SEVERITY.length) - (rank.get(b.id) ?? VERDICT_SEVERITY.length));
}

/**
 * Size of the first batch: at least `batch`, and far enough to include the last closure. In a
 * section sorted worst first that is simply the number of closures; in one sorted by start time
 * ("Gepland") it still guarantees no closure is hidden behind "Toon meer".
 */
export function firstBatchSize(items: readonly IndexItem[], batch: number, now: number, opts: EntityListOptions = {}): number {
  if (!opts.revealClosures) return batch;
  let last = -1;
  items.forEach((it, i) => {
    const level = rowVerdict(it, now, opts).level;
    if (level === 'dicht' || level === 'rijbaan') last = i;
  });
  return Math.max(batch, last + 1);
}

/** What grouping reads of a row: its section and direction from the detail, its index point. */
function groupFields(it: IndexItem, opts: EntityListOptions): GroupFields {
  const d = opts.details?.get(it.id);
  // A live extra without a point geometry carries 0,0: no position rather than a false neighbour.
  const pos: [number, number] | null = it.lon === 0 && it.lat === 0 ? null : [it.lon, it.lat];
  return { id: it.id, road: it.road, title: it.title, start: it.start, end: it.end, from: d?.from, to: d?.to, pos };
}

/**
 * The rows of a section folded into series and street parts (ui/list-group.ts), judged with the
 * same verdict the pills show. Each member keeps its own pill in the expansion.
 */
export function groupRows(items: readonly IndexItem[], now: number, opts: EntityListOptions = {}): ListGroup<IndexItem>[] {
  return groupSeries(items, (it) => rowVerdict(it, now, opts).level, (it) => groupFields(it, opts));
}

/** `firstBatchSize` for grouped rows: no group with a closure behind "Toon meer". */
export function firstGroupBatch(groups: readonly ListGroup<IndexItem>[], batch: number, opts: EntityListOptions = {}): number {
  if (!opts.revealClosures) return batch;
  let last = -1;
  groups.forEach((g, i) => {
    if (g.level === 'dicht' || g.level === 'rijbaan') last = i;
  });
  return Math.max(batch, last + 1);
}

function batchHtml(groups: readonly ListGroup<IndexItem>[], from: number, count: number, now: number, opts: EntityListOptions): string {
  return groups
    .slice(from, from + count)
    .map((g, i) =>
      renderGroupHtml(g, (it, extra) =>
        renderListItem(modelFromIndexItem(it), now, {
          href: itemHref(it.id, opts),
          index: from === 0 ? i : 99,
          ...rowOptions(it, opts),
          ...extra,
        }),
      ),
    )
    .join('');
}

function renderBatch(container: HTMLElement, groups: readonly ListGroup<IndexItem>[], from: number, count: number, now: number, opts: EntityListOptions): void {
  container.insertAdjacentHTML('beforeend', batchHtml(groups, from, count, now, opts));
}

/** Inner HTML of a group's `<h2>`, or of the `<summary>` of a collapsed one. */
function headingHtml(section: EntitySection): string {
  const count = `<span class="entity-list__group-count">${formatCount(section.items.length)}</span>`;
  return section.collapsed ? `<span>${esc(section.title ?? '')}</span> ${count}` : `${esc(section.title ?? '')} ${count}`;
}

/** `<h2>` heading of an open group, or the `<summary>` of a collapsed one. */
function buildHeading(section: EntitySection): HTMLElement {
  const el = document.createElement(section.collapsed ? 'summary' : 'h2');
  el.className = 'entity-list__group-title';
  el.innerHTML = headingHtml(section);
  return el;
}

export interface SectionsHtml {
  html: string;
  /** Meldingen behind the row limit, over all sections. */
  more: number;
}

/**
 * The same sections as `renderEntityList`, as an HTML string with at most `limit` rows in all and
 * no "Toon meer" button: the build writes it into the page (ui/entity-snapshot.ts) for readers
 * that run no script, and the page script replaces it with the live list.
 */
export function renderSectionsHtml(sections: readonly EntitySection[], now: number, opts: EntityListOptions = {}, limit = ENTITY_BATCH): SectionsHtml {
  let left = limit;
  let more = 0;
  const parts: string[] = [];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    const rows = groupRows(section.items, now, opts);
    const shown = Math.min(rows.length, left);
    left -= shown;
    more += memberCount(rows.slice(shown));
    if (shown === 0) continue;
    const tag = section.collapsed ? 'details' : 'section';
    const cls = section.collapsed ? 'entity-list__group entity-list__group--collapsed' : 'entity-list__group';
    const heading = section.title ? `<${section.collapsed ? 'summary' : 'h2'} class="entity-list__group-title">${headingHtml(section)}</${section.collapsed ? 'summary' : 'h2'}>` : '';
    const note = section.note ? `<p class="entity-list__group-note">${esc(section.note)}</p>` : '';
    parts.push(`<${tag} class="${cls}">${heading}${note}<div class="entity-list__items">${batchHtml(rows, 0, shown, now, opts)}</div></${tag}>`);
  }
  return { html: parts.join(''), more };
}

/** The rows card of a group, filled with `rows[from, to)`. */
function buildItems(rows: readonly ListGroup<IndexItem>[], from: number, to: number, now: number, opts: EntityListOptions): HTMLElement {
  const items = document.createElement('div');
  items.className = 'entity-list__items';
  renderBatch(items, rows, from, to - from, now, opts);
  return items;
}

/**
 * One section as DOM: its heading and rows, with "Toon meer" when there are more. With `splitAt`
 * inside the first batch it comes in two parts, the heading with the first `splitAt` rows and a
 * second card with the rest, so the list's break (an ad slot) can stand between them.
 */
function buildSection(section: EntitySection, rows: readonly ListGroup<IndexItem>[], now: number, opts: EntityListOptions, splitAt = 0): HTMLElement[] {
  const batch = opts.batch ?? ENTITY_BATCH;
  const first = Math.min(firstGroupBatch(rows, batch, opts), rows.length);
  const split = splitAt > 0 && splitAt < first ? splitAt : 0;
  const group = document.createElement(section.collapsed ? 'details' : 'section');
  group.className = section.collapsed ? 'entity-list__group entity-list__group--collapsed' : 'entity-list__group';

  if (section.title) group.appendChild(buildHeading(section));
  if (section.note) {
    const note = document.createElement('p');
    note.className = 'entity-list__group-note';
    note.textContent = section.note;
    group.appendChild(note);
  }
  if (split > 0) group.appendChild(buildItems(rows, 0, split, now, opts));

  /** The part that grows with "Toon meer": the whole section, or what follows the break. */
  const tail = split > 0 ? document.createElement('div') : group;
  if (split > 0) {
    tail.className = 'entity-list__group entity-list__group--rest';
    tail.setAttribute('role', 'group');
    tail.setAttribute('aria-label', `${section.title ?? 'Meldingen'}, vervolg`);
  }
  const items = buildItems(rows, split, first, now, opts);
  tail.appendChild(items);

  let shown = first;
  if (shown < rows.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn--secondary entity-list__more';
    const label = (): void => {
      more.textContent = `Toon meer (${plural(memberCount(rows.slice(shown)), 'melding', 'meldingen')})`;
    };
    label();
    more.addEventListener('click', () => {
      const before = shown - split;
      renderBatch(items, rows, shown, batch, now, opts);
      shown = Math.min(shown + batch, rows.length);
      if (shown >= rows.length) more.remove();
      else label();
      const next = items.children[before];
      (next?.matches('.item') ? (next as HTMLElement) : next?.querySelector<HTMLElement>('.item'))?.focus();
    });
    tail.appendChild(more);
  }
  return split > 0 ? [group, tail] : [group];
}

/* ------------------------------ the break in the list ------------------------------ */

/** Rows above the break: about one phone screen of list, so the break is a screen below the ad above the list. */
export const BREAK_AFTER_ROWS = 12;
/** Rows that must follow the break; with fewer the list simply ends and the break comes after it. */
export const BREAK_MIN_ROWS_AFTER = 4;

export interface ListBreak {
  /** Index of the section the break falls in (or directly before, when `row` is 0). */
  section: number;
  /** Rows of that section above the break. */
  row: number;
}

/**
 * Where the list's break goes: after `after` rows, counted through the open sections in order,
 * when at least `minRest` rows follow. A folded section ends the count (a break never goes
 * inside it). Null when the list is too short: the break then follows the whole list.
 */
export function listBreakAt(
  sections: ReadonlyArray<{ rows: number; collapsed?: boolean }>,
  after = BREAK_AFTER_ROWS,
  minRest = BREAK_MIN_ROWS_AFTER,
): ListBreak | null {
  const firstFolded = sections.findIndex((s) => s.collapsed);
  const open = firstFolded < 0 ? sections : sections.slice(0, firstFolded);
  const total = open.reduce((n, s) => n + s.rows, 0);
  if (total < after + minRest) return null;
  let above = 0;
  for (const [section, s] of open.entries()) {
    if (above + s.rows > after) return { section, row: after - above };
    above += s.rows;
  }
  return null;
}

/**
 * The element inside the list that must never leave the page: the ad slot the templates put
 * there (`data-list-break`). Taking an ad out of the document and putting it back reloads it, so
 * every renderer below builds the list around this element and leaves it where it is.
 */
function listBreak(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(':scope > [data-list-break]');
}

/**
 * True while the break shows something or still may (an ad slot that waits or is open). Its own
 * display decides, not whether it is visible right now: the list itself is hidden while a melding
 * is open (a visitor who lands on `#id=…`), and it must still be built around the break then.
 */
function breakIsLive(el: HTMLElement | null): el is HTMLElement {
  return el !== null && !el.hidden && getComputedStyle(el).display !== 'none';
}

/** Replaces the list's content: `above` the break and `below` it; the break itself stays put. */
function setListContent(root: HTMLElement, above: readonly Node[], below: readonly Node[] = []): void {
  const keep = listBreak(root);
  if (!keep) {
    root.replaceChildren(...above, ...below);
    return;
  }
  for (const child of Array.from(root.childNodes)) if (child !== keep) child.remove();
  keep.before(...above);
  keep.after(...below);
}

/** The children of a throwaway element holding `html`, for the renderers that write a fragment. */
function nodesFromHtml(html: string): Node[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return Array.from(holder.childNodes);
}

/** Replaces the contents of `root` with the given sections. Empty sections are skipped. */
export function renderEntityList(
  root: HTMLElement,
  sections: readonly EntitySection[],
  now: number,
  opts: EntityListOptions = {},
): void {
  root.setAttribute('aria-busy', 'false');
  const filled = sections.filter((s) => s.items.length > 0).map((section) => ({ section, rows: groupRows(section.items, now, opts) }));
  // No break to place (no slot in this list, or it shows nothing): the list in one piece.
  const at = breakIsLive(listBreak(root)) ? listBreakAt(filled.map(({ section, rows }) => ({ rows: rows.length, collapsed: section.collapsed === true }))) : null;
  if (!at) {
    setListContent(root, filled.flatMap(({ section, rows }) => buildSection(section, rows, now, opts)));
    return;
  }
  const built = filled.map(({ section, rows }, i) => buildSection(section, rows, now, opts, i === at.section ? at.row : 0));
  // The section the break falls in gave two parts when it was split: the first goes above.
  const above = built.flatMap((parts, i) => (i < at.section ? parts : i === at.section && parts.length === 2 ? parts.slice(0, 1) : []));
  setListContent(root, above, built.flat().filter((node) => !above.includes(node)));
}

/**
 * Placeholder rows so the list has its final height before the data arrives (no layout shift).
 * Rendered synchronously at page start; replaced by `renderEntityList`.
 */
export function renderEntitySkeleton(root: HTMLElement, rows = 4): void {
  root.setAttribute('aria-busy', 'true');
  setListContent(
    root,
    nodesFromHtml(
      `<div class="skeleton" aria-hidden="true">${Array.from(
        { length: rows },
        () => '<div class="skeleton__row"><span class="skeleton__badge"></span><span class="skeleton__lines"><span></span><span></span><span></span></span></div>',
      ).join('')}</div><p class="sr-only">Meldingen worden geladen</p>`,
    ),
  );
}

/** Quiet Dutch notice in place of the list when the data could not be loaded. */
export function renderEntityNotice(root: HTMLElement, text: string): void {
  root.setAttribute('aria-busy', 'false');
  setListContent(root, nodesFromHtml(`<p class="entity-list__notice" role="status">${esc(text)}</p>`));
}
