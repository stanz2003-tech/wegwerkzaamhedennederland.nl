/**
 * Pins down infra/watchdog/wrangler.toml, read as text like infra/test/workflows.test.mjs does:
 * the cron matches what the decision assumes, the Worker has no public URL, and no secret is in it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TICK_MINUTES } from '../decide.mjs';

const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const setting = (key) => new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(toml)?.[1]?.trim();

test('the cron fires every TICK_MINUTES, which the stale threshold was sized for', () => {
  assert.equal(setting('crons'), `["*/${TICK_MINUTES} * * * *"]`);
});

test('the Worker has no public URL: it only runs on its cron', () => {
  // Every request to a public URL would cost GitHub API calls on the owner's token.
  assert.equal(setting('workers_dev'), 'false');
  assert.equal(setting('preview_urls'), 'false');
  assert.doesNotMatch(toml, /^\s*routes?\s*=/m);
});

test('the entry point exists and logs are kept', () => {
  assert.equal(setting('main'), '"worker.mjs"');
  assert.doesNotThrow(() => readFileSync(new URL('../worker.mjs', import.meta.url)));
  assert.match(toml, /\[observability\]\s*\nenabled = true/);
});

test('no token or ping URL in the file: those are Worker secrets', () => {
  assert.doesNotMatch(toml, /github_pat_|ghp_|hc-ping\.com\/[0-9a-f-]{8}/i);
  assert.doesNotMatch(toml, /^\s*GITHUB_TOKEN\s*=/m);
  assert.doesNotMatch(toml, /^\s*HEALTHCHECK_URL\s*=/m);
});
