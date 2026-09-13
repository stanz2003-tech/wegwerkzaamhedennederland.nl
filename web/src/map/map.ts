/**
 * The main map: basemap (with fallbacks), overlay sources/layers, hover + click + selection via
 * feature-state, camera helpers with panel-aware padding. WebGL2 failure → static fallback.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/map.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {
  Map as MlMap,
  NavigationControl,
  setWorkerUrl,
  type ErrorEvent,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type PaddingOptions,
} from 'maplibre-gl';
import type { BBox } from '../data/filter';
import { bboxOf, padBbox } from '../data/filter';
import type { ItemFeature } from '../data/types';
import { attributionOptions, keepAttributionCompact } from './attribution';
import { isPdokTileFailure, loadBasemap, loadOpenFreeMap, renderStaticFallback, type BasemapKind, type ResolvedBasemap } from './basemap';
import { HIT_LAYERS, LAYERS, SRC_LINES, SRC_POINTS, ensureOverlay, setDetourData, setOverlayData, splitFeatures, type SplitData } from './layers';
import { unionBbox } from '../data/filter';
import { announceMap } from './ready';
import type { BasemapTheme } from './restyle';

/**
 * MapLibre 6 loads its worker from `new URL('./maplibre-gl-worker.mjs', import.meta.url)`,
 * a path that neither the dev dep-optimizer nor the production bundle emits (it 404s, and the
 * style then never finishes loading). Vite's `?worker&url` bundles the worker with its shared
 * chunk and gives us the emitted URL, which we hand to MapLibre before creating any map.
 */
setWorkerUrl(workerUrl);

export const NL_CENTER: [number, number] = [5.29, 52.13];
export const NL_ZOOM = 7.2;
export const NL_BOUNDS: BBox = [3.2, 50.5, 7.3, 53.7];
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-2, 48.5],
  [12.5, 55.5],
];
const TILE_FAILURES_BEFORE_FALLBACK = 3;
const FLY_MS = 600;

export interface AppMapCallbacks {
  onSelect(id: string | null): void;
  onHover(id: string | null): void;
  onMoveEnd(): void;
  onBasemap?(kind: BasemapKind): void;
}

export interface AppMapInit {
  container: HTMLElement;
  theme: BasemapTheme;
  center: [number, number];
  zoom: number;
  attribution: string;
  reducedMotion: boolean;
  callbacks: AppMapCallbacks;
}

interface FeatureRef {
  source: string;
  id: string;
}

export class AppMap {
  readonly map: MlMap;
  private resolved: ResolvedBasemap;
  private data: SplitData;
  private sourceOf = new Map<string, string>();
  private selectedRef: FeatureRef | null = null;
  private hoverRef: FeatureRef | null = null;
  private tileFailures = 0;
  private switchingBasemap = false;
  private readonly callbacks: AppMapCallbacks;
  private readonly reducedMotion: boolean;
  private padding: PaddingOptions = { top: 24, right: 24, bottom: 24, left: 24 };

  private constructor(map: MlMap, resolved: ResolvedBasemap, init: AppMapInit) {
    this.map = map;
    this.resolved = resolved;
    this.data = splitFeatures([]);
    this.callbacks = init.callbacks;
    this.reducedMotion = init.reducedMotion;
    this.wire();
  }

