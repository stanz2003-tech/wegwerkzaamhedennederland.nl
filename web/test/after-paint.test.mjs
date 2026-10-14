/**
 * ui/after-paint.ts: a tap paints first, the heavy repaint runs in a task after that frame, and
 * taps before that frame collapse into one repaint (INP).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { afterPaint } from './helpers/src.mjs';

/** Timers the test steps by hand: frames and tasks only run when the test says so. */
function fakeTimers(hidden = false) {
  const frames = [];
  const tasks = [];
  return {
    frames,
    tasks,
    requestFrame: (cb) => frames.push(cb),
    setTimeout: (cb, ms) => tasks.push({ cb, ms }),
    hidden: () => hidden,
    flushFrames: () => frames.splice(0).forEach((cb) => cb()),
    /** Runs the queued tasks, or only those queued with `ms`. */
    flushTasks: (ms) => {
      const due = tasks.filter((t) => ms === undefined || t.ms === ms);
      for (const t of due) tasks.splice(tasks.indexOf(t), 1);
      due.forEach((t) => t.cb());
    },
  };
}

describe('paint first, then the heavy work (ui/after-paint.ts)', () => {
  it('runs the job in a task after the next frame, never inside the tap', () => {
    const t = fakeTimers();
    const s = afterPaint.createPaintScheduler(t);
    const ran = [];
    s.schedule(() => ran.push('render'));
    assert.deepEqual(ran, [], 'nothing heavy inside the tap');
    assert.equal(s.pending(), true);
    t.flushFrames();
    assert.deepEqual(ran, [], 'not in the frame callback either: that would delay the paint');
    t.flushTasks(0);
    assert.deepEqual(ran, ['render']);
    assert.equal(s.pending(), false);
    t.flushTasks();
    assert.deepEqual(ran, ['render'], 'the fallback timer then finds nothing to do');
  });

  it('collapses taps before the frame into the last one', () => {
    const t = fakeTimers();
    const s = afterPaint.createPaintScheduler(t);
    const ran = [];
    s.schedule(() => ran.push('vandaag'));
    s.schedule(() => ran.push('morgen'));
    s.schedule(() => ran.push('weekend'));
    assert.equal(t.frames.length, 1, 'one frame requested');
    t.flushFrames();
    t.flushTasks();
    assert.deepEqual(ran, ['weekend']);
    s.schedule(() => ran.push('nu'));
    t.flushFrames();
    t.flushTasks();
    assert.deepEqual(ran, ['weekend', 'nu'], 'a later tap gets its own repaint');
  });

  it('does not wait for a frame on a hidden page, which paints none', () => {
    const t = fakeTimers(true);
    const s = afterPaint.createPaintScheduler(t);
    let ran = false;
    s.schedule(() => (ran = true));
    assert.equal(t.frames.length, 0);
    t.flushTasks();
    assert.equal(ran, true);
  });

  it('still runs when a page says it is visible but no frame comes (the answer never stays dimmed)', () => {
    const t = fakeTimers();
    const s = afterPaint.createPaintScheduler(t);
    let ran = false;
    s.schedule(() => (ran = true));
    t.flushTasks(afterPaint.FRAME_FALLBACK_MS);
    assert.equal(ran, true, 'no frame at all: the fallback timer runs the job');
    assert.ok(afterPaint.FRAME_FALLBACK_MS >= 50 && afterPaint.FRAME_FALLBACK_MS <= 200, 'well after a due frame, well before a reader notices');
  });

  it('a late callback of an earlier wait never runs a newer job before its own frame', () => {
    const t = fakeTimers();
    const s = afterPaint.createPaintScheduler(t);
    const ran = [];
    s.schedule(() => ran.push('first'));
    t.flushTasks(afterPaint.FRAME_FALLBACK_MS); // no frame came: the fallback ran it
    assert.deepEqual(ran, ['first']);
    s.schedule(() => ran.push('second'));
    const [oldFrame, newFrame] = t.frames.splice(0);
    oldFrame(); // the first wait's frame arrives late
    t.flushTasks(0);
    assert.deepEqual(ran, ['first'], 'the old wait does not run the new job before its frame');
    newFrame();
    t.flushTasks(0);
    assert.deepEqual(ran, ['first', 'second']);
    t.flushTasks();
    assert.deepEqual(ran, ['first', 'second'], 'and runs only once');
  });
});

describe('main.ts repaints a changed question after the tap has been painted', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function questionChanged('), src.indexOf('\n}', src.indexOf('function questionChanged(')));

  it('marks the old answer as busy, then renders and speaks in the scheduled job', () => {
    assert.match(body, /setUpdating\(true\);\s*afterPaint\.schedule\(/);
    const job = body.slice(body.indexOf('afterPaint.schedule('));
    assert.ok(job.indexOf('render()') < job.indexOf('setUpdating(false)'), 'busy until the new answer is on screen');
    assert.ok(job.indexOf('setUpdating(false)') < job.indexOf('announceAnswer()'), 'speaks the new answer, not the old one');
  });

  it('dims the old answer, list, route and detail while busy', () => {
    const css = readFileSync(new URL('../src/styles/panel.css', import.meta.url), 'utf8');
    const rule = css.match(/\.panel\.is-updating :is\(([^)]*)\)\s*\{([^}]*)\}/);
    assert.ok(rule, 'is-updating rule');
    for (const part of ['.panel__answer', '.panel__body', '.panel__route', '.panel__bar']) assert.ok(rule[1].includes(part), part);
    assert.match(rule[2], /opacity:\s*0\.\d+/);
  });
});

describe('no full repaint inside a tap that does not change the answer', () => {
  const block = (src, start) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, start);
    return src.slice(i, src.indexOf('\n  }', i));
  };

  it('"Route plannen" opens and closes its form by repainting only its own slot', () => {
    const src = readFileSync(new URL('../src/ui/route-controller.ts', import.meta.url), 'utf8');
    for (const fn of ['function openForm(', 'function closeForm(']) {
      const body = block(src, fn);
      assert.doesNotMatch(body, /host\.render\(/, fn);
      assert.match(body, /paintSlot\(\)/, fn);
    }
  });

  it('moveend (fired inside the map frame and on every sheet resize) repaints the list after that frame', () => {
    const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const moveEnd = src.slice(src.indexOf('onMoveEnd:'), src.indexOf('onBasemap:'));
    assert.match(moveEnd, /afterMove\.schedule\(render\)/);
    assert.doesNotMatch(moveEnd, /\brender\(\)/);
    assert.match(src, /const afterMove = createPaintScheduler\(\)/, 'its own queue, so a pan never drops a question change');
  });
});

