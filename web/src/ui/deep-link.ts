/**
 * A link to one melding — `/?id=…`, or `/#id=…` from a road, place or list page — opens that
 * melding whatever the map holds at that moment. The map starts with werk-actueel + live; a
 * planned melding is only in werk-gepland, which the map loads lazily. So: look among everything
 * loaded; when the melding is not there and werk-gepland is not in yet, load it (or wait for the
 * load already in flight) and look again. Only a melding that is in none of the files is gone: it
 * ended, or it was a bridge opening that is over (those live in live.geojson only while the
 * bridge is open). main.ts acts on the result; this module only decides.
 */
import type { ItemFeature } from '../data/types';

/** The part of the map page's data (ui/map-data.ts) a deep link needs. */
export interface DeepLinkData {
  /** The melding among everything loaded: live, werk-actueel and, once in, werk-gepland. */
  find(id: string): ItemFeature | undefined;
  geplandLoaded(): boolean;
  /** Loads werk-gepland, or returns the load already in flight. */
  ensureGepland(): Promise<void>;
}

export type DeepLinkResult =
  | { kind: 'found'; feature: ItemFeature }
  /** In none of the files: the melding ended, or the bridge opening is over. */
  | { kind: 'gone' }
  /** Not in what we have, and werk-gepland could not be loaded: we cannot tell. */
  | { kind: 'unknown' };

export async function lookupDeepLink(id: string, data: DeepLinkData): Promise<DeepLinkResult> {
  const loaded = data.find(id);
  if (loaded) return { kind: 'found', feature: loaded };
  if (!data.geplandLoaded()) {
    try {
      await data.ensureGepland();
    } catch {
      // The loader reports its own failure (a toast); the answer below is then 'unknown'.
    }
  }
  const planned = data.find(id);
  if (planned) return { kind: 'found', feature: planned };
  return data.geplandLoaded() ? { kind: 'gone' } : { kind: 'unknown' };
}
