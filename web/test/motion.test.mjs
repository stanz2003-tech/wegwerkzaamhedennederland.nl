/**
 * `prefers-reduced-motion` is honoured through exactly one mechanism: the three duration tokens
 * are zeroed under `reduce`, and every rule that animates uses those tokens. A literal duration
 * ("2s") escapes that, so it is only allowed inside a `prefers-reduced-motion: no-preference`
 * block — which is off by definition for a reader who asked for less motion.
 *
 * A regression net rather than a style rule: nothing else in web/test/ can catch a hardcoded
 * `transition: transform 300ms` slipping into a stylesheet.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const STYLE_DIR = fileURLToPath(new URL('../src/styles/', import.meta.url));

function css(name) {
  return readFileSync(join(STYLE_DIR, name), 'utf8');
}

const files = readdirSync(STYLE_DIR).filter((f) => f.endsWith('.css'));

/** Character ranges of every `@media (... no-preference ...) { ... }` block, braces matched. */
function noPreferenceRanges(source) {
  const ranges = [];
  const re = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

/** Literal, non-zero durations in a `transition`/`animation` shorthand or *-duration property. */
function literalDurations(source) {
  const out = [];
  const re = /(transition|animation)(-duration)?\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const value = m[3];
    const times = value.match(/(?<![-\w.])(\d*\.?\d+)(ms|s)\b/g) ?? [];
    for (const t of times) {
      if (Number.parseFloat(t) === 0) continue;
      out.push({ index: m.index, property: m[1], value: value.trim().slice(0, 60), time: t });
    }
  }
  return out;
}

describe('reduced motion', () => {
  it('zeroes the three duration tokens under prefers-reduced-motion: reduce', () => {
    const tokens = css('tokens.css');
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokens);
    assert.ok(block, 'tokens.css has a reduce block on :root');
    for (const token of ['--dur-1', '--dur-2', '--dur-3']) {
      assert.match(block[1], new RegExp(`${token}:\\s*0m?s\\s*;`), `${token} is zeroed`);
    }
  });

  it('declares every duration token it zeroes', () => {
    const tokens = css('tokens.css');
    for (const token of ['--dur-1', '--dur-2', '--dur-3']) {
      assert.match(tokens, new RegExp(`${token}:\\s*\\d+ms`), `${token} has a normal value too`);
    }
  });

  it('turns smooth scrolling off as well', () => {
    assert.match(css('base.css'), /@media \(prefers-reduced-motion: reduce\)\s*\{\s*html\s*\{\s*scroll-behavior: auto;/);
  });

  it('keeps every literal duration inside a no-preference block', () => {
    const offenders = [];
    for (const file of files) {
      const source = css(file);
      const safe = noPreferenceRanges(source);
      for (const hit of literalDurations(source)) {
        const inside = safe.some(([from, to]) => hit.index >= from && hit.index < to);
        if (!inside) offenders.push(`${file}: ${hit.property}: ${hit.value} (${hit.time})`);
      }
    }
    assert.deepEqual(offenders, [], 'use var(--dur-*) or wrap the rule in prefers-reduced-motion: no-preference');
  });

  it('finds the animations that are deliberately gated (so the check above is not vacuous)', () => {
    const source = css('components.css');
    const ranges = noPreferenceRanges(source);
    assert.ok(ranges.length >= 3, `expected the gated animation blocks, found ${ranges.length}`);
    const gated = literalDurations(source).filter((h) => ranges.some(([from, to]) => h.index >= from && h.index < to));
    // `pulse` (live pill) and `shimmer` (skeleton); the third block only carries an
    // animation-delay, which is not a duration.
    assert.ok(gated.length >= 2, `expected literal durations inside those blocks, found ${gated.length}`);
  });
});
