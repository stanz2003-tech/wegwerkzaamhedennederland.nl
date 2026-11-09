/**
 * The watchdog's decision: restart the Data → Wekker → Data chain from outside GitHub, or leave it.
 * A pure function, so every rule below is tested (test/decide.test.mjs, test/replay.test.mjs).
 *
 * Why it exists: the chain has died at least four times (27 Sep, 30 Oct, 4 Nov, 9 Nov 2026) in ways
 * no step inside GitHub can catch — a dispatch GitHub accepted and then lost, a run that concluded
 * "failure" without ever creating its `volgende` job — and GitHub's own fallback cron (:07/:37)
 * was dropped on exactly those evenings. A Cloudflare Cron Trigger does fire, so the watchdog runs
 * there and only does what a person did by hand: press "Run workflow" on Data.
 *
 * The rules, in order:
 *   1. GitHub unreadable → do nothing (`unknown`). Acting blind is how two chains start.
 *   2. Data fresh (`generated` at most STALE_AFTER_MINUTES old) → nothing to do (`ok`).
 *      When meta.json is unreadable, the chain's own silence stands in for the data's age.
 *   3. A Data or Wekker run queued, waiting or running → the chain is alive (`wait`). This mirrors
 *      the one-chain rules of the chain itself (infra/wekker/next.mjs, the `volgende` job): whoever
 *      is busy will set the next link. Stale data with a living chain means the pipeline fails, and
 *      another run cannot fix NDW or R2. A run "busy" for over BUSY_MAX_AGE_MINUTES is stuck, not
 *      alive, and does not count.
 *   4. A run finished less than SETTLE_SECONDS ago → its successor may not be listed yet (`wait`).
 *   5. A restart (a workflow_dispatch from outside the chain: this watchdog or a manual
 *      "Run workflow") less than RESTART_INTERVAL_MINUTES ago → `wait`. At most one per interval.
 *   6. Otherwise the chain is dead → `dispatch` Data on main. Stuck runs from rule 3 are cancelled
 *      first (`cancel`): a stuck wekker would make the new run's `volgende` defer to it, and a stuck
 *      Data run would hold the new one in the `data` concurrency group — either way the restart
 *      would not bring the chain back. Cancelling them cannot split it: a healthy wekker is done
 *      in about 13 minutes and a Data run in about 20, far below BUSY_MAX_AGE_MINUTES.
 *
 * Even a restart that was not needed cannot split the chain: a Data run's `volgende` job adds no
 * wekker while one waits, and a wekker that finds a Data run busy sets itself again instead of
 * starting another. That is why GitHub's own fallback cron is safe, and this is the same kind of run.
 * The rules above are there so the watchdog does not add runs a living chain does not need.
 */

/** Data older than this, with nothing busy, means the chain stopped. A healthy cycle is ~10 min. */
export const STALE_AFTER_MINUTES = 20;
/** The cron in wrangler.toml: `*\/5 * * * *`. */
export const TICK_MINUTES = 5;
/** An unfinished run older than this is stuck. A wekker normally takes 8 min, 30 on 4 Nov. */
export const BUSY_MAX_AGE_MINUTES = 60;
/** After a run finishes, the next link appears within seconds; give it one tick. */
export const SETTLE_SECONDS = 120;
/** At most one restart (own or manual) per this many minutes. */
export const RESTART_INTERVAL_MINUTES = 20;
/** Runs the chain starts itself carry this actor (the jobs' GITHUB_TOKEN). */
export const CHAIN_ACTOR = 'github-actions[bot]';

const MINUTE_MS = 60_000;

/** Minutes since an ISO time, or NaN when it is missing or unparsable. */
export function minutesSince(isoTime, nowMs) {
  const t = Date.parse(isoTime ?? '');
  return Number.isNaN(t) ? Number.NaN : (nowMs - t) / MINUTE_MS;
}

const round1 = (n) => Math.round(n * 10) / 10;
const actorOf = (run) => run?.triggering_actor?.login ?? run?.actor?.login ?? '';
const hhmm = (isoTime) => (typeof isoTime === 'string' ? isoTime.slice(11, 16) : '?');

/**
 * A Data run started from outside the chain: this watchdog or someone pressing "Run workflow".
 * An unknown actor counts as a restart, which only ever makes the watchdog hold back longer.
 */
export function isRestart(run) {
  return run?.event === 'workflow_dispatch' && actorOf(run) !== CHAIN_ACTOR;
}

/** Labels like "Wekker waiting 18:07Z" for the log. */
function label(run) {
  return `${run.workflow} ${run.status} ${hhmm(run.created_at)}Z`;
}

