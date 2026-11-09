/**
 * Replays of the two nights the chain died, from the real run history (test/fixtures/, fetched
 * from the GitHub API on 9 November 2026). Every five minutes the watchdog would have looked; these
 * tests check what it would have decided — and above all that it never fires while the chain lives.
 *
 * The run list only knows how runs ended, so the state at an earlier moment is rebuilt: a run
 * exists from created_at, and is busy until updated_at (or forever, if it had not finished when the
 * fixture was fetched). meta.json is rebuilt the same way: `generated` is a run's start (created_at
 * + 16 s, as in the live meta.json of run 42685614863), visible once that run has finished.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decide, TICK_MINUTES } from '../decide.mjs';

const load = (day) => JSON.parse(readFileSync(new URL(`./fixtures/runs-${day}.json`, import.meta.url), 'utf8'));
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** The run as the API would have listed it at `atMs` (newest first), or nothing if not yet created. */
function listAt(runs, atMs) {
  return runs
    .filter((r) => Date.parse(r.created_at) <= atMs)
    .map((r) => {
      const finished = r.conclusion !== null && Date.parse(r.updated_at) <= atMs;
      return {
        status: finished ? 'completed' : 'in_progress',
        created_at: r.created_at,
        updated_at: finished ? r.updated_at : r.created_at,
        event: r.event,
        actor: { login: r.actor },
        triggering_actor: { login: r.actor },
      };
    })
    .reverse();
}

/** `generated` in meta.json at `atMs`: the newest published run that had finished by then. */
function generatedAt(dataRuns, atMs, published) {
  const last = dataRuns.filter((r) => published(r) && Date.parse(r.updated_at) <= atMs).at(-1);
  return last ? iso(Date.parse(last.created_at) + 16_000) : undefined;
}

/** Every tick of a `*\/5` cron between two moments, with the decision the watchdog would have made. */
function replay(day, from, to, published, generatedOverride) {
  const { data, wekker } = load(day);
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += TICK_MINUTES * 60_000) {
    const generated = generatedOverride ?? generatedAt(data, t, published);
    const d = decide({ nowMs: t, generated, dataRuns: listAt(data, t), wekkerRuns: listAt(wekker, t) });
    out.push({ at: iso(t).slice(11, 16), ...d });
  }
  return out;
}

const firstDispatch = (ticks) => ticks.find((t) => t.action === 'dispatch')?.at;
const success = (r) => r.conclusion === 'success';

test('9 November: the watchdog restarts the chain at 18:40, fifty minutes before the manual run', () => {
  // Run 42672553932 (18:16) published and then concluded "failure" without ever creating its
  // `volgende` job; the data stayed at 18:16 until Stan pressed Run workflow at 19:30.
  const published = (r) => success(r) || r.id === 42672553932;
  const ticks = replay('2026-11-09', '2026-11-09T16:05:00Z', '2026-11-09T18:40:00Z', published);
  assert.equal(firstDispatch(ticks), '18:40');
  const at = (hhmm) => ticks.find((t) => t.at === hhmm);
  assert.equal(at('18:20').action, 'ok', 'four minutes after the last publish');
  assert.equal(at('18:35').action, 'ok', 'nineteen minutes old: not stale yet');
  assert.match(at('18:40').reason, /keten is gestopt/);
  // 18:40 + a two-minute run = 18:42, data 26 minutes old at worst: below the site's 30-minute
  // "gegevens niet actueel" mark. In reality the warning showed from 18:47 until 19:32.
});

test('9 November: while the chain ran (16:05–18:35) not a single dispatch, even if no run had published', () => {
  // Worst case for false alarms: data hours old the whole time (a pipeline failing every run). The
  // chain was alive at every tick, so the watchdog must still leave it alone.
  const ticks = replay('2026-11-09', '2026-11-09T16:05:00Z', '2026-11-09T18:15:00Z', success, '2026-11-09T12:00:00Z');
  assert.deepEqual(ticks.filter((t) => t.action === 'dispatch'), []);
  assert.ok(ticks.every((t) => t.action === 'wait'), 'stale but alive at every tick');
  // And after the manual restart at 19:30 the chain runs again: no dispatch from 19:35 on.
  const after = replay('2026-11-09', '2026-11-09T19:35:00Z', '2026-11-09T19:50:00Z', success, '2026-11-09T12:00:00Z');
  assert.deepEqual(after.filter((t) => t.action === 'dispatch'), []);
});

test('4 November (Actions outage): restarts at 10:25 and 16:20, never during the slow runs between', () => {
  // 10:12 the Data run failed and the chain died; GitHub's fallback cron only came back at 15:42.
  // 15:45–16:17 a wekker (30 min) and a Data run (24 min) crawled through the outage; that chain
  // died at 16:17 and stayed dead until a push at 19:08. Whether the 10:12 run published is unknown;
  // assumed not (a failed data job publishes nothing).
  // (The fixture starts at 08:00; from 08:30 on the replay has a full cycle of history behind it.)
  const morning = replay('2026-11-04', '2026-11-04T08:30:00Z', '2026-11-04T10:25:00Z', success);
  assert.equal(firstDispatch(morning), '10:25');
  assert.ok(morning.filter((t) => t.at < '10:25').every((t) => t.action !== 'dispatch'));

  const afternoon = replay('2026-11-04', '2026-11-04T15:45:00Z', '2026-11-04T16:20:00Z', success);
  assert.equal(firstDispatch(afternoon), '16:20');
  // From 16:05 the data (15:42) was over 20 minutes old while the slow runs were still going.
  for (const t of afternoon.filter((x) => x.at >= '16:05' && x.at <= '16:15')) {
    assert.equal(t.action, 'wait', `${t.at}: data stale, but the slow runs were still busy`);
  }

  const evening = replay('2026-11-04', '2026-11-04T19:10:00Z', '2026-11-04T20:00:00Z', success);
  assert.deepEqual(evening.filter((t) => t.action === 'dispatch'), [], 'the chain is back after the push');
});
