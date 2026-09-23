#!/usr/bin/env node
/**
 * End-to-end check of the published site, run by .github/workflows/wekker.yml between two data
 * runs. It pings healthchecks.io only when the whole chain is healthy:
 *
 *   1. the site answers with a 200;
 *   2. the published meta.json — fetched past the CDN cache — is younger than MAX_DATA_AGE_MINUTES.
 *
 * Why a separate check instead of the ping at the end of the Data job: that ping proved only that
 * a job went green. It could not see a Pages deploy that failed, a cache rule serving a stale 404,
 * or a chain of runs that had silently stopped. One silent heartbeat now means "something in the
 * chain is broken", whichever link it was.
 *
 * The script never fails the job. The wekker must dispatch the next data run even when the site is
 * unhealthy — a stopped chain cannot recover on its own — so problems are reported as workflow
 * warnings and in the job summary, and the missing heartbeat is what raises the alarm.
 *
 * Environment:
 *   SITE_URL               page that must answer 200 (omit to skip)
 *   DATA_META_URL          published meta.json (omit to skip the freshness check)
 *   MAX_DATA_AGE_MINUTES   freshness ceiling (default 30: three missed ten-minute cycles)
 *   HEALTHCHECK_URL        pinged only when every check passed (omit to skip)
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const USER_AGENT = 'wegwerk-wekker';
const DEFAULT_MAX_AGE_MINUTES = 30;
const FETCH_TIMEOUT_MS = 10_000;

/** Reads a variable, trimming the stray whitespace a pasted secret tends to carry. */
export function envValue(env, name) {
  const raw = env?.[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Minutes between `generated` in meta.json and now; NaN when the field is missing or unparsable. */
export function dataAgeMinutes(meta, nowMs) {
  const generated = Date.parse(meta?.generated ?? '');
  return Number.isNaN(generated) ? Number.NaN : (nowMs - generated) / 60000;
}

/**
 * Turns the observations into one verdict. Anything unknown counts as not-ok: a heartbeat that
 * keeps arriving while the truth is unknown is worse than no heartbeat at all.
 * `null` means "check switched off", which is not a problem; `false` / NaN means it failed.
 */
export function verdict({ siteOk, ageMinutes, maxAgeMinutes }) {
  const problems = [];
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
 * One full check. Returns what was observed; pings the heartbeat only when everything is healthy.
 * @returns {Promise<{ok: boolean, problems: string[], age: number|null, siteOk: boolean|null, pinged: boolean}>}
 */
export async function runCheck(env, { now = Date.now(), fetchImpl = fetchWithTimeout } = {}) {
  const siteUrl = envValue(env, 'SITE_URL');
  let siteOk = null;
  if (siteUrl) {
    try {
      const response = await fetchImpl(siteUrl, { headers: { 'user-agent': USER_AGENT } });
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
  const result = verdict({ siteOk, ageMinutes, maxAgeMinutes });

  let pinged = false;
  const heartbeat = envValue(env, 'HEALTHCHECK_URL');
  if (heartbeat && result.ok) {
    try {
      const response = await fetchImpl(heartbeat, { headers: { 'user-agent': USER_AGENT } });
      pinged = response.ok;
    } catch {
      // A missed heartbeat is exactly what healthchecks.io reports on; nothing useful to do here.
    }
  }

  return { ...result, age: ageMinutes, siteOk, pinged };
}

/** Human-readable report for the job log and the job summary. */
export function report(result) {
  const age = result.age === null ? 'niet gecontroleerd' : Number.isNaN(result.age) ? 'onleesbaar' : `${Math.round(result.age)} min`;
  const site = result.siteOk === null ? 'niet gecontroleerd' : result.siteOk ? 'antwoordt' : 'antwoordt NIET';
  const lines = [
    `### Wekker — ketencontrole`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Site | ${site} |`,
    `| Leeftijd gepubliceerde data | ${age} |`,
    `| Oordeel | ${result.ok ? 'gezond' : `**${result.problems.join(' · ')}**`} |`,
    `| Hartslag naar healthchecks.io | ${result.pinged ? 'verstuurd' : 'niet verstuurd'} |`,
  ];
  return lines.join('\n');
}

async function main() {
  const result = await runCheck(process.env);
  const text = report(result);
  console.log(text);
  if (!result.ok) console.log(`::warning::Wekker: ${result.problems.join(' · ')}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${text}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    // Never fail the job: the next data run must still be dispatched.
    console.log(`::warning::Wekker-controle kon niet draaien: ${err instanceof Error ? err.message : String(err)}`);
  });
}
