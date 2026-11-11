/**
 * One watchdog tick: look at the published data and at the chain on GitHub, decide (decide.mjs),
 * and restart Data when the chain has stopped. Runs in the Cloudflare Worker (worker.mjs) every
 * five minutes, and locally as a dry run (dry-run.mjs). Uses only `fetch`, so the same code runs
 * in both places and in the tests (test/tick.test.mjs) against a fake.
 *
 * Requests per tick: meta.json, two run lists, and only when needed a cancel per stuck run, one
 * dispatch and one heartbeat — at most 20, well inside the Workers Free plan (50 subrequests,
 * 10 ms CPU; waiting on the network is free).
 *
 * Environment (Worker secrets; nothing else is needed):
 *   GITHUB_TOKEN     fine-grained PAT, this repository only, Actions: read and write (required)
 *   HEALTHCHECK_URL  healthchecks.io ping URL for the watchdog itself (optional): pinged each tick
 *                    it could do its job, `/fail` when GitHub refused or the token is missing
 * Overrides for tests or a fork (optional): GITHUB_REPO, GITHUB_REF, DATA_META_URL.
 */
import { decide } from './decide.mjs';

export const DEFAULTS = Object.freeze({
  GITHUB_REPO: 'stanz2003-tech/wegwerkzaamhedennederland.nl',
  GITHUB_REF: 'main',
  DATA_META_URL: 'https://data.wegwerkzaamhedennederland.nl/v1/meta.json',
});
export const DATA_WORKFLOW = 'data.yml';
export const WEKKER_WORKFLOW = 'wekker.yml';

const NAME = 'wegwerk-watchdog';
const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 10_000;
/** Enough history for the 20-minute restart window (a healthy chain makes ~2 Data runs in it). */
const DATA_RUNS_PER_PAGE = 10;
const WEKKER_RUNS_PER_PAGE = 5;

/** Reads a var/secret, trimming the stray whitespace a pasted secret tends to carry. */
export function envValue(env, name) {
  const raw = env?.[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

function config(env) {
  return {
    repo: envValue(env, 'GITHUB_REPO') || DEFAULTS.GITHUB_REPO,
    ref: envValue(env, 'GITHUB_REF') || DEFAULTS.GITHUB_REF,
    metaUrl: envValue(env, 'DATA_META_URL') || DEFAULTS.DATA_META_URL,
    token: envValue(env, 'GITHUB_TOKEN'),
    healthcheckUrl: envValue(env, 'HEALTHCHECK_URL'),
  };
}

/** What a GitHub status code most likely means for this token, in the owner's language. */
export function githubHint(status) {
  if (status === 401) return 'token ongeldig of verlopen: maak een nieuw token en zet het opnieuw met wrangler secret put GITHUB_TOKEN';
  if (status === 403) return 'token mist het recht Actions: Read and write, of GitHub remt het aantal aanvragen af';
  if (status === 404) return 'repository of workflow niet gevonden: heeft het token toegang tot deze repository?';
  if (status === 422) return 'GitHub weigert de start: bestaat de branch en staat workflow_dispatch nog in data.yml?';
  return 'GitHub gaf een onverwacht antwoord';
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    // GitHub rejects API calls without a User-Agent.
    'user-agent': NAME,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

const message = (err) => (err instanceof Error ? err.message : String(err));

/** `generated` from the published meta.json, fetched past the CDN (cache-buster, no-cache). */
async function readGenerated(cfg, now, fetchImpl) {
  const url = `${cfg.metaUrl}${cfg.metaUrl.includes('?') ? '&' : '?'}watchdog=${now}`;
  try {
    const response = await fetchImpl(url, { headers: { 'user-agent': NAME, 'cache-control': 'no-cache' } });
    if (!response.ok) return { error: `meta.json: HTTP ${response.status}` };
    const generated = (await response.json())?.generated;
    return typeof generated === 'string' ? { generated } : { error: 'meta.json: geen veld generated' };
  } catch (err) {
    return { error: `meta.json: ${message(err)}` };
  }
}

/** The newest runs of one workflow, or an error. */
async function listRuns(cfg, workflow, perPage, fetchImpl) {
  const url = `${GITHUB_API}/repos/${cfg.repo}/actions/workflows/${workflow}/runs?per_page=${perPage}&exclude_pull_requests=true`;
  try {
    const response = await fetchImpl(url, { headers: githubHeaders(cfg.token) });
    if (!response.ok) return { error: `${workflow} runs: HTTP ${response.status} (${githubHint(response.status)})` };
    const runs = (await response.json())?.workflow_runs;
    return Array.isArray(runs) ? { runs } : { error: `${workflow} runs: onverwacht antwoord` };
  } catch (err) {
    return { error: `${workflow} runs: ${message(err)}` };
  }
}

/** POST .../actions/workflows/data.yml/dispatches — GitHub answers 204 when it accepts. */
async function dispatchData(cfg, fetchImpl) {
  const url = `${GITHUB_API}/repos/${cfg.repo}/actions/workflows/${DATA_WORKFLOW}/dispatches`;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { ...githubHeaders(cfg.token), 'content-type': 'application/json' },
      body: JSON.stringify({ ref: cfg.ref }),
    });
    if (response.status === 204) return { ok: true, status: 204 };
    return { ok: false, status: response.status, error: `dispatch: HTTP ${response.status} (${githubHint(response.status)})` };
  } catch (err) {
    return { ok: false, status: null, error: `dispatch: ${message(err)}` };
  }
}

