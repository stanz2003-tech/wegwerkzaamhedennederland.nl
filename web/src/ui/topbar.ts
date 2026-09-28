/**
 * Top bar: theme toggle, mobile menu, live pill and (app only) category counters.
 * Used by main.ts and every generated page (`mountTopbar()` + `hydrateLivePill()`).
 */
import { loadMeta } from '../data/load';
import { ageMinutes, startOfDay, toMs } from '../data/time';
import type { Category, Meta } from '../data/types';
import { CATEGORY_META } from './categories';
import { esc, fmtDay, fmtDayTime, fmtTime, formatCount } from './format';
import { ICONS } from './icons';
import { currentTheme, onThemeChange, toggleTheme } from './theme';

export type LiveStatus =
  | { kind: 'loading' }
  | { kind: 'ok'; generated: string }
  | { kind: 'stale'; generated: string }
  | { kind: 'error' };

/**
 * The wekker (infra/worker) starts the pipeline every ten minutes; three missed cycles in a row
 * is a fault rather than a hiccup, so the warning appears after half an hour. Keep this in step with
 * `crons` in infra/worker/wrangler.toml and MAX_DATA_AGE_MINUTES there.
 */
export const STALE_AFTER_MINUTES = 30;

export function liveStatusFromMeta(meta: Meta, now = Date.now()): LiveStatus {
  const age = ageMinutes(meta.generated, now);
  if (Number.isNaN(age)) return { kind: 'error' };
  return age > STALE_AFTER_MINUTES ? { kind: 'stale', generated: meta.generated } : { kind: 'ok', generated: meta.generated };
}

/**
 * When the data is from: "20:17" today, "wo 23 sep 21:31" otherwise. A bare clock time for data
 * from five days ago read as "a few minutes late" (overzicht-0).
 */
export function liveTimeLabel(ms: number, now = Date.now()): string {
  return startOfDay(ms) === startOfDay(now) ? fmtTime(ms) : fmtDayTime(ms);
}

/** The "gegevens van …" label for the answer card while the data is stale; undefined otherwise. */
export function staleDataLabel(status: LiveStatus, now = Date.now()): string | undefined {
  return status.kind === 'stale' ? liveTimeLabel(toMs(status.generated), now) : undefined;
}

export interface Topbar {
  root: HTMLElement;
  setLive(status: LiveStatus): void;
  setCounts(counts: Partial<Record<Category, number>>): void;
}

/**
 * The pill: full text on wide screens, and on phones a short visible text for the two states a
 * driver must notice (stale, error) — a coloured dot alone told nobody anything on a touch screen
 * and nothing at all to colour-blind readers. Those states also swap the dot for an alert icon.
 * The full text stays in the DOM (visually hidden on phones), so a screen reader reads it once;
 * the short text is aria-hidden. The pill is not a live region: the warning banner above the
 * answer (ui/stale-banner.ts) is the one place a stale state is announced.
 */
function renderLive(el: HTMLElement, status: LiveStatus): void {
  el.hidden = false;
  el.dataset.state = status.kind;
  let text: string;
  let short = '';
  let shortTime = '';
  let title: string;
  switch (status.kind) {
    case 'loading':
      text = 'Laden…';
      title = 'Gegevens worden geladen';
      break;
    case 'ok':
      text = `Bijgewerkt ${fmtTime(toMs(status.generated))}`;
      title = `Laatste update van de gegevens: ${fmtTime(toMs(status.generated))}`;
      break;
    case 'stale': {
      const ms = toMs(status.generated);
      const now = Date.now();
      text = `Let op: gegevens van ${liveTimeLabel(ms, now)}`;
      // "Oud · 20:17": the phone topbar has ~100 px for the pill next to brand, theme and menu;
      // "Niet actueel · 20:17" pushed the menu button off the screen. Below 375 px only "Oud"
      // and the icon remain (chrome.css); the banner above the answer says it in full.
      short = 'Oud';
      shortTime = startOfDay(ms) === startOfDay(now) ? fmtTime(ms) : fmtDay(ms).replace(/^\S+\s/, '');
      title = `Laatste update: ${liveTimeLabel(ms, now)}. De gegevens zijn sindsdien niet vernieuwd; wat je ziet kan verouderd zijn.`;
      break;
    }
    case 'error':
      text = 'Gegevens tijdelijk niet beschikbaar';
      short = 'Geen data';
      title = 'De gegevens konden niet worden geladen';
      break;
  }
  const alert = status.kind === 'stale' || status.kind === 'error';
  const mark = alert ? `<span class="live__icon" aria-hidden="true">${ICONS.circleAlert}</span>` : '<span class="live__dot" aria-hidden="true"></span>';
  el.innerHTML = `${mark}<span class="live__text">${esc(text)}</span>${short ? `<span class="live__short" aria-hidden="true">${esc(short)}${shortTime ? `<span class="live__short-time"> · ${esc(shortTime)}</span>` : ''}</span>` : ''}`;
  el.title = title;
  el.removeAttribute('role');
}

