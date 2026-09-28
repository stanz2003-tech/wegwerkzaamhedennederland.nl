/**
 * The small verdict hint next to a road or place link on /wegen/ and /plaatsen/: "ergens dicht
 * gemeld" / "rijbaan dicht gemeld". It replaced a bare count that was written INSIDE the badge,
 * so the A1 with 29 items read "A129" (zoek-1, overzicht-2).
 *
 * The level is the heaviest index verdict for cars over the active items of that road or place —
 * conservative (the whole measure, not the current phase), so it can be heavier than the road
 * page's timed answer; "gemeld" covers that. Only a closure gets a hint: an index row can never
 * justify "geen hinder" or "erdoor" for a whole road, so those are never shown.
 */
import type { IndexItem } from '../data/index';
import { verdictFor, worseLevel, type VehicleMode, type VerdictLevel } from '../data/verdict';
import { esc } from './format';

/** Heaviest verdict per key over the active rows; a row may belong to several keys. */
export function worstActiveByKey(
  rows: readonly IndexItem[],
  keysOf: (it: IndexItem) => readonly string[],
  now: number,
  mode: VehicleMode = 'auto',
): Map<string, VerdictLevel> {
  const worst = new Map<string, VerdictLevel>();
  for (const it of rows) {
    if (!it.active) continue;
    const keys = keysOf(it);
    if (keys.length === 0) continue;
    const level = verdictFor(it, mode, { now }).level;
    for (const key of keys) worst.set(key, worseLevel(worst.get(key) ?? null, level));
  }
  return worst;
}

const STATE_TEXT: Partial<Record<VerdictLevel, string>> = {
  dicht: 'ergens dicht gemeld',
  rijbaan: 'rijbaan dicht gemeld',
};

/** The hint for a level, or null: only "dicht" and "rijbaan" are worth a hint. */
export function roadStateText(level: VerdictLevel | null | undefined): string | null {
  return level ? (STATE_TEXT[level] ?? null) : null;
}

/** `<span class="road-state road-state--dicht">ergens dicht gemeld</span>`, or '' for no hint. */
export function roadStateHtml(level: VerdictLevel | null | undefined): string {
  const text = roadStateText(level);
  return text && level ? `<span class="road-state road-state--${level}">${esc(text)}</span>` : '';
}
