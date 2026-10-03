/**
 * Search box with a combobox dropdown: local item matches (index rows, loaded lazily on focus)
 * + PDOK Locatieserver suggestions (debounced 200 ms, aborted on new input). Keyboard navigable.
 *
 * The order of the dropdown is data/search-index.ts `orderOptions`: road, the place itself,
 * "Meldingen", "Straten", "Filter de lijst". Group headings and the no-result note are
 * `role="presentation"` rows outside the options, so arrow keys and aria-activedescendant skip
 * them. A status line tells screen readers what Enter does and how many suggestions there are.
 */
import type { IndexItem } from '../data/index';
import {
  applyAlias,
  lookupPlace,
  normalizeRoadQuery,
  orderOptions,
  noResultText,
  roadFromName,
  searchLocal,
  suggestPlaces,
  zoomForPlaceType,
  type LocalHit,
  type PlaceHit,
  type PlaceLocation,
  type SearchOption,
  type SearchRow,
} from '../data/search-index';
import type { VehicleMode } from '../data/verdict';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import { esc, whenLabel } from './format';
import { ICONS } from './icons';
import { listItemVerdict, modelFromIndexItem } from './list-item';
import { renderVerdictPill } from './verdict-pill';

export { roadFromName };

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
/** Smallest height of the suggestion list above an on-screen keyboard (about two options). */
const LIST_MIN_PX = 120;
const LIST_GAP_PX = 8;
/** PDOK rows per call: places and streets are asked separately, so a village is never pushed out by its streets. */
const PLACE_ROWS = 5;
const STREET_ROWS = 4;
const LOCAL_ROWS = 5;
/** How long a press on an option may take before its click (see the focusout handler). */
const PRESS_MS = 800;

/** The question the list answers, so a suggested item shows the verdict its list row shows. */
export interface SearchContext {
  mode: VehicleMode;
  at: number;
  window?: { from: number; to: number };
}

export interface SearchCallbacks {
  /** Lazily provides the local index rows (cached by the caller). */
  localItems(): Promise<readonly IndexItem[]>;
  onPickItem(hit: LocalHit): void;
  /**
   * A place or street was chosen. `loc` is its PDOK geometry, null when the lookup failed (a
   * woonplaats or gemeente can then still enter place mode, it only cannot frame the map).
   */
  onPickPlace(loc: PlaceLocation | null, zoom: number, hit: PlaceHit): void;
  /** A road number was chosen (typed, or a PDOK "weg" result): enter road mode. */
  onPickRoad?(road: string): void;
  /** Enter without a highlighted option → filter the list on the text. */
  onQuery(query: string): void;
  onFocus?(): void;
  /** Vehicle mode and moment of the list (default: auto, now). */
  context?(): SearchContext;
}

export interface SearchBox {
  root: HTMLElement;
  setQuery(q: string): void;
  focus(): void;
  /** Picks a place exactly as the dropdown does (the list's "Bedoelde je …?" button). */
  pickPlace(hit: PlaceHit): void;
}

const PLACE_TYPE_LABEL: Record<string, string> = {
  weg: 'straat',
  woonplaats: 'plaats',
  gemeente: 'gemeente',
  provincie: 'provincie',
};

/** "plaats · gemeente Altena", "gemeente · Noord-Brabant", "straat". */
function placeSub(o: PlaceHit): string {
  if (o.type === 'woonplaats') return o.gemeente ? `plaats · gemeente ${o.gemeente}` : 'plaats';
  if (o.type === 'gemeente') return o.provincie ? `gemeente · ${o.provincie}` : 'gemeente';
  if (o.type === 'weg') return roadFromName(o.name) ? 'weg' : 'straat';
  return PLACE_TYPE_LABEL[o.type] ?? o.type;
}

