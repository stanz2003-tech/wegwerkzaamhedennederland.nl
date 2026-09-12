/**
 * Basemap resolution with fallbacks:
 *   1. PDOK BRT Achtergrondkaart style fetched at runtime, re-painted (restyle.ts)
 *   2. local copy of the same style (public/styles/*.json), re-painted
 *   3. OpenFreeMap positron (used when PDOK tiles fail with 5xx at runtime as well)
 *   4. raster WMTS "grijs" style (only used when everything vector fails)
 * Plus a static tile mosaic for browsers without WebGL2 (MapLibre cannot start there).
 */
import type { StyleSpecification } from 'maplibre-gl';
import { boldLabelFont, isStyleSpecification, overlayInsertionPoint, repaintPdokStyle, type BasemapTheme } from './restyle';

export type BasemapKind = 'pdok' | 'pdok-local' | 'openfreemap' | 'raster';

export interface ResolvedBasemap {
  style: StyleSpecification;
  kind: BasemapKind;
  theme: BasemapTheme;
  /** Font stack for our own labels (cluster counts) that the style's glyph server can serve. */
  labelFont: string[];
  /** Layer id our overlays are inserted before (labels stay on top). */
  beforeId: string | undefined;
}

const PDOK_BASE = 'https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1';
export const PDOK_STYLE_URL: Record<BasemapTheme, string> = {
  light: `${PDOK_BASE}/styles/standaard__webmercatorquad?f=mapbox`,
  dark: `${PDOK_BASE}/styles/darkmode__webmercatorquad?f=mapbox`,
};
export const PDOK_GLYPHS = `${PDOK_BASE}/resources/fonts/{fontstack}/{range}.pbf`;
export const LOCAL_STYLE_URL: Record<BasemapTheme, string> = {
  light: '/styles/pdok-standaard.json',
  dark: '/styles/pdok-dark.json',
};
export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const OPENFREEMAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
export const RASTER_TILE_URL = 'https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png';

const STYLE_TIMEOUT_MS = 6000;

async function fetchStyle(url: string, timeoutMs = STYLE_TIMEOUT_MS): Promise<StyleSpecification> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`style ${res.status}`);
    const json: unknown = await res.json();
    if (!isStyleSpecification(json)) throw new Error('style: onverwachte structuur');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function resolvePdok(style: StyleSpecification, theme: BasemapTheme, kind: 'pdok' | 'pdok-local'): ResolvedBasemap {
  const painted = repaintPdokStyle(style, theme);
  return { style: painted, kind, theme, labelFont: ['Liberation Sans Bold'], beforeId: overlayInsertionPoint(painted) };
}

/** OpenFreeMap positron, lightly toned so it does not fight our overlays; attribution added. */
export async function loadOpenFreeMap(theme: BasemapTheme): Promise<ResolvedBasemap> {
  const style = await fetchStyle(OPENFREEMAP_STYLE_URL);
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, src]) => [
      id,
      src.type === 'vector' || src.type === 'raster' ? { ...src, attribution: OPENFREEMAP_ATTRIBUTION } : src,
    ]),
  );
  const toned: StyleSpecification = { ...style, sources };
  return { style: toned, kind: 'openfreemap', theme, labelFont: boldLabelFont(toned), beforeId: overlayInsertionPoint(toned) };
}

/** Raster WMTS "grijs" as a last-resort vector-free style. */
export function rasterStyle(theme: BasemapTheme): ResolvedBasemap {
  const style: StyleSpecification = {
    version: 8,
    glyphs: PDOK_GLYPHS,
    sources: {
      'brt-grijs': {
        type: 'raster',
        tiles: [RASTER_TILE_URL],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: '© Kadaster, BRT Achtergrondkaart (CC BY 4.0)',
      },
    },
    layers: [
      { id: 'ww-background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#1B1E24' : '#F4F1EA' } },
      {
        id: 'brt-grijs',
        type: 'raster',
        source: 'brt-grijs',
        paint: theme === 'dark' ? { 'raster-brightness-max': 0.35, 'raster-saturation': -1 } : { 'raster-opacity': 0.9 },
      },
    ],
  };
  return { style, kind: 'raster', theme, labelFont: ['Liberation Sans Bold'], beforeId: undefined };
}

