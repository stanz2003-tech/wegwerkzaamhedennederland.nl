import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTitle,
  isGenericComment,
  mentionsPlace,
  oneLine,
  prefixRoad,
  sanitizeAddress,
  sentenceCase,
  stripHouseNumbers,
  tidySeparators,
  TITLE_MAX,
  truncate,
  TYPE_LABELS,
} from '../src/title.js';

test('fallback chain: a specific warning comment wins over everything', () => {
  const title = buildTitle({
    comment: 'Vervangen van de duiker',
    causeDesc: 'Asfalteringswerkzaamheden',
    roadName: 'Afsluitdijk',
    from: 'Den Oever',
    to: 'Zurich',
    street: 'Dorpsstraat',
    place: 'Breda',
    cat: 'werk',
    sub: 'resurfacingWork',
  });
  // the comment is the base text; the place is appended because the comment
  // does not name a location and the item has no road number
  assert.equal(title, 'Vervangen van de duiker, Breda');
  // boilerplate is the exception — see the dedicated test below
  assert.equal(buildTitle({ comment: 'Weg dicht in een richting', roadName: 'Afsluitdijk', cat: 'werk' }), 'Afsluitdijk');
});

test('fallback chain: VILD road name, then from → to, then from alone', () => {
  assert.equal(buildTitle({ road: 'A7', roadName: 'Afsluitdijk', from: 'Den Oever', to: 'Zurich', cat: 'werk' }), 'A7 · Afsluitdijk');
  assert.equal(buildTitle({ road: 'A7', from: 'Den Oever', to: 'Zurich', cat: 'werk' }), 'A7 · Den Oever → Zurich');
  assert.equal(buildTitle({ road: 'A7', from: 'Den Oever', cat: 'werk' }), 'A7 · Den Oever');
  // VILD text already names a location: never append the place to it
  assert.equal(buildTitle({ roadName: 'Afsluitdijk', place: 'Den Oever', cat: 'werk' }), 'Afsluitdijk');
});

test('fallback chain: "straat, woonplaats" when no VILD name is known', () => {
  assert.equal(buildTitle({ street: 'Asterdkraag', place: 'Breda', cat: 'werk', sub: 'resurfacingWork' }), 'Asterdkraag, Breda');
  // a street without a place still beats the cause description
  assert.equal(buildTitle({ street: 'Asterdkraag', causeDesc: 'Asfaltwerk', cat: 'werk' }), 'Asterdkraag');
  // a bare place is no title: fall through to the cause description, which then
  // gets the place appended
  assert.equal(buildTitle({ place: 'Breda', causeDesc: 'Asfaltwerk', cat: 'werk' }), 'Asfaltwerk, Breda');
});

test('fallback chain: causeDescription, then the type label (with place when known)', () => {
  assert.equal(buildTitle({ causeDesc: 'Asfalteringswerkzaamheden, , PCMN-Z', cat: 'werk' }), 'Asfalteringswerkzaamheden, PCMN-Z');
  assert.equal(buildTitle({ cat: 'werk', sub: 'resurfacingWork', place: 'Breda' }), 'Asfalteringswerkzaamheden in Breda');
  assert.equal(buildTitle({ cat: 'werk', sub: 'resurfacingWork' }), 'Asfalteringswerkzaamheden');
  // sub type label wins over the category label
  assert.equal(buildTitle({ cat: 'afsluiting', sub: 'roadClosed' }), 'Weg afgesloten');
  assert.equal(buildTitle({ cat: 'afsluiting' }), 'Afsluiting');
  // an unknown sub type falls back to the category label
  assert.equal(buildTitle({ cat: 'file', sub: 'somethingNdwInvented' }), 'File');
  // no category at all still yields a usable label
  assert.equal(buildTitle({ cat: 'nonsense' }), 'Verkeersmaatregel');
});

// --- Melvin free text: postcodes, house numbers, missing place -------------

test('postcodes are stripped from address-like Melvin titles (real feed strings)', () => {
  assert.equal(
    buildTitle({ comment: 'J.W. de Visserwei 1, 9001 ZE Grou', place: 'Grou', cat: 'werk', sub: 'installationWork' }),
    'J.W. de Visserwei, Grou',
  );
  assert.equal(buildTitle({ comment: 'Wissesdwinger 1, 8911 ER Leeuwarden', place: 'Leeuwarden', cat: 'werk' }), 'Wissesdwinger, Leeuwarden');
  assert.equal(buildTitle({ comment: 'Griene dyk 7, 9088 CD Wirdum', place: 'Wirdum', cat: 'werk' }), 'Griene dyk, Wirdum');
  // lowercase postcode letters are not postcodes, and a year plus a word is safe
  assert.equal(sanitizeAddress('Werk tot 2026 om de brug'), 'Werk tot 2026 om de brug');
  assert.equal(buildTitle({ comment: 'GlasvezelaansluIting: Utrechtsestraatweg 32, 3481LA HARMELEN', road: 'N198', cat: 'werk' }), 'N198 · GlasvezelaansluIting: Utrechtsestraatweg, HARMELEN');
});

