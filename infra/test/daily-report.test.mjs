import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import {
  CF_SITE_TAG,
  OTHER_SITES,
  amsterdamDate,
  amsterdamMidnight,
  buildReport,
  reportPeriod,
  serviceAccountJwt,
  summariseSearch,
  summariseVisitors,
  visitorPeriods,
  visitorsQuery,
} from '../daily-report.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const row = (visits, count, dimensions) => ({ sum: { visits }, count, ...(dimensions ? { dimensions } : {}) });
const gscDay = (date, clicks, impressions, position) => ({ keys: [date], clicks, impressions, position });
const iso = (pair) => pair.map((d) => d.toISOString());

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

test('visitorPeriods uses calendar days and Monday-based weeks, not rolling 24 h / 7 days', () => {
  const now = new Date('2026-10-28T18:00:00Z'); // Wednesday 19:00 in Amsterdam, week 44
  const p = visitorPeriods(now);
  assert.deepEqual(iso(p.today), ['2026-10-27T23:00:00.000Z', now.toISOString()]);
  // Last Wednesday was still summer time: midnight was 22:00 UTC, 19:00 local was 17:00 UTC.
  assert.deepEqual(iso(p.todayLastWeek), ['2026-10-20T22:00:00.000Z', '2026-10-21T17:00:00.000Z']);
  assert.deepEqual(iso(p.yesterday), ['2026-10-26T23:00:00.000Z', '2026-10-27T23:00:00.000Z']);
  assert.deepEqual(iso(p.yesterdayLastWeek), ['2026-10-19T22:00:00.000Z', '2026-10-20T22:00:00.000Z']);
  assert.deepEqual(iso(p.thisWeek), ['2026-10-25T23:00:00.000Z', now.toISOString()]);
  assert.deepEqual(iso(p.thisWeekLastWeek), ['2026-10-18T22:00:00.000Z', '2026-10-21T17:00:00.000Z']);
  assert.deepEqual(iso(p.lastWeek), ['2026-10-18T22:00:00.000Z', '2026-10-25T23:00:00.000Z']);
  assert.deepEqual(iso(p.weekBefore), ['2026-10-11T22:00:00.000Z', '2026-10-18T22:00:00.000Z']);
});

test('on a Monday this week is just today, and last week is the whole Monday–Sunday before', () => {
  const p = visitorPeriods(new Date('2026-11-16T18:00:00Z'));
  assert.deepEqual(iso(p.thisWeek), iso(p.today));
  assert.deepEqual(iso(p.thisWeekLastWeek), iso(p.todayLastWeek));
  assert.deepEqual(iso(p.lastWeek), ['2026-11-08T23:00:00.000Z', '2026-11-15T23:00:00.000Z']);
});

test('reportPeriod names the Amsterdam day and the ISO weeks', () => {
  assert.deepEqual(reportPeriod(new Date('2026-11-17T18:00:00Z')), { date: '2026-11-17', weekday: 'dinsdag', isoWeek: 47, isMonday: false, lastWeek: 46 });
  // 23:30 UTC on Sunday is already Monday in Amsterdam.
  assert.equal(reportPeriod(new Date('2026-11-15T23:30:00Z')).isMonday, true);
});

