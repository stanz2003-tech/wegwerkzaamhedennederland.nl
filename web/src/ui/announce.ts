/**
 * The one live region of a page: `announce(text)` reads a short answer to screen-reader users
 * after something THEY did (vehicle mode, a "Wanneer?" choice, a day in the strip, road mode, a
 * category). The list and the summary sentence used to be `aria-live` themselves, so every pan of
 * the map read out 6,000–8,600 characters and the answer never got through (toeg-1).
 *
 * Rules the callers keep: never call this from `moveend` or the periodic refresh, and pass the
 * answer that is on screen (the card headline or the summary sentence), nothing longer.
 *
 * The region is `<p class="sr-only" role="status" data-announce>`; index.html has one, other
 * pages get it created on first use. It is created at call time and only filled after the
 * debounce, so it exists in the accessibility tree before its content changes — a region that is
 * inserted already filled is not announced by every screen reader.
 */

/** Long enough to swallow a burst of clicks (Nu → Morgen → Weekend), short enough to feel direct. */
export const ANNOUNCE_DEBOUNCE_MS = 600;

/** The part of an element the announcer writes to (an HTMLElement in the page, a stub in tests). */
export interface AnnounceRegion {
  textContent: string | null;
}

export interface AnnouncerDeps {
  region(): AnnounceRegion | null;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  delayMs?: number;
}

export type Announce = (text: string) => void;

/**
 * Debounced, de-duplicated writer. The last text of a burst wins; a text identical to the last
 * one announced is skipped, so re-rendering the same answer never repeats it.
 */
export function createAnnouncer(deps: AnnouncerDeps): Announce {
  const delay = deps.delayMs ?? ANNOUNCE_DEBOUNCE_MS;
  let handle: unknown = null;
  let last = '';
  return (text) => {
    const next = text.replace(/\s+/g, ' ').trim();
    if (next === '') return;
    const region = deps.region();
    if (!region) return;
    if (handle !== null) deps.clearTimer(handle);
    handle = deps.setTimer(() => {
      handle = null;
      if (next === last) return;
      last = next;
      region.textContent = next;
    }, delay);
  };
}

function pageRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.querySelector<HTMLElement>('[data-announce]');
  if (existing) return existing;
  const p = document.createElement('p');
  p.className = 'sr-only';
  p.setAttribute('role', 'status');
  p.dataset.announce = '';
  document.body.append(p);
  return p;
}

let pageAnnouncer: Announce | null = null;

/** Announces `text` in the page's status region (see the module comment for when to call it). */
export function announce(text: string): void {
  pageAnnouncer ??= createAnnouncer({
    region: pageRegion,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
  });
  pageAnnouncer(text);
}
