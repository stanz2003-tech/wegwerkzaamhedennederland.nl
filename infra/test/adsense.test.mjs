import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authUrl, parseClientFile } from '../adsense-auth.mjs';
import { adsenseRange, adsenseReportUrl, adsenseRowsByDate, fetchAdsense, summariseAdsense } from '../lib/adsense.mjs';
import { changePct, isoWeek, mondayOf, weekdayName } from '../lib/amsterdam-time.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const HEADERS = ['DATE', 'ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS'].map((name) => ({ name }));
const adRow = (date, earnings, pageViews = 100, impressions = 200, clicks = 1) =>
  ({ cells: [date, String(earnings), String(pageViews), String(impressions), String(clicks)].map((value) => ({ value })) });
const OAUTH = JSON.stringify({ client_id: 'id.apps.googleusercontent.com', client_secret: 'sec', refresh_token: '1//rt' });

test('week helpers follow ISO weeks with Monday first', () => {
  assert.equal(isoWeek('2026-11-17'), 47);
  assert.equal(isoWeek('2026-01-01'), 1); // a Thursday
  assert.equal(isoWeek('2027-01-03'), 53); // Sunday of the last week of 2026
  assert.equal(isoWeek('2027-01-04'), 1);
  assert.equal(mondayOf('2026-11-22'), '2026-11-16');
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(weekdayName('2026-11-22'), 'zondag');
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(5, 0), null);
});

test('adsenseRange starts at the week before last, or at the 1st of the month when that is earlier', () => {
  // Tuesday 17 Nov: week before last starts Monday 2 Nov, the month on the 1st.
  assert.deepEqual(adsenseRange(new Date('2026-11-17T18:00:00Z')), { startDate: '2026-11-01', endDate: '2026-11-17' });
  // Tuesday 3 Nov: the week before last starts on 19 Oct.
  assert.deepEqual(adsenseRange(new Date('2026-11-03T18:00:00Z')), { startDate: '2026-10-19', endDate: '2026-11-03' });
});