test('house numbers only disappear where the text really is an address', () => {
  // address-shaped: the word before the number ends like a street name
  assert.equal(stripHouseNumbers('Lakenblekerstraat 56'), 'Lakenblekerstraat');
  assert.equal(stripHouseNumbers('Dorpsweg 3-5'), 'Dorpsweg');
  assert.equal(stripHouseNumbers('Kerkstraat 12a, Breda'), 'Kerkstraat, Breda');
  assert.equal(stripHouseNumbers('1 Dorpsstraat', true), 'Dorpsstraat');
  // not address-shaped: the number carries meaning and stays
  assert.equal(stripHouseNumbers('Snelheidsbeperking 50'), 'Snelheidsbeperking 50');
  assert.equal(stripHouseNumbers('Fase 2'), 'Fase 2');
  assert.equal(stripHouseNumbers('Breedtebeperking 2,80m'), 'Breedtebeperking 2,80m');
  assert.equal(buildTitle({ comment: 'Snelheidsbeperking 50', place: 'Breda', cat: 'overig' }), 'Snelheidsbeperking 50, Breda');
});

test('the place is appended to Melvin text that does not name a location', () => {
  assert.equal(buildTitle({ comment: 'Opslag bouwmateriaal', place: 'Grou', cat: 'werk' }), 'Opslag bouwmateriaal, Grou');
  assert.equal(buildTitle({ comment: 'Weg dicht in beide richtingen', place: 'Harlingen', cat: 'afsluiting' }), 'Weg dicht in beide richtingen, Harlingen');
  // Melvin lowercases its own labels; a title starts with a capital
  assert.equal(buildTitle({ comment: 'gestuurde boring', place: 'Vianen', cat: 'werk' }), 'Gestuurde boring, Vianen');
  // already names the place → not repeated
  assert.equal(buildTitle({ comment: 'Werk aan de rotonde in Harlingen', place: 'Harlingen', cat: 'werk' }), 'Werk aan de rotonde in Harlingen');
  // nothing is invented: without a place the text is left exactly as it is
  assert.equal(buildTitle({ comment: 'Opslag bouwmateriaal', cat: 'werk' }), 'Opslag bouwmateriaal');
  // a numbered road localises the item itself, so no place is appended
  assert.equal(buildTitle({ comment: 'Breedtebeperking < 2m', road: 'A4', place: 'Hoofddorp', cat: 'overig' }), 'A4 · Breedtebeperking < 2m');
});

test('Melvin boilerplate drops below the street: it says what, not where', () => {
  // "Weg dicht in beide richtingen" is the warning comment of 5,830 planning
  // situations in one feed — useless as a title when a street is known
  const generic = { comment: 'Weg dicht in beide richtingen', place: 'Harlingen', cat: 'afsluiting', sub: 'roadClosed' };
  assert.equal(buildTitle({ ...generic, street: 'Havenplein' }), 'Havenplein, Harlingen');
  // a VILD road name beats it too
  assert.equal(buildTitle({ ...generic, road: 'A7', roadName: 'Afsluitdijk' }), 'A7 · Afsluitdijk');
  // without anything better it is still the best text we have
  assert.equal(buildTitle(generic), 'Weg dicht in beide richtingen, Harlingen');
  // specific comments keep winning over the street
  assert.equal(buildTitle({ comment: 'Opslag bouwmateriaal', street: 'Havenplein', place: 'Grou', cat: 'werk' }), 'Opslag bouwmateriaal, Grou');

  for (const text of [
    'Weg dicht in beide richtingen',
    'Weg dicht in een richting',
    'Snelheidsbeperking',
    'Geen gevolgen voor verkeer',
    'Beperking voor langzaam verkeer',
    'Verminderd aantal rijstroken beschikbaar',
    'SNELHEIDSBEPERKING.',
    '  weg   dicht in een richting ',
  ]) {
    assert.equal(isGenericComment(text), true, text);
  }
  for (const text of ['Opslag bouwmateriaal', 'Weg dicht in beide richtingen tussen A en B', 'Parkeerverboden']) {
    assert.equal(isGenericComment(text), false, text);
  }
});

