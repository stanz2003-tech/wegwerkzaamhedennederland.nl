/**
 * Theme handling: explicit preference in localStorage (`theme` = light|dark), otherwise the
 * system preference. Resolved changes are broadcast as a `wegwerk:theme` event on `document`.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
export const THEME_EVENT = 'wegwerk:theme';

function readStored(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The theme currently in effect. */
export function currentTheme(): Theme {
  return readStored() ?? systemTheme();
}

function apply(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  document.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: currentTheme() }));
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the theme still applies for this page view.
  }
  apply(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function onThemeChange(cb: (theme: Theme) => void): () => void {
  const handler = (e: Event): void => cb((e as CustomEvent<Theme>).detail);
  document.addEventListener(THEME_EVENT, handler);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const mqHandler = (): void => {
    if (!readStored()) apply(null);
  };
  mq.addEventListener('change', mqHandler);
  return () => {
    document.removeEventListener(THEME_EVENT, handler);
    mq.removeEventListener('change', mqHandler);
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
