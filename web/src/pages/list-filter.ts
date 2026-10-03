/**
 * A filter field on top of the pre-rendered /wegen/, /plaatsen/ and /bruggen/ lists (zoek-9):
 * /plaatsen/ is 342 closed gemeente groups, so Almkerk could only be found by knowing that it
 * lies in Altena. Typing hides the links that do not match, hides the groups left empty and
 * opens the group that holds a matching village. Without JavaScript the full list still works:
 * the field is only inserted by this script. Styles: styles/list-filter.css (imported by list.ts).
 */
import { normalizeText } from '../data/filter';
import { esc } from '../ui/format';

const DEBOUNCE_MS = 100;
/** The attribute that marks a group this filter opened, so clearing the field closes it again. */
const OPENED = 'data-filter-opened';

/** Normalised text a link is matched on: road number without spaces, or the visible name. */
export function linkKey(a: Pick<HTMLElement, 'textContent' | 'dataset'>): string {
  const d = a.dataset;
  return normalizeText(d.road ?? d.woonplaats ?? d.gemeente ?? a.textContent ?? '').replace(/\s+/g, d.road ? '' : ' ');
}

/** Whether a link matches: road numbers by prefix ("a2" → A2, A20), names anywhere ("almk"). */
export function linkMatches(key: string, query: string, isRoad: boolean): boolean {
  if (!query) return true;
  return isRoad ? key.startsWith(query.replace(/\s+/g, '')) : key.includes(query);
}

/** Hides or shows one element; returns whether it is visible. */
function show(el: HTMLElement, visible: boolean): boolean {
  el.hidden = !visible;
  return visible;
}

function filterLinks(container: ParentNode, q: string): number {
  let visible = 0;
  container.querySelectorAll<HTMLElement>('li').forEach((li) => {
    const a = li.querySelector<HTMLAnchorElement>('a');
    if (!a) return;
    if (show(li, linkMatches(linkKey(a), q, a.dataset.road !== undefined))) visible += 1;
  });
  return visible;
}

/** /plaatsen/: a matching gemeente shows all its villages; otherwise only the matching villages, opened. */
function filterPlaceGroup(group: HTMLDetailsElement, q: string): boolean {
  const name = normalizeText(group.dataset.gemeente ?? '');
  const gemeenteHit = !q || name.includes(q);
  const villages = filterLinks(group, gemeenteHit ? '' : q);
  const hit = gemeenteHit || villages > 0;
  if (q && !gemeenteHit && villages > 0 && !group.open) {
    group.open = true;
    group.setAttribute(OPENED, '');
  }
  if ((!q || gemeenteHit) && group.hasAttribute(OPENED)) {
    group.open = false;
    group.removeAttribute(OPENED);
  }
  return show(group, hit);
}

/** One group section (letter, road type, provincie): hidden when nothing in it is left. */
function filterSection(section: HTMLElement, q: string): boolean {
  const groups = section.querySelectorAll<HTMLDetailsElement>('details.place-group');
  let visible = 0;
  if (groups.length > 0) {
    groups.forEach((g) => {
      if (filterPlaceGroup(g, q)) visible += 1;
    });
  } else {
    // Sub-headings (N100 – N199) go with the list that follows them.
    section.querySelectorAll<HTMLUListElement>('ul').forEach((ul) => {
      const n = filterLinks(ul, q);
      visible += n;
      show(ul, n > 0);
      const prev = ul.previousElementSibling;
      if (prev instanceof HTMLElement && prev.tagName === 'H3') show(prev, n > 0);
    });
  }
  return show(section, visible > 0);
}

/** The field's label per list: what can be typed there. */
export const FILTER_LABELS: Readonly<Record<'wegen' | 'plaatsen' | 'bruggen', string>> = {
  wegen: 'Filter op wegnummer',
  plaatsen: 'Filter op plaats of gemeente',
  bruggen: 'Filter op brug, weg of plaats',
};

export function mountListFilter(groupsEl: HTMLElement, label = 'Filter op wegnummer of naam'): void {
  if (groupsEl.querySelector('#list-filter')) return;
  const wrap = document.createElement('div');
  wrap.className = 'list-filter';
  wrap.innerHTML = `<label class="list-filter__label" for="list-filter">${esc(label)}</label>
    <input id="list-filter" class="list-filter__input" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false">
    <p class="list-filter__empty" role="status" hidden></p>`;
  groupsEl.prepend(wrap);
  const input = wrap.querySelector<HTMLInputElement>('input');
  const empty = wrap.querySelector<HTMLElement>('.list-filter__empty');
  const nav = groupsEl.querySelector<HTMLElement>('.letter-nav');
  if (!input || !empty) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const apply = (): void => {
    const raw = input.value.trim();
    const q = normalizeText(raw).replace(/\s+/g, ' ');
    let visible = 0;
    groupsEl.querySelectorAll<HTMLElement>(':scope > section.list-group').forEach((section) => {
      if (filterSection(section, q)) visible += 1;
    });
    // The letter jumps point at sections that may be hidden now.
    if (nav) nav.hidden = q !== '';
    empty.hidden = visible > 0 || q === '';
    empty.innerHTML = empty.hidden ? '' : `Niets gevonden voor “${esc(raw)}”.`;
  };
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(apply, DEBOUNCE_MS);
  });
}
