/**
 * The words the site uses for the same thing in more than one place, kept together so a page
 * never says "weggelaten" in one line and "verborgen" in the next (taal-8). Pure strings and
 * tiny functions only; the verdict labels themselves live in data/verdict.ts (VERDICT_META).
 */
import { modeNoun, type VehicleMode } from '../data/verdict';

/** The one word for items the relevance switch takes out of the list and the map. */
export const HIDDEN_WORD = 'verborgen';

/** The relevance switch: "Alleen wat voor auto's geldt". */
export function relevanceLabel(mode: VehicleMode): string {
  return `Alleen wat voor ${modeNoun(mode)} geldt`;
}

/**
 * The panel line outside road, place and text mode. The list under it already answers per row;
 * a count sentence ("In beeld: 2604 plekken dicht, …") answered nothing (overzicht-5).
 */
export const SEARCH_PROMPT = 'Zoek je weg of plaats voor een antwoord';

/** Lead-in of the motorway badges at national zoom: "Nu dicht op snelwegen:" / "Morgen dicht op snelwegen:". */
export function closedMotorwaysLead(whenLabel: string): string {
  const w = whenLabel.trim();
  if (w === '' || w === 'nu') return 'Nu dicht op snelwegen:';
  // A window label ("vandaag", "dit weekend") reads as the subject; a date needs "Op".
  const lead = /^\d|^(ma|di|wo|do|vr|za|zo)\s/.test(w) ? `Op ${w}` : w.charAt(0).toUpperCase() + w.slice(1);
  return `${lead} dicht op snelwegen:`;
}

/** The map link to the text section under the map. */
export const UITLEG_LINK = 'Uitleg en alle wegen';

/** The one line under the heading of /vandaag/ and /dit-weekend/: what the list is, not how long it is. */
export function windowListIntro(windowLabel: string): string {
  return `Hieronder wat ${windowLabel} dicht of beperkt is, ernstigste eerst; lang lopend werk staat onderaan.`;
}

/** Detail line of a melding of category "overig" without a sub type or a description. */
export const NO_DESCRIPTION = 'De wegbeheerder heeft niet gezegd wat er aan de hand is.';
