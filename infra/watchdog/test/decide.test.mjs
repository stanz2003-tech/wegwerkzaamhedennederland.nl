/**
 * Tests for the watchdog's decision (infra/watchdog/decide.mjs): when does an outside restart of
 * the Data → Wekker → Data chain help, and when would it only add a run to a chain that is alive?
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BUSY_MAX_AGE_MINUTES,
  CHAIN_ACTOR,
  RESTART_INTERVAL_MINUTES,
  SETTLE_SECONDS,
  STALE_AFTER_MINUTES,
  TICK_MINUTES,
  decide,
  isRestart,
} from '../decide.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const NOW = Date.parse('2026-11-09T18:45:00Z');
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

/** A run as the GitHub REST API lists it, with only the fields the watchdog reads. */
function run({ id, status = 'completed', created, updated = created, event = 'workflow_dispatch', actor = CHAIN_ACTOR }) {
  return { id, status, created_at: ago(created), updated_at: ago(updated), event, actor: { login: actor }, triggering_actor: { login: actor } };
}

const STALE = ago(STALE_AFTER_MINUTES + 8);
const FRESH = ago(4);
/** The chain as it looked on 9 November: last data run done 26 min ago, its wekker never came. */
const deadData = [run({ created: 29, updated: 26 })];
const deadWekker = [run({ created: 38, updated: 29 })];

test('fresh data: nothing to do, whatever GitHub shows', () => {
  const d = decide({ nowMs: NOW, generated: FRESH, dataRuns: deadData, wekkerRuns: deadWekker });
  assert.equal(d.action, 'ok');
  assert.equal(d.facts.ageMinutes, 4);
});

test('stale data and a silent chain: restart Data', () => {
  const d = decide({ nowMs: NOW, generated: STALE, dataRuns: deadData, wekkerRuns: deadWekker });
  assert.equal(d.action, 'dispatch');
  assert.match(d.reason, /keten is gestopt/);
  assert.equal(d.facts.idleMinutes, 26);
});

test('stale data but a waiting wekker: the chain is alive, a restart would add nothing', () => {
  // This is the normal state between two runs, and also what a failing pipeline looks like:
  // the data goes stale while the chain keeps going. A new run cannot fix NDW or a broken upload.
  for (const status of ['waiting', 'queued', 'in_progress', 'pending', 'requested']) {
    const d = decide({ nowMs: NOW, generated: STALE, dataRuns: deadData, wekkerRuns: [run({ status, created: 3 }), ...deadWekker] });
    assert.equal(d.action, 'wait', status);
    assert.match(d.reason, /keten leeft/);
  }
});

test('stale data but a Data run queued or running: wait for it', () => {
  for (const status of ['queued', 'in_progress', 'pending']) {
    const d = decide({ nowMs: NOW, generated: STALE, dataRuns: [run({ status, created: 1 }), ...deadData], wekkerRuns: deadWekker });
    assert.equal(d.action, 'wait', status);
  }
});

test('a run that finished moments ago may still get its successor: wait one tick', () => {
  // Between "wekker done" and "next Data run listed" there are a few seconds in which nothing is
  // busy. A restart there would be harmless (the chain's own guards keep one chain) but useless.
  const justDone = [run({ created: 10, updated: (SETTLE_SECONDS - 30) / 60 })];
  const d = decide({ nowMs: NOW, generated: STALE, dataRuns: deadData, wekkerRuns: justDone });
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /net een run klaar/);
});

test('at most one restart per interval: a recent own or manual dispatch holds the next one back', () => {
  const restart = (minutes) => run({ created: minutes, updated: minutes - 1.5, actor: 'stanz2003-tech' });
  const held = decide({ nowMs: NOW, generated: STALE, dataRuns: [restart(RESTART_INTERVAL_MINUTES - 1)], wekkerRuns: deadWekker });
  assert.equal(held.action, 'wait');
  assert.match(held.reason, /hooguit één herstart/i);
  const due = decide({ nowMs: NOW, generated: STALE, dataRuns: [restart(RESTART_INTERVAL_MINUTES + 1)], wekkerRuns: deadWekker });
  assert.equal(due.action, 'dispatch');
});

test('only dispatches from outside the chain count as restarts', () => {
  assert.equal(isRestart(run({ created: 1, actor: 'stanz2003-tech' })), true);
  // An unknown actor is counted as a restart: holding back is the safe side.
  assert.equal(isRestart({ event: 'workflow_dispatch', created_at: ago(1) }), true);
  assert.equal(isRestart(run({ created: 1 })), false, 'the chain itself (GITHUB_TOKEN)');
  assert.equal(isRestart(run({ created: 1, event: 'schedule', actor: 'stanz2003-tech' })), false, 'the :07/:37 fallback');
  assert.equal(isRestart(run({ created: 1, event: 'push', actor: 'stanz2003-tech' })), false, 'a push');
  // So the chain's own dispatches never block a restart:
  const d = decide({ nowMs: NOW, generated: STALE, dataRuns: [run({ created: 15, updated: 13 })], wekkerRuns: deadWekker });
  assert.equal(d.action, 'dispatch');
});

