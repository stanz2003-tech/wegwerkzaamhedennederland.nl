/**
 * Curated facts about the big road bridges that the registry (pipeline/static/bruggen.json) does
 * not carry, from bridge-aliases.json: the names people search for ("Gorkumse brug" for the
 * Merwedebrug bij Gorinchem) and, for long bridges, how far from the bridge point a melding still
 * counts (data/bridge-select.ts). Keyed by the bridge's URL slug, which never changes.
 *
 * Only names we are sure of: an alias is shown on the page ("Ook bekend als"), offered in the
 * search box and used to recognise meldingen that name the bridge. A bridge listed here is also
 * always indexable (web/scripts/lib/bridge-pages.mjs reads the same JSON).
 */
import data from './bridge-aliases.json';

export interface BridgeExtra {
  /** Other names for the bridge, as people write them. */
  aliases?: readonly string[];
  /** Radius around the bridge point in km for a long bridge; absent: DEFAULT_BRIDGE_RADIUS_KM. */
  radiusKm?: number;
}

export const BRIDGE_EXTRAS: Readonly<Record<string, BridgeExtra>> = data.bridges;

/** Radius around the bridge point within which a melding on its road counts. */
export const DEFAULT_BRIDGE_RADIUS_KM: number = data.defaultRadiusKm;
