/**
 * The entity-page manifest (`/entity-pages.json`, written by scripts/gen-pages.mjs from the same
 * lists the pages come from): which /weg/, /plaats/ and /gemeente/ pages exist. The map uses it
 * to resolve `?plaats=<slug>` back to a name and to link to a page only when that page exists.
 *
 * It is a deploy artifact of the site, not of the data host, so it is fetched from the site
 * origin, never from `dataBase()`. When it cannot be loaded every lookup answers "no page": links
 * are then hidden, never broken.
 */
import { normalizeText } from './filter';

export const ENTITY_PAGES_URL = '/entity-pages.json';

export interface WoonplaatsPage {
  slug: string;
  name: string;
  gemeente: string | null;
}

export interface GemeentePage {
  slug: string;
  name: string;
}

export interface EntityPages {
  hasRoadPage(slug: string): boolean;
  /**
   * The page of a woonplaats by name. About 70 names occur in more than one gemeente ("Alteveer"
   * three times); those need the gemeente (from the PDOK weergavenaam "Almkerk, Altena,
   * Noord-Brabant", or the item's own gemeente) and stay unresolved without it.
   */
  findWoonplaats(name: string, gemeente?: string | null): WoonplaatsPage | null;
  findGemeente(name: string): GemeentePage | null;
  woonplaatsBySlug(slug: string): WoonplaatsPage | null;
  gemeenteBySlug(slug: string): GemeentePage | null;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function woonplaatsOf(v: unknown): WoonplaatsPage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.slug) || !isStr(o.name)) return null;
  return { slug: o.slug, name: o.name, gemeente: isStr(o.gemeente) ? o.gemeente : null };
}

function gemeenteOf(v: unknown): GemeentePage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return isStr(o.slug) && isStr(o.name) ? { slug: o.slug, name: o.name } : null;
}

function group<T>(list: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of list) {
    const k = key(t);
    const bucket = out.get(k);
    if (bucket) bucket.push(t);
    else out.set(k, [t]);
  }
  return out;
}

/** Validates the manifest and indexes it; null when it does not have the expected shape. */
export function entityPagesFrom(json: unknown): EntityPages | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.roads) || !Array.isArray(o.woonplaatsen) || !Array.isArray(o.gemeenten)) return null;
  const roads = new Set(o.roads.filter(isStr));
  const woonplaatsen = o.woonplaatsen.map(woonplaatsOf).filter((w): w is WoonplaatsPage => w !== null);
  const gemeenten = o.gemeenten.map(gemeenteOf).filter((g): g is GemeentePage => g !== null);
  const wpByName = group(woonplaatsen, (w) => normalizeText(w.name));
  const gmByName = new Map(gemeenten.map((g) => [normalizeText(g.name), g]));
  const wpBySlug = new Map(woonplaatsen.map((w) => [w.slug, w]));
  const gmBySlug = new Map(gemeenten.map((g) => [g.slug, g]));
  return {
    hasRoadPage: (slug) => roads.has(slug),
    findWoonplaats(name, gemeente) {
      const candidates = wpByName.get(normalizeText(name)) ?? [];
      if (candidates.length === 1) return candidates[0] ?? null;
      if (!gemeente) return null;
      const g = normalizeText(gemeente);
      const inGemeente = candidates.filter((w) => w.gemeente !== null && normalizeText(w.gemeente) === g);
      return inGemeente.length === 1 ? (inGemeente[0] ?? null) : null;
    },
    findGemeente: (name) => gmByName.get(normalizeText(name)) ?? null,
    woonplaatsBySlug: (slug) => wpBySlug.get(slug) ?? null,
    gemeenteBySlug: (slug) => gmBySlug.get(slug) ?? null,
  };
}

let cached: Promise<EntityPages | null> | null = null;
let loaded: EntityPages | null = null;

/**
 * Loads the manifest once per page view. A failure resolves to null (and is retried on the next
 * call), so a missing file only hides the links.
 */
export function loadEntityPages(fetchImpl: typeof fetch = fetch): Promise<EntityPages | null> {
  if (cached) return cached;
  cached = fetchImpl(ENTITY_PAGES_URL, { credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${ENTITY_PAGES_URL} ${res.status}`);
      const pages = entityPagesFrom(await res.json());
      if (!pages) throw new Error(`${ENTITY_PAGES_URL} heeft niet de verwachte vorm`);
      loaded = pages;
      return pages;
    })
    .catch((err: unknown) => {
      console.warn('[wegwerk] paginaoverzicht niet geladen:', err instanceof Error ? err.message : String(err));
      cached = null;
      return null;
    });
  return cached;
}

/** The manifest when it has already arrived (for synchronous renders such as the detail view). */
export function entityPagesNow(): EntityPages | null {
  return loaded;
}
