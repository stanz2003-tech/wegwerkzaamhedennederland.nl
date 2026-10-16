/**
 * Plain-Dutch notes for the consistency checks the pipeline attaches to an item (`ItemDetail.chk`,
 * pipeline/src/consistency.js). Two kinds:
 *   - `reason`: the verdict comes from the publisher's own label or sentence, not from a closure
 *     record — say where "dicht" comes from;
 *   - `conflict`: the publisher's words and data disagree — quote the words, say what we show and
 *     that the signs on site decide. We always show the stricter reading (impact.js).
 * Notes are the same for every vehicle mode: they describe the melding, not the reader's verdict.
 */
import type { ConsistencyCheck, Vehicle } from '../data/types';

export interface CheckNote {
  kind: 'reason' | 'conflict';
  title: string;
  text: string;
}

const ON_SITE = 'Let ter plaatse op de borden.';

/** "voor auto’s", "voor auto’s en bussen", "voor al het verkeer". */
function audience(veh: readonly Vehicle[] | null | undefined): string {
  if (!veh || veh.length === 0) return 'voor al het verkeer';
  const names: Record<Vehicle, string> = {
    car: 'auto’s',
    lorry: 'vrachtverkeer',
    bicycle: 'fietsers',
    moped: 'brommers',
    bus: 'bussen',
    agricultural: 'landbouwverkeer',
    other: 'ander verkeer',
  };
  const list = veh.map((v) => names[v]);
  return `voor ${list.length > 1 ? `${list.slice(0, -1).join(', ')} en ${list[list.length - 1]}` : list[0]}`;
}

const quote = (q: string | undefined): string => (q ? `‘${q}’` : 'iets anders');

function noteOf(check: ConsistencyCheck, veh: readonly Vehicle[] | null | undefined): CheckNote | null {
  switch (check.c) {
    case 'correctie':
      return {
        kind: 'reason',
        title: 'Door Wegwerk gecorrigeerd',
        text: `${check.q ?? ''} Past de wegbeheerder de melding aan, dan vervalt deze correctie vanzelf.`.trim(),
      };
    case 'gevolg-dicht':
      return {
        kind: 'reason',
        title: 'Waarom dicht?',
        text: `De wegbeheerder meldt als gevolg ${quote(check.q)}, maar zet geen afsluiting in de gegevens. We gaan uit van wat de wegbeheerder meldt.`,
      };
    case 'gevolg-auto':
      return {
        kind: 'conflict',
        title: 'Melding spreekt zichzelf tegen',
        text: `De wegbeheerder kiest als gevolg ${quote(check.q)}, maar zet de afsluiting in de gegevens alleen ${audience(check.v)}. De rest van de melding wijst erop dat de weg ook voor auto’s dicht is, dus dat tonen we. ${ON_SITE}`,
      };
    case 'gevolg-periode':
      return {
        kind: 'reason',
        title: 'Waarom dicht tot het einde?',
        text: `De wegbeheerder geeft maar één werkperiode op en meldt als gevolg ${quote(check.q)}. We gaan ervan uit dat de weg daarna dicht blijft tot het einde van de melding. ${ON_SITE}`,
      };
    case 'tekst-dicht':
      return {
        kind: 'reason',
        title: 'Waarom dicht?',
        text: `De wegbeheerder schrijft ${quote(check.q)}, maar zet geen afsluiting in de gegevens. We gaan uit van die tekst.`,
      };
    case 'tekst-fietspad':
      return {
        kind: 'conflict',
        title: 'Melding spreekt zichzelf tegen',
        text: `De wegbeheerder schrijft ${quote(check.q)}, maar meldt de afsluiting in de gegevens ${audience(veh)}. Mogelijk is alleen het fiets- of voetpad dicht. Tot de wegbeheerder dit rechtzet, tonen we wat de gegevens zeggen. ${ON_SITE}`,
      };
    case 'gevolg-geen':
      return {
        kind: 'conflict',
        title: 'Melding spreekt zichzelf tegen',
        text: `De wegbeheerder kiest als gevolg ${quote(check.q)}, maar meldt in de gegevens een afsluiting. We tonen de afsluiting. ${ON_SITE}`,
      };
    case 'gevolg-langzaam':
      return {
        kind: 'conflict',
        title: 'Melding spreekt zichzelf tegen',
        text: `De wegbeheerder kiest als gevolg ${quote(check.q)} (fietsers en voetgangers), maar meldt in de gegevens een afsluiting ${audience(veh)}. We tonen de afsluiting. ${ON_SITE}`,
      };
    default:
      return null;
  }
}

/** The notes for an item's checks, in the order the pipeline wrote them; unknown codes are skipped. */
export function checkNotes(chk: readonly ConsistencyCheck[] | undefined, veh: readonly Vehicle[] | null | undefined): CheckNote[] {
  return (chk ?? []).map((c) => noteOf(c, veh)).filter((n): n is CheckNote => n !== null);
}
