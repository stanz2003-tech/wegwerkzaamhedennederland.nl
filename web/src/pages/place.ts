/**
 * Entry script for /plaats/<slug>/ and /gemeente/<slug>/ (template `web/templates/place.html`).
 * Loads the province shard of the index (index/prov/<PVxx>.json, falling back to index/all.json),
 * filters on the woonplaats or gemeente name and fills the counts, summary, list and small map.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/entity-list.css';
import '../styles/pages.css';

import { mapFeatures, parseCoord, splitForEntity } from '../data/entity';
import { itemsInGemeente, itemsInWoonplaats, loadIndexAll, loadIndexProv, rowsToItems, type IndexItem } from '../data/index';
import { loadLive } from '../data/load';
import type { IndexFile, ItemFeature } from '../data/types';
import { mountPageMap, upgradeMapGeometry } from '../ui/entity-map-mount';
import { renderEntityList, renderEntityNotice, renderEntitySkeleton, summaryText } from '../ui/entity-list';
import { formatCount } from '../ui/format';
import { bodyAttr, bootPage, setEmptyVisible, setText, stampUpdated } from '../ui/page-boot';

const DATA_NOTICE = 'De actuele meldingen konden niet worden geladen. Probeer het later nog eens of bekijk de kaart.';

const ZOOM_WOONPLAATS = 12;
const ZOOM_GEMEENTE = 11;

const kind = bodyAttr('placeKind') === 'gemeente' ? 'gemeente' : 'woonplaats';
const name = bodyAttr('placeName');
const provCode = bodyAttr('provCode');

const listEl = document.getElementById('entity-list');
if (listEl) renderEntitySkeleton(listEl, 4);

const boot = bootPage();

/** Province shard first; the full index is the fallback when the shard is missing. */
async function loadRows(): Promise<IndexFile> {
  if (!provCode || provCode === '_') return loadIndexAll();
  try {
    return await loadIndexProv(provCode);
  } catch (err) {
    console.warn('[wegwerk] provinciebestand niet geladen, val terug op de volledige index:', err instanceof Error ? err.message : String(err));
    return loadIndexAll();
  }
}

function filterForPlace(all: readonly IndexItem[], placeName: string): IndexItem[] {
  return kind === 'gemeente' ? itemsInGemeente(all, placeName) : itemsInWoonplaats(all, placeName);
}

async function main(): Promise<void> {
  stampUpdated(await boot.meta);

  if (!name) {
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    return;
  }

  const [indexRes, liveRes] = await Promise.allSettled([loadRows(), loadLive()]);
  if (indexRes.status === 'rejected') {
    console.warn('[wegwerk] index niet geladen:', indexRes.reason);
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    setText('entity-summary', 'Actuele meldingen zijn nu niet beschikbaar');
    return;
  }

  const matched = filterForPlace(rowsToItems(indexRes.value.rows), name);
  const { active, upcoming } = splitForEntity(matched, Date.now());

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
  const lon = parseCoord(bodyAttr('lon'), 3.2, 7.3);
  const lat = parseCoord(bodyAttr('lat'), 50.5, 53.7);
  const zoom = kind === 'gemeente' ? ZOOM_GEMEENTE : ZOOM_WOONPLAATS;
  const view = lon !== null && lat !== null ? { center: [lon, lat] as [number, number], zoom } : {};
  const shown = [...active, ...upcoming];
  const map = await mountPageMap(mapFeatures(shown, liveFeatures), view);
  // The index only knows a point per measure; the real line geometry arrives afterwards.
  void upgradeMapGeometry(map, shown, { geometry: liveFeatures });
}

void main();