export interface LoadBasemapOptions {
  /** Skip the network PDOK style (used after PDOK tiles started failing). */
  avoidPdok?: boolean;
}

/** Resolves the best available basemap for the theme; never rejects. */
export async function loadBasemap(theme: BasemapTheme, opts: LoadBasemapOptions = {}): Promise<ResolvedBasemap> {
  if (!opts.avoidPdok) {
    try {
      return resolvePdok(await fetchStyle(PDOK_STYLE_URL[theme]), theme, 'pdok');
    } catch {
      // fall through
    }
    try {
      return resolvePdok(await fetchStyle(LOCAL_STYLE_URL[theme]), theme, 'pdok-local');
    } catch {
      // fall through
    }
  }
  try {
    return await loadOpenFreeMap(theme);
  } catch {
    return rasterStyle(theme);
  }
}

/* --------------------------- runtime tile failure --------------------------- */

interface ErrorLike {
  message?: string;
  status?: number;
  url?: string;
}

/** True for a PDOK vector-tile request that failed server-side (5xx) or at network level. */
export function isPdokTileFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as ErrorLike;
  const url = typeof e.url === 'string' ? e.url : '';
  if (!url.includes('api.pdok.nl') || !url.includes('/tiles/')) return false;
  if (typeof e.status === 'number') return e.status >= 500;
  return /failed to fetch|networkerror|load failed/i.test(e.message ?? '');
}

/* ------------------------------ no-WebGL fallback ------------------------------ */

const TILE_PX = 256;

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

/**
 * Renders a static mosaic of WMTS tiles with a message, for browsers without WebGL2.
 * `message` is plain text; `linkHtml` is trusted markup (our own links).
 */
export function renderStaticFallback(
  container: HTMLElement,
  view: { center: [number, number]; zoom: number },
  message: string,
  linkHtml = '',
): void {
  const z = Math.max(0, Math.min(19, Math.round(view.zoom)));
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;
  const cx = lonToTileX(view.center[0], z);
  const cy = latToTileY(view.center[1], z);
  const cols = Math.ceil(width / TILE_PX) + 2;
  const rows = Math.ceil(height / TILE_PX) + 2;
  const x0 = Math.floor(cx) - Math.floor(cols / 2);
  const y0 = Math.floor(cy) - Math.floor(rows / 2);
  const offsetX = width / 2 - (cx - x0) * TILE_PX;
  const offsetY = height / 2 - (cy - y0) * TILE_PX;
  const max = 2 ** z;

  const wrap = document.createElement('div');
  wrap.className = 'map-static';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Statische kaart van Nederland');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = x0 + c;
      const ty = y0 + r;
      if (ty < 0 || ty >= max) continue;
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.width = TILE_PX;
      img.height = TILE_PX;
      img.src = RASTER_TILE_URL.replace('{z}', String(z))
        .replace('{x}', String(((tx % max) + max) % max))
        .replace('{y}', String(ty));
      img.style.transform = `translate(${Math.round(offsetX + c * TILE_PX)}px, ${Math.round(offsetY + r * TILE_PX)}px)`;
      wrap.appendChild(img);
    }
  }
  const notice = document.createElement('div');
  notice.className = 'map-static__notice';
  notice.setAttribute('role', 'status');
  const text = document.createElement('p');
  text.textContent = message;
  notice.appendChild(text);
  if (linkHtml) {
    const links = document.createElement('p');
    links.innerHTML = linkHtml;
    notice.appendChild(links);
  }
  wrap.appendChild(notice);
  container.replaceChildren(wrap);
}
