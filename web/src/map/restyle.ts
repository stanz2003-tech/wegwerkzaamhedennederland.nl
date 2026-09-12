/**
 * Re-painting the PDOK BRT Achtergrondkaart style to the "Bord" palette: warm paper land,
 * muted water, quiet roads, neutral road-number shields. Pure and generic (by layer id +
 * layer type + colour substitution), so a PDOK style update degrades gracefully.
 * No maplibre-gl import here so it can be unit-tested in Node.
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

export type BasemapTheme = 'light' | 'dark';

export interface BasemapPalette {
  land: string;
  water: string;
  forest: string;
  built: string;
  heath: string;
  sand: string;
  rock: string;
  building: string;
  roadMajor: string;
  roadMid: string;
  roadMinor: string;
  roadTunnel: string;
  cyclePath: string;
  casingMajor: string;
  casingMid: string;
  casingMinor: string;
  casingTunnel: string;
  rail: string;
  railDash: string;
  border: string;
  labelText: string;
  placeText: string;
  labelHalo: string;
  waterLabel: string;
  shieldA: string;
  shieldAText: string;
  shieldN: string;
  shieldNText: string;
}

export const PALETTE: Record<BasemapTheme, BasemapPalette> = {
  light: {
    land: '#F4F1EA',
    water: '#BFD9E8',
    forest: '#E7EBDF',
    built: '#EBE7DF',
    heath: '#ECE5E3',
    sand: '#F1EBD9',
    rock: '#DEDCD6',
    building: '#E5E0D6',
    roadMajor: '#FFFFFF',
    roadMid: '#FDFCF9',
    roadMinor: '#FAF8F3',
    roadTunnel: '#E8E5DE',
    cyclePath: '#E4E1D8',
    casingMajor: '#AEB3BB',
    casingMid: '#C8CBD0',
    casingMinor: '#DAD9D3',
    casingTunnel: '#D0CEC7',
    rail: '#B3B2AC',
    railDash: '#F4F1EA',
    border: '#A5A9B1',
    labelText: '#5C616B',
    placeText: '#2E323A',
    labelHalo: '#F4F1EA',
    waterLabel: '#6A8CA5',
    shieldA: '#6B717C',
    shieldAText: '#FFFFFF',
    shieldN: '#E2E0D8',
    shieldNText: '#1B1B1F',
  },
  dark: {
    land: '#1B1E24',
    water: '#16303F',
    forest: '#1D2321',
    built: '#212429',
    heath: '#23212A',
    sand: '#25272A',
    rock: '#2A2D33',
    building: '#262A31',
    roadMajor: '#4B5159',
    roadMid: '#3C4149',
    roadMinor: '#343941',
    roadTunnel: '#2A2E36',
    cyclePath: '#2A2E36',
    casingMajor: '#0E1013',
    casingMid: '#121418',
    casingMinor: '#15171B',
    casingTunnel: '#1B1E24',
    rail: '#4A4F58',
    railDash: '#1B1E24',
    border: '#4A4F58',
    labelText: '#B5BAC3',
    placeText: '#E6E3DC',
    labelHalo: '#1B1E24',
    waterLabel: '#7FA3BD',
    shieldA: '#5B6470',
    shieldAText: '#FFFFFF',
    shieldN: '#C2C6CD',
    shieldNText: '#1B1B1F',
  },
};

/** Layers that add visual noise (fences, pylons, tram/metro). */
export const HIDDEN_LAYER_IDS: readonly string[] = [
  'inrichtingselement lijn',
  'hoogspanningsmast inrichtingselement_punt',
  'tram',
  'metro',
  'metro / sneltram in tunnel',
  'metro / sneltram in tunnel 2',
];