/** Verdict pill + when ("nog 2 u" / "start ma 28 sep 07:00") + the category in grey. */
function itemSub(o: LocalHit, ctx: SearchContext, now: number): string {
  const verdict = listItemVerdict(modelFromIndexItem(o.item), now, { mode: ctx.mode, at: ctx.at, ...(ctx.window ? { window: ctx.window } : {}) });
  const when = whenLabel({ start: o.item.start, end: o.item.end }, now);
  const place = o.woonplaats ?? o.gemeente;
  const extra = [CATEGORY_META[o.cat].label, ...(place && !o.title.includes(place) ? [place] : [])];
  // One text run for when + category, so a wrapped line never starts with a stray "·".
  return `${renderVerdictPill(verdict, { size: 'sm' })}<span class="search__when">${esc(when)} <span class="search__cat">· ${esc(extra.join(' · '))}</span></span>`;
}

function renderOption(o: SearchOption, i: number, active: boolean, ctx: SearchContext, now: number): string {
  const base = `role="option" id="search-opt-${i}" data-i="${i}" aria-selected="${active ? 'true' : 'false'}" class="search__opt${active ? ' is-active' : ''}"`;
  if (o.kind === 'query') {
    return `<li ${base} data-kind="query">${ICONS.search}<span class="search__opt-main">Filter de lijst op “${esc(o.query)}”</span></li>`;
  }
  if (o.kind === 'road') {
    return `<li ${base} data-kind="road">${roadBadge(o.road, null, { size: 'sm' })}<span class="search__opt-main">Alleen de ${esc(o.road)}: kan ik erdoor?</span><span class="search__opt-sub">weg</span></li>`;
  }
  if (o.kind === 'item') {
    const place = o.woonplaats ?? o.gemeente;
    return `<li ${base} data-kind="item">${roadBadge(o.road, o.roadType, { size: 'sm', place })}<span class="search__opt-main">${esc(o.title)}</span><span class="search__opt-sub search__opt-sub--item">${itemSub(o, ctx, now)}</span></li>`;
  }
  const main = o.didYouMean ? `Bedoelde je ${o.label}?` : o.label;
  const icon = o.type === 'weg' ? ICONS.signpost : ICONS.mapPin;
  return `<li ${base} data-kind="place"${o.didYouMean ? ' data-did-you-mean' : ''}>${icon}<span class="search__opt-main">${esc(main)}</span><span class="search__opt-sub">${esc(placeSub(o))}</span></li>`;
}

function renderRow(r: SearchRow, options: readonly SearchOption[], active: number, ctx: SearchContext, now: number): string {
  if (r.kind === 'heading') return `<li role="presentation" class="search__group">${esc(r.label)}</li>`;
  if (r.kind === 'note') return `<li role="presentation" class="search__note">${ICONS.info}<span>${esc(r.text)}</span></li>`;
  const o = options[r.index];
  return o ? renderOption(o, r.index, r.index === active, ctx, now) : '';
}

/** What a screen reader hears once the suggestions are there (toeg-4). */
export function statusText(options: readonly SearchOption[], active: number, query: string): string {
  const chosen = active >= 0 ? options[active] : undefined;
  if (options.length === 0) return noResultText(query);
  const others = options.length > 1 ? ' Pijl omlaag voor andere suggesties.' : '';
  if (chosen?.kind === 'road') return `Enter: alleen de ${chosen.road} tonen.${others}`;
  if (chosen?.kind === 'place' && chosen.didYouMean) return `Bedoelde je ${chosen.label}? Enter om die te kiezen.${others}`;
  if (chosen?.kind === 'place') return `Enter: ${chosen.label} tonen.${others}`;
  return `${options.length === 1 ? '1 suggestie' : `${options.length} suggesties`}, pijl omlaag om te kiezen.`;
}

