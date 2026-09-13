/**
 * Category → label / colour token / icon mapping (single source of truth for the UI).
 * Colours are referenced by CSS variable name; the hex values below mirror tokens.css
 * and exist only for MapLibre paint expressions, which cannot read CSS variables.
 */
import type { Category } from '../data/types';
import { CATEGORIES } from '../data/types';
import { ICONS } from './icons';

export interface CategoryMeta {
  label: string;
  /** Plural / list heading form, e.g. "Werkzaamheden". */
  plural: string;
  /** CSS custom property name, e.g. "--c-werk". */
  color: string;
  /** Inline SVG markup (Lucide). */
  icon: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  werk: { label: 'Werkzaamheden', plural: 'Werkzaamheden', color: '--c-werk', icon: ICONS.construction },
  afsluiting: { label: 'Afsluiting', plural: 'Afsluitingen', color: '--c-afsluiting', icon: ICONS.octagonX },
  file: { label: 'File', plural: 'Files', color: '--c-file', icon: ICONS.carFront },
  incident: { label: 'Incident', plural: 'Incidenten', color: '--c-incident', icon: ICONS.triangleAlert },
  brug: { label: 'Brugopening', plural: 'Brugopeningen', color: '--c-brug', icon: ICONS.ship },
  evenement: { label: 'Evenement', plural: 'Evenementen', color: '--c-evenement', icon: ICONS.flag },
  overig: { label: 'Overig', plural: 'Overig', color: '--c-overig', icon: ICONS.circleDot },
};

/** Hex values identical to tokens.css (light / dark). Used for map paint only. */
export const CATEGORY_HEX: Record<'light' | 'dark', Record<Category, string>> = {
  light: {
    werk: '#f5a300',
    afsluiting: '#e0301e',
    file: '#8e0e1f',
    incident: '#c2185b',
    brug: '#0e7c86',
    evenement: '#6d4aff',
    overig: '#5b6470',
  },
  dark: {
    werk: '#ffb524',
    afsluiting: '#ff5a47',
    file: '#d8434f',
    incident: '#e94b8a',
    brug: '#2fb2be',
    evenement: '#9b85ff',
    overig: '#8b939f',
  },
};

/**
 * Verdict colours for the map (data/verdict.ts levels). Mirror the appended `--v-*` tokens in
 * tokens.css (light / dark); map paint only, the UI uses the tokens.
 */
export const VERDICT_HEX: Record<'light' | 'dark', Record<'dicht' | 'rijbaan' | 'hinder' | 'geen' | 'nvt' | 'onbekend', string>> = {
  light: { dicht: '#d8232a', rijbaan: '#e8571c', hinder: '#c98a00', geen: '#1e8e3e', nvt: '#7a8290', onbekend: '#5b6470' },
  dark: { dicht: '#ff6b62', rijbaan: '#ff8a4c', hinder: '#f2b23c', geen: '#4fbf6a', nvt: '#8b939f', onbekend: '#8b939f' },
};

/**
 * Colour of the dashed detour line drawn when a detail with `detourGeom` is open. Mirrors the
 * appended `--omleiding` token in tokens.css (light / dark); map paint only.
 */
export const DETOUR_HEX: Record<'light' | 'dark', string> = {
  light: '#1f5fbf',
  dark: '#78aaff',
};

export { CATEGORY_PRIORITY } from '../data/filter';

export const ALL_CATEGORIES: readonly Category[] = CATEGORIES;

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(cat: Category): string {
  return CATEGORY_META[cat].label;
}
