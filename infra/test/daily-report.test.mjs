import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import {
  CF_SITE_TAG,
  amsterdamDate,
  amsterdamMidnight,
  buildReport,
  serviceAccountJwt,
  summariseSearch,
  summariseVisitors,
  visitorPeriods,
  visitorsQuery,
} from '../daily-report.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const row = (visits, count, dimensions) => ({ sum: { visits }, count, ...(dimensions ? { dimensions } : {}) });
const gscDay = (date, clicks, impressions, position) => ({ keys: [date], clicks, impressions, position });

test('amsterdamMidnight is 23:00 UTC in winter and 22:00 UTC in summer, also on the switch days', () => {
  assert.equal(amsterdamMidnight('2026-10-26').toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(amsterdamMidnight('2026-07-01').toISOString(), '2026-06-30T22:00:00.000Z');
  assert.equal(amsterdamMidnight('2026-10-25').toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(amsterdamMidnight('2026-03-29').toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(amsterdamMidnight('2026-03-30').toISOString(), '2026-03-29T22:00:00.000Z');
});

test('amsterdamDate follows the local calendar day, not the UTC one', () => {
  assert.equal(amsterdamDate(new Date('2026-10-26T23:30:00Z')), '2026-10-27');
  assert.equal(amsterdamDate(new Date('2026-10-26T22:30:00Z')), '2026-10-26');
});

test('visitorPeriods compares today so far with the same stretch of the day a week earlier', () => {
  const now = new Date('2026-10-26T18:00:00Z');
  const p = visitorPeriods(now);
  assert.equal(p.today[0].toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(p.today[1].toISOString(), now.toISOString());
  // Last Monday was still summer time: midnight was 22:00 UTC, and 19 hours later is 17:00 UTC.
  assert.equal(p.sameTimeLastWeek[0].toISOString(), '2026-10-18T22:00:00.000Z');
  assert.equal(p.sameTimeLastWeek[1].toISOString(), '2026-10-19T17:00:00.000Z');
  assert.equal(p.yesterday[0].toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(p.yesterday[1].toISOString(), '2026-10-25T23:00:00.000Z');
});

test('visitorsQuery asks only for this site and splits the Netherlands from China', () => {
  const q = visitorsQuery(new Date('2026-10-26T18:00:00Z'));
  assert.match(q, new RegExp(`siteTag:"${CF_SITE_TAG}"`));
  assert.match(q, /today:rumPageloadEventsAdaptiveGroups\(limit:10,filter:\{[^}]*countryName:"NL"/);
  assert.match(q, /todayChina:[^}]*countryName:"CN"/);
  assert.match(q, /todayOther:[^}]*countryName_neq:"NL"/);
  assert.match(q, /topPages:rumPageloadEventsAdaptiveGroups\(limit:10,orderBy:\[sum_visits_DESC\]/);
});

test('summariseVisitors keeps China apart from other foreign visits and strips query strings', () => {
  const s = summariseVisitors(
    {
      today: [row(1085, 8189)],
      sameTimeLastWeek: [row(690, 6977)],
      yesterday: [],
      last7Days: [row(5900, 50000)],
      previous7Days: [row(3800, 30000)],
      todayChina: [row(3, 3)],
      todayOther: [row(10, 12)],
      topPages: [row(198, 900, { requestPath: '/gemeente/s-hertogenbosch/' }), row(5, 5, { requestPath: '/?id=abc' })],
      referrers: [row(879, 0, { refererHost: 'www.google.com' }), row(180, 0, { refererHost: '' })],
    },
    new Date('2026-10-26T18:00:00Z'),
  );
  assert.deepEqual(s.today, { visits: 1085, pageviews: 8189 });
  assert.deepEqual(s.yesterday, { visits: 0, pageviews: 0 });
  assert.equal(s.todayChinaVisits, 3);
  assert.equal(s.todayOtherCountriesVisits, 7);
  assert.deepEqual(s.topPages.map((p) => p.requestPath), ['/gemeente/s-hertogenbosch/', '/']);
  assert.deepEqual(s.referrers.map((r) => r.refererHost), ['www.google.com', '(direct)']);
});

test('serviceAccountJwt is an RS256 token Google can verify with the account key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = serviceAccountJwt({ client_email: 'report@x.iam.gserviceaccount.com', private_key: key }, new Date('2026-10-26T18:00:00Z'));
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(c.iss, 'report@x.iam.gserviceaccount.com');
  assert.equal(c.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(c.exp - c.iat, 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url'));
});

test('summariseSearch compares the newest 7 days with data against the 7 before', () => {
  const daily = [];
  for (let d = 1; d <= 14; d++) daily.push(gscDay(`2026-10-${String(d + 9).padStart(2, '0')}`, d <= 7 ? 100 : 200, 1000, d <= 7 ? 8 : 6));
  const s = summariseSearch(daily.reverse(), [{ keys: ['https://www.wegwerkzaamhedennederland.nl/gemeente/arnhem/'], clicks: 50, impressions: 400 }]);
  assert.deepEqual(s.lastWeek, { from: '2026-10-17', to: '2026-10-23', daysWithData: 7, clicks: 1400, impressions: 7000, ctr: 20, position: 6 });
  assert.deepEqual(s.previousWeek, { from: '2026-10-10', to: '2026-10-16', daysWithData: 7, clicks: 700, impressions: 7000, ctr: 10, position: 8 });
  assert.deepEqual(s.topPages, [{ page: '/gemeente/arnhem/', clicks: 50, impressions: 400 }]);
});

test('summariseSearch keeps calendar weeks when Google leaves out days without data', () => {
  const daily = [gscDay('2026-10-23', 10, 100, 5), gscDay('2026-10-20', 10, 100, 5), gscDay('2026-10-15', 4, 100, 9), gscDay('2026-10-08', 99, 100, 1)];
  const s = summariseSearch(daily, []);
  assert.deepEqual([s.lastWeek.from, s.lastWeek.to, s.lastWeek.daysWithData, s.lastWeek.clicks], ['2026-10-17', '2026-10-23', 2, 20]);
  assert.deepEqual([s.previousWeek.from, s.previousWeek.to, s.previousWeek.daysWithData, s.previousWeek.clicks], ['2026-10-10', '2026-10-16', 1, 4]);
});

test('summariseSearch without any data reports empty weeks instead of failing', () => {
  const s = summariseSearch([], []);
  assert.deepEqual(s.lastWeek, { from: null, to: null, daysWithData: 0, clicks: 0, impressions: 0, ctr: 0, position: null });
});

test('buildReport fetches Search Console with a service-account token and asks pages for the same week', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = JSON.stringify({ client_email: 'r@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(new URLSearchParams(init.body).get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      return json({ access_token: 'ya29.test' });
    }
    assert.equal(init.headers.Authorization, 'Bearer ya29.test');
    const request = JSON.parse(init.body);
    if (request.dimensions[0] === 'date') return json({ rows: [gscDay('2026-10-23', 5, 50, 4), gscDay('2026-10-22', 5, 50, 6)] });
    assert.deepEqual([request.startDate, request.endDate], ['2026-10-17', '2026-10-23']);
    return json({ rows: [{ keys: ['https://www.wegwerkzaamhedennederland.nl/weg/a2/'], clicks: 7, impressions: 70 }] });
  };
  const report = await buildReport({ env: { GSC_SA_JSON: sa }, now: new Date('2026-10-26T18:00:00Z'), fetchImpl });
  assert.equal(report.search.lastWeek.clicks, 10);
  assert.equal(report.search.lastWeek.position, 5);
  assert.deepEqual(report.search.topPages, [{ page: '/weg/a2/', clicks: 7, impressions: 70 }]);
  assert.match(calls[1], /sites\/sc-domain%3Awegwerkzaamhedennederland\.nl\/searchAnalytics\/query$/);
  assert.deepEqual(report.visitors, { error: 'CF_API_TOKEN is not set' });
});

test('a key that is not JSON gives a fixed message that does not echo the secret', async () => {
  const report = await buildReport({ env: { GSC_SA_JSON: 'MIIEvQIBADANBg' }, now: new Date(), fetchImpl: async () => json({}) });
  assert.deepEqual(report.search, { error: 'GSC_SA_JSON is not valid JSON (paste the whole key file)' });
});

test('a Google token refusal ends up as a readable search error', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = JSON.stringify({ client_email: 'r@x', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const report = await buildReport({ env: { GSC_SA_JSON: sa }, now: new Date(), fetchImpl: async () => json({ error: 'invalid_grant' }, 400) });
  assert.deepEqual(report.search, { error: 'Google token request failed: HTTP 400 invalid_grant' });
});

test('buildReport reports a missing secret per section instead of failing the whole run', async () => {
  const now = new Date('2026-10-26T18:00:00Z');
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(init.headers.Authorization, 'Bearer cf-token');
    return json({ data: { viewer: { accounts: [{ today: [row(5, 9)] }] } } });
  };
  const report = await buildReport({ env: { CF_API_TOKEN: ' cf-token\n' }, now, fetchImpl });
  assert.deepEqual(report.visitors.today, { visits: 5, pageviews: 9 });
  assert.deepEqual(report.search, { error: 'GSC_SA_JSON is not set' });
});

test('buildReport turns a Cloudflare error into a readable section error', async () => {
  const fetchImpl = async () => json({ data: null, errors: [{ message: 'not authorized for that account' }] }, 200);
  const report = await buildReport({ env: { CF_API_TOKEN: 'x' }, now: new Date(), fetchImpl });
  assert.deepEqual(report.visitors, { error: 'Cloudflare GraphQL failed: not authorized for that account' });
});

test('a partial Cloudflare answer (some aliases null plus errors) is an error, not zero visitors', async () => {
  const fetchImpl = async () => json({ data: { viewer: { accounts: [{ today: null, yesterday: [row(5, 5)] }] } }, errors: [{ message: 'unknown field countryName_neq' }] });
  const report = await buildReport({ env: { CF_API_TOKEN: 'x' }, now: new Date(), fetchImpl });
  assert.deepEqual(report.visitors, { error: 'Cloudflare GraphQL failed: unknown field countryName_neq' });
});
