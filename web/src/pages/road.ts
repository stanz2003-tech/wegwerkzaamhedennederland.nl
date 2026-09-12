/**
 * Entry script for /weg/<slug>/ (template `web/templates/road.html`).
 * Reads the road from the body data-attributes, loads index/all.json (+ live.geojson for the
 * real geometry of files and incidents), filters on the road number, and fills the counts,
 * summary, list and small map. Without JavaScript the pre-rendered page stays as it is.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/entity-list.css';
import '../styles/pages.css';

import type { BBox } from '../data/filter';
import { bboxOfItems, itemsOnRoadLoose, mapFeatures, parseBbox, parseCoord, splitForEntity } from '../data/entity';
import { loadIndexAll, rowsToItems } from '../data/index';
import { loadLive } from '../data/load';
import type { ItemFeature } from '../data/types';
import { mountPageMap, upgradeMapGeometry } from '../ui/entity-map-mount';
import { renderEntityList, renderEntityNotice, renderEntitySkeleton, summaryText } from '../ui/entity-list';
import { formatCount } from '../ui/format';
import { bodyAttr, bootPage, setEmptyVisible, setText, stampUpdated } from '../ui/page-boot';

const DATA_NOTICE = 'De actuele meldingen konden niet worden geladen. Probeer het later nog eens of bekijk de kaart.';

const road = bodyAttr('road');
const listEl = document.getElementById('entity-list');
if (listEl) renderEntitySkeleton(listEl, 4);

const boot = bootPage();

function mapView(bbox: BBox | null, lon: number | null, lat: number | null): { bbox?: BBox; center?: [number, number]; zoom?: number } {
  if (bbox) return { bbox };
  if (lon !== null && lat !== null) return { center: [lon, lat], zoom: 9 };
  return {};
}

async function main(): Promise<void> {
  stampUpdated(await boot.meta);

  if (!road) {
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    return;
  }

  const [indexRes, liveRes] = await Promise.allSettled([loadIndexAll(), loadLive()]);
  if (indexRes.status === 'rejected') {
    console.warn('[wegwerk] index niet geladen:', indexRes.reason);
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    setText('entity-summary', 'Actuele meldingen zijn nu niet beschikbaar');
    return;
  }

  const all = rowsToItems(indexRes.value.rows);
  const onRoad = itemsOnRoadLoose(all, road);
  const { active, upcoming } = splitForEntity(onRoad, Date.now());

  setText('entity-count-active', formatCount(active.length));
  setText('entity-count-upcoming', formatCount(upcoming.length));
  setText('entity-summary', summaryText(active, upcoming));
  setEmptyVisible('entity-empty', active.length === 0 && upcoming.length === 0);

  const now = Date.now();
  if (listEl) {
    renderEntityList(
      listEl,
      [
        { title: 'Nu actief', items: active },
        { title: 'Gepland (komende 30 dagen)', items: upcoming },
      ],
      now,
    );
  }

  const liveFeatures: ItemFeature[] = liveRes.status === 'fulfilled' ? liveRes.value : [];
  const shown = [...active, ...upcoming];
  const bbox = parseBbox(bodyAttr('bbox')) ?? bboxOfItems(shown);
  const lon = parseCoord(bodyAttr('lon'), 3.2, 7.3);
  const lat = parseCoord(bodyAttr('lat'), 50.5, 53.7);
  const map = await mountPageMap(mapFeatures(shown, liveFeatures), mapView(bbox, lon, lat));
  // The index only knows a point per measure; the real line geometry arrives afterwards.
  void upgradeMapGeometry(map, shown, { geometry: liveFeatures });
}

void main();
