/**
 * Entry script for /plaats/<slug>/ and /gemeente/<slug>/ (template `web/templates/place.html`).
 *
 * Loads `gemeenten/<slug>.json` (contract v3) — for a woonplaats the file of its gemeente,
 * filtered on the woonplaats name — and answers "kan ik op <datum> door Utrecht?" with the
 * forecast block. Falls back to the province shard of the index (index/prov/<PVxx>.json, then
 * index/all.json) filtered on the woonplaats or gemeente name when the file is absent.
 */
import '../styles/base.css';
import '../styles/chrome.css';
import '../styles/components.css';
import '../styles/entity-list.css';
import '../styles/pages.css';

import { parseCoord } from '../data/entity';
import { slugFromPath } from '../data/entity-file';
import { normalizeText } from '../data/filter';
import { itemsInGemeente, itemsInWoonplaats, loadIndexAll, loadIndexProv, rowsToItems, type IndexItem } from '../data/index';
import { loadLive } from '../data/load';
import type { EntityItem, IndexFile } from '../data/types';
import { slugify } from '../data/types';
import { readUrlState } from '../data/url-state';
import { renderEntityNotice, renderEntitySkeleton } from '../ui/entity-list';
import { bodyAttr, bootPage, setText, stampUpdated } from '../ui/page-boot';
import { loadEntitySource, runEntityPage, sourceFromIndex, type EntitySource } from './entity-page';

const DATA_NOTICE = 'De actuele meldingen konden niet worden geladen. Probeer het later nog eens of bekijk de kaart.';

const ZOOM_WOONPLAATS = 12;
const ZOOM_GEMEENTE = 11;

const kind = bodyAttr('placeKind') === 'gemeente' ? 'gemeente' : 'woonplaats';
const name = bodyAttr('placeName');
const gemeente = bodyAttr('gemeente') ?? (kind === 'gemeente' ? name : undefined);
const provCode = bodyAttr('provCode');

const listEl = document.getElementById('entity-list');
const forecastEl = document.getElementById('entity-forecast');
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

async function fallbackSource(placeName: string): Promise<EntitySource | null> {
  const [indexRes, liveRes] = await Promise.allSettled([loadRows(), loadLive()]);
  if (indexRes.status === 'rejected') {
    console.warn('[wegwerk] index niet geladen:', indexRes.reason);
    return null;
  }
  const rows = filterForPlace(rowsToItems(indexRes.value.rows), placeName);
  return sourceFromIndex(rows, liveRes.status === 'fulfilled' ? liveRes.value : []);
}

async function main(): Promise<void> {
  stampUpdated(await boot.meta);

  if (!name) {
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    return;
  }

  // /gemeente/<slug>/ → that file; /plaats/<slug>/ → the file of the gemeente, filtered.
  const gemeenteSlug = kind === 'gemeente' ? (slugFromPath(window.location.pathname, '/gemeente/') ?? slugify(name)) : gemeente ? slugify(gemeente) : null;
  const w = normalizeText(name);
  const filter = kind === 'woonplaats' ? (it: EntityItem): boolean => it.f.properties.woonplaats !== undefined && normalizeText(it.f.properties.woonplaats) === w : undefined;
  const source = (await loadEntitySource('gemeente', gemeenteSlug, filter)) ?? (await fallbackSource(name));
  if (!source) {
    if (listEl) renderEntityNotice(listEl, DATA_NOTICE);
    setText('entity-summary', 'Actuele meldingen zijn nu niet beschikbaar');
    return;
  }

  const lon = parseCoord(bodyAttr('lon'), 3.2, 7.3);
  const lat = parseCoord(bodyAttr('lat'), 50.5, 53.7);
  const zoom = kind === 'gemeente' ? ZOOM_GEMEENTE : ZOOM_WOONPLAATS;
  const view = lon !== null && lat !== null ? { center: [lon, lat] as [number, number], zoom } : {};

  await runEntityPage({
    subject: { kind, name },
    url: readUrlState(),
    source,
    view,
    listEl,
    forecastEl,
  });
}

void main();