function wireThemeToggle(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (!btn) return;
  const render = (): void => {
    const theme = currentTheme();
    btn.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
    btn.setAttribute('aria-label', theme === 'dark' ? 'Schakel naar licht thema' : 'Schakel naar donker thema');
    btn.title = btn.getAttribute('aria-label') ?? '';
    btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  };
  btn.addEventListener('click', () => {
    toggleTheme();
  });
  onThemeChange(render);
  render();
}

function wireMenu(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const nav = root.querySelector<HTMLElement>('[data-nav]');
  if (!btn || !nav) return;
  btn.innerHTML = ICONS.menu;
  const close = (): void => {
    root.classList.remove('is-menu-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = ICONS.menu;
  };
  btn.addEventListener('click', () => {
    const open = root.classList.toggle('is-menu-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.innerHTML = open ? ICONS.x : ICONS.menu;
    if (open) nav.querySelector<HTMLAnchorElement>('a')?.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-menu-open')) {
      close();
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (root.classList.contains('is-menu-open') && e.target instanceof Node && !root.contains(e.target)) close();
  });
}

function markCurrentNav(root: HTMLElement): void {
  const path = window.location.pathname.replace(/index\.html$/, '');
  root.querySelectorAll<HTMLAnchorElement>('[data-nav] a').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    const isCurrent = href === '/' ? path === '/' : path.startsWith(href);
    if (isCurrent) a.setAttribute('aria-current', 'page');
  });
}

export function mountTopbar(): Topbar {
  const root = document.querySelector<HTMLElement>('[data-topbar]');
  if (!root) throw new Error('Topbar markup ([data-topbar]) ontbreekt');
  wireThemeToggle(root);
  wireMenu(root);
  markCurrentNav(root);
  const live = root.querySelector<HTMLElement>('[data-live]');
  const counters = root.querySelector<HTMLElement>('[data-counters]');

  return {
    root,
    setLive(status) {
      if (live) renderLive(live, status);
    },
    setCounts(counts) {
      if (!counters) return;
      const entries = (Object.keys(CATEGORY_META) as Category[])
        .filter((cat) => (counts[cat] ?? 0) > 0)
        .map((cat) => {
          const meta = CATEGORY_META[cat];
          const n = counts[cat] ?? 0;
          return `<a class="count" href="/?cat=${cat}" style="--count-color: var(${meta.color})" title="${esc(meta.plural)}: ${formatCount(n)} actief">
            <span class="count__dot" aria-hidden="true"></span><span class="count__n">${formatCount(n)}</span><span class="count__label">${esc(meta.plural)}</span></a>`;
        });
      counters.innerHTML = entries.join('');
      counters.hidden = entries.length === 0;
    },
  };
}

/** For generated pages: fetch meta.json and fill the live pill + counters; never throws. */
export async function hydrateLivePill(topbar: Topbar): Promise<Meta | null> {
  topbar.setLive({ kind: 'loading' });
  try {
    const meta = await loadMeta();
    topbar.setLive(liveStatusFromMeta(meta));
    topbar.setCounts(meta.counts);
    return meta;
  } catch {
    topbar.setLive({ kind: 'error' });
    return null;
  }
}
