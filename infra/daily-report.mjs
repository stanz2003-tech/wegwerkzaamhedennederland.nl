#!/usr/bin/env node
/**
 * Collects the numbers for the daily status push as one JSON document on stdout. A scheduled
 * Claude routine runs this script and writes a short Dutch summary from the JSON.
 *
 *   node infra/daily-report.mjs [--now 2026-10-26T18:00:00Z]
 *
 * Every comparison uses Amsterdam calendar days and Monday–Sunday weeks, never "the last 24
 * hours" or "the last 7 days". Sections, each fetched on its own so one broken source does not
 * hide the others:
 *   visitors     Cloudflare Web Analytics (RUM), Dutch visits: today so far against the same
 *                weekday last week up to the same time, yesterday (whole day) against the same
 *                weekday a week earlier, this week so far against last week up to the same
 *                moment, last week against the week before. Plus top pages, referrers and the
 *                visits from China (bot traffic, challenged by a WAF rule since 2026-10-25).
 *   adsense      AdSense estimated earnings in the same calendar periods (see lib/adsense.mjs).
 *   search       Google Search Console (lags 2–3 days): the newest complete Monday–Sunday week
 *                against the week before, the current week so far, and the top pages.
 *
 * Environment (secrets live in the cloud environment, never in the repo):
 *   CF_API_TOKEN   Cloudflare API token with "Account Analytics: Read".
 *   GSC_SA_JSON    Google service-account key (JSON text), added to the Search Console
 *                  property as a user with restricted access.
 *   ADSENSE_OAUTH  OAuth client + refresh token of the AdSense owner (infra/adsense-auth.mjs).
 *
 * Exit codes: 0 at least one section ok · 1 every section failed.
 */
import { createSign } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fetchAdsense, GOOGLE_TOKEN } from './lib/adsense.mjs';
import {
  addDays, amsterdamDate, amsterdamMidnight, changePct, isoWeek, mondayOf, weekdayIndex, weekdayName,
} from './lib/amsterdam-time.mjs';

export { amsterdamDate, amsterdamMidnight } from './lib/amsterdam-time.mjs';

export const CF_ACCOUNT = 'e05c34416fc750c256958a04f58b0c9a';
export const CF_SITE_TAG = '2dd291d8e9274d309dddef0d56257f9e';
export const GSC_PROPERTY = 'sc-domain:wegwerkzaamhedennederland.nl';
const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const FETCH_TIMEOUT_MS = 30_000;
const TOP_N = 10;
// Enough for two whole weeks before the newest Sunday with data, even when Google lags 5 days.
const GSC_LOOKBACK_DAYS = 28;

/** The calendar day and weeks the report is about, shared by every section. */
export function reportPeriod(now) {
  const date = amsterdamDate(now);
  return {
    date,
    weekday: weekdayName(date),
    isoWeek: isoWeek(date),
    isMonday: weekdayIndex(date) === 0,
    lastWeek: isoWeek(addDays(mondayOf(date), -7)),
  };
}

