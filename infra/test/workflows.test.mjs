/**
 * Invariants of the self-scheduling chain Data → Wekker → Data (.github/workflows).
 *
 * The chain replaces GitHub's `schedule:`, which dropped 841 of the 860 runs a five-minute cron
 * asked for. It is also the one piece of this project that can go wrong expensively: a wekker
 * without its wait timer, or two chains side by side, would start runs back to back around the
 * clock. These checks read the workflow files as text — no YAML dependency — and pin down exactly
 * the lines that keep the chain single, slow and self-healing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => readFileSync(resolve(ROOT, '.github/workflows', name), 'utf8');
const data = read('data.yml');
const wekker = read('wekker.yml');

/** The YAML under a top-level key, up to the next top-level key. */
function block(text, key) {
  const start = text.search(new RegExp(`^${key}:`, 'm'));
  assert.ok(start >= 0, `${key}: ontbreekt`);
  const rest = text.slice(start + key.length + 1);
  const next = rest.search(/^\S/m);
  return next < 0 ? rest : rest.slice(0, next);
}

test('the wekker only runs when dispatched: it has no schedule of its own', () => {
  const on = block(wekker, 'on');
  assert.match(on, /workflow_dispatch/);
  assert.doesNotMatch(on, /schedule/);
});

test('the wekker waits on the "wekker" environment, whose timer provides the pause', () => {
  // A job waiting on an environment wait timer occupies no runner and costs no billable time.
  assert.match(wekker, /^\s+environment: wekker\s*$/m);
});

test('the wekker may dispatch workflows and nothing more', () => {
  const perms = block(wekker, 'permissions');
  assert.match(perms, /actions: write/);
  assert.match(perms, /contents: read/);
  assert.doesNotMatch(perms, /contents: write/);
});

test('the wekker lets next.mjs decide, and acts on every one of its answers', () => {
  // The decision (one chain, no loop without the timer, never end without a successor) is a
  // tested function in infra/wekker/next.mjs; the workflow only feeds it and carries it out.
  assert.match(wekker, /node infra\/wekker\/next\.mjs "\$created" "\$runs"/);
  // The own age comes from this run, not from the last data run (that mix-up killed the chain).
  assert.match(wekker, /RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.match(wekker, /gh api "repos\/\$REPO\/actions\/runs\/\$RUN_ID" --jq '\.created_at'/);
  assert.match(wekker, /--workflow data\.yml --limit 10 --json status,createdAt/);
  const step = wekker.slice(wekker.indexOf('case "$action" in'));
  assert.match(step, /dispatch-data\)\s+gh workflow run data\.yml/);
  assert.match(step, /rearm\)\s+gh workflow run wekker\.yml/);
  assert.match(step, /stop\)\s+echo "::warning::/);
  // Anything unexpected sets the wekker again rather than ending the chain.
  assert.match(step, /\*\)[\s\S]*gh workflow run wekker\.yml/);
  // The sparse checkout brings the decision script along.
  assert.match(wekker, /sparse-checkout: infra\/wekker/);
});

test('the wekker runs the end-to-end check and sends the heartbeat from there', () => {
  assert.match(wekker, /node infra\/wekker\/check\.mjs/);
  assert.match(wekker, /HEALTHCHECK_URL: \$\{\{ secrets\.HEALTHCHECK_URL \}\}/);
  // DATA_BASE ends with a slash (deploy.yml enforces it), so the file name follows directly.
  assert.match(wekker, /DATA_META_URL: \$\{\{ vars\.DATA_BASE \}\}meta\.json/);
});

test('every data run sets the wekker, also after a failed data job', () => {
  assert.match(data, /^  volgende:$/m);
  const volgende = data.slice(data.indexOf('  volgende:'));
  assert.match(volgende, /needs: \[preflight, data\]/);
  assert.match(volgende, /if: always\(\) && needs\.preflight\.outputs\.configured == 'true'/);
  assert.match(volgende, /gh workflow run wekker\.yml/);
  // One chain: a wekker that already waits will start the next run itself.
  assert.match(volgende, /--workflow wekker\.yml[^\n]*select\(\.status != "completed"\)/);
});

test('the data workflow keeps its hourly schedule as a fallback and serialises its runs', () => {
  assert.match(block(data, 'on'), /cron: "7 \* \* \* \*"/);
  const concurrency = block(data, 'concurrency');
  assert.match(concurrency, /group: data/);
  assert.match(concurrency, /cancel-in-progress: false/);
  assert.match(block(data, 'permissions'), /actions: write/);
});

test('the heartbeat is no longer sent by the data job itself', () => {
  // A ping at the end of the data job only proved that a job went green.
  assert.doesNotMatch(data, /name: Ping healthchecks/);
  assert.doesNotMatch(data, /secrets\.HEALTHCHECK_URL/);
});

test('the keepalive runs on every event, not only on scheduled runs', () => {
  const step = data.slice(data.indexOf('- name: Keep the schedule alive'));
  const firstLines = step.split('\n').slice(0, 4).join('\n');
  assert.doesNotMatch(firstLines, /github\.event_name == 'schedule'/);
});