export function mountSearch(root: HTMLElement, cb: SearchCallbacks): SearchBox {
  root.classList.add('search');
  // A short placeholder: the box shares its row with the vehicle mode (panel.css), and the
  // longer "Zoek weg, plaats of melding…" was cut off at every width. The label says it in full.
  root.innerHTML = `<form class="search__form" role="search" autocomplete="off">
      <label class="sr-only" for="search-input">Zoek een weg, plaats of melding</label>
      <span class="search__icon" aria-hidden="true">${ICONS.search}</span>
      <input id="search-input" class="search__input" type="search" name="q" placeholder="Weg of plaats…" role="combobox" aria-expanded="false" aria-controls="search-listbox" aria-autocomplete="list" aria-haspopup="listbox" enterkeyhint="search" spellcheck="false">
      <button type="button" class="search__clear" aria-label="Zoekopdracht wissen" hidden>${ICONS.x}</button>
      <ul id="search-listbox" class="search__list" role="listbox" aria-label="Suggesties" tabindex="-1" hidden></ul>
      <span class="sr-only" role="status" id="search-status"></span>
    </form>`;
  const form = root.querySelector<HTMLFormElement>('form');
  const input = root.querySelector<HTMLInputElement>('input');
  const clear = root.querySelector<HTMLButtonElement>('.search__clear');
  const list = root.querySelector<HTMLUListElement>('ul');
  const status = root.querySelector<HTMLElement>('#search-status');
  if (!form || !input || !clear || !list || !status) throw new Error('search markup ontbreekt');

  let options: SearchOption[] = [];
  let rows: SearchRow[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let localPromise: Promise<readonly IndexItem[]> | null = null;
  let requestSeq = 0;
  /** The text the options on screen belong to. */
  let shownFor = '';

  const context = (): SearchContext => cb.context?.() ?? { mode: 'auto', at: Date.now() };

  const getLocal = (): Promise<readonly IndexItem[]> => {
    if (!localPromise) {
      localPromise = cb.localItems().catch(() => {
        localPromise = null;
        return [] as readonly IndexItem[];
      });
    }
    return localPromise;
  };

  /**
   * On a phone the on-screen keyboard covers the lower part of the layout viewport, and the
   * suggestions under the input landed right under it (mobiel-4). The visual viewport is what is
   * really left: cap the list to the room between the input and the keyboard.
   */
  const fitToKeyboard = (): void => {
    const vv = window.visualViewport;
    if (!vv || list.hidden) return;
    const room = vv.height + vv.offsetTop - input.getBoundingClientRect().bottom - LIST_GAP_PX;
    // Never taller than the stylesheet allows (components.css), only shorter.
    list.style.maxHeight = `min(60vh, 420px, ${Math.max(LIST_MIN_PX, Math.round(room))}px)`;
  };
  window.visualViewport?.addEventListener('resize', fitToKeyboard);
  window.visualViewport?.addEventListener('scroll', fitToKeyboard);

  const close = (): void => {
    requestSeq += 1; // a search still in flight must not reopen the list
    list.hidden = true;
    list.style.removeProperty('max-height');
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    status.textContent = '';
    options = [];
    rows = [];
    active = -1;
    shownFor = '';
  };

  const render = (): void => {
    if (rows.length === 0) {
      close();
      return;
    }
    const ctx = context();
    const now = Date.now();
    list.innerHTML = rows.map((r) => renderRow(r, options, active, ctx, now)).join('');
    list.hidden = false;
    fitToKeyboard();
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `search-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const pickPlace = (o: PlaceHit): void => {
    input.value = o.type === 'weg' ? o.name : o.label;
    clear.hidden = false;
    close();
    const road = o.type === 'weg' ? roadFromName(o.name) : null;
    if (road && cb.onPickRoad) {
      cb.onPickRoad(road);
      return;
    }
    controller?.abort();
    controller = new AbortController();
    lookupPlace(o.id, controller.signal)
      .then((loc) => cb.onPickPlace(loc, zoomForPlaceType(loc?.type ?? o.type), o))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        cb.onPickPlace(null, zoomForPlaceType(o.type), o);
      });
  };

  const pick = (o: SearchOption): void => {
    if (o.kind === 'query') {
      cb.onQuery(o.query);
      close();
      return;
    }
    if (o.kind === 'road') {
      input.value = o.road;
      close();
      cb.onPickRoad?.(o.road);
      return;
    }
    if (o.kind === 'item') {
      input.value = o.title;
      cb.onPickItem(o);
      close();
      return;
    }
    pickPlace(o);
  };

  const search = async (typed: string): Promise<void> => {
    const seq = ++requestSeq;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    // "Den Bosch" → "'s-Hertogenbosch" before anything is asked (zoek-8).
    const q = applyAlias(typed);
    const none = (): PlaceHit[] => [];
    const [local, places, streets] = await Promise.all([
      getLocal().then((items) => searchLocal(items, q, LOCAL_ROWS)),
      suggestPlaces(q, signal, PLACE_ROWS, 'places').catch(none),
      suggestPlaces(q, signal, STREET_ROWS, 'streets').catch(none),
    ]);
    if (seq !== requestSeq) return;
    const road = cb.onPickRoad ? normalizeRoadQuery(typed) : null;
    // Nothing at all: one retry with PDOK's fuzzy match, for "Gorichem" → "Bedoelde je Gorinchem?".
    const empty = !road && local.length + places.length + streets.length === 0;
    const fuzzy = empty ? await suggestPlaces(q, signal, 4, 'towns', true).catch(none) : [];
    if (seq !== requestSeq) return;
    // Tabbed away while PDOK answered: do not open a list over whatever has the focus now.
    if (document.activeElement !== input) return;
    const ordered = orderOptions({ query: q, road, places, local, streets, fuzzy });
    options = ordered.options;
    rows = ordered.rows;
    active = ordered.active;
    render();
    shownFor = typed;
    status.textContent = statusText(options, active, typed);
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.hidden = q.length === 0;
    if (timer) clearTimeout(timer);
    if (q.length < MIN_CHARS) {
      close();
      if (q.length === 0) cb.onQuery('');
      return;
    }
    timer = setTimeout(() => void search(q), DEBOUNCE_MS);
  });

  input.addEventListener('focus', () => {
    void getLocal();
    cb.onFocus?.();
    if (input.value.trim().length >= MIN_CHARS && options.length === 0) void search(input.value.trim());
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + dir + options.length) % options.length;
      render();
      document.getElementById(`search-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (input.value) {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        clear.hidden = true;
        cb.onQuery('');
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (timer) clearTimeout(timer);
      const typed = input.value.trim();
      // Typed faster than the debounce: the options on screen belong to an earlier text ("A2"
      // while "A27" is in the box). Answer the text as it is now.
      if (typed.length >= MIN_CHARS && typed !== shownFor) {
        void search(typed).then(() => {
          if (shownFor === typed) choose();
        });
        return;
      }
      choose();
    }
  });

  /** Enter: the highlighted option, or the text as a list filter. */
  const choose = (): void => {
    const chosen = active >= 0 ? options[active] : undefined;
    if (chosen) pick(chosen);
    else {
      cb.onQuery(applyAlias(input.value.trim()));
      close();
    }
  };

  form.addEventListener('submit', (e) => e.preventDefault());

  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  // Should a browser still move the focus on a tap, the focusout below must not empty the list
  // before the click arrives: options are not focusable, so relatedTarget is null then.
  let pressing = false;
  list.addEventListener('pointerdown', () => {
    pressing = true;
    window.setTimeout(() => (pressing = false), PRESS_MS);
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    const o = li ? options[Number(li.dataset.i)] : undefined;
    if (o) pick(o);
  });

  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    close();
    cb.onQuery('');
    input.focus();
  });

  // Tab out of the box closes the list, so it never covers the control that got the focus (toeg-4).
  // Also when the focus only moves to the clear button: the options are reached with the arrow
  // keys, so a Tab means "done here". The list itself has tabindex -1: Chrome makes a scrolling
  // box keyboard-focusable, which put the open list in the Tab order behind the clear button.
  root.addEventListener('focusout', (e) => {
    if (pressing) return;
    if (!(e.relatedTarget instanceof Node) || !list.contains(e.relatedTarget)) close();
  });

  document.addEventListener('click', (e) => {
    if (e.target instanceof Node && !root.contains(e.target)) close();
  });

  return {
    root,
    setQuery(q) {
      input.value = q;
      clear.hidden = q.length === 0;
    },
    focus() {
      input.focus();
    },
    pickPlace,
  };
}
