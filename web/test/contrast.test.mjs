/**
 * WCAG contrast of the verdict pills, computed from tokens.css itself (toeg-2).
 *
 * "Weg dicht" and "Rijbaan dicht" are filled pills; white on the map colours measured 3.61:1
 * (rijbaan, light), 2.79:1 (dicht, dark) and 2.34:1 (rijbaan, dark). The other levels are text
 * on a 12 % tint of their colour over --surface (components.css `.vpill`). Every pair must reach
 * 4.5:1 — pill text is 12–13 px — in the light theme, in `[data-theme="dark"]` and in the
 * `prefers-color-scheme: dark` fallback. The three blocks are parsed separately, so a token
 * changed in one dark block and forgotten in the other fails here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const CSS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of every block whose selector is exactly `selector`, merged in source order. */
function blockTokens(selector) {
  const out = new Map();
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim());
  }
  return out;
}

/** The three themes: light, and light overridden by each dark block. */
const LIGHT = blockTokens(':root');
const THEMES = {
  light: LIGHT,
  'dark ([data-theme])': new Map([...LIGHT, ...blockTokens(':root[data-theme="dark"]')]),
  'dark (prefers-color-scheme)': new Map([...LIGHT, ...blockTokens(':root:not([data-theme="light"])')]),
};

function resolve(tokens, value, depth = 0) {
  assert.ok(depth < 10, `var() loop at ${value}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value.toLowerCase();
  const next = tokens.get(ref[1]);
  assert.ok(next, `token ${ref[1]} is not defined`);
  return resolve(tokens, next, depth + 1);
}

const hex = (tokens, name) => {
  const v = resolve(tokens, `var(${name})`);
  assert.match(v, /^#[0-9a-f]{6}$/, `${name} must resolve to a 6-digit hex, got ${v}`);
  return v;
};

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `color-mix(in srgb, a p%, b)`: linear in the gamma-encoded channels. */
const mix = (a, p, b) => toHex(rgb(a).map((v, i) => v * p + rgb(b)[i] * (1 - p)));

function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe('contrast helper', () => {
  it('matches the known WCAG values', () => {
    assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
    assert.equal(contrast('#ffffff', '#e8571c').toFixed(2), '3.61', 'the old rijbaan pill');
    assert.equal(mix('#ffffff', 0.5, '#000000'), '#808080');
  });
});

describe('verdict pill contrast (tokens.css)', () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    it(`${theme}: "Weg dicht" and "Rijbaan dicht" text on their fill ≥ ${AA}:1`, () => {
      const on = hex(tokens, '--v-closed-on');
      for (const level of ['dicht', 'rijbaan']) {
        const fill = hex(tokens, `--v-${level}-fill`);
        const c = contrast(on, fill);
        assert.ok(c >= AA, `${theme} ${level}: ${on} on ${fill} = ${c.toFixed(2)}:1`);
      }
    });

    it(`${theme}: the tinted pills (hinder, geen, nvt, onbekend) ≥ ${AA}:1`, () => {
      const surface = hex(tokens, '--surface');
      for (const level of ['hinder', 'geen', 'nvt', 'onbekend']) {
        const text = hex(tokens, `--v-${level}-text`);
        const bg = mix(hex(tokens, `--v-${level}`), 0.12, surface);
        const c = contrast(text, bg);
        assert.ok(c >= AA, `${theme} ${level}: ${text} on ${bg} = ${c.toFixed(2)}:1`);
      }
    });
  }

  it('the pill fills are their own tokens: the map colours stay as they were', () => {
    assert.equal(hex(THEMES.light, '--v-dicht'), '#d8232a');
    assert.equal(hex(THEMES.light, '--v-rijbaan'), '#e8571c');
    assert.notEqual(hex(THEMES.light, '--v-dicht-fill'), hex(THEMES.light, '--v-dicht'));
  });

  it('both dark blocks agree on every pill token', () => {
    const a = THEMES['dark ([data-theme])'];
    const b = THEMES['dark (prefers-color-scheme)'];
    for (const name of ['--v-closed-on', '--v-dicht-fill', '--v-rijbaan-fill', '--surface']) {
      assert.equal(hex(a, name), hex(b, name), name);
    }
  });
});

describe('the pill CSS uses the fill tokens', () => {
  const COMPONENTS = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

  it('dicht and rijbaan take background and border from the -fill tokens and text from --v-closed-on', () => {
    assert.match(COMPONENTS, /\.vpill--dicht\s*\{[^}]*background:\s*var\(--v-dicht-fill\)[^}]*border-color:\s*var\(--v-dicht-fill\)/);
    assert.match(COMPONENTS, /\.vpill--rijbaan\s*\{[^}]*background:\s*var\(--v-rijbaan-fill\)[^}]*border-color:\s*var\(--v-rijbaan-fill\)/);
    assert.match(COMPONENTS, /--vpill-text:\s*var\(--v-closed-on\)/);
    assert.doesNotMatch(COMPONENTS, /--vpill-text:\s*#ffffff/);
  });

  it('a faded nvt row no longer fades the pill', () => {
    assert.doesNotMatch(COMPONENTS, /\.item\[data-verdict='nvt'\]\s*\{\s*opacity/);
  });
});