test('a run that has been "busy" for over an hour is stuck, not alive, and is cancelled before the restart', () => {
  // A stuck wekker would make the new Data run's `volgende` defer to it, and a stuck Data run would
  // hold the new one in the `data` concurrency group: without the cancel the restart would not take.
  const stuckWekker = run({ id: 7001, status: 'waiting', created: BUSY_MAX_AGE_MINUTES + 30 });
  const stuckData = run({ id: 7002, status: 'queued', created: BUSY_MAX_AGE_MINUTES + 5 });
  const d = decide({ nowMs: NOW, generated: STALE, dataRuns: [stuckData, ...deadData], wekkerRuns: [stuckWekker, ...deadWekker] });
  assert.equal(d.action, 'dispatch');
  assert.deepEqual(d.facts.stuck.map((s) => s.split(' ').slice(0, 2).join(' ')).sort(), ['Data queued', 'Wekker waiting']);
  assert.deepEqual([...d.cancel].sort(), [7001, 7002]);
  assert.match(d.reason, /2 vastgelopen run\(s\) annuleren/);
  // Never a busy run, and never anything when the watchdog does not restart.
  const alive = decide({ nowMs: NOW, generated: STALE, dataRuns: deadData, wekkerRuns: [run({ id: 7003, status: 'waiting', created: 3 }), stuckWekker] });
  assert.equal(alive.action, 'wait');
  assert.equal(alive.cancel, undefined);
  assert.deepEqual(decide({ nowMs: NOW, generated: STALE, dataRuns: deadData, wekkerRuns: deadWekker }).cancel, []);
});

test('GitHub unreadable: do nothing rather than act blind', () => {
  for (const [dataRuns, wekkerRuns] of [[null, deadWekker], [deadData, undefined], ['x', []]]) {
    const d = decide({ nowMs: NOW, generated: STALE, dataRuns, wekkerRuns });
    assert.equal(d.action, 'unknown');
  }
});

test('meta.json unreadable: the chain\'s own silence decides', () => {
  const quiet = decide({ nowMs: NOW, generated: undefined, dataRuns: deadData, wekkerRuns: deadWekker });
  assert.equal(quiet.action, 'dispatch', 'silent for 26 min');
  assert.equal(quiet.facts.ageMinutes, null);
  const recent = decide({ nowMs: NOW, generated: 'gisteren', dataRuns: [run({ created: 9, updated: 7 })], wekkerRuns: [] });
  assert.equal(recent.action, 'ok', 'active 7 min ago');
  assert.match(recent.reason, /onleesbaar/);
});

test('no runs at all and stale data: restart', () => {
  assert.equal(decide({ nowMs: NOW, generated: STALE, dataRuns: [], wekkerRuns: [] }).action, 'dispatch');
});

test('the thresholds keep the site from ever saying "niet actueel" when the chain dies', () => {
  // Worst case: the chain dies right after a publish. The data turns stale after
  // STALE_AFTER_MINUTES, the next tick comes at most TICK_MINUTES later, and a Data run needs up to
  // about four minutes (queue + pipeline + upload). All of that has to fit under the site's own
  // threshold (web/src/ui/topbar.ts), or every page shows the warning before the restart lands.
  const topbar = readFileSync(resolve(ROOT, 'web/src/ui/topbar.ts'), 'utf8');
  const siteThreshold = Number(/export const STALE_AFTER_MINUTES = (\d+);/.exec(topbar)?.[1]);
  assert.ok(siteThreshold > 0, 'STALE_AFTER_MINUTES not found in topbar.ts');
  const RUN_MINUTES = 4;
  assert.ok(STALE_AFTER_MINUTES + TICK_MINUTES + RUN_MINUTES <= siteThreshold, `${STALE_AFTER_MINUTES}+${TICK_MINUTES}+${RUN_MINUTES} > ${siteThreshold}`);
  // ...and the stale mark sits well above a normal ten-minute cycle.
  assert.ok(STALE_AFTER_MINUTES >= 15);
  assert.ok(RESTART_INTERVAL_MINUTES >= 15 && RESTART_INTERVAL_MINUTES >= TICK_MINUTES * 3);
  // A wekker waits 8 minutes and may take 30 during a GitHub incident (4 November); only far
  // beyond that does an unfinished run count as stuck.
  assert.ok(BUSY_MAX_AGE_MINUTES >= 45);
});
