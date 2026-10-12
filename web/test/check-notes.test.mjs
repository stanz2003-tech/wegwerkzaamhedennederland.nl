/**
 * The consistency notes (pipeline/src/consistency.js → ItemDetail.chk): where the verdict and the
 * publisher's own words disagree, the detail says so in plain Dutch and quotes the publisher —
 * the Merwedebrug read "Weg dicht" over a text about a cycle path without a word of explanation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkNotes, uiDetail } from './helpers/src.mjs';

const MERWEDE = 'Langdurige afsluiting fietspad Merwedebrug westzijde i.v.m. met de bouw van de nieuwe brug';

describe('checkNotes', () => {
  it('quotes the cycle-path text and names who the data closes the road for', () => {
    const [note] = checkNotes.checkNotes([{ c: 'tekst-fietspad', q: MERWEDE }], ['car']);
    assert.equal(note.kind, 'conflict');
    assert.match(note.text, /‘Langdurige afsluiting fietspad Merwedebrug westzijde i\.v\.m\. met de bouw van de nieuwe brug’/);
    assert.match(note.text, /voor auto’s/);
    assert.match(note.text, /alleen het fiets- of voetpad/);
    const [all] = checkNotes.checkNotes([{ c: 'tekst-fietspad', q: MERWEDE }], null);
    assert.match(all.text, /voor al het verkeer/);
  });

  it('explains a verdict that comes from the label or the text, and says it is the publisher\'s word', () => {
    const [label] = checkNotes.checkNotes([{ c: 'gevolg-dicht', q: 'Weg dicht in beide richtingen' }], null);
    assert.equal(label.kind, 'reason');
    assert.match(label.text, /‘Weg dicht in beide richtingen’/);
    const [text] = checkNotes.checkNotes([{ c: 'tekst-dicht', q: 'De A15 is afgesloten tussen Gorinchem en Deil' }], null);
    assert.match(text.text, /‘De A15 is afgesloten tussen Gorinchem en Deil’/);
  });

  it('says when Wegwerk corrected the data, and that the correction expires with the melding', () => {
    const [note] = checkNotes.checkNotes([{ c: 'correctie', q: 'Wij hebben de afsluiting op fietsers gezet.' }], ['bicycle']);
    assert.equal(note.kind, 'reason');
    assert.equal(note.title, 'Door Wegwerk gecorrigeerd');
    assert.match(note.text, /^Wij hebben de afsluiting op fietsers gezet. Past de wegbeheerder de melding aan, dan vervalt deze correctie vanzelf.$/);
  });

  it('notes the contradicting labels and skips unknown codes and missing input', () => {
    const notes = checkNotes.checkNotes(
      [
        { c: 'gevolg-geen', q: 'Geen gevolgen voor verkeer' },
        { c: 'gevolg-langzaam', q: 'Beperking voor langzaam verkeer' },
        { c: 'iets-nieuws', q: 'x' },
      ],
      null,
    );
    assert.deepEqual(notes.map((n) => n.kind), ['conflict', 'conflict']);
    assert.deepEqual(checkNotes.checkNotes(undefined, null), []);
  });
});

describe('detail with consistency notes', () => {
  const fakeRoot = () => ({ innerHTML: '', querySelector: () => null });
  const cb = { onBack() {}, onShare() {}, onRetry() {} };
  const NOW = Date.parse('2026-10-12T17:00:00Z');
  const props = {
    id: 'AND01_C1020D9C0FA84C228DBBA388E93364CB', cat: 'afsluiting', sub: 'roadClosed', sev: 1,
    title: `${MERWEDE}., Gorinchem`, roadType: 'lokaal', start: '2026-05-14T19:00:00Z', end: '2032-12-19T16:00:00Z',
    src: 'Waterschap Rivierenland', hind: 'E', imp: 'dicht', veh: ['car'],
  };
  const detail = { id: props.id, src: 'Waterschap Rivierenland', upd: '2026-05-14T19:00:00Z', chk: [{ c: 'tekst-fietspad', q: MERWEDE }] };
  const render = (p, d) => {
    const root = fakeRoot();
    uiDetail.renderDetail(root, { props: p, center: null, detail: d, loading: false, error: false, mode: 'auto' }, NOW, cb);
    return root.innerHTML;
  };

  it('shows the note between the title and the rest, and drops "nauwelijks hinder" under a closure', () => {
    const html = render(props, detail);
    assert.match(html, /class="banner banner--warn detail__check"/);
    assert.ok(html.indexOf('detail__check') > html.indexOf('detail-title'), 'below the title');
    assert.ok(html.indexOf('detail__check') < html.indexOf('detail__when') || !html.includes('detail__when'));
    assert.doesNotMatch(html, /nauwelijks hinder/);
    // without a closure the publisher's hinder class still shows
    assert.match(render({ ...props, imp: 'hinder' }, { ...detail, chk: undefined }), /nauwelijks hinder/);
  });

  it('shows Melvin\'s gevolg label as the publisher\'s own words', () => {
    const html = render({ ...props, title: 'Banneweg, Gorinchem' }, { ...detail, chk: undefined, gevolg: 'Weg dicht in beide richtingen' });
    assert.match(html, /Volgens wegbeheerder<\/dt><dd>Weg dicht in beide richtingen</);
    assert.doesNotMatch(html, /detail__check/);
  });
});
