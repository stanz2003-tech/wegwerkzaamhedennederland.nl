#!/usr/bin/env node
/**
 * Collects the numbers for the daily status mail as one JSON document on stdout. A scheduled
 * Claude routine runs this script, writes a short Dutch summary from the JSON and mails it.
 *
 *   node infra/daily-report.mjs [--now 2026-10-26T18:00:00Z]
 *
 * Sections, each fetched on its own so one broken source does not hide the other:
 *   visitors     Cloudflare Web Analytics (RUM) — Dutch visits today so far, the same moment a week
 *                ago, yesterday, the last 7 days against the 7 before, top pages and referrers,
 *                plus the visits from China (bot traffic, challenged by a WAF rule since 2026-10-25).
 *   search       Google Search Console — clicks, impressions, CTR and position of the last 7 days
 *                with data (Google lags 2–3 days) against the 7 before, and the top pages.
 *
 * Environment (secrets live in the cloud environment, never in the repo):
 *   CF_API_TOKEN   Cloudflare API token with "Account Analytics: Read".
 *   GSC_SA_JSON    Google service-account key (JSON text), added to the Search Console
 *                  property as a user with restricted access.
 *
 * Exit codes: 0 at least one section ok · 1 every section failed.
 */
import { createSign } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const CF_ACCOUNT = 'e05c34416fc750c256958a04f58b0c9a';
export const CF_SITE_TAG = '2dd291d8e9274d309dddef0d56257f9e';
export const GSC_PROPERTY = 'sc-domain:wegwerkzaamhedennederland.nl';
const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TIME_ZONE = 'Europe/Amsterdam';
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 30_000;
const TOP_N = 10;
const GSC_LOOKBACK_DAYS = 18;
const GSC_WINDOW_DAYS = 7;

/** Offset of Amsterdam from UTC at `date`, in ms (+1 h in winter, +2 h in summer). */
function amsterdamOffsetMs(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar date in Amsterdam, as YYYY-MM-DD. */
export function amsterdamDate(date) {
  return new Date(date.getTime() + amsterdamOffsetMs(date)).toISOString().slice(0, 10);
}

/** The instant Amsterdam's day `ymd` starts, correct across the DST switches. */
export function amsterdamMidnight(ymd) {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const guess = new Date(Date.parse(`${ymd}T00:00:00Z`) - amsterdamOffsetMs(noonUtc));
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - amsterdamOffsetMs(guess));
}

function addDays(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The time windows of the visitors section, all in real instants. */
export function visitorPeriods(now) {
  const today = amsterdamDate(now);
  const start = amsterdamMidnight(today);
  const weekAgoStart = amsterdamMidnight(addDays(today, -7));
  return {
    today: [start, now],
    sameTimeLastWeek: [weekAgoStart, new Date(weekAgoStart.getTime() + (now - start))],
    yesterday: [amsterdamMidnight(addDays(today, -1)), start],
    last7Days: [new Date(now - 7 * DAY_MS), now],
    previous7Days: [new Date(now - 14 * DAY_MS), new Date(now - 7 * DAY_MS)],
  };
}

function rumGroup(alias, [from, to], { country, countryNot, dims, limit = 10 } = {}) {
  const filters = [
    `siteTag:"${CF_SITE_TAG}"`,
    `datetime_geq:"${from.toISOString()}"`,
    `datetime_lt:"${to.toISOString()}"`,
    country ? `countryName:"${country}"` : '',
    countryNot ? `countryName_neq:"${countryNot}"` : '',
  ].filter(Boolean).join(',');
  const order = dims ? 'orderBy:[sum_visits_DESC],' : '';
  return `${alias}:rumPageloadEventsAdaptiveGroups(limit:${limit},${order}filter:{${filters}}){count sum{visits}${dims ? ` dimensions{${dims}}` : ''}}`;
}

/** One GraphQL query for every number of the visitors section. */
export function visitorsQuery(now) {
  const p = visitorPeriods(now);
  const nl = { country: 'NL' };
  const groups = [
    rumGroup('today', p.today, nl),
    rumGroup('sameTimeLastWeek', p.sameTimeLastWeek, nl),
    rumGroup('yesterday', p.yesterday, nl),
    rumGroup('last7Days', p.last7Days, nl),
    rumGroup('previous7Days', p.previous7Days, nl),
    rumGroup('todayChina', p.today, { country: 'CN' }),
    rumGroup('todayOther', p.today, { countryNot: 'NL' }),
    rumGroup('topPages', p.today, { ...nl, dims: 'requestPath', limit: TOP_N }),
    rumGroup('referrers', p.today, { ...nl, dims: 'refererHost', limit: 6 }),
  ];
  return `{viewer{accounts(filter:{accountTag:"${CF_ACCOUNT}"}){${groups.join(' ')}}}}`;
}

const totals = (rows) => ({ visits: rows?.[0]?.sum?.visits ?? 0, pageviews: rows?.[0]?.count ?? 0 });
const ranked = (rows, key) =>
  (rows ?? []).map((r) => ({ [key]: r.dimensions[key] || '(direct)', visits: r.sum.visits }));

/** Shapes the GraphQL answer; the numbers are Cloudflare's sampled estimates. */
export function summariseVisitors(account, now) {
  const china = totals(account.todayChina).visits;
  return {
    asOf: now.toISOString(),
    country: 'NL',
    today: totals(account.today),
    sameTimeLastWeek: totals(account.sameTimeLastWeek),
    yesterday: totals(account.yesterday),
    last7Days: totals(account.last7Days),
    previous7Days: totals(account.previous7Days),
    todayChinaVisits: china,
    todayOtherCountriesVisits: totals(account.todayOther).visits - china,
    topPages: ranked(account.topPages, 'requestPath').map((r) => ({ ...r, requestPath: r.requestPath.replace(/\?.*$/, '') })),
    referrers: ranked(account.referrers, 'refererHost'),
  };
}

export async function fetchVisitors({ token, now, fetchImpl = fetch }) {
  if (!token) throw new Error('CF_API_TOKEN is not set');
  const res = await fetchImpl(CF_GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: visitorsQuery(now) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  const account = body?.data?.viewer?.accounts?.[0];
  // GraphQL can answer 200 with some aliases null plus errors[]; those would read as real zeros.
  if (!res.ok || !account || body.errors?.length) {
    const why = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare GraphQL failed: ${why}`);
  }
  return summariseVisitors(account, now);
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/** A signed RS256 JWT that Google swaps for an access token (service-account flow). */
export function serviceAccountJwt({ client_email: email, private_key: key }, now) {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: email, scope: GSC_SCOPE, aud: GOOGLE_TOKEN, iat, exp: iat + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key, 'base64url');
  return `${header}.${claims}.${signature}`;
}

async function googleAccessToken(serviceAccount, now, fetchImpl) {
  const res = await fetchImpl(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: serviceAccountJwt(serviceAccount, now),
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Google token request failed: HTTP ${res.status} ${body.error ?? ''}`.trim());
  return body.access_token;
}

async function searchAnalytics(accessToken, request, fetchImpl) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_PROPERTY)}/searchAnalytics/query`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console query failed: HTTP ${res.status} ${body?.error?.message ?? ''}`.trim());
  return body.rows ?? [];
}