/** PDOK signal colours that must never survive (they clash with our category colours). */
const PDOK_COLOUR_SUBSTITUTES: Record<BasemapTheme, Record<string, keyof BasemapPalette>> = {
  light: {
    '#f9e11e': 'roadMajor',
    '#fcef84': 'roadMid',
    '#e69800': 'casingMajor',
    '#ff7f7f': 'shieldA',
    '#ffffbe': 'shieldN',
    '#ffd700': 'roadMajor',
    '#ff9900': 'casingMajor',
    '#80bde3': 'water',
    '#90c0e4': 'water',
    '#004de3': 'waterLabel',
  },
  dark: {
    '#f9e11e': 'roadMajor',
    '#fcef84': 'roadMid',
    '#e69800': 'casingMajor',
    '#ff7f7f': 'shieldA',
    '#ffffbe': 'shieldN',
    '#ffd700': 'roadMajor',
    '#ff9900': 'casingMajor',
    '#2a5a7f': 'water',
    '#3a6a8e': 'water',
    '#4c4c4c': 'land',
    '#5a5a5a': 'building',
  },
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Replaces known PDOK colour strings anywhere inside a paint/layout value (deep, immutable). */
export function substituteColours(value: unknown, theme: BasemapTheme): unknown {
  const table = PDOK_COLOUR_SUBSTITUTES[theme];
  const palette = PALETTE[theme];
  if (typeof value === 'string') {
    const key = table[value.toLowerCase()];
    return key ? palette[key] : value;
  }
  if (Array.isArray(value)) return value.map((v) => substituteColours(v, theme));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteColours(v, theme)]));
  }
  return value;
}

const get = (prop: string): ExpressionSpecification => ['get', prop];

/** `["match", ["get","vistext"], ...pairs, fallback]`: exact `vistext` labels → value. */
function matchVistext<T extends string | number>(
  pairs: readonly (readonly [readonly string[], T])[],
  fallback: T,
): ExpressionSpecification {
  const expr: unknown[] = ['match', get('vistext')];
  for (const [labels, value] of pairs) expr.push([...labels], value);
  expr.push(fallback);
  return expr as ExpressionSpecification;
}

const MOTORWAY = ['autosnelweg', 'autosnelweg op brug', 'autosnelweg oprit/afrit', 'E-weg'];
const MAIN_ROAD = ['hoofdweg', 'hoofdweg op brug', 'hoofdweg oprit/afrit', 'regionale weg', 'regionale weg op brug', 'regionale weg oprit/afrit'];
const TUNNEL = ['autosnelweg in tunnel', 'regionale weg in tunnel', 'lokale weg in tunnel', 'hoofdweg in tunnel', 'straat in tunnel'];

function withPaint(layer: LayerSpecification, paint: Record<string, unknown>): LayerSpecification {
  const current = 'paint' in layer && isPlainObject(layer.paint) ? layer.paint : {};
  return { ...layer, paint: { ...current, ...paint } } as LayerSpecification;
}

function withLayout(layer: LayerSpecification, layout: Record<string, unknown>): LayerSpecification {
  const current = 'layout' in layer && isPlainObject(layer.layout) ? layer.layout : {};
  return { ...layer, layout: { ...current, ...layout } } as LayerSpecification;
}

function repaintFill(layer: LayerSpecification, p: BasemapPalette): LayerSpecification {
  switch (layer.id) {
    case 'Onderlegger Nederland':
      return withPaint(layer, { 'fill-color': matchVistext([[['(zee)water', 'zee', 'meer, plas'], p.water]], p.land) });
    case 'waterdeelvlak':
      return withPaint(layer, { 'fill-color': p.water });
    case 'Bodemgebruik':
      return withPaint(layer, {
        'fill-color': matchVistext(
          [
            [['bos', 'bos: dras, moeras, riet'], p.forest],
            [['bebouwd gebied'], p.built],
            [['heide', 'heide: dras, moeras, riet'], p.heath],
            [['zand', 'zand: dras, moeras, riet'], p.sand],
            [['steenglooing', 'aanlegsteiger'], p.rock],
            [['zee', 'meer, plas'], p.water],
          ],
          'transparent',
        ),
      });
    case 'Gebouw':
      return withPaint(layer, { 'fill-color': p.building, 'fill-opacity': 0.9 });
    case 'wegdeelvlak':
      return withPaint(layer, {
        'fill-color': matchVistext([[TUNNEL, p.roadTunnel], [['fietspad'], p.cyclePath]], p.roadMajor),
        'fill-outline-color': p.casingMinor,
      });
    default:
      return layer;
  }
}

function repaintLine(layer: LayerSpecification, p: BasemapPalette): LayerSpecification {
  switch (layer.id) {
    case 'wegdeellijn-contour':
      return withPaint(layer, {
        'line-color': matchVistext([[MOTORWAY, p.casingMajor], [MAIN_ROAD, p.casingMid], [TUNNEL, p.casingTunnel]], p.casingMinor),
      });
    case 'wegdeellijn':
      return withPaint(layer, {
        'line-color': matchVistext(
          [[MOTORWAY, p.roadMajor], [MAIN_ROAD, p.roadMid], [TUNNEL, p.roadTunnel], [['fietspad'], p.cyclePath]],
          p.roadMinor,
        ),
      });
    case 'registratiefgebiedlijn':
      return withPaint(layer, { 'line-color': p.border });
    case 'spoorbaandeellijn':
      return withPaint(layer, { 'line-color': p.rail, 'line-width': ['match', get('vistext'), 'tram', 0.6, 'metro / sneltram in tunnel', 2, 1.6] });
    case 'treinspoor':
      return withPaint(layer, { 'line-color': p.railDash, 'line-width': 1 });
    default:
      return layer;
  }
}