/**
 * POST .../actions/runs/{id}/cancel for a run decide.mjs found stuck. 202 = accepted; 409 means it
 * finished in the meantime, which is just as good.
 */
async function cancelRun(cfg, id, fetchImpl) {
  const url = `${GITHUB_API}/repos/${cfg.repo}/actions/runs/${id}/cancel`;
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: githubHeaders(cfg.token) });
    if (response.status === 202 || response.status === 409) return { id, ok: true, status: response.status };
    return { id, ok: false, status: response.status, error: `cancel ${id}: HTTP ${response.status} (${githubHint(response.status)})` };
  } catch (err) {
    return { id, ok: false, status: null, error: `cancel ${id}: ${message(err)}` };
  }
}

/** Pings healthchecks.io: the plain URL when the watchdog could do its job, `/fail` when not. */
async function heartbeat(url, healthy, fetchImpl) {
  try {
    await fetchImpl(healthy ? url : `${url.replace(/\/+$/, '')}/fail`, { headers: { 'user-agent': NAME } });
  } catch {
    // A missed ping is exactly what healthchecks.io reports on; nothing else to do here.
  }
  return healthy ? 'ok' : 'fail';
}

function fetchWithTimeout(input, init = {}) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/**
 * One tick. Never throws; everything it saw and did is in the returned record (logged by the caller).
 * `dryRun` decides exactly like the real thing but never dispatches and never pings; it also works
 * without a token, because the repository is public.
 */
export async function tick(env, { now = Date.now(), fetchImpl = fetchWithTimeout, dryRun = false } = {}) {
  const cfg = config(env);
  const record = { watchdog: NAME, at: new Date(now).toISOString(), dryRun, repo: cfg.repo };

  if (!cfg.token && !dryRun) {
    const errors = ['GITHUB_TOKEN ontbreekt: zet hem met npx wrangler secret put GITHUB_TOKEN'];
    const pinged = cfg.healthcheckUrl ? await heartbeat(cfg.healthcheckUrl, false, fetchImpl) : null;
    return { ...record, action: 'unknown', reason: 'Geen token; niets gedaan.', generated: null, dispatch: null, errors, heartbeat: pinged };
  }

  const [meta, data, wekker] = await Promise.all([
    readGenerated(cfg, now, fetchImpl),
    listRuns(cfg, DATA_WORKFLOW, DATA_RUNS_PER_PAGE, fetchImpl),
    listRuns(cfg, WEKKER_WORKFLOW, WEKKER_RUNS_PER_PAGE, fetchImpl),
  ]);
  const errors = [meta.error, data.error, wekker.error].filter(Boolean);
  const decision = decide({ nowMs: now, generated: meta.generated, dataRuns: data.runs ?? null, wekkerRuns: wekker.runs ?? null });

  let dispatch = null;
  const cancelled = [];
  if (decision.action === 'dispatch') {
    if (dryRun) {
      cancelled.push(...(decision.cancel ?? []).map((id) => ({ id, skipped: 'dry-run' })));
      dispatch = { skipped: 'dry-run' };
    } else {
      // Stuck runs first, one at a time (rarely more than one): they would block the restart.
      for (const id of decision.cancel ?? []) {
        const { error, ...result } = await cancelRun(cfg, id, fetchImpl);
        cancelled.push(result);
        if (error) errors.push(error);
      }
      const { error, ...result } = await dispatchData(cfg, fetchImpl);
      dispatch = result;
      if (error) errors.push(error);
    }
  }

  // Healthy = the watchdog could see the chain and, if it had to, restart it. Stale data alone is
  // not its fault; the wekker's own heartbeat reports that.
  const done = (step) => step.ok === true || Boolean(step.skipped);
  const healthy = Boolean(data.runs && wekker.runs) && (dispatch === null || done(dispatch)) && cancelled.every(done);
  const pinged = !dryRun && cfg.healthcheckUrl ? await heartbeat(cfg.healthcheckUrl, healthy, fetchImpl) : null;

  return {
    ...record,
    action: decision.action,
    reason: decision.reason,
    generated: meta.generated ?? null,
    ...decision.facts,
    cancelled,
    dispatch,
    errors,
    heartbeat: pinged,
  };
}

/** One JSON line per tick, at a level that matches what happened (Workers Logs keeps them). */
export function logRecord(record, logger = console) {
  const line = JSON.stringify(record);
  if (record.errors?.length) logger.error(line);
  else if (record.action === 'dispatch') logger.warn(line);
  else logger.log(line);
}