  /**
   * Creates the map. Returns null when WebGL2 is unavailable; the container then shows a static
   * fallback with a message.
   */
  static async create(init: AppMapInit): Promise<AppMap | null> {
    const resolved = await loadBasemap(init.theme);
    let map: MlMap;
    try {
      map = new MlMap({
        container: init.container,
        style: resolved.style,
        center: init.center,
        zoom: init.zoom,
        minZoom: 6,
        maxZoom: 17.5,
        maxBounds: MAX_BOUNDS,
        // Compact + collapsed on every viewport; see map/attribution.ts.
        attributionControl: attributionOptions(init.attribution),
        maplibreLogo: false,
        fadeDuration: init.reducedMotion ? 0 : 300,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        validateStyle: false,
      });
    } catch {
      renderStaticFallback(
        init.container,
        { center: init.center, zoom: init.zoom },
        'Deze browser ondersteunt geen WebGL2, dat nodig is voor de interactieve kaart. Je ziet een statische kaart; de lijst hiernaast werkt gewoon.',
        '<a href="/afsluitingen/">Actuele afsluitingen</a> · <a href="/files/">Files</a> · <a href="/wegen/">Per weg</a>',
      );
      return null;
    }
    map.touchZoomRotate.disableRotation();
    keepAttributionCompact(map);
    map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), 'bottom-right');
    map.getCanvas().setAttribute('aria-label', 'Kaart van Nederland met wegwerkzaamheden, afsluitingen en files');
    const app = new AppMap(map, resolved, init);
    init.callbacks.onBasemap?.(resolved.kind);
    announceMap(init.container, map);
    await app.ready();
    return app;
  }

  get basemapKind(): BasemapKind {
    return this.resolved.kind;
  }

  private ready(): Promise<void> {
    if (this.map.isStyleLoaded()) return Promise.resolve();
    return new Promise((resolve) => {
      this.map.once('style.load', () => resolve());
    });
  }

  /* ---------------------------------- wiring ---------------------------------- */

  private wire(): void {
    const map = this.map;
    map.on('style.load', () => this.installOverlay());
    // A diffed setStyle drops our layers without firing `style.load` again; `ensureOverlay` is
    // idempotent, so re-asserting on every style change keeps the overlay alive either way.
    map.on('styledata', () => this.installOverlay());
    map.on('error', (e) => this.handleError(e));
    map.on('moveend', () => this.callbacks.onMoveEnd());
    map.on('mousemove', (e) => this.handleMove(e));
    map.on('mouseout', () => this.setHover(null, true));
    map.on('click', (e) => void this.handleClick(e));
    map.on('touchend', () => this.setHover(null, true));
  }

  private detour: [number, number][] | null = null;

  private installOverlay(): void {
    ensureOverlay(this.map, this.data, {
      theme: this.resolved.theme,
      labelFont: this.resolved.labelFont,
      beforeId: this.resolved.beforeId,
      cluster: true,
    });
    setOverlayData(this.map, this.data);
    setDetourData(this.map, this.detour);
    this.applySelected();
  }

  /** Draws the detour of the open detail as a dashed line (null removes it). */
  setDetour(coords: readonly [number, number][] | null): void {
    this.detour = coords ? coords.map((c) => [c[0], c[1]]) : null;
    setDetourData(this.map, this.detour);
  }

  /** Fits the camera to the union of the features' bounds (no-op for an empty list). */
  fitToFeatures(features: readonly ItemFeature[], maxZoom = 12): void {
    const boxes: BBox[] = [];
    for (const f of features) {
      const bb = bboxOf(f.geometry);
      if (bb) boxes.push(bb);
    }
    const union = unionBbox(boxes);
    if (union) this.fitBBox(union, maxZoom);
  }

  private handleError(e: ErrorEvent): void {
    if (this.resolved.kind !== 'pdok' && this.resolved.kind !== 'pdok-local') return;
    if (!isPdokTileFailure(e.error)) return;
    this.tileFailures += 1;
    if (this.tileFailures >= TILE_FAILURES_BEFORE_FALLBACK && !this.switchingBasemap) {
      this.switchingBasemap = true;
      void loadOpenFreeMap(this.resolved.theme)
        .then((resolved) => this.applyBasemap(resolved))
        .catch(() => undefined)
        .finally(() => {
          this.switchingBasemap = false;
        });
    }
  }

  private applyBasemap(resolved: ResolvedBasemap): void {
    this.resolved = resolved;
    // `diff: false`: another basemap means other sources, sprite and glyphs, and only a full
    // reload reliably fires `style.load` again so the overlay is reinstalled.
    this.map.setStyle(resolved.style, { diff: false });
    this.callbacks.onBasemap?.(resolved.kind);
  }

  async setTheme(theme: BasemapTheme): Promise<void> {
    if (theme === this.resolved.theme) return;
    const resolved = await loadBasemap(theme, { avoidPdok: this.resolved.kind === 'openfreemap' });
    this.applyBasemap(resolved);
  }

  /* ----------------------------------- data ----------------------------------- */

  setItems(items: readonly ItemFeature[]): void {
    this.data = splitFeatures(items);
    this.sourceOf = new Map(items.map((f) => [f.properties.id, f.geometry.type === 'Point' ? SRC_POINTS : SRC_LINES]));
    setOverlayData(this.map, this.data);
    this.applySelected();
  }

  private refOf(id: string): FeatureRef | null {
    const source = this.sourceOf.get(id);
    return source ? { source, id } : null;
  }

  private setState(ref: FeatureRef | null, key: 'hover' | 'selected', on: boolean): void {
    if (!ref || !this.map.getSource(ref.source)) return;
    this.map.setFeatureState({ source: ref.source, id: ref.id }, { [key]: on });
  }

  private applySelected(): void {
    if (this.selectedRef) this.setState(this.selectedRef, 'selected', true);
  }

  setSelected(id: string | null): void {
    if (this.selectedRef) this.setState(this.selectedRef, 'selected', false);
    this.selectedRef = id ? this.refOf(id) : null;
    this.applySelected();
  }

  setHover(id: string | null, fromMap = false): void {
    const next = id ? this.refOf(id) : null;
    if (this.hoverRef?.id === next?.id) return;
    if (this.hoverRef) this.setState(this.hoverRef, 'hover', false);
    this.hoverRef = next;
    if (this.hoverRef) this.setState(this.hoverRef, 'hover', true);
    this.map.getCanvas().style.cursor = next && fromMap ? 'pointer' : '';
  }

  /* -------------------------------- interaction -------------------------------- */

  private featuresAt(e: MapMouseEvent): MapGeoJSONFeature[] {
    const present = HIT_LAYERS.filter((id) => this.map.getLayer(id));
    if (present.length === 0) return [];
    return this.map.queryRenderedFeatures(e.point, { layers: present });
  }

  private handleMove(e: MapMouseEvent): void {
    const features = this.featuresAt(e);
    const first = features[0];
    if (!first) {
      this.setHover(null, true);
      return;
    }
    if (first.layer.id === LAYERS.clusters) {
      this.setHover(null, true);
      this.map.getCanvas().style.cursor = 'pointer';
      return;
    }
    const id = typeof first.properties?.id === 'string' ? first.properties.id : null;
    this.setHover(id, true);
    if (id) this.callbacks.onHover(id);
  }

  private async handleClick(e: MapMouseEvent): Promise<void> {
    const features = this.featuresAt(e);
    const first = features[0];
    if (!first) {
      this.callbacks.onSelect(null);
      return;
    }
    if (first.layer.id === LAYERS.clusters) {
      const clusterId = first.properties?.cluster_id;
      const source = this.map.getSource<GeoJSONSource>(SRC_POINTS);
      if (typeof clusterId === 'number' && source && first.geometry.type === 'Point') {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        const [lon, lat] = first.geometry.coordinates;
        this.map.easeTo({ center: [lon ?? 0, lat ?? 0], zoom: Math.min(zoom + 0.2, 16), duration: this.duration(FLY_MS) });
      }
      return;
    }
    const id = typeof first.properties?.id === 'string' ? first.properties.id : null;
    if (id) this.callbacks.onSelect(id);
  }

  /* ---------------------------------- camera ---------------------------------- */

  setPadding(padding: PaddingOptions): void {
    this.padding = padding;
  }

  private duration(ms: number): number {
    return this.reducedMotion ? 0 : ms;
  }

  fitToFeature(f: ItemFeature, maxZoom = 14.5): void {
    const bb = bboxOf(f.geometry);
    if (!bb) return;
    this.fitBBox(bb, maxZoom);
  }

  fitBBox(bb: BBox, maxZoom = 14.5): void {
    const [w, s, e, n] = padBbox(bb, 0.004);
    this.map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: this.padding, maxZoom, duration: this.duration(FLY_MS) },
    );
  }

  flyTo(center: [number, number], zoom: number): void {
    this.map.flyTo({ center, zoom, padding: this.padding, duration: this.duration(FLY_MS) });
  }

  /** Visible bounds as [w, s, e, n]. */
  getBBox(): BBox {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  getCenter(): [number, number] {
    const c = this.map.getCenter();
    return [c.lng, c.lat];
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  resize(): void {
    this.map.resize();
  }
}
