#!/usr/bin/env node
/**
 * What the wekker does after its wait: start the next data run, set itself again, or stop.
 * Run by .github/workflows/wekker.yml; the decision itself is a pure function so it can be tested.
 *
 *   node infra/wekker/next.mjs <this run's created_at> '<gh run list --workflow data.yml --json status,createdAt>'
 *
 * prints one word on stdout — `dispatch-data`, `rearm` or `stop` — and the reason on stderr.
 *
 * The rule that matters: the wekker never ends without a successor, unless its own wait timer is
 * gone. On 27 September 2026 the chain died because two guards deferred to each other. A wekker
 * was waiting when GitHub's hourly fallback run started; that run saw the waiting wekker and set
 * no new one (right), and the wekker then saw a data run that had started only 270 s earlier and
 * read it as "the wait timer is missing" (wrong), so it stopped. Nothing restarted the chain until
 * GitHub got round to a scheduled run again — hours later.
 *
 *   - Missing timer: measured on the wekker's OWN age. With the timer it is about eight minutes old
 *     when it gets here; without it, seconds. Other data runs say nothing about the timer.
 *   - A data run still busy: that run may already have deferred to this wekker, so doing nothing
 *     can orphan the chain. The wekker sets itself again instead; when the busy run gets to its
 *     own "Wekker zetten" step it finds the new wekker waiting and defers to it — still one chain.
 */
import { pathToFileURL } from 'node:url';

/** The wait timer on the environment "wekker" is 8 minutes; a wekker younger than this has none. */
export const MIN_OWN_AGE_SECONDS = 360;

/** A data run that is still not completed this many minutes after creation is a ghost (see isStale). */
export const STALE_RUN_MINUTES = 45;

/**
 * @param {{ nowMs: number, selfCreatedAt: string, dataRuns: { status?: string, createdAt?: string }[],
 *           minOwnAgeSeconds?: number }} input
 * @returns {{ action: 'dispatch-data' | 'rearm' | 'stop', reason: string }}
 */
export function decide({ nowMs, selfCreatedAt, dataRuns, minOwnAgeSeconds = MIN_OWN_AGE_SECONDS }) {
  const created = Date.parse(selfCreatedAt ?? '');
  if (Number.isFinite(created)) {
    const age = Math.round((nowMs - created) / 1000);
    if (age < minOwnAgeSeconds) {
      return {
        action: 'stop',
        reason: `Deze wekker is pas ${age}s geleden gestart. Staat de wait timer op de environment 'wekker' nog aan? De keten stopt; het uurlijkse schema in data.yml neemt het over.`,
      };
    }
  }
  // Unknown own age (API hiccup): carry on rather than risk a dead chain — a missing timer would
  // then show up as runs back to back, which the next wekker with a readable age stops.
  const unfinished = (Array.isArray(dataRuns) ? dataRuns : []).filter((r) => r && r.status !== 'completed');
  const stale = unfinished.filter((r) => isStale(r, nowMs));
  const busy = unfinished.length - stale.length;
  if (busy > 0) {
    return {
      action: 'rearm',
      reason: `Er loopt of wacht al een Data-run (${busy}); de wekker wordt opnieuw gezet zodat de keten niet afbreekt.`,
    };
  }
  if (stale.length > 0) {
    return {
      action: 'dispatch-data',
      reason: `Volgende Data-run gestart. ${stale.length} vastgelopen Data-run(s) ouder dan ${STALE_RUN_MINUTES} min genegeerd (${stale.map((r) => `${r.status} sinds ${r.createdAt}`).join(', ')}).`,
    };
  }
  return { action: 'dispatch-data', reason: 'Volgende Data-run gestart.' };
}

/**
 * A run that is not completed this long after it was created is a ghost: GitHub accepted it and
 * never ran it. On 25 November 2026 a dispatched data run stayed "queued" without a single job for
 * over a day, and every wekker deferred to it. A real data run is done within about 21 minutes
 * (preflight 2 + job 15 + "Wekker zetten" 4), plus at most one run ahead of it in the concurrency
 * group. A run without a readable createdAt still counts as busy.
 */
function isStale(run, nowMs) {
  const created = Date.parse(run.createdAt ?? '');
  return Number.isFinite(created) && nowMs - created > STALE_RUN_MINUTES * 60_000;
}

function main() {
  const [selfCreatedAt, runsJson] = process.argv.slice(2);
  let dataRuns = [];
  try {
    dataRuns = JSON.parse(runsJson ?? '[]');
  } catch {
    process.stderr.write('Kon de lijst met Data-runs niet lezen; ga door alsof er niets loopt.\n');
  }
  const { action, reason } = decide({ nowMs: Date.now(), selfCreatedAt, dataRuns });
  process.stderr.write(`${reason}\n`);
  process.stdout.write(`${action}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
