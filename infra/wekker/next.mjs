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
  const busy = (Array.isArray(dataRuns) ? dataRuns : []).filter((r) => r && r.status !== 'completed').length;
  if (busy > 0) {
    return {
      action: 'rearm',
      reason: `Er loopt of wacht al een Data-run (${busy}); de wekker wordt opnieuw gezet zodat de keten niet afbreekt.`,
    };
  }
  return { action: 'dispatch-data', reason: 'Volgende Data-run gestart.' };
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
