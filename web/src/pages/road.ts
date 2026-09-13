/**
 * Entry script for /weg/<slug>/ (template `web/templates/road.html`).
 *
 * Loads `roads/<slug>.json` (contract v3: every item of the road with geometry and full detail,
 * incl. recurring `periods`) and answers "kan ik op <datum> over de A2?" with the forecast block
 * under the hero. When that file is absent (v2 data, or a road without items) it falls back to
 * index/all.json filtered on the road number + live.geojson for the real geometry of files.
 * Without JavaScript the pre-rendered page stays as it is.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/entity-list.css';
import '../styles/pages.css';

import { bboxOf, unionBbox, type BBox } from '../data/filter';
import { itemsOnRoadLoose, parseBbox, parseCoord } from '../data/entity';
import { slugFromPath } from '../data/entity-file';
import { loadIndexAll, rowsToItems } from '../data/index';
import { loadLive } from '../data/load';
import type { RoadType } from '../data/types';
import { slugify } from '../data/types';
import { readUrlState } from '../data/url-state';
import { renderEntityNotice, renderEntitySkeleton } from '../ui/entity-list';
import { bodyAttr, bootPage, setText, stampUpdated } from '../ui/page-boot';
import { loadEntitySource, runEntityPage, sourceFromIndex, type EntitySource } from './entity-page';

const DATA_NOTICE = 'De actuele meldingen konden niet worden geladen. Probeer het later nog eens of bekijk de kaart.';

const road = bodyAttr('road');
const roadTypeAttr = bodyAttr('roadType');
const roadType: RoadType | null = roadTypeAttr === 'A' || roadTypeAttr === 'N' || roadTypeAttr === 'S' || roadTypeAttr === 'E' || roadTypeAttr === 'lokaal' ? roadTypeAttr : null;
const listEl = document.getElementById('entity-list');
const forecastEl = document.getElementById('entity-forecast');
if (listEl) renderEntitySkeleton(listEl, 4);

const boot = bootPage();

function mapView(bbox: BBox | null, lon: number | null, lat: number | null): { bbox?: BBox; center?: [number, number]; zoom?: number } {
  if (bbox) return { bbox };
  if (lon !== null && lat !== null) return { center: [lon, lat], zoom: 9 };
  return {};
}

async function fallbackSource(roadNumber: string): Promise<EntitySource | null> {
  const [indexRes, liveRes] = await Promise.allSettled([loadIndexAll(), loadLive()]);
  if (indexRes.status === 'rejected') {
    console.warn('[wegwerk] index niet geladen:', indexRes.reason);
    return null;
  }
  const rows = itemsOnRoadLoose(rowsToItems(indexRes.value.rows), roadNumber);
  return sourceFromIndex(rows, liveRes.status === 'fulfilled' ? liveRes.value : []);
}

async function main(): Promise<void> {
  stampUpdated(await boot.meta);

  if (!road) {
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    return;
  }

  const slug = slugFromPath(window.location.pathname, '/weg/') ?? slugify(road);
  const source = (await loadEntitySource('road', slug)) ?? (await fallbackSource(road));
  if (!source) {
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    setText('entity-summary', 'Actuele meldingen zijn nu niet beschikbaar');
    return;
  }

  const bbox =
    parseBbox(bodyAttr('bbox')) ??
    unionBbox(source.items.map((it) => bboxOf(it.f.geometry)).filter((b): b is BBox => b !== null));
  const lon = parseCoord(bodyAttr('lon'), 3.2, 7.3);
  const lat = parseCoord(bodyAttr('lat'), 50.5, 53.7);

  await runEntityPage({
    subject: { kind: 'road', name: road },
    roadType,
    url: readUrlState(),
    source,
    view: mapView(bbox, lon, lat),
    listEl,
    forecastEl,
  });
}

void main();
