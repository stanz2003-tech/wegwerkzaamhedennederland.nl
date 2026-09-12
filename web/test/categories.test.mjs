/**
 * Unit tests for web/src/ui/categories.ts.
 *
 * The important one: CATEGORY_HEX exists only because MapLibre paint expressions cannot read
 * CSS custom properties, so those hex values MUST stay identical to the `--c-<cat>` tokens in
 * web/src/styles/tokens.css. This test parses that stylesheet and compares both themes,
 * including the `prefers-color-scheme: dark` fallback block.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { categories, types } from './helpers/src.mjs';

const { ALL_CATEGORIES, CATEGORY_HEX, CATEGORY_META, CATEGORY_PRIORITY, categoryLabel, isCategory } = categories;
const { CATEGORIES } = types;

const CSS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

/**
 * Reads the `--c-<cat>` declarations from one CSS block, identified by its selector text.
 * Blocks are flat (no nested braces) apart from the media query, which is handled by
 * searching from the selector onwards up to the first closing brace.
 */
function categoryTokens(selector) {
  const at = CSS.indexOf(selector);
  assert.notEqual(at, -1, `selector ${selector} not found in tokens.css`);
  const block = CSS.slice(at + selector.length, CSS.indexOf('}', at));
  const found = {};
  for (const match of block.matchAll(/--c-([a-z]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    found[match[1]] = match[2].toLowerCase();
  }
  return found;
}

describe('CATEGORY_HEX mirrors tokens.css', () => {
  it('light theme hex values equal the :root tokens', () => {
    const css = categoryTokens(':root {');
    assert.deepEqual(css, CATEGORY_HEX.light);
  });

  it('dark theme hex values equal the [data-theme="dark"] tokens', () => {
    const css = categoryTokens(':root[data-theme="dark"] {');
    assert.deepEqual(css, CATEGORY_HEX.dark);
  });

  it('the prefers-color-scheme fallback repeats the same dark values', () => {
    const css = categoryTokens(':root:not([data-theme="light"]) {');
    assert.deepEqual(css, CATEGORY_HEX.dark);
  });

  it('covers every category in both themes with a 6-digit hex value', () => {
    for (const theme of ['light', 'dark']) {
      assert.equal(Object.keys(CATEGORY_HEX[theme]).length, CATEGORIES.length);
      for (const cat of CATEGORIES) {
        assert.match(CATEGORY_HEX[theme][cat], /^#[0-9a-f]{6}$/, `${theme}/${cat}`);
      }
    }
  });

  it('light and dark differ for every category (the dark set is brightened)', () => {
    for (const cat of CATEGORIES) {
      assert.notEqual(CATEGORY_HEX.light[cat], CATEGORY_HEX.dark[cat], `${cat} should be tuned per theme`);
    }
  });
});

describe('CATEGORY_META', () => {
  it('has an entry for every category and nothing else', () => {
    assert.deepEqual(Object.keys(CATEGORY_META).sort(), [...CATEGORIES].sort());
    assert.deepEqual([...ALL_CATEGORIES], [...CATEGORIES]);
  });

  it('has a Dutch label, a plural and a CSS variable name per category', () => {
    for (const cat of CATEGORIES) {
      const meta = CATEGORY_META[cat];
      assert.ok(meta.label.length > 0, `${cat} label`);
      assert.ok(meta.plural.length > 0, `${cat} plural`);
      assert.equal(meta.color, `--c-${cat}`, `${cat} colour token name`);
      assert.ok(CSS.includes(`${meta.color}:`), `${meta.color} exists in tokens.css`);
    }
  });

  it('has an inline Lucide SVG icon per category', () => {
    for (const cat of CATEGORIES) {
      const icon = CATEGORY_META[cat].icon;
      assert.match(icon, /^<svg[\s\S]+<\/svg>\s*$/, `${cat} icon is inline SVG`);
      assert.ok(icon.includes('currentColor'), `${cat} icon inherits currentColor`);
    }
  });

  it('categoryLabel returns the label of the entry', () => {
    assert.equal(categoryLabel('werk'), 'Werkzaamheden');
    assert.equal(categoryLabel('brug'), 'Brugopening');
    for (const cat of CATEGORIES) assert.equal(categoryLabel(cat), CATEGORY_META[cat].label);
  });
});

describe('isCategory and CATEGORY_PRIORITY', () => {
  it('accepts only the seven contract categories', () => {
    for (const cat of CATEGORIES) assert.equal(isCategory(cat), true);
    assert.equal(isCategory('omleiding'), false);
    assert.equal(isCategory(''), false);
    assert.equal(isCategory('Werk'), false);
  });

  it('re-exports a complete, unique impact ordering', () => {
    const values = CATEGORIES.map((cat) => CATEGORY_PRIORITY[cat]);
    assert.equal(new Set(values).size, CATEGORIES.length);
    assert.ok(CATEGORY_PRIORITY.afsluiting < CATEGORY_PRIORITY.file);
    assert.ok(CATEGORY_PRIORITY.file < CATEGORY_PRIORITY.werk);
    assert.ok(CATEGORY_PRIORITY.werk < CATEGORY_PRIORITY.overig);
  });
});
