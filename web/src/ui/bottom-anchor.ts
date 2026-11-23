/**
 * Google's anchor ad at the bottom of the screen (AdSense Auto ads; on since 23 Nov 2026, "alleen
 * onderkant"). Google adds it itself: `<ins class="adsbygoogle adsbygoogle-noablate"
 * data-anchor-status="displayed">`, a child of `<html>`, `position: fixed; bottom: 0`. Measured
 * on the live site on a 375 × 812 phone: 139 px high, the ad plus the grip that folds it away.
 *
 * The page's own bar ("Nu: … · Andere dag", ui/answer-bar.ts) is fixed to the same edge and lay
 * under it. This module only reports how much of the bottom edge the anchor takes; the bar
 * decides what to do with that. Nothing here touches Google's element.
 */

/** Google's own mark on the anchor; its classes are shared with every other ad. */
export const ANCHOR_SELECTOR = 'ins.adsbygoogle[data-anchor-status]';

/** Where an element stands on the screen, as `getBoundingClientRect` gives it. */
export interface Box {
  top: number;
  bottom: number;
  height: number;
}

/**
 * How far above the bottom edge a box may end and still count as standing on it: while a phone
 * browser slides its own toolbar in or out, `innerHeight` and a fixed element disagree by a few px.
 */
export const EDGE_SLACK_PX = 8;

/**
 * Px of the bottom edge of the screen that `box` covers. 0 without a box, for a box that shows
 * nothing or left the screen, for an anchor at the top, and for anything that reaches above the
 * middle of the screen (a full-screen ad is not an anchor).
 */
export function bottomCover(box: Box | null, viewportHeight: number): number {
  if (!box || box.height <= 0) return 0;
  const reachesBottom = box.bottom >= viewportHeight - EDGE_SLACK_PX;
  const startsLow = box.top > viewportHeight / 2 && box.top < viewportHeight;
  return reachesBottom && startsLow ? Math.round(viewportHeight - box.top) : 0;
}

export interface AnchorEnv {
  /** The anchor's box right now; null while Google has not added one. */
  anchorBox(): Box | null;
  viewportHeight(): number;
  /** Calls `cb` whenever the anchor may have arrived, changed size or left. */
  onChange(cb: () => void): void;
}

function browserEnv(): AnchorEnv {
  const find = (): HTMLElement | null => document.querySelector<HTMLElement>(ANCHOR_SELECTOR);
  return {
    anchorBox: () => find()?.getBoundingClientRect() ?? null,
    viewportHeight: () => window.innerHeight,
    onChange: (cb) => {
      let watched: HTMLElement | null = null;
      const attrs = new MutationObserver(cb);
      /** Follows the anchor's own changes (folding it away rewrites its style) once it is there. */
      const follow = (): void => {
        const anchor = find();
        if (anchor && anchor !== watched) {
          watched = anchor;
          attrs.observe(anchor, { attributes: true, attributeFilter: ['style', 'data-anchor-status', 'data-anchor-shown'] });
        }
        cb();
      };
      // Google appends the anchor to <html>; <body> is watched too in case that ever changes.
      const arrivals = new MutationObserver(follow);
      arrivals.observe(document.documentElement, { childList: true });
      arrivals.observe(document.body, { childList: true });
      window.addEventListener('resize', cb);
      follow();
    },
  };
}

/**
 * Calls `report(px)` with the bottom cover whenever it changes: when the anchor arrives, when the
 * reader folds it away and when it leaves. Not called while there is nothing to report.
 */
export function watchBottomAnchor(report: (px: number) => void, env: AnchorEnv = browserEnv()): void {
  let last = 0;
  const check = (): void => {
    const px = bottomCover(env.anchorBox(), env.viewportHeight());
    if (px === last) return;
    last = px;
    report(px);
  };
  env.onChange(check);
  check();
}
