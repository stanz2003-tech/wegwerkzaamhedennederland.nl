/**
 * AdSense section of the daily report: estimated earnings per Amsterdam calendar day from the
 * AdSense Management API v2. That API does not accept service accounts, so it runs on an OAuth
 * refresh token of the AdSense owner (made once with `node infra/adsense-auth.mjs`).
 *
 *   ADSENSE_OAUTH   {"client_id":"…","client_secret":"…","refresh_token":"…"} on one line.
 */
import { addDays, amsterdamDate, changePct, datesBetween, isoWeek, mondayOf } from './amsterdam-time.mjs';

export const ADSENSE_ACCOUNT = 'accounts/pub-2154960775763414';
export const ADSENSE_SCOPE = 'https://www.googleapis.com/auth/adsense.readonly';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const ADSENSE_API = 'https://adsense.googleapis.com/v2';
const FETCH_TIMEOUT_MS = 30_000;
const METRICS = { ESTIMATED_EARNINGS: 'earnings', PAGE_VIEWS: 'pageViews', IMPRESSIONS: 'impressions', CLICKS: 'clicks' };
const cents = (n) => Math.round(n * 100) / 100;

/** First and last date the summary needs: the week before last, or the 1st of the month if earlier. */
export function adsenseRange(now) {
  const today = amsterdamDate(now);
  const weekBefore = addDays(mondayOf(today), -14);
  const monthStart = `${today.slice(0, 8)}01`;
  return { startDate: weekBefore < monthStart ? weekBefore : monthStart, endDate: today };
}

export function adsenseReportUrl({ startDate, endDate }) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const params = new URLSearchParams({
    dateRange: 'CUSTOM',
    'startDate.year': sy, 'startDate.month': sm, 'startDate.day': sd,
    'endDate.year': ey, 'endDate.month': em, 'endDate.day': ed,
    currencyCode: 'EUR',
    reportingTimeZone: 'ACCOUNT_TIME_ZONE',
  });
  params.append('dimensions', 'DATE');
  for (const metric of Object.keys(METRICS)) params.append('metrics', metric);
  return `${ADSENSE_API}/${ADSENSE_ACCOUNT}/reports:generate?${params}`;
}

/** Turns the report's header/cell table into { 'YYYY-MM-DD': { earnings, pageViews, … } }. */
export function adsenseRowsByDate(body) {
  const names = (body.headers ?? []).map((h) => h.name);
  const dateAt = names.indexOf('DATE');
  if (dateAt < 0) throw new Error('AdSense report has no DATE column');
  const byDate = {};
  for (const row of body.rows ?? []) {
    const cells = row.cells.map((c) => c.value);
    byDate[cells[dateAt]] = Object.fromEntries(
      Object.entries(METRICS).map(([metric, key]) => [key, Number(cells[names.indexOf(metric)] ?? 0) || 0]),
    );
  }
  return byDate;
}

/** Totals over `from`…`to`; days AdSense left out count as zero. */
function sumDays(byDate, from, to) {
  const total = { from, to, earnings: 0, pageViews: 0, impressions: 0, clicks: 0 };
  for (const d of datesBetween(from, to)) {
    const day = byDate[d];
    if (!day) continue;
    for (const key of Object.values(METRICS)) total[key] += day[key];
  }
  total.earnings = cents(total.earnings);
  return total;
}

const compare = (current, previous) => ({ current, previous, changePct: changePct(current.earnings, previous.earnings) });

/**
 * Calendar periods only: today so far, yesterday against the same weekday a week earlier, this
 * week up to yesterday against the same days last week (AdSense has no hours, so a half day
 * would be compared with a whole one), last Monday–Sunday against the week before, and the month.
 */
export function summariseAdsense(byDate, now) {
  const today = amsterdamDate(now);
  const yesterday = addDays(today, -1);
  const monday = mondayOf(today);
  const lastMonday = addDays(monday, -7);
  return {
    currency: 'EUR',
    today: sumDays(byDate, today, today),
    yesterday: compare(sumDays(byDate, yesterday, yesterday), sumDays(byDate, addDays(yesterday, -7), addDays(yesterday, -7))),
    thisWeekThroughYesterday: today === monday ? null : {
      week: isoWeek(today),
      ...compare(sumDays(byDate, monday, yesterday), sumDays(byDate, lastMonday, addDays(yesterday, -7))),
    },
    lastWeek: {
      week: isoWeek(lastMonday),
      ...compare(sumDays(byDate, lastMonday, addDays(monday, -1)), sumDays(byDate, addDays(lastMonday, -7), addDays(lastMonday, -1))),
    },
    monthToDate: sumDays(byDate, `${today.slice(0, 8)}01`, today),
  };
}

function parseOauth(oauthJson) {
  let oauth;
  try {
    oauth = JSON.parse(oauthJson);
  } catch {
    throw new Error('ADSENSE_OAUTH is not valid JSON (paste the whole line from infra/adsense-auth.mjs)');
  }
  const missing = ['client_id', 'client_secret', 'refresh_token'].filter((k) => !oauth?.[k]);
  if (missing.length) throw new Error(`ADSENSE_OAUTH lacks ${missing.join(', ')}`);
  return oauth;
}

export async function refreshAccessToken({ client_id, client_secret, refresh_token }, fetchImpl = fetch) {
  const res = await fetchImpl(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id, client_secret, refresh_token }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error === 'invalid_grant') {
    throw new Error('AdSense refresh token was revoked or expired: run node infra/adsense-auth.mjs again');
  }
  if (!res.ok || !body.access_token) throw new Error(`Google token request failed: HTTP ${res.status} ${body.error ?? ''}`.trim());
  return body.access_token;
}

export async function fetchAdsense({ oauthJson, now, fetchImpl = fetch }) {
  if (!oauthJson) throw new Error('ADSENSE_OAUTH is not set');
  const accessToken = await refreshAccessToken(parseOauth(oauthJson), fetchImpl);
  const res = await fetchImpl(adsenseReportUrl(adsenseRange(now)), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AdSense report failed: HTTP ${res.status} ${body?.error?.message ?? ''}`.trim());
  return summariseAdsense(adsenseRowsByDate(body), now);
}
