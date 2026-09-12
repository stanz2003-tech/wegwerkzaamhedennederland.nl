/**
 * Small map for the generated entity pages (road / place / bridge): same basemap module,
 * zoom control only, cooperative gestures (no scroll hijacking), only the given items.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/map.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Map as MlMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { BBox } from '../data/filter';
import { padBbox } from '../data/filter';
import type { ItemFeature } from '../data/types';
import { onThemeChange } from '../ui/theme';
import { attributionOptions, keepAttributionCompact } from './attribution';
import { loadBasemap, renderStaticFallback, type ResolvedBasemap } from './basemap';
import { LAYERS, ensureOverlay, setOverlayData, splitFeatures } from './layers';
import { announceMap } from './ready';
import type { BasemapTheme } from './restyle';

export interface EntityView {
  bbox?: BBox | null;
  center?: [number, number];
  zoom?: number;
}

export interface EntityMapOptions {
  theme: BasemapTheme;
  attribution: string;
  reducedMotion: boolean;
  /** Called when a feature is clicked (deep link into the app). */
  onSelect?: (id: string) => void;
}

// See src/map/map.ts: MapLibre 6 cannot find its own worker in a bundler build.
setWorkerUrl(workerUrl);

const FALLBACK_CENTER: [number, number] = [5.29, 52.13];

function viewBounds(view: EntityView): { center: [number, number]; zoom: number } {
  if (view.center) return { center: view.center, zoom: view.zoom ?? 11 };
  if (view.bbox) {
    const [w, s, e, n] = view.bbox;
    return { center: [(w + e) / 2, (s + n) / 2], zoom: view.zoom ?? 9 };
  }
  return { center: FALLBACK_CENTER, zoom: 7 };
}

export interface EntityMap {
  map: MlMap;
  setItems(items: readonly ItemFeature[]): void;
  destroy(): void;
}

export async function mountEntityMap(
  container: HTMLElement,
  items: readonly ItemFeature[],
  view: EntityView,
  opts: EntityMapOptions,
): Promise<EntityMap | null> {
  let resolved: ResolvedBasemap = await loadBasemap(opts.theme);
  let data = splitFeatures(items);
  const { center, zoom } = viewBounds(view);
  let map: MlMap;
  try {
    map = new MlMap({
      container,
      style: resolved.style,
      center,
      zoom,
      minZoom: 6,
      maxZoom: 17,
      attributionControl: attributionOptions(opts.attribution),
      maplibreLogo: false,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: opts.reducedMotion ? 0 : 300,
      validateStyle: false,
    });
  } catch {
    renderStaticFallback(
      container,
      { center, zoom },
      'De interactieve kaart heeft WebGL2 nodig; deze browser ondersteunt dat niet. De lijst hieronder toont dezelfde meldingen.',
    );
    return null;
  }
  map.touchZoomRotate.disableRotation();
  keepAttributionCompact(map);
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.getCanvas().setAttribute('aria-label', 'Kaart met de meldingen op deze pagina');

  const install = (): void => {
    ensureOverlay(map, data, { theme: resolved.theme, labelFont: resolved.labelFont, beforeId: resolved.beforeId, cluster: false });
    setOverlayData(map, data);
  };
  map.on('style.load', install);
  // A diffed setStyle (the theme toggle) removes our layers without firing `style.load` again,
  // which left the map with a basemap and no measures. `ensureOverlay` is idempotent, so
  // re-asserting it whenever the style data changed restores it without extra bookkeeping.
  map.on('styledata', install);

  map.once('load', () => {
    if (view.bbox) {
      const [w, s, e, n] = padBbox(view.bbox, 0.01);
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 32, maxZoom: 14, duration: 0 },
      );
    }
  });

  if (opts.onSelect) {
    const onSelect = opts.onSelect;
    // No cluster layer here (entity maps are unclustered), so points before the line hit target.
    const featureAt = (point: Parameters<typeof map.queryRenderedFeatures>[0]) => {
      const layers = [LAYERS.points, LAYERS.hit].filter((id) => map.getLayer(id));
      return layers.length ? map.queryRenderedFeatures(point, { layers })[0] : undefined;
    };
    map.on('click', (e) => {
      const id = featureAt(e.point)?.properties?.id;
      if (typeof id === 'string') onSelect(id);
    });
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = featureAt(e.point) ? 'pointer' : '';
    });
  }

  const stopTheme = onThemeChange((theme) => {
    void loadBasemap(theme).then((next) => {
      resolved = next;
      // `diff: false`: a theme change is a different basemap (other sources, sprite and glyphs),
      // and a full reload is the only path that reliably fires `style.load` again.
      map.setStyle(next.style, { diff: false });
    });
  });

  announceMap(container, map);

  return {
    map,
    setItems(next) {
      data = splitFeatures(next);
      setOverlayData(map, data);
    },
    destroy() {
      stopTheme();
      map.remove();
    },
  };
}
