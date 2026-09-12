/**
 * Shared boot for the generated SEO pages (road / place / bridge / list / static): topbar with
 * theme toggle and live pill, footer cookie link, ad slots, analytics, and the "bijgewerkt"
 * stamp. Everything is defensive: a page must keep working (pre-rendered) when data or a
 * single widget fails, so nothing here throws.
 */
import { loadMeta } from '../data/load';
import { toMs } from '../data/time';
import { slugify, type Meta } from '../data/types';
import { mountAds, wireCmpLinks } from './ads';
import { mountAnalytics } from './analytics';
import { fmtDayTime } from './format';
import { showToast } from './toast';
import { hydrateLivePill, mountTopbar, type Topbar } from './topbar';

const NO_CMP_TEXT = 'Op deze pagina staan geen advertenties, dus er zijn ook geen advertentiecookies om in te stellen.';

export interface PageBoot {
  /** Null when the header markup is missing (should not happen; the page still works). */
  topbar: Topbar | null;
  /** Resolves with meta.json, or null when it could not be loaded. Never rejects. */
  meta: Promise<Meta | null>;
}

/** Mounts the shared chrome and starts loading meta.json. Safe to call once per page. */
export function bootPage(): PageBoot {
  let topbar: Topbar | null = null;
  try {
    topbar = mountTopbar();
  } catch (err) {
    console.warn('[wegwerk] topbar niet gemonteerd:', err instanceof Error ? err.message : String(err));
  }

  try {
    mountAds();
  } catch (err) {
    console.warn('[wegwerk] advertentieslots niet gevuld:', err instanceof Error ? err.message : String(err));
  }

  wireCmpLinks(() => showToast(NO_CMP_TEXT));
  mountAnalytics();
  wireDetailsDeepLinks();

  const meta: Promise<Meta | null> = topbar
    ? hydrateLivePill(topbar)
    : loadMeta().then(
        (m) => m,
        () => null,
      );

  return { topbar, meta };
}

/* ------------------------- deep links into the FAQ ------------------------- */

/** Gives every `<details>` a stable id derived from its summary, so it can be linked to. */
function ensureDetailsIds(): void {
  const used = new Set<string>();
  document.querySelectorAll<HTMLDetailsElement>('main details').forEach((d) => {
    if (d.id) {
      used.add(d.id);
      return;
    }
    const base = slugify(d.querySelector('summary')?.textContent ?? '').slice(0, 60);
    if (!base) return;
    let id = base;
    let n = 2;
    while (used.has(id) || document.getElementById(id)) id = `${base}-${n++}`;
    used.add(id);
    d.id = id;
  });
}

/** Opens the `<details>` the hash points at (or that contains the target) and scrolls to it. */
function openFromHash(): void {
  const raw = window.location.hash.slice(1);
  if (!raw) return;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // A malformed escape sequence: use the hash as it is.
  }
  const target = document.getElementById(id);
  if (!target) return;
  const own = target.closest('details') ?? target.querySelector('details');
  if (own instanceof HTMLDetailsElement) own.open = true;
  for (let el = target.parentElement; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement) el.open = true;
  }
  target.scrollIntoView({ block: 'start' });
}

/** Reflects an opened item in the URL so the reader can copy the link to it. */
function trackOpenState(): void {
  document.querySelectorAll<HTMLDetailsElement>('main details[id]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      const next = `#${d.id}`;
      if (window.location.hash !== next) window.history.replaceState(null, '', next);
    });
  });
}

/**
 * Makes the FAQ blocks on every page type addressable: `/weg/a2/#is-de-a2-dit-weekend-dicht`
 * opens that question. Static content pages use plain headings and are unaffected.
 */
export function wireDetailsDeepLinks(): void {
  ensureDetailsIds();
  openFromHash();
  trackOpenState();
  window.addEventListener('hashchange', openFromHash);
}

/**
 * Fills the `<time>` elements that show when the data was last refreshed
 * (`#entity-updated` on entity pages, `#list-updated` on list pages).
 * Leaves the pre-rendered build date in place when meta is unavailable.
 */
export function stampUpdated(meta: Meta | null): void {
  if (!meta) return;
  const ms = toMs(meta.generated);
  if (!Number.isFinite(ms)) return;
  for (const id of ['entity-updated', 'list-updated']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = fmtDayTime(ms);
    el.setAttribute('datetime', meta.generated);
  }
}

/** A `data-*` attribute of `<body>`, trimmed; undefined when absent or empty. */
export function bodyAttr(name: string): string | undefined {
  const v = document.body.dataset[name];
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** Sets the text of an element by id when it exists. */
export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Shows or hides the pre-rendered empty state (`#entity-empty` / `#list-empty`). */
export function setEmptyVisible(id: string, visible: boolean): void {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}
