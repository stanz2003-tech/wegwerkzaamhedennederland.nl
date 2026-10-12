/**
 * One address field of the route form ("Van" / "Naar"): a combobox over PDOK Locatieserver that
 * finds an address, a postcode, a street or a place — the search box's own suggest and lookup
 * (data/search-index.ts), without its road, item and list-filter options. Keyboard: arrows move
 * through the suggestions, Enter picks, Escape closes; the ids carry a prefix so two fields can
 * live on one page.
 */
import { applyAlias, lookupPlace, suggestPlaces, type PlaceHit } from '../data/search-index';
import type { Stop } from '../data/routing';
import { esc } from './format';
import { ICONS } from './icons';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;
const ROWS = 6;

export interface StopInput {
  get(): Stop | null;
  set(stop: Stop | null): void;
  /** The typed text, when nothing was picked from the list. */
  typed(): string;
  /** Picks the first suggestion for the typed text; null when PDOK knows nothing. */
  resolveTyped(): Promise<Stop | null>;
  focus(): void;
}

export interface StopInputOptions {
  id: string;
  label: string;
  placeholder: string;
  onChange?(stop: Stop | null): void;
}

/** The name a picked hit gets in the field and on the card: "Almkerk", "Kerkstraat 1, 4286 AA Almkerk". */
export function stopName(hit: Pick<PlaceHit, 'type' | 'name' | 'label'>): string {
  if (hit.type === 'woonplaats' || hit.type === 'gemeente') return hit.label;
  return hit.name;
}

/** The grey second line of a suggestion: "Altena, Noord-Brabant" for a place, the kind otherwise. */
function hitSub(hit: PlaceHit): string {
  if (hit.type === 'adres') return 'adres';
  if (hit.type === 'postcode') return 'postcode';
  if (hit.type === 'weg') return 'straat';
  return [hit.gemeente !== hit.label ? hit.gemeente : null, hit.provincie].filter(Boolean).join(', ') || hit.type;
}

export async function stopFromHit(hit: PlaceHit, signal?: AbortSignal): Promise<Stop | null> {
  const loc = await lookupPlace(hit.id, signal);
  if (!loc) return null;
  return { name: stopName(hit), lon: loc.center[0], lat: loc.center[1] };
}

export function mountStopInput(root: HTMLElement, o: StopInputOptions): StopInput {
  const listId = `${o.id}-list`;
  root.classList.add('search', 'stop');
  root.innerHTML = `<div class="search__form stop__form">
      <label class="stop__label" for="${o.id}">${esc(o.label)}</label>
      <span class="search__icon" aria-hidden="true">${ICONS.mapPin}</span>
      <input id="${o.id}" class="search__input stop__input" type="text" placeholder="${esc(o.placeholder)}" role="combobox" aria-expanded="false" aria-controls="${listId}" aria-autocomplete="list" autocomplete="off" spellcheck="false" enterkeyhint="next">
      <ul id="${listId}" class="search__list stop__list" role="listbox" aria-label="Suggesties voor ${esc(o.label.toLowerCase())}" tabindex="-1" hidden></ul>
    </div>`;
  const input = root.querySelector<HTMLInputElement>('input');
  const list = root.querySelector<HTMLUListElement>('ul');
  if (!input || !list) throw new Error('stop markup ontbreekt');

  let picked: Stop | null = null;
  let hits: PlaceHit[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let seq = 0;

  const close = (): void => {
    seq += 1;
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    hits = [];
    active = -1;
  };

  const render = (): void => {
    if (hits.length === 0) {
      close();
      return;
    }
    list.innerHTML = hits
      .map(
        (h, i) =>
          `<li role="option" id="${o.id}-opt-${i}" data-i="${i}" aria-selected="${i === active ? 'true' : 'false'}" class="search__opt${i === active ? ' is-active' : ''}" data-kind="place">${h.type === 'weg' ? ICONS.signpost : ICONS.mapPin}<span class="search__opt-main">${esc(stopName(h))}</span><span class="search__opt-sub">${esc(hitSub(h))}</span></li>`,
      )
      .join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${o.id}-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const setPicked = (stop: Stop | null): void => {
    picked = stop;
    o.onChange?.(stop);
  };

  const pick = (hit: PlaceHit): void => {
    input.value = stopName(hit);
    close();
    controller?.abort();
    controller = new AbortController();
    stopFromHit(hit, controller.signal)
      .then((stop) => setPicked(stop))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setPicked(null);
      });
  };

  const search = async (text: string): Promise<void> => {
    const mine = ++seq;
    controller?.abort();
    controller = new AbortController();
    const found = await suggestPlaces(applyAlias(text), controller.signal, ROWS, 'stops').catch(() => [] as PlaceHit[]);
    if (mine !== seq || document.activeElement !== input) return;
    hits = found;
    active = found.length > 0 ? 0 : -1;
    render();
  };

  input.addEventListener('input', () => {
    // Typing replaces the picked stop: the field and the stop must never disagree.
    if (picked) setPicked(null);
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (q.length < MIN_CHARS) {
      close();
      return;
    }
    timer = setTimeout(() => void search(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length > 0) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      render();
      document.getElementById(`${o.id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
      e.preventDefault();
      const hit = hits[active];
      if (hit) pick(hit);
    }
  });

  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    const hit = li ? hits[Number(li.dataset.i)] : undefined;
    if (hit) pick(hit);
  });
  root.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) close();
  });

  return {
    get: () => picked,
    set(stop) {
      picked = stop;
      input.value = stop?.name ?? '';
      close();
    },
    typed: () => input.value.trim(),
    async resolveTyped() {
      const text = input.value.trim();
      if (text.length < MIN_CHARS) return null;
      const [first] = await suggestPlaces(applyAlias(text), undefined, 1, 'stops');
      if (!first) return null;
      const stop = await stopFromHit(first);
      if (stop) {
        input.value = stop.name;
        setPicked(stop);
      }
      return stop;
    },
    focus: () => input.focus({ preventScroll: true }),
  };
}