/** The newest of the given times as minutes ago, or Infinity when there is none. */
function newestMinutesAgo(times, nowMs) {
  const ages = times.map((t) => minutesSince(t, nowMs)).filter(Number.isFinite);
  return ages.length ? Math.min(...ages) : Number.POSITIVE_INFINITY;
}

/** What the run lists say about the chain right now. */
function chainState(dataRuns, wekkerRuns, nowMs) {
  const runs = [
    ...dataRuns.map((r) => ({ ...r, workflow: 'Data' })),
    ...wekkerRuns.map((r) => ({ ...r, workflow: 'Wekker' })),
  ].filter((r) => r && typeof r === 'object');
  const open = runs.filter((r) => r.status !== 'completed');
  // An unreadable start time counts as busy: holding back is the safe side.
  const isStuck = (r) => minutesSince(r.created_at, nowMs) > BUSY_MAX_AGE_MINUTES;
  const stuck = open.filter(isStuck);
  return {
    busy: open.filter((r) => !isStuck(r)).map(label),
    stuck: stuck.map(label),
    stuckIds: stuck.map((r) => r.id).filter((id) => Number.isSafeInteger(id) && id > 0),
    idleMinutes: newestMinutesAgo(runs.map((r) => r.updated_at ?? r.created_at), nowMs),
    lastRestartMinutes: newestMinutesAgo(dataRuns.filter(isRestart).map((r) => r.created_at), nowMs),
  };
}

/**
 * @param {{ nowMs: number, generated?: string, dataRuns: object[] | null, wekkerRuns: object[] | null }} input
 *   `generated` from the published meta.json; the run lists as GET .../actions/workflows/{file}/runs
 *   returns them (`workflow_runs`), newest first. `null` = could not be read.
 * @returns {{ action: 'ok' | 'wait' | 'dispatch' | 'unknown', reason: string, facts: object, cancel?: number[] }}
 *   `cancel`: ids of stuck runs to cancel before the dispatch (only with `dispatch`).
 */
export function decide({ nowMs, generated, dataRuns, wekkerRuns }) {
  if (!Array.isArray(dataRuns) || !Array.isArray(wekkerRuns)) {
    return { action: 'unknown', reason: 'De runs op GitHub zijn niet te lezen; niets gedaan.', facts: {} };
  }
  const age = minutesSince(generated, nowMs);
  const chain = chainState(dataRuns, wekkerRuns, nowMs);
  const facts = {
    ageMinutes: Number.isFinite(age) ? round1(age) : null,
    idleMinutes: Number.isFinite(chain.idleMinutes) ? round1(chain.idleMinutes) : null,
    busy: chain.busy,
    stuck: chain.stuck,
    lastRestartMinutes: Number.isFinite(chain.lastRestartMinutes) ? round1(chain.lastRestartMinutes) : null,
  };
  const ageText = Number.isFinite(age) ? `Data ${Math.round(age)} min oud` : 'meta.json onleesbaar';
  const idleText = Number.isFinite(chain.idleMinutes) ? `${Math.round(chain.idleMinutes)} min` : 'onbekend lang';

  const stale = Number.isFinite(age) ? age > STALE_AFTER_MINUTES : chain.idleMinutes > STALE_AFTER_MINUTES;
  if (!stale) {
    const reason = Number.isFinite(age)
      ? `${ageText}; niets te doen.`
      : `${ageText}, maar de keten was ${idleText} geleden nog actief; niets gedaan.`;
    return { action: 'ok', reason, facts };
  }
  if (chain.busy.length > 0) {
    return {
      action: 'wait',
      reason: `${ageText}, maar de keten leeft (${chain.busy.join(', ')}). Een extra run voegt niets toe; faalt de pipeline zelf?`,
      facts,
    };
  }
  if (chain.idleMinutes * 60 < SETTLE_SECONDS) {
    return { action: 'wait', reason: `${ageText}; er is net een run klaar (${Math.round(chain.idleMinutes * 60)} s geleden). Volgende tik opnieuw kijken.`, facts };
  }
  if (chain.lastRestartMinutes < RESTART_INTERVAL_MINUTES) {
    return {
      action: 'wait',
      reason: `${ageText} en de keten staat stil, maar Data is ${Math.round(chain.lastRestartMinutes)} min geleden al van buitenaf gestart (waakhond of handmatig). Hooguit één herstart per ${RESTART_INTERVAL_MINUTES} min.`,
      facts,
    };
  }
  const cancelText = chain.stuckIds.length ? ` Eerst ${chain.stuckIds.length} vastgelopen run(s) annuleren.` : '';
  return {
    action: 'dispatch',
    reason: `${ageText} en al ${idleText} geen Data- of Wekker-run actief: de keten is gestopt. Data wordt opnieuw gestart.${cancelText}`,
    facts,
    cancel: chain.stuckIds,
  };
}
