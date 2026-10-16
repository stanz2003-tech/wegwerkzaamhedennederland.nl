/**
 * Loads the AdSense script only once the page itself is done: after the window `load` event,
 * after the page's own start-up work (its data, the answer and the map, `holdUntil`; capped), in
 * the first idle moment after that. The stack that script pulls in (adsbygoogle.js,
 * show_ads_impl.js and Google's consent dialog: ~300 KB compressed, ~900 KB of JavaScript) used
 * to start during the page boot, next to the page's own scripts and data, and a phone then spent
 * its first second parsing ads instead of showing the answer and answering taps (INP). `load`
 * alone is not enough: it fires before the page's data has arrived. The ad slot sits below the
 * answer, so starting a moment later costs no impression.
 *
 * `now()` skips the wait: the footer link "Cookie-instellingen" needs the consent dialog that
 * comes with the script.
 */

export type AdScriptState = 'waiting' | 'loading' | 'loaded' | 'failed';

export interface AdScriptEnv {
  /** True when the window `load` event has already fired. */
  loaded(): boolean;
  /** Calls `cb` once, when the window `load` event fires. */
  onLoad(cb: () => void): void;
  /** requestIdleCallback with a deadline; null where the browser has none (Safari). */
  idle: ((cb: () => void, timeoutMs: number) => void) | null;
  setTimeout(cb: () => void, ms: number): void;
  /** Appends `<script async src>` and calls back once, on load or on error. */
  inject(src: string, onLoad: () => void, onError: () => void): void;
}

export interface AdScript {
  state(): AdScriptState;
  /** Starts loading at once when it has not started yet. */
  now(): void;
  /** Calls `cb` once the script has loaded; at once when it already has. */
  onLoaded(cb: () => void): void;
  /** Calls `cb` when the script fails to load (ad blocker, offline); at once when it already has. */
  onFail(cb: () => void): void;
  /**
   * Also waits for `work` (the page's own start-up) before the idle wait, at most HOLD_MAX_MS
   * after `load`. Counts only when called before `load` (the holds are read then), as the page
   * boot does.
   */
  holdUntil(work: Promise<unknown>): void;
}

/** The longest the page's own start-up may hold the ads back after `load` (a hanging request). */
export const HOLD_MAX_MS = 5000;
/** The longest the idle callback may wait on a busy page before the script loads anyway. */
export const IDLE_TIMEOUT_MS = 3000;
/** Without requestIdleCallback (Safari): this long after the page is done, so it can paint first. */
export const NO_IDLE_DELAY_MS = 500;

function browserEnv(): AdScriptEnv {
  return {
    loaded: () => document.readyState === 'complete',
    onLoad: (cb) => window.addEventListener('load', () => cb(), { once: true }),
    idle:
      typeof window.requestIdleCallback === 'function'
        ? (cb, timeoutMs) => window.requestIdleCallback(() => cb(), { timeout: timeoutMs })
        : null,
    setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    inject: (src, onLoad, onError) => {
      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = src;
      s.addEventListener('load', onLoad, { once: true });
      s.addEventListener('error', onError, { once: true });
      document.head.appendChild(s);
    },
  };
}

/** Schedules `<script async src>` for after `load`, the page's own work and idle. Once per page. */
export function deferAdScript(src: string, env: AdScriptEnv = browserEnv()): AdScript {
  let state: AdScriptState = 'waiting';
  let loadListeners: ReadonlyArray<() => void> = [];
  let failListeners: ReadonlyArray<() => void> = [];
  let holds: ReadonlyArray<Promise<unknown>> = [];

  /** Ends the wait: `state` becomes `outcome` and that outcome's listeners run once. */
  const settle = (outcome: 'loaded' | 'failed'): void => {
    state = outcome;
    const listeners = outcome === 'loaded' ? loadListeners : failListeners;
    loadListeners = [];
    failListeners = [];
    listeners.forEach((cb) => cb());
  };

  const start = (): void => {
    if (state !== 'waiting') return;
    state = 'loading';
    env.inject(
      src,
      () => settle('loaded'),
      () => settle('failed'),
    );
  };

  const whenIdle = (): void => {
    if (env.idle) env.idle(start, IDLE_TIMEOUT_MS);
    else env.setTimeout(start, NO_IDLE_DELAY_MS);
  };

  /** After `load`: the page's own work first (capped), then an idle moment. */
  const afterLoad = (): void => {
    if (holds.length === 0) {
      whenIdle();
      return;
    }
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      whenIdle();
    };
    void Promise.allSettled(holds).then(release);
    env.setTimeout(release, HOLD_MAX_MS);
  };

  if (env.loaded()) afterLoad();
  else env.onLoad(afterLoad);

  return {
    state: () => state,
    now: start,
    onLoaded(cb) {
      if (state === 'loaded') cb();
      else if (state !== 'failed') loadListeners = [...loadListeners, cb];
    },
    onFail(cb) {
      if (state === 'failed') cb();
      else if (state !== 'loaded') failListeners = [...failListeners, cb];
    },
    holdUntil(work) {
      holds = [...holds, work];
    },
  };
}