/** The time windows of the visitors section, all in real instants. */
export function visitorPeriods(now) {
  const today = amsterdamDate(now);
  const start = amsterdamMidnight(today);
  const weekAgoStart = amsterdamMidnight(addDays(today, -7));
  // Same wall-clock time a week ago, also when a DST switch lies in between.
  const sameMomentLastWeek = new Date(weekAgoStart.getTime() + (now - start));
  const monday = mondayOf(today);
  const thisMonday = amsterdamMidnight(monday);
  const lastMonday = amsterdamMidnight(addDays(monday, -7));
  return {
    today: [start, now],
    todayLastWeek: [weekAgoStart, sameMomentLastWeek],
    yesterday: [amsterdamMidnight(addDays(today, -1)), start],
    yesterdayLastWeek: [amsterdamMidnight(addDays(today, -8)), weekAgoStart],
    thisWeek: [thisMonday, now],
    thisWeekLastWeek: [lastMonday, sameMomentLastWeek],
    lastWeek: [lastMonday, thisMonday],
    weekBefore: [amsterdamMidnight(addDays(monday, -14)), lastMonday],
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

const NL_PERIODS = ['today', 'todayLastWeek', 'yesterday', 'yesterdayLastWeek', 'thisWeek', 'thisWeekLastWeek', 'lastWeek', 'weekBefore'];

/** One GraphQL query for every number of the visitors section. */
export function visitorsQuery(now) {
  const p = visitorPeriods(now);
  const nl = { country: 'NL' };
  const groups = [
    ...NL_PERIODS.map((name) => rumGroup(name, p[name], nl)),
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
const compareVisits = (current, previous) => ({ current, previous, changePct: changePct(current.visits, previous.visits) });

/** Shapes the GraphQL answer; the numbers are Cloudflare's sampled estimates. */
export function summariseVisitors(account, now) {
  const china = totals(account.todayChina).visits;
  const period = reportPeriod(now);
  const pair = (current, previous) => compareVisits(totals(account[current]), totals(account[previous]));
  return {
    asOf: now.toISOString(),
    country: 'NL',
    today: pair('today', 'todayLastWeek'),
    yesterday: pair('yesterday', 'yesterdayLastWeek'),
    thisWeek: { week: period.isoWeek, ...pair('thisWeek', 'thisWeekLastWeek') },
    lastWeek: { week: period.lastWeek, ...pair('lastWeek', 'weekBefore') },
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
 * Monday–Sunday weeks around the newest date with data. Search Console leaves out days without
 * impressions, so the windows are built from dates, not from row counts. `weekToDate` is null
 * when the newest date is a Sunday (then the newest week is complete).
 */
export function searchWindows(dailyRows) {
  const newest = dailyRows.reduce((max, r) => (r.keys[0] > max ? r.keys[0] : max), '');
  if (!newest) return null;
  const window = (from, to) => ({ from, to, rows: dailyRows.filter((r) => r.keys[0] >= from && r.keys[0] <= to) });
  const lastSunday = weekdayIndex(newest) === 6 ? newest : addDays(mondayOf(newest), -1);
  const lastMonday = addDays(lastSunday, -6);
  const currentMonday = mondayOf(newest);
  return {
    newest,
    lastFullWeek: {
      week: isoWeek(lastMonday),
      current: window(lastMonday, lastSunday),
      previous: window(addDays(lastMonday, -7), addDays(lastSunday, -7)),
    },
    weekToDate: newest === lastSunday ? null : {
      week: isoWeek(newest),
      current: window(currentMonday, newest),
      previous: window(addDays(currentMonday, -7), addDays(newest, -7)),
    },
  };
}

const compareClicks = ({ week, current, previous }) => {
  const [cur, prev] = [sumWindow(current), sumWindow(previous)];
  return { week, current: cur, previous: prev, changePct: changePct(cur.clicks, prev.clicks) };
};

/** The newest complete week against the week before, the current week so far, and the top pages. */
export function summariseSearch(dailyRows, pageRows) {
  const windows = searchWindows(dailyRows);
  const empty = { week: null, current: { from: null, to: null, rows: [] }, previous: { from: null, to: null, rows: [] } };
  return {
    newestDate: windows?.newest ?? null,
    lastFullWeek: compareClicks(windows?.lastFullWeek ?? empty),
    weekToDate: windows?.weekToDate ? compareClicks(windows.weekToDate) : null,
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
  const week = searchWindows(daily)?.lastFullWeek.current;
  const pages = week
    ? await searchAnalytics(accessToken, { startDate: week.from, endDate: week.to, dimensions: ['page'], rowLimit: TOP_N }, fetchImpl)
    : [];
  return summariseSearch(daily, pages);
}

/** Runs every section; a failure becomes `{ error }` in its section instead of aborting. */
export async function buildReport({ env, now, fetchImpl = fetch }) {
  const settle = (promise) => promise.then((data) => data, (err) => ({ error: err.message }));
  const [visitors, adsense, search] = await Promise.all([
    settle(fetchVisitors({ token: env.CF_API_TOKEN?.trim(), now, fetchImpl })),
    settle(fetchAdsense({ oauthJson: env.ADSENSE_OAUTH?.trim(), now, fetchImpl })),
    settle(fetchSearch({ serviceAccountJson: env.GSC_SA_JSON?.trim(), now, fetchImpl })),
  ]);
  return {
    site: 'https://www.wegwerkzaamhedennederland.nl',
    generatedAt: now.toISOString(),
    period: reportPeriod(now),
    visitors,
    adsense,
    search,
  };
}

async function main() {
  const { values } = parseArgs({ options: { now: { type: 'string' } } });
  const now = values.now ? new Date(values.now) : new Date();
  const report = await buildReport({ env: process.env, now });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = [report.visitors, report.adsense, report.search].every((s) => s.error) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