function sumWindow({ from, to, rows }) {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const weightedPosition = rows.reduce((n, r) => n + r.position * r.impressions, 0);
  return {
    from,
    to,
    daysWithData: rows.length,
    clicks,
    impressions,
    ctr: impressions ? Math.round((clicks / impressions) * 1000) / 10 : 0,
    position: impressions ? Math.round((weightedPosition / impressions) * 10) / 10 : null,
  };
}

/**
 * Two calendar weeks ending on the newest date with data. Search Console leaves out days
 * without impressions, so the windows are built from dates, not from row counts.
 */
export function searchWindows(dailyRows) {
  const newest = dailyRows.reduce((max, r) => (r.keys[0] > max ? r.keys[0] : max), '');
  if (!newest) return null;
  const window = (endOffset) => {
    const from = addDays(newest, endOffset - GSC_WINDOW_DAYS + 1);
    const to = addDays(newest, endOffset);
    return { from, to, rows: dailyRows.filter((r) => r.keys[0] >= from && r.keys[0] <= to) };
  };
  return { last: window(0), previous: window(-GSC_WINDOW_DAYS) };
}

/** The newest calendar week with data against the week before it, plus the top pages. */
export function summariseSearch(dailyRows, pageRows) {
  const windows = searchWindows(dailyRows);
  const empty = { from: null, to: null, rows: [] };
  return {
    lastWeek: sumWindow(windows?.last ?? empty),
    previousWeek: sumWindow(windows?.previous ?? empty),
    topPages: pageRows.slice(0, TOP_N).map((r) => ({
      page: r.keys[0].replace(/^https:\/\/www\.wegwerkzaamhedennederland\.nl/, ''),
      clicks: r.clicks,
      impressions: r.impressions,
    })),
  };
}

export async function fetchSearch({ serviceAccountJson, now, fetchImpl = fetch }) {
  if (!serviceAccountJson) throw new Error('GSC_SA_JSON is not set');
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('GSC_SA_JSON is not valid JSON (paste the whole key file)');
  }
  const accessToken = await googleAccessToken(serviceAccount, now, fetchImpl);
  const endDate = amsterdamDate(now);
  const startDate = addDays(endDate, -GSC_LOOKBACK_DAYS);
  const daily = await searchAnalytics(accessToken, { startDate, endDate, dimensions: ['date'], dataState: 'final' }, fetchImpl);
  const last = searchWindows(daily)?.last;
  const pages = last
    ? await searchAnalytics(accessToken, { startDate: last.from, endDate: last.to, dimensions: ['page'], rowLimit: TOP_N }, fetchImpl)
    : [];
  return summariseSearch(daily, pages);
}

/** Runs both sections; a failure becomes `{ error }` in its section instead of aborting. */
export async function buildReport({ env, now, fetchImpl = fetch }) {
  const settle = (promise) => promise.then((data) => data, (err) => ({ error: err.message }));
  const [visitors, search] = await Promise.all([
    settle(fetchVisitors({ token: env.CF_API_TOKEN?.trim(), now, fetchImpl })),
    settle(fetchSearch({ serviceAccountJson: env.GSC_SA_JSON?.trim(), now, fetchImpl })),
  ]);
  return { site: 'https://www.wegwerkzaamhedennederland.nl', generatedAt: now.toISOString(), visitors, search };
}

async function main() {
  const { values } = parseArgs({ options: { now: { type: 'string' } } });
  const now = values.now ? new Date(values.now) : new Date();
  const report = await buildReport({ env: process.env, now });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.visitors.error && report.search.error ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
