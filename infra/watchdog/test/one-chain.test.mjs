/**
 * The claim the watchdog rests on: even a restart that was not needed cannot split the chain,
 * because the chain's own guards absorb it. Checked here against the wekker's real decision
 * (infra/wekker/next.mjs) and the watchdog's (decide.mjs), step by step through the worst moment:
 * the watchdog starts Data while a wekker is waiting.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide as wekkerDecides } from '../../wekker/next.mjs';
import { CHAIN_ACTOR, decide as watchdogDecides } from '../decide.mjs';

const T = Date.parse('2026-11-09T20:00:00Z');
const at = (min) => new Date(T + min * 60_000).toISOString();
const dataRun = (status, createdMin, actor = 'stanz2003-tech') => ({
  status,
  createdAt: at(createdMin),
  created_at: at(createdMin),
  updated_at: at(createdMin),
  event: 'workflow_dispatch',
  actor: { login: actor },
  triggering_actor: { login: actor },
});

test('a needless restart while a wekker waits: the wekker sets itself again instead of a second Data run', () => {
  // 20:00 a wekker starts its 8-minute wait. Say the watchdog (wrongly) starts Data at 20:05, and
  // that run is still busy when the wekker wakes at 20:08.
  const wekkerCreated = at(0);
  const restart = dataRun('in_progress', 5);
  const whenWekkerWakes = wekkerDecides({ nowMs: T + 8 * 60_000, selfCreatedAt: wekkerCreated, dataRuns: [restart] });
  assert.equal(whenWekkerWakes.action, 'rearm', 'no second Data run');
  // If the restart already finished, the wekker starts the next Data run as usual: still one chain,
  // because the restart's own `volgende` saw the waiting wekker and set none (data.yml).
  const afterRestartDone = wekkerDecides({ nowMs: T + 8 * 60_000, selfCreatedAt: wekkerCreated, dataRuns: [{ ...restart, status: 'completed' }] });
  assert.equal(afterRestartDone.action, 'dispatch-data');
});

test('the watchdog itself would not have restarted there: a waiting wekker is a living chain', () => {
  const d = watchdogDecides({
    nowMs: T + 5 * 60_000,
    generated: at(-40),
    dataRuns: [{ ...dataRun('completed', -9, CHAIN_ACTOR), updated_at: at(-7) }],
    wekkerRuns: [{ ...dataRun('waiting', 0, CHAIN_ACTOR) }],
  });
  assert.equal(d.action, 'wait');
});
