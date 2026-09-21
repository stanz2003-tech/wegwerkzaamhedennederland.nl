/**
 * How far ahead the published dataset reaches, read once from `meta.json`.
 *
 * The pipeline drops measures that start more than `Meta.horizon.days` ahead, so a question about
 * a later date cannot be answered from the files. Before this existed the site replied "Geen
 * hinder gemeld" to such a question — the same confident sentence it uses for a genuinely quiet
 * road — while 1.765 closures for that period simply were not published yet.
 *
 * It lives in a tiny module of its own rather than being threaded through the map, the entity
 * pages and the forecast block, because it is set once at boot and never changes afterwards:
 * configuration, not state. `answerFor()` still takes it as an explicit argument so the answer
 * logic stays pure and testable.
 */
import type { Meta } from './types';

let untilMs: number | undefined;

/** Records the horizon of the loaded dataset. Older files carry no horizon; then it stays unknown. */
export function setHorizonFromMeta(meta: Meta | null | undefined): void {
  const iso = meta?.horizon?.until;
  const ms = iso ? Date.parse(iso) : Number.NaN;
  untilMs = Number.isFinite(ms) ? ms : undefined;
}

/** The last moment the dataset covers, or undefined when it is unknown. */
export function horizonMs(): number | undefined {
  return untilMs;
}

/** Test seam: forget what was recorded. */
export function resetHorizon(): void {
  untilMs = undefined;
}
