/**
 * Shows an ad slot only when the reader comes near it. A slot far down the page used to ask for
 * its ad on every page view, while few readers scroll that far: on 16 Nov 2026 the one slot sat 4
 * to 12 phone screens deep and AdSense counted 10% of its ads as seen. Advertisers pay for ads
 * that are seen, and an unseen ad still costs the phone its download.
 *
 * The slot keeps zero height until then, so nothing on screen moves: it opens about one screen
 * below what the reader is looking at, never above it.
 */

/**
 * IntersectionObserver `rootMargin`: one screen below the visible part, nothing above it. A slot
 * the reader has already passed (a restored scroll position, a link to a heading further down)
 * would open above what is on screen and push that down; Safari did not correct for that.
 */
export const NEAR_MARGIN = '0px 0px 100% 0px';

export interface NearEnv {
  /**
   * Watches `el` and calls `onNear` whenever it is within `margin` of the screen; returns the
   * function that stops the watch. Null where the browser has no IntersectionObserver.
   */
  observe: ((el: Element, margin: string, onNear: () => void) => () => void) | null;
}

function browserEnv(): NearEnv {
  if (typeof IntersectionObserver !== 'function') return { observe: null };
  return {
    observe: (el, margin, onNear) => {
      const io = new IntersectionObserver(
        (entries) => {
          // Coming up from below the slot it enters at the top edge: opening it there would push
          // the page down under the reader's thumb, so only a slot below that edge counts.
          if (entries.some((entry) => entry.isIntersecting && entry.boundingClientRect.top > 0)) onNear();
        },
        { rootMargin: margin },
      );
      io.observe(el);
      return () => io.disconnect();
    },
  };
}

/** The vertical stretch of the page a slot takes, in px. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * True when every ad in `others` is at least `minGap` px of page away from `slot`. With one
 * screen height as the gap, two ads are never on screen together: on a short page (a bridge with
 * two meldingen) the slot under the list stood 250 px below the one under the map.
 */
export function standsApart(slot: Span, others: readonly Span[], minGap: number): boolean {
  return others.every((other) => (other.bottom <= slot.top ? slot.top - other.bottom : other.top - slot.bottom) >= minGap);
}

/**
 * Calls `cb` once, when `el` comes within a screen below the visible part; at once in a browser
 * that cannot watch for it. Returns a cancel function: after it, `cb` never runs.
 */
export function whenNear(el: Element, cb: () => void, env: NearEnv = browserEnv()): () => void {
  if (!env.observe) {
    cb();
    return () => undefined;
  }
  let watching = true;
  let stopWatch: () => void = () => undefined;
  /** Ends the watch; false when it had already ended. */
  const end = (): boolean => {
    if (!watching) return false;
    watching = false;
    stopWatch();
    return true;
  };
  stopWatch = env.observe(el, NEAR_MARGIN, () => {
    if (end()) cb();
  });
  // An observer that reported during `observe` itself could not be stopped yet.
  if (!watching) stopWatch();
  return () => {
    end();
  };
}