test('visitorsQuery asks only for this site and splits the Netherlands from China', () => {
  const q = visitorsQuery(new Date('2026-10-28T18:00:00Z'));
  assert.match(q, new RegExp(`siteTag:"${CF_SITE_TAG}"`));
  assert.match(q, /today:rumPageloadEventsAdaptiveGroups\(limit:10,filter:\{[^}]*countryName:"NL"/);
  assert.match(q, /weekBefore:rumPageloadEventsAdaptiveGroups\(limit:10,filter:\{[^}]*datetime_geq:"2026-10-11T22:00:00.000Z"/);
  assert.match(q, /todayChina:[^}]*countryName:"CN"/);
  assert.match(q, /todayOther:[^}]*countryName_neq:"NL"/);
  assert.match(q, /topPages:rumPageloadEventsAdaptiveGroups\(limit:10,orderBy:\[sum_visits_DESC\]/);
});

test('summariseVisitors pairs every period with the same period a week earlier', () => {
  const s = summariseVisitors(
    {
      today: [row(1085, 8189)],
      todayLastWeek: [row(868, 6977)],
      yesterday: [],
      yesterdayLastWeek: [row(900, 7000)],
      thisWeek: [row(2000, 16000)],
      thisWeekLastWeek: [row(1000, 9000)],
      lastWeek: [row(5900, 50000)],
      weekBefore: [],
      todayChina: [row(3, 3)],
      todayOther: [row(10, 12)],
      topPages: [row(198, 900, { requestPath: '/gemeente/s-hertogenbosch/' }), row(5, 5, { requestPath: '/?id=abc' })],
      referrers: [row(879, 0, { refererHost: 'www.google.com' }), row(180, 0, { refererHost: '' })],
    },
    new Date('2026-10-28T18:00:00Z'),
  );
  assert.deepEqual(s.today, { current: { visits: 1085, pageviews: 8189 }, previous: { visits: 868, pageviews: 6977 }, changePct: 25 });
  assert.deepEqual(s.yesterday.current, { visits: 0, pageviews: 0 });
  assert.equal(s.yesterday.changePct, -100);
  assert.deepEqual([s.thisWeek.week, s.thisWeek.changePct], [44, 100]);
  assert.deepEqual([s.lastWeek.week, s.lastWeek.current.visits, s.lastWeek.changePct], [43, 5900, null]);
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

test('summariseSearch compares the newest complete Monday–Sunday week with the week before', () => {
  const daily = [];
  // 2026-10-05 (Mon) … 2026-10-21 (Wed): week 41 at 100 clicks a day, week 42 at 200, week 43 so far at 300.
  for (let d = 5; d <= 21; d++) {
    const clicks = d <= 11 ? 100 : d <= 18 ? 200 : 300;
    daily.push(gscDay(`2026-10-${String(d).padStart(2, '0')}`, clicks, 1000, d <= 11 ? 8 : 6));
  }
  const s = summariseSearch(daily.reverse(), [{ keys: ['https://www.wegwerkzaamhedennederland.nl/gemeente/arnhem/'], clicks: 50, impressions: 400 }]);
  assert.equal(s.newestDate, '2026-10-21');
  assert.equal(s.lastFullWeek.week, 42);
  assert.deepEqual(s.lastFullWeek.current, { from: '2026-10-12', to: '2026-10-18', daysWithData: 7, clicks: 1400, impressions: 7000, ctr: 20, position: 6 });
  assert.deepEqual(s.lastFullWeek.previous, { from: '2026-10-05', to: '2026-10-11', daysWithData: 7, clicks: 700, impressions: 7000, ctr: 10, position: 8 });
  assert.equal(s.lastFullWeek.changePct, 100);
  const w = s.weekToDate;
  assert.deepEqual(
    [w.week, w.current.from, w.current.clicks, w.previous.from, w.previous.to, w.previous.clicks, w.changePct],
    [43, '2026-10-19', 900, '2026-10-12', '2026-10-14', 600, 50],
  );
  assert.deepEqual(s.topPages, [{ page: '/gemeente/arnhem/', clicks: 50, impressions: 400 }]);
});

test('summariseSearch has no week-to-date when the newest day with data is a Sunday', () => {
  const s = summariseSearch([gscDay('2026-10-18', 10, 100, 5), gscDay('2026-10-12', 10, 100, 5)], []);
  const c = s.lastFullWeek.current;
  assert.deepEqual([c.from, c.to, c.daysWithData], ['2026-10-12', '2026-10-18', 2]);
  assert.equal(s.weekToDate, null);
});

test('summariseSearch keeps calendar weeks when Google leaves out days without data', () => {
  const daily = [gscDay('2026-10-23', 10, 100, 5), gscDay('2026-10-17', 10, 100, 5), gscDay('2026-10-08', 4, 100, 9), gscDay('2026-10-04', 99, 100, 1)];
  const s = summariseSearch(daily, []);
  const { current, previous } = s.lastFullWeek;
  assert.deepEqual([current.from, current.to, current.daysWithData, current.clicks], ['2026-10-12', '2026-10-18', 1, 10]);
  assert.deepEqual([previous.from, previous.daysWithData, previous.clicks], ['2026-10-05', 1, 4]);
});

test('summariseSearch without any data reports empty weeks instead of failing', () => {
  const s = summariseSearch([], []);
  assert.deepEqual(s.lastFullWeek.current, { from: null, to: null, daysWithData: 0, clicks: 0, impressions: 0, ctr: 0, position: null });
  assert.equal(s.weekToDate, null);
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
    if (request.dimensions[0] === 'date') {
      assert.deepEqual([request.startDate, request.endDate], ['2026-09-28', '2026-10-26']);
      return json({ rows: [gscDay('2026-10-23', 1, 10, 1), gscDay('2026-10-18', 5, 50, 4), gscDay('2026-10-17', 5, 50, 6)] });
    }
    assert.deepEqual([request.startDate, request.endDate], ['2026-10-12', '2026-10-18']);
    return json({ rows: [{ keys: ['https://www.wegwerkzaamhedennederland.nl/weg/a2/'], clicks: 7, impressions: 70 }] });
  };
  const report = await buildReport({ env: { GSC_SA_JSON: sa }, now: new Date('2026-10-26T18:00:00Z'), fetchImpl });
  assert.equal(report.search.lastFullWeek.current.clicks, 10);
  assert.equal(report.search.lastFullWeek.current.position, 5);
  assert.equal(report.search.weekToDate.current.clicks, 1);
  assert.deepEqual(report.search.topPages, [{ page: '/weg/a2/', clicks: 7, impressions: 70 }]);
  assert.match(calls[1], /sites\/sc-domain%3Awegwerkzaamhedennederland\.nl\/searchAnalytics\/query$/);
  assert.deepEqual(report.visitors, { error: 'CF_API_TOKEN is not set' });
  assert.deepEqual(report.adsense, { error: 'ADSENSE_OAUTH is not set' });
  assert.equal(report.period.isoWeek, 44);
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
  assert.deepEqual(report.visitors.today.current, { visits: 5, pageviews: 9 });
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

// --- second site: stroomprijzenperuur.nl ------------------------------------------------------

test('visitorsQuery can ask for another site of the same account', () => {
  const [site] = OTHER_SITES;
  const q = visitorsQuery(new Date('2026-11-28T18:00:00Z'), site.siteTag);
  assert.match(q, new RegExp(`siteTag:"${site.siteTag}"`));
  assert.ok(!q.includes(CF_SITE_TAG), 'not the Wegwerk site');
});

test('summariseSearch strips the host of the site it is about', () => {
  const s = summariseSearch([], [{ keys: ['https://www.stroomprijzenperuur.nl/morgen/'], clicks: 3, impressions: 30 }], 'https://www.stroomprijzenperuur.nl');
  assert.deepEqual(s.topPages, [{ page: '/morgen/', clicks: 3, impressions: 30 }]);
});

test('buildReport adds the other sites after Wegwerk, each with its own visitors and search', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(init.body);
    return json({ data: { viewer: { accounts: [{ today: [row(bodies.length === 1 ? 5 : 2, 3)] }] } } });
  };
  const report = await buildReport({ env: { CF_API_TOKEN: 'cf-token' }, now: new Date('2026-11-28T18:00:00Z'), fetchImpl });
  assert.equal(report.visitors.today.current.visits, 5, 'Wegwerk stays at the top level, unchanged');
  assert.equal(report.otherSites.length, OTHER_SITES.length);
  const [other] = report.otherSites;
  assert.equal(other.site, 'https://www.stroomprijzenperuur.nl');
  assert.equal(other.visitors.today.current.visits, 2);
  assert.match(bodies[1], new RegExp(OTHER_SITES[0].siteTag), 'the second query is for the other site');
  assert.deepEqual(other.search, { error: 'GSC_SA_JSON is not set' });
});