function repaintSymbol(layer: LayerSpecification, p: BasemapPalette): LayerSpecification {
  switch (layer.id) {
    case 'annotatie': {
      const painted = withPaint(layer, {
        'text-color': matchVistext([[['A-wegnummers'], p.shieldAText], [['N-wegnummers'], p.shieldNText], [['plaatsnamen'], p.placeText]], p.labelText),
        'text-halo-color': matchVistext([[['A-wegnummers'], p.shieldA], [['N-wegnummers'], p.shieldN]], p.labelHalo),
        'text-halo-width': matchVistext([[['A-wegnummers'], 6], [['N-wegnummers'], 4]], 1.2),
        'text-halo-blur': 0,
      });
      return withLayout(painted, { 'text-allow-overlap': false, 'text-ignore-placement': false });
    }
    case 'straatnamen':
      return withPaint(layer, { 'text-color': p.labelText, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 });
    case 'waterdeelvlak_label':
      return withPaint(layer, { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1 });
    default:
      return layer;
  }
}

function repaintLayer(layer: LayerSpecification, theme: BasemapTheme): LayerSpecification {
  const p = PALETTE[theme];
  if (HIDDEN_LAYER_IDS.includes(layer.id)) return withLayout(layer, { visibility: 'none' });
  let out: LayerSpecification;
  switch (layer.type) {
    case 'fill':
      out = repaintFill(layer, p);
      break;
    case 'line':
      out = repaintLine(layer, p);
      break;
    case 'symbol':
      out = repaintSymbol(layer, p);
      break;
    case 'background':
      out = withPaint(layer, { 'background-color': p.land });
      break;
    default:
      out = layer;
  }
  // Generic safety net: any PDOK signal colour left in paint/layout is neutralised.
  const paint = 'paint' in out ? (substituteColours(out.paint, theme) as Json) : undefined;
  const layout = 'layout' in out ? (substituteColours(out.layout, theme) as Json) : undefined;
  return { ...out, ...(paint !== undefined ? { paint } : {}), ...(layout !== undefined ? { layout } : {}) } as LayerSpecification;
}

/** Returns a new style object with our palette applied; the input is not mutated. */
export function repaintPdokStyle(style: StyleSpecification, theme: BasemapTheme): StyleSpecification {
  const layers = style.layers.map((l) => repaintLayer(l, theme));
  const hasBackground = layers.some((l) => l.type === 'background');
  const background: LayerSpecification[] = hasBackground
    ? []
    : [{ id: 'ww-background', type: 'background', paint: { 'background-color': PALETTE[theme].land } }];
  return { ...style, layers: [...background, ...layers] };
}

/** True when the style looks like a MapLibre style document. */
export function isStyleSpecification(v: unknown): v is StyleSpecification {
  return isPlainObject(v) && v.version === 8 && Array.isArray(v.layers) && isPlainObject(v.sources);
}

/** Id of the layer our overlays should be inserted before: `straatnamen` when present, else the first symbol layer. */
export function overlayInsertionPoint(style: StyleSpecification): string | undefined {
  if (style.layers.some((l) => l.id === 'straatnamen')) return 'straatnamen';
  return style.layers.find((l) => l.type === 'symbol')?.id;
}

/** Picks a bold font stack that the style's glyph server can serve. */
export function boldLabelFont(style: StyleSpecification): string[] {
  const fonts = new Set<string>();
  for (const l of style.layers) {
    if (l.type !== 'symbol' || !l.layout) continue;
    const tf = (l.layout as Record<string, unknown>)['text-font'];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') fonts.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
    };
    collect(tf);
  }
  const list = [...fonts].filter((f) => !['match', 'literal', 'get', 'case', 'coalesce'].includes(f) && !/^\W|\d/.test(f));
  const bold = list.find((f) => /bold/i.test(f));
  if (bold) return [bold];
  const first = list.find((f) => /sans|regular/i.test(f));
  return first ? [first] : ['Liberation Sans Bold'];
}
