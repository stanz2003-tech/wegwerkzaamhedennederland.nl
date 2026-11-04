/**
 * "Kan ik over de Merwedebrug?" — the answer, the 14-day strip, the list and the small map of a
 * bridge in a road, with the same building blocks as a road page (pages/entity-page.ts).
 *
 * The items are those of the road's file (`roads/<slug>.json`) plus the meldingen without a road
 * number of the bridge's gemeente (`gemeenten/<slug>.json`), narrowed to what touches the bridge
 * by data/bridge-select.ts. Without the road file it falls back to the index points of that road
 * (+ live.geojson for real lines), as the road page does. The verdicts and the answer come from
 * the unchanged answer code: only the selection is the bridge's own.
 */
import { bridgeProfile, bridgeSubject, bridgeWithArticle, selectBridgeItems, type BridgeProfile } from '../data/bridge-select';
import { haversineKm } from '../data/filter';
import { matchesRoad, parseCoord } from '../data/entity';
import { loadIndexAll, rowsToItems } from '../data/index';
import { loadLive } from '../data/load';
import type { Meta, RoadType } from '../data/types';
import { slugify } from '../data/types';
import { readUrlState } from '../data/url-state';
import { renderEntityNotice, renderEntitySkeleton } from '../ui/entity-list';
import { bodyAttr, dataAsOfLabel, showListNotice, startEntityList } from '../ui/page-boot';
import { loadEntitySource, runEntityPage, sourceFromIndex, type EntitySource } from './entity-page';

const DATA_NOTICE = 'De actuele meldingen konden niet worden geladen. Probeer het later nog eens of bekijk de kaart.';
const BRIDGE_MAP_ZOOM = 13;
/** Index rows without a road number further away than this cannot name the bridge (bridge-select.ts). */
const FALLBACK_NO_ROAD_KM = 6;

const listEl = document.getElementById('entity-list');
if (bodyAttr('road') !== undefined) startEntityList(listEl, (el) => renderEntitySkeleton(el, 4));

function roadTypeOf(v: string | undefined): RoadType | null {
  return v === 'A' || v === 'N' || v === 'S' || v === 'E' || v === 'lokaal' ? v : null;
}

/** Without the road's file: the index rows of the road, and the rows without a road near the bridge. */
async function fallbackSource(profile: BridgeProfile): Promise<EntitySource | null> {
  const [indexRes, liveRes] = await Promise.allSettled([loadIndexAll(), loadLive()]);
  if (indexRes.status === 'rejected') {
    console.warn('[wegwerk] index niet geladen:', indexRes.reason);
    return null;
  }
  const road = profile.road ?? '';
  const rows = rowsToItems(indexRes.value.rows).filter((it) =>
    it.road ? matchesRoad(it.road, road) : haversineKm(profile.point, [it.lon, it.lat]) <= FALLBACK_NO_ROAD_KM,
  );
  return sourceFromIndex(rows, liveRes.status === 'fulfilled' ? liveRes.value : []);
}

/** Runs the road-bridge page; resolves once the answer and the list are drawn. */
export async function runRoadBridge(meta: Meta | null): Promise<void> {
  const forecastEl = document.getElementById('entity-forecast');
  const road = bodyAttr('road');
  const slug = bodyAttr('bridgeSlug');
  const name = bodyAttr('bridgeName');
  const lon = parseCoord(bodyAttr('lon'), 3.2, 7.3);
  const lat = parseCoord(bodyAttr('lat'), 50.5, 53.7);
  if (!road || !slug || !name || lon === null || lat === null) {
    showListNotice(listEl, DATA_NOTICE, renderEntityNotice);
    return;
  }
  const profile = bridgeProfile({ slug, name, road, lon, lat });
  const gemeenteSlug = bodyAttr('gemeenteSlug');
  const [roadSource, gemeenteSource] = await Promise.all([
    loadEntitySource('road', bodyAttr('roadSlug') ?? slugify(road)),
    // Only what has no road number: the road's own meldingen come from its file.
    gemeenteSlug ? loadEntitySource('gemeente', gemeenteSlug, (it) => !it.f.properties.road) : Promise.resolve(null),
  ]);
  const base = roadSource ?? (await fallbackSource(profile));
  if (!base) {
    showListNotice(listEl, DATA_NOTICE, renderEntityNotice);
    return;
  }
  const source: EntitySource = {
    items: selectBridgeItems([...base.items, ...(gemeenteSource?.items ?? [])], profile),
    fromEntityFile: base.fromEntityFile,
  };
  const dataAsOf = dataAsOfLabel(meta);
  await runEntityPage({
    subject: bridgeSubject(profile),
    roadType: roadTypeOf(bodyAttr('roadType')),
    bridge: bridgeWithArticle(name),
    url: readUrlState(),
    source,
    view: { center: profile.point, zoom: BRIDGE_MAP_ZOOM },
    listEl,
    forecastEl,
    ...(dataAsOf ? { dataAsOf } : {}),
  });
}
