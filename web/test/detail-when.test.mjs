/**
 * The detail view answered for the chosen moment (overzicht-10, vooruit-3, vooruit-11, taal-2,
 * taal-3): status, banner, timeline marker and "Wanneer wat" all count from `at`, the route
 * buttons sit above the explanation, and the kind line never contradicts the banner.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { uiDetail } from './helpers/src.mjs';

const NOW = Date.parse('2026-09-28T10:00:00Z');
const AT = Date.parse('2026-10-21T10:00:00Z'); // wo 21 okt 12:00
const fakeRoot = () => ({ innerHTML: '', querySelector: () => null });
const cb = { onBack() {}, onShare() {}, onRetry() {} };

const props = {
  id: 'kk', cat: 'afsluiting', sub: 'roadClosed', sev: 3, title: 'Paul Krugerkade, Utrecht', roadType: 'lokaal',
  start: '2026-09-22T22:00:00Z', end: '2026-10-29T16:00:00Z', src: 'Utrecht', imp: 'dicht', veh: ['car', 'bicycle'], per: true,
};
const detail = {
  id: 'kk', src: 'Utrecht', desc: 'Werkzaamheden aan de kade.',
  tl: [
    ['2026-09-22T22:00:00Z', '2026-10-16T05:00:00Z', 'dicht', ['car']],
    ['2026-10-16T05:00:00Z', '2026-10-19T15:00:00Z', 'dicht', ['car', 'bicycle']],
    ['2026-10-19T15:00:00Z', '2026-10-29T16:00:00Z', 'dicht', ['bicycle']],
  ],
};
const state = (extra = {}) => ({ props, center: [5.12, 52.08], detail, loading: false, error: false, mode: 'auto', ...extra });

function render(extra) {
  const root = fakeRoot();
  uiDetail.renderDetail(root, state(extra), NOW, cb);
  return root.innerHTML;
}

describe('detail at a chosen moment', () => {
  it('names the moment instead of "Nu actief", in the status and above the banner', () => {
    const html = render({ at: AT });
    assert.match(html, /Op wo 21 okt 12:00: bezig \(tot en met do 29 okt\)/);
    assert.doesNotMatch(html, /Nu actief/);
    assert.match(html, /class="vbanner__kicker">Voor auto&#39;s · wo 21 okt 12:00</);
  });

  it('marks the chosen date on the timeline, with a faint NU tick', () => {
    const html = render({ at: AT });
    assert.match(html, /class="timeline__now timeline__chosen"[^>]*><span>21 OKT<\/span>/);
    assert.match(html, /class="timeline__tick"/);
    const now = render({ at: NOW });
    assert.match(now, /class="timeline__now"[^>]*><span>NU<\/span>/);
    assert.doesNotMatch(now, /timeline__chosen/);
  });

  it('lists "Wanneer wat" from the chosen stretch on, with labels from the verdict', () => {
    const html = render({ at: AT });
    assert.match(html, /<h3 class="detail__h" id="detail-phases-h">Wanneer wat<\/h3>/);
    // At 21 okt only the cycle path is closed: for cars that stretch is "Geldt niet voor auto's".
    assert.match(html, /<li class="phase is-chosen" aria-current="true"><time[^>]*>ma 19 okt 17:00 – do 29 okt 17:00<\/time><span class="phase__what"><span class="vpill vpill--nvt/);
    assert.match(html, /gekozen moment/);
    assert.doesNotMatch(html, /vr 16 okt 07:00/, 'stretches before the chosen moment are left out');
    const early = render({ at: NOW });
    assert.match(early, /wo 23 sep 00:00 – ma 19 okt 17:00/, 'two back-to-back "Weg dicht" stretches are one row');
  });

  it('the route button sits above the explanation', () => {
    const html = render({ at: AT });
    assert.ok(html.indexOf('data-gmaps-route') > 0);
    assert.ok(html.indexOf('data-gmaps-route') < html.indexOf('Toelichting'));
    assert.ok(html.indexOf('detail-when-h') < html.indexOf('data-gmaps-route'), '"Wanneer" comes before the route');
  });

  it('a phase that does not concern cars says who it is for, not "Afsluiting · weg afgesloten"', () => {
    const html = render({ at: AT });
    assert.match(html, /<span>Afsluiting voor fietsers<\/span>/);
    assert.doesNotMatch(html, /weg afgesloten/);
    const closed = render({ at: NOW });
    assert.match(closed, /<span>Afsluiting<\/span>/);
  });

  it('a tlTo ends the rows with "werktijden nog niet bekend"', () => {
    const html = render({ at: NOW, detail: { ...detail, tlTo: '2026-10-29T16:00:00Z' } });
    assert.match(html, /Na do 29 okt 17:00: werktijden nog niet bekend/);
  });
});
