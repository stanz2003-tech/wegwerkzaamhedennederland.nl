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

const BROWSER: PaintTimers = {
  requestFrame: (cb) => window.requestAnimationFrame(() => cb()),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  hidden: () => document.visibilityState === 'hidden',
};

export function createPaintScheduler(timers: PaintTimers = BROWSER): PaintScheduler {
  let job: (() => void) | null = null;

  const run = (): void => {
    const next = job;
    job = null;
    next?.();
  };

  return {
    schedule(next) {
      const waiting = job !== null;
      job = next;
      if (waiting) return;
      // rAF runs just before the frame is painted; a task queued from it runs after the paint.
      if (timers.hidden()) timers.setTimeout(run, 0);
      else timers.requestFrame(() => timers.setTimeout(run, 0));
    },
    pending: () => job !== null,
  };
}