test('mentionsPlace matches whole words, diacritics folded', () => {
  assert.equal(mentionsPlace('J.W. de Visserwei, Grou', 'Grou'), true);
  assert.equal(mentionsPlace('Werk in Sint-Michielsgestel', 'sint-michielsgestel'), true);
  assert.equal(mentionsPlace('Werk in Curacao', 'Curaçao'), true);
  assert.equal(mentionsPlace('Groundwork aan de weg', 'Grou'), false);
  assert.equal(mentionsPlace('Bredase weg', 'Breda'), false);
});

test('the separator is always exactly " · ", whatever noise the text starts with', () => {
  assert.equal(prefixRoad('Werk aan het viaduct', 'A2'), 'A2 · Werk aan het viaduct');
  // a leading non-breaking space, middot or dash never collapses the separator
  assert.equal(prefixRoad(' Breedtebeperking < 2m', 'A4'), 'A4 · Breedtebeperking < 2m');
  assert.equal(prefixRoad('·Breedtebeperking', 'A4'), 'A4 · Breedtebeperking');
  assert.equal(prefixRoad('- Rijstrook dicht', 'A4'), 'A4 · Rijstrook dicht');
  assert.equal(buildTitle({ comment: ' Breedtebeperking < 2m', road: 'A4', cat: 'overig' }), 'A4 · Breedtebeperking < 2m');
  for (const title of ['A4 · Breedtebeperking', prefixRoad('x', 'A4')]) assert.ok(!/·(?! )/.test(title), title);
});

test('road prefix is added once and never duplicated', () => {
  assert.equal(buildTitle({ comment: 'A2 werk aan het viaduct', road: 'A2', cat: 'werk' }), 'A2 werk aan het viaduct');
  assert.equal(prefixRoad('a2: werk', 'A2'), 'a2: werk');
  assert.equal(prefixRoad('A2-Vught', 'A2'), 'A2-Vught');
  assert.equal(prefixRoad('A20 werk', 'A2'), 'A2 · A20 werk'); // A20 is a different road
  assert.equal(prefixRoad('werk', undefined), 'werk');
  assert.equal(prefixRoad('s100 werk', 's100'), 's100 werk');
});

test('HTML is stripped and newlines collapse into one line', () => {
  assert.equal(buildTitle({ comment: '<p>Rijstrook dicht</p><br/>tot maandag', cat: 'werk' }), 'Rijstrook dicht tot maandag');
  assert.equal(oneLine('  a\n\nb\tc  '), 'a b c');
  assert.equal(tidySeparators('Asfalt, , PCMN-Z ,'), 'Asfalt, PCMN-Z');
});

test('sentenceCase capitalises Melvin text but leaves road codes alone', () => {
  assert.equal(sentenceCase('gestuurde boring'), 'Gestuurde boring');
  assert.equal(sentenceCase('Gestuurde boring'), 'Gestuurde boring');
  assert.equal(sentenceCase('s100 dicht'), 's100 dicht');
  assert.equal(sentenceCase('a2 dicht'), 'a2 dicht');
});

test('titles are capped at 120 characters on a word boundary', () => {
  const long = 'Werkzaamheden aan de rijbaan tussen knooppunt Hoevelaken en knooppunt Rijnsweerd inclusief het vervangen van de geluidsschermen langs de weg';
  const title = buildTitle({ comment: long, road: 'A28', cat: 'werk' });
  assert.equal(title.length <= TITLE_MAX, true, `length ${title.length}`);
  assert.ok(title.startsWith('A28 · Werkzaamheden aan de rijbaan'));
  assert.ok(title.endsWith('…'));
  assert.ok(!title.includes(' …'));

  // the appended place is a bonus: it is dropped rather than cut in half
  const almost = 'Werkzaamheden aan de rijbaan tussen de eerste rotonde en de tweede rotonde inclusief het vervangen van het riool eronder';
  const withPlace = buildTitle({ comment: almost, place: 'Sint-Michielsgestel', cat: 'werk' });
  assert.equal(withPlace.length <= TITLE_MAX, true, `length ${withPlace.length}`);
  assert.ok(!withPlace.includes('Sint-Michielsgestel'));
});

test('truncate keeps short text, cuts long text at a space and trims separators', () => {
  assert.equal(truncate('kort', 10), 'kort');
  assert.equal(truncate('1234567890', 10), '1234567890');
  assert.equal(truncate('aaa bbb ccc ddd', 10), 'aaa bbb…');
  // no usable space in the last 40%: hard cut
  assert.equal(truncate('aaaaaaaaaaaaaaaaaaaa', 10), 'aaaaaaaaa…');
  assert.equal(truncate('aaa bbb, ccc', 9), 'aaa bbb…');
});

test('every documented category has a Dutch label', () => {
  for (const cat of ['werk', 'afsluiting', 'file', 'incident', 'brug', 'evenement', 'overig']) {
    assert.equal(typeof TYPE_LABELS[cat], 'string', `missing label for ${cat}`);
  }
});