test('adsenseReportUrl asks a daily EUR report in the account time zone', () => {
  const url = new URL(adsenseReportUrl({ startDate: '2026-11-01', endDate: '2026-11-17' }));
  assert.equal(url.pathname, '/v2/accounts/pub-2154960775763414/reports:generate');
  assert.equal(url.searchParams.get('dateRange'), 'CUSTOM');
  assert.deepEqual(['startDate.year', 'startDate.month', 'startDate.day', 'endDate.day'].map((k) => url.searchParams.get(k)), ['2026', '11', '1', '17']);
  assert.deepEqual(url.searchParams.getAll('dimensions'), ['DATE']);
  assert.deepEqual(url.searchParams.getAll('metrics'), ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS']);
  assert.equal(url.searchParams.get('currencyCode'), 'EUR');
});

test('adsenseRowsByDate reads the cells by header name', () => {
  const byDate = adsenseRowsByDate({ headers: HEADERS, rows: [adRow('2026-11-16', 1.23, 50, 80, 2)] });
  assert.deepEqual(byDate, { '2026-11-16': { earnings: 1.23, pageViews: 50, impressions: 80, clicks: 2 } });
  assert.deepEqual(adsenseRowsByDate({ headers: HEADERS }), {});
  assert.throws(() => adsenseRowsByDate({ headers: [] }), /no DATE column/);
});

test('summariseAdsense compares whole calendar days and Monday-based weeks', () => {
  const byDate = {};
  // 2 Nov (Mon) … 17 Nov (Tue): €1 a day in week 45, €2 in week 46, €3 in week 47.
  for (let d = 2; d <= 17; d++) {
    const earnings = d <= 8 ? 1 : d <= 15 ? 2 : 3;
    byDate[`2026-11-${String(d).padStart(2, '0')}`] = { earnings, pageViews: 10, impressions: 20, clicks: 0 };
  }
  const s = summariseAdsense(byDate, new Date('2026-11-17T18:00:00Z'));
  assert.equal(s.today.earnings, 3);
  assert.deepEqual([s.yesterday.current.from, s.yesterday.current.earnings, s.yesterday.previous.from, s.yesterday.previous.earnings, s.yesterday.changePct], ['2026-11-16', 3, '2026-11-09', 2, 50]);
  const w = s.thisWeekThroughYesterday;
  assert.deepEqual([w.week, w.current.from, w.current.to, w.current.earnings, w.previous.to, w.previous.earnings], [47, '2026-11-16', '2026-11-16', 3, '2026-11-09', 2]);
  assert.deepEqual([s.lastWeek.week, s.lastWeek.current.earnings, s.lastWeek.current.pageViews, s.lastWeek.previous.earnings, s.lastWeek.changePct], [46, 14, 70, 7, 100]);
  assert.deepEqual([s.monthToDate.from, s.monthToDate.earnings], ['2026-11-01', 7 + 14 + 6]);
});

test('on a Monday AdSense has no week-so-far, only last week; missing days count as zero', () => {
  const s = summariseAdsense({ '2026-11-15': { earnings: 0.1 + 0.2, pageViews: 1, impressions: 1, clicks: 0 } }, new Date('2026-11-16T18:00:00Z'));
  assert.equal(s.thisWeekThroughYesterday, null);
  assert.deepEqual([s.lastWeek.week, s.lastWeek.current.earnings, s.lastWeek.changePct], [46, 0.3, null]);
  assert.equal(s.today.earnings, 0);
});

test('fetchAdsense swaps the refresh token and reads the report', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      assert.deepEqual([form.get('grant_type'), form.get('refresh_token')], ['refresh_token', '1//rt']);
      return json({ access_token: 'ya29.ads' });
    }
    assert.equal(init.headers.Authorization, 'Bearer ya29.ads');
    return json({ headers: HEADERS, rows: [adRow('2026-11-17', 0.42)] });
  };
  const s = await fetchAdsense({ oauthJson: OAUTH, now: new Date('2026-11-17T18:00:00Z'), fetchImpl });
  assert.equal(s.today.earnings, 0.42);
  assert.match(calls[1], /^https:\/\/adsense\.googleapis\.com\/v2\/accounts\/pub-2154960775763414\/reports:generate\?/);
});

test('fetchAdsense explains a revoked refresh token and a refused report without echoing secrets', async () => {
  const now = new Date('2026-11-17T18:00:00Z');
  await assert.rejects(fetchAdsense({ oauthJson: OAUTH, now, fetchImpl: async () => json({ error: 'invalid_grant' }, 400) }), /revoked or expired: run node infra\/adsense-auth\.mjs/);
  const refused = async (url) => (url.includes('oauth2') ? json({ access_token: 'x' }) : json({ error: { message: 'API has not been used in project' } }, 403));
  await assert.rejects(fetchAdsense({ oauthJson: OAUTH, now, fetchImpl: refused }), /AdSense report failed: HTTP 403 API has not been used/);
  await assert.rejects(fetchAdsense({ oauthJson: '{"client_id":"a"}', now }), /ADSENSE_OAUTH lacks client_secret, refresh_token/);
  await assert.rejects(fetchAdsense({ oauthJson: 'sec-ret', now }), (err) => !err.message.includes('sec-ret'));
});

test('the sign-in helper reads a Desktop client file and asks offline read-only access with PKCE', () => {
  assert.deepEqual(parseClientFile('{"installed":{"client_id":"c","client_secret":"s","redirect_uris":["http://localhost"]}}'), { client_id: 'c', client_secret: 's' });
  assert.throws(() => parseClientFile('{"installed":{}}'), /No client_id/);
  const url = new URL(authUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:5555', state: 'st', codeChallenge: 'ch' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/adsense.readonly');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});
