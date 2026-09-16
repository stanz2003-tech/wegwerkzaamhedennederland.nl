/**
 * Wegwerk wekker — a Cloudflare Worker whose only job is to start the Data workflow on time.
 *
 * Why this exists: GitHub runs `schedule:` triggers on a best-effort basis, and on this repository
 * it drops almost all of them. Between 13 and 16 September 2026 a `1-59/5` cron (288 runs a day)
 * produced 19 runs in three days, with gaps up to 5 hours 53 — so "files en incidenten worden elke
 * 5 minuten vernieuwd" was false on every page of the site. A Cloudflare Cron Trigger fires
 * reliably, costs nothing on the Free plan (5 triggers per account, 10 ms CPU, 50 subrequests per
 * invocation) and does no work itself: it calls the GitHub REST API, and the pipeline keeps running
 * where it already runs.
 *
 * The same invocation doubles as the only end-to-end check that exists. The workflow's own
 * heartbeat proves that a job went green; it cannot see a broken Pages deploy, a cache rule that
 * serves a stale 404, or an expired token. This Worker pings `HEALTHCHECK_URL` only when the
 * dispatch was accepted AND the site answers AND the published data is younger than
 * MAX_DATA_AGE_MINUTES — so one silent heartbeat means "something in the chain is broken",
 * whichever link it was.
 *
 * Configuration (wrangler.toml [vars], plus secrets):
 *   GITHUB_TOKEN            secret  fine-grained PAT, Actions: read+write, this repository only
 *   GITHUB_REPO             var     "owner/name"
 *   WORKFLOW_FILE           var     workflow to dispatch (default "data.yml")
 *   GITHUB_REF              var     branch to run on (default "main")
 *   DATA_META_URL           var     published meta.json; omit to skip the freshness check
 *   SITE_URL                var     page that must answer 200; omit to skip
 *   MAX_DATA_AGE_MINUTES    var     freshness ceiling in minutes (default 45)
 *   HEALTHCHECK_URL         secret  pinged only when every check passed; omit to skip
 */

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'wegwerk-wekker';
const DEFAULT_MAX_AGE_MINUTES = 45;
const FETCH_TIMEOUT_MS = 8000;

/** Reads a var/secret, trimming the stray whitespace a pasted secret tends to carry. */
export function envValue(env, name) {
  const raw = env?.[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * The request that starts the workflow. A 204 means GitHub accepted it; a 404 almost always means
 * the token lacks the Actions permission rather than that the workflow is missing.
 */
export function dispatchRequest(env) {
  const repo = envValue(env, 'GITHUB_REPO');
  const token = envValue(env, 'GITHUB_TOKEN');
  if (!repo.includes('/')) throw new Error('GITHUB_REPO must be "owner/name"');
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const workflow = envValue(env, 'WORKFLOW_FILE') || 'data.yml';
  const ref = envValue(env, 'GITHUB_REF') || 'main';
  return new Request(`${GITHUB_API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      // GitHub rejects API calls that arrive without a User-Agent.
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({ ref }),
  });
}

/** Minutes between `generated` in meta.json and now; NaN when the field is missing or unparsable. */
export function dataAgeMinutes(meta, nowMs) {
  const generated = Date.parse(meta?.generated ?? '');
  return Number.isNaN(generated) ? Number.NaN : (nowMs - generated) / 60000;
}

/**
 * Turns the three observations into one verdict. Anything unknown counts as not-ok: a heartbeat
 * that keeps arriving while the truth is unknown is worse than no heartbeat at all.
 */
export function verdict({ dispatched, siteOk, ageMinutes, maxAgeMinutes }) {
  const problems = [];
  if (!dispatched) problems.push('workflow niet gestart');
  if (siteOk === false) problems.push('site antwoordt niet');
  if (ageMinutes !== null) {
    if (Number.isNaN(ageMinutes)) problems.push('data-tijdstempel onleesbaar');
    else if (ageMinutes > maxAgeMinutes) problems.push(`data ${Math.round(ageMinutes)} min oud (max ${maxAgeMinutes})`);
  }
  return { ok: problems.length === 0, problems };
}

function fetchWithTimeout(input, init = {}) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/**
 * One full cycle: start the workflow, then verify the chain it feeds.
 * @returns {Promise<{ok: boolean, problems: string[], age: number|null, dispatched: boolean}>}
 */
export async function runCheck(env, { now = Date.now(), fetchImpl = fetchWithTimeout } = {}) {
  let dispatched = false;
  let dispatchDetail = '';
  try {
    const response = await fetchImpl(dispatchRequest(env));
    dispatched = response.status === 204;
    if (!dispatched) dispatchDetail = `HTTP ${response.status}`;
  } catch (err) {
    dispatchDetail = err instanceof Error ? err.message : String(err);
  }

  const siteUrl = envValue(env, 'SITE_URL');
  let siteOk = null;
  if (siteUrl) {
    try {
      const response = await fetchImpl(siteUrl, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
      siteOk = response.ok;
    } catch {
      siteOk = false;
    }
  }

  const metaUrl = envValue(env, 'DATA_META_URL');
  let ageMinutes = null;
  if (metaUrl) {
    try {
      // Cache-busting on purpose: this check is about the origin's state, not Cloudflare's copy.
      const url = `${metaUrl}${metaUrl.includes('?') ? '&' : '?'}wekker=${now}`;
      const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' } });
      ageMinutes = response.ok ? dataAgeMinutes(await response.json(), now) : Number.NaN;
    } catch {
      ageMinutes = Number.NaN;
    }
  }

  const maxAgeMinutes = Number(envValue(env, 'MAX_DATA_AGE_MINUTES')) || DEFAULT_MAX_AGE_MINUTES;
  const result = verdict({ dispatched, siteOk, ageMinutes, maxAgeMinutes });
  if (dispatchDetail) {
    result.problems = result.problems.map((p) => (p === 'workflow niet gestart' ? `${p} (${dispatchDetail})` : p));
  }

  const heartbeat = envValue(env, 'HEALTHCHECK_URL');
  if (heartbeat && result.ok) {
    try {
      await fetchImpl(heartbeat, { headers: { 'user-agent': USER_AGENT } });
    } catch {
      // A missed heartbeat is what healthchecks.io reports on; there is nothing useful to do here.
    }
  }

  return { ...result, age: ageMinutes, dispatched };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runCheck(env).then((result) => {
        if (!result.ok) console.error('wekker:', result.problems.join(' · '));
      }),
    );
  },

  /**
   * Report-only endpoint, so the Worker can be inspected without waiting for the next cron. It
   * deliberately never dispatches anything and never echoes a secret — only whether one is set.
   */
  async fetch(request, env) {
    const names = ['GITHUB_TOKEN', 'GITHUB_REPO', 'HEALTHCHECK_URL', 'DATA_META_URL', 'SITE_URL'];
    const body = {
      worker: USER_AGENT,
      doel: 'start de Data-workflow van wegwerkzaamhedennederland.nl en bewaakt de keten',
      ingesteld: Object.fromEntries(names.map((name) => [name, envValue(env, name) !== ''])),
      repo: envValue(env, 'GITHUB_REPO') || null,
      workflow: envValue(env, 'WORKFLOW_FILE') || 'data.yml',
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
