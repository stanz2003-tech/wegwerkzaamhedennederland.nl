import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectRoad,
  normalizeRoad,
  normalizeVildRoad,
  roadFromRoadNumberField,
  roadFromStreet,
  roadFromTexts,
  roadTypeOf,
} from '../src/roads.js';

test('normalizeRoad: casing, spaces and leading zeros', () => {
  assert.equal(normalizeRoad('a2'), 'A2');
  assert.equal(normalizeRoad('N 57'), 'N57');
  assert.equal(normalizeRoad('A007'), 'A7');
  assert.equal(normalizeRoad('S100'), 's100');
  assert.equal(normalizeRoad('s100'), 's100');
  assert.equal(normalizeRoad('E19'), 'E19');
  assert.equal(normalizeRoad(' A12 '), 'A12');
  assert.equal(normalizeRoad(undefined), undefined);
  assert.equal(normalizeRoad(''), undefined);
});

test('normalizeRoad rejects anything that is not a plain road number', () => {
  assert.equal(normalizeRoad('N.V.'), undefined);
  assert.equal(normalizeRoad('A2 Vught'), undefined);
  assert.equal(normalizeRoad('Rijksweg 2'), undefined);
  assert.equal(normalizeRoad('A1234'), undefined);
  assert.equal(normalizeRoad('s10'), undefined); // Amsterdam s-routes are three digits
  assert.equal(normalizeRoad('12'), undefined);
});

test('normalizeVildRoad collapses carriageway suffixes and branch letters', () => {
  assert.equal(normalizeVildRoad('A12 hrb'), 'A12');
  assert.equal(normalizeVildRoad('A15 prb'), 'A15');
  assert.equal(normalizeVildRoad('A4 HRL'), 'A4');
  assert.equal(normalizeVildRoad('N282A'), 'N282');
  assert.equal(normalizeVildRoad('N342+'), 'N342');
  assert.equal(normalizeVildRoad('N57'), 'N57');
  assert.equal(normalizeVildRoad('v100-CR1'), undefined);
  assert.equal(normalizeVildRoad(''), undefined);
  assert.equal(normalizeVildRoad(undefined), undefined);
});

test('roadTypeOf: A, N, S, E, lokaal', () => {
  assert.equal(roadTypeOf('A2'), 'A');
  assert.equal(roadTypeOf('N57'), 'N');
  assert.equal(roadTypeOf('s100'), 'S');
  assert.equal(roadTypeOf('E19'), 'E');
  assert.equal(roadTypeOf('Dorpsstraat'), 'lokaal');
  assert.equal(roadTypeOf(undefined), 'lokaal');
});

test('roadFromRoadNumberField only reads a road number at the start', () => {
  assert.equal(roadFromRoadNumberField('N33'), 'N33');
  assert.equal(roadFromRoadNumberField('N7 Weg der Verenigde Naties'), 'N7');
  assert.equal(roadFromRoadNumberField('A28/A1'), 'A28');
  assert.equal(roadFromRoadNumberField('s100 Ring West'), 's100');
  // Melvin free-text road descriptions and street names are not road numbers
  assert.equal(roadFromRoadNumberField('002 Rijksweg 2'), undefined);
  assert.equal(roadFromRoadNumberField('Burgemeester Röellstraat'), undefined);
  assert.equal(roadFromRoadNumberField('N33A'), undefined);
  assert.equal(roadFromRoadNumberField(undefined), undefined);
});

test('roadFromTexts finds the first A/N number in free text', () => {
  assert.equal(roadFromTexts(['Afsluiting A12 richting Utrecht']), 'A12');
  assert.equal(roadFromTexts([undefined, '', 'werk aan de N57 bij Serooskerke']), 'N57');
  assert.equal(roadFromTexts(['(N279) omleiding']), 'N279');
});

test('roadFromTexts must NOT match company suffixes or house numbers', () => {
  assert.equal(roadFromTexts(['Heijmans Infra N.V. voert het werk uit']), undefined);
  assert.equal(roadFromTexts(['Dorpsstraat 12 is afgesloten']), undefined);
  assert.equal(roadFromTexts(['Contact: A. Jansen']), undefined);
  assert.equal(roadFromTexts(['project A12b fase 2']), undefined);
  assert.equal(roadFromTexts(['Postbus 1000, 1234 AB']), undefined);
  // lower case in free text is deliberately ignored ("bijlage a2", "versie n1")
  assert.equal(roadFromTexts(['op de a2 tussen Vught en Boxtel']), undefined);
  assert.equal(roadFromTexts([]), undefined);
});

test('roadFromStreet recognises a road number inside a geocoded street name', () => {
  assert.equal(roadFromStreet('Rijksweg A2'), 'A2');
  assert.equal(roadFromStreet('N57'), 'N57');
  assert.equal(roadFromStreet('s100'), 's100');
  assert.equal(roadFromStreet('Asterdkraag'), undefined);
  assert.equal(roadFromStreet('Straatweg 14'), undefined);
  assert.equal(roadFromStreet(undefined), undefined);
});

test('detectRoad order: roadOrJunctionNumber → VILD → text → street', () => {
  assert.deepEqual(
    detectRoad({ roadNr: 'N33', vildRoad: 'A7', texts: ['werk op de A12'], street: 'N57' }),
    { road: 'N33', roadType: 'N' },
  );
  assert.deepEqual(detectRoad({ vildRoad: 'A12 hrb', texts: ['werk op de N57'], street: 'Dorpsstraat' }), { road: 'A12', roadType: 'A' });
  assert.deepEqual(detectRoad({ texts: ['werk op de N57'], street: 'Rijksweg A2' }), { road: 'N57', roadType: 'N' });
  assert.deepEqual(detectRoad({ street: 'Rijksweg A2' }), { road: 'A2', roadType: 'A' });
  // an unusable roadOrJunctionNumber does not block the later steps
  assert.deepEqual(detectRoad({ roadNr: '002 Rijksweg 2', vildRoad: 'A2' }), { road: 'A2', roadType: 'A' });
  // nothing usable at all
  assert.deepEqual(detectRoad({ texts: ['Werk in de Dorpsstraat'], street: 'Dorpsstraat' }), { roadType: 'lokaal' });
  assert.deepEqual(detectRoad({}), { roadType: 'lokaal' });
});
