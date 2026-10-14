/**
 * Paint first, then do the heavy work (INP). A tap on a time chip or vehicle button re-judges
 * and re-sorts thousands of items and hands them to the map: on a phone that took most of a
 * second, and the tapped button only lit up after all of it. `schedule(job)` runs `job` in a
 * task after the next frame was painted, so the tap shows at once. Jobs scheduled before that
 * frame collapse into the last one: three quick taps cost one render, not three.
 */

export interface PaintScheduler {
  schedule(job: () => void): void;
  /** True while a job waits for its frame. */
  pending(): boolean;
}

export interface PaintTimers {
  requestFrame(cb: () => void): void;
  setTimeout(cb: () => void, ms: number): void;
  /** A hidden page paints no frames: run in the next task instead of waiting for one. */
  hidden(): boolean;
}

/**
 * A frame is due within ~16 ms on a page that paints. A page can also say it is visible and
 * still get no frames (an occluded window, an embedded view): the job then runs after this
 * long anyway, so the answer never stays dimmed and stale.
 */
export const FRAME_FALLBACK_MS = 100;

const BROWSER: PaintTimers = {
  requestFrame: (cb) => window.requestAnimationFrame(() => cb()),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  hidden: () => document.visibilityState === 'hidden',
};

export function createPaintScheduler(timers: PaintTimers = BROWSER): PaintScheduler {
  let job: (() => void) | null = null;
  /** Each wait gets its own number: a late callback of an earlier wait runs nothing. */
  let wait = 0;

  const runFor = (id: number) => (): void => {
    if (id !== wait || job === null) return;
    const next = job;
    job = null;
    next();
  };

  return {
    schedule(next) {
      const waiting = job !== null;
      job = next;
      if (waiting) return;
      wait += 1;
      const run = runFor(wait);
      // rAF runs just before the frame is painted; a task queued from it runs after the paint.
      if (timers.hidden()) {
        timers.setTimeout(run, 0);
        return;
      }
      timers.requestFrame(() => timers.setTimeout(run, 0));
      timers.setTimeout(run, FRAME_FALLBACK_MS);
    },
    pending: () => job !== null,
  };
}
