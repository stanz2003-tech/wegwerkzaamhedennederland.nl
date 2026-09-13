/**
 * Search box with a combobox dropdown: local item matches (index rows, loaded lazily on focus)
 * + PDOK Locatieserver suggestions (debounced 200 ms, aborted on new input). Keyboard navigable.
 */
import type { IndexItem } from '../data/index';
import {
  lookupPlace,
  normalizeRoadQuery,
  searchLocal,
  suggestPlaces,
  zoomForPlaceType,
  type LocalHit,
  type PlaceHit,
  type PlaceLocation,
} from '../data/search-index';
import { roadBadge } from './badge';
import { CATEGORY_META } from './categories';
import { esc } from './format';
import { ICONS } from './icons';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

export interface SearchCallbacks {
  /** Lazily provides the local index rows (cached by the caller). */
  localItems(): Promise<readonly IndexItem[]>;
  onPickItem(hit: LocalHit): void;
  onPickPlace(loc: PlaceLocation, zoom: number): void;
  /** A road number was chosen (typed, or a PDOK "weg" result): enter road mode. */
  onPickRoad?(road: string): void;
  /** Enter without a highlighted option → filter the list on the text. */
  onQuery(query: string): void;
  onFocus?(): void;
}

/** "A27" from a PDOK road name such as "A27, Gorinchem" or "Rijksweg A27"; null when none. */
export function roadFromName(name: string): string | null {
  const m = /(?:^|[\s,(])([ANSE]\s?\d{1,3})(?=$|[\s,)])/i.exec(name);
  return m ? normalizeRoadQuery(m[1] ?? '') : null;
}

export interface SearchBox {
  root: HTMLElement;
  setQuery(q: string): void;
  focus(): void;
}

type Option = { kind: 'query'; query: string } | { kind: 'road'; road: string } | LocalHit | PlaceHit;

const PLACE_TYPE_LABEL: Record<string, string> = {
  weg: 'weg',
  woonplaats: 'plaats',
  gemeente: 'gemeente',
  provincie: 'provincie',
};

function renderOption(o: Option, i: number, active: boolean): string {
  const base = `role="option" id="search-opt-${i}" data-i="${i}" aria-selected="${active ? 'true' : 'false'}" class="search__opt${active ? ' is-active' : ''}"`;
  if (o.kind === 'query') {
    return `<li ${base} data-kind="query">${ICONS.search}<span class="search__opt-main">Filter de lijst op “${esc(o.query)}”</span></li>`;
  }
  if (o.kind === 'road') {
    return `<li ${base} data-kind="road">${roadBadge(o.road, null, { size: 'sm' })}<span class="search__opt-main">Alleen de ${esc(o.road)}: kan ik erdoor?</span><span class="search__opt-sub">weg</span></li>`;
  }
  if (o.kind === 'item') {
    const meta = CATEGORY_META[o.cat];
    const place = o.woonplaats ?? o.gemeente;
    return `<li ${base} data-kind="item">${roadBadge(o.road, o.roadType, { size: 'sm', place })}
      <span class="search__opt-main">${esc(o.title)}</span>
      <span class="search__opt-sub" style="--cat-color: var(${meta.color})">${meta.icon}<span>${esc(meta.label)}${o.active ? '' : ' · gepland'}${place && !o.title.includes(place) ? ` · ${esc(place)}` : ''}</span></span></li>`;
  }
  return `<li ${base} data-kind="place">${ICONS.mapPin}<span class="search__opt-main">${esc(o.name)}</span><span class="search__opt-sub">${esc(PLACE_TYPE_LABEL[o.type] ?? o.type)}</span></li>`;
}

export function mountSearch(root: HTMLElement, cb: SearchCallbacks): SearchBox {
  root.classList.add('search');
  root.innerHTML = `<form class="search__form" role="search" autocomplete="off">
      <label class="sr-only" for="search-input">Zoek een weg, plaats of melding</label>
      <span class="search__icon" aria-hidden="true">${ICONS.search}</span>
      <input id="search-input" class="search__input" type="search" name="q" placeholder="Zoek weg, plaats of melding…" role="combobox" aria-expanded="false" aria-controls="search-listbox" aria-autocomplete="list" aria-haspopup="listbox" enterkeyhint="search" spellcheck="false">
      <button type="button" class="search__clear" aria-label="Zoekopdracht wissen" hidden>${ICONS.x}</button>
      <ul id="search-listbox" class="search__list" role="listbox" aria-label="Suggesties" hidden></ul>
    </form>`;
  const form = root.querySelector<HTMLFormElement>('form');
  const input = root.querySelector<HTMLInputElement>('input');
  const clear = root.querySelector<HTMLButtonElement>('.search__clear');
  const list = root.querySelector<HTMLUListElement>('ul');
  if (!form || !input || !clear || !list) throw new Error('search markup ontbreekt');

  let options: Option[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let localPromise: Promise<readonly IndexItem[]> | null = null;
  let requestSeq = 0;

  const getLocal = (): Promise<readonly IndexItem[]> => {
    if (!localPromise) {
      localPromise = cb.localItems().catch(() => {
        localPromise = null;
        return [] as readonly IndexItem[];
      });
    }
    return localPromise;
  };

  const close = (): void => {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    options = [];
    active = -1;
  };

  const render = (): void => {
    if (options.length === 0) {
      close();
      return;
    }
    list.innerHTML = options.map((o, i) => renderOption(o, i, i === active)).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `search-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const pick = (o: Option): void => {
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
    input.value = o.name;
    close();
    const road = o.type === 'weg' ? roadFromName(o.name) : null;
    if (road && cb.onPickRoad) {
      cb.onPickRoad(road);
      return;
    }
    controller?.abort();
    controller = new AbortController();
    lookupPlace(o.id, controller.signal)
      .then((loc) => {
        if (loc) cb.onPickPlace(loc, zoomForPlaceType(loc.type));
      })
      .catch(() => undefined);
  };

  const search = async (q: string): Promise<void> => {
    const seq = ++requestSeq;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const [local, places] = await Promise.all([
      getLocal().then((items) => searchLocal(items, q, 5)),
      suggestPlaces(q, signal, 6).catch(() => [] as PlaceHit[]),
    ]);
    if (seq !== requestSeq) return;
    const road = cb.onPickRoad ? normalizeRoadQuery(q) : null;
    options = [
      ...(road ? [{ kind: 'road' as const, road }] : []),
      { kind: 'query', query: q },
      ...local,
      ...places,
    ];
    // A road number is the most likely intent: preselect it so Enter goes straight to road mode.
    active = road ? 0 : -1;
    render();
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
      const chosen = active >= 0 ? options[active] : undefined;
      if (chosen) pick(chosen);
      else cb.onQuery(input.value.trim());
      if (!chosen) close();
    }
  });

  form.addEventListener('submit', (e) => e.preventDefault());

  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
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
  };
}
