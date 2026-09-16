/**
 * The scheduled Data workflow commits pipeline/cache/{geocode,bruggen-seen,etags}.json back to the
 * repository, and keys its parsed-feed cache on hashFiles('pipeline/cache/etags.json'). A .gitignore
 * entry on any of those three breaks both mechanisms at once, and only in CI: `git add` refuses the
 * ignored path, the whole commit step exits non-zero, and `continue-on-error: true` swallows it.
 *
 * That happened: etags.json was ignored, so 19 consecutive green runs committed nothing, NDW was
 * never answered with a 304, and the geocode cache never grew. This test makes the next occurrence
 * a red CI run instead of a silent regression.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The caches the workflow commits; see the "Commit updated caches" step in data.yml. */
const COMMITTED_CACHES = ['pipeline/cache/geocode.json', 'pipeline/cache/bruggen-seen.json', 'pipeline/cache/etags.json'];

/** `git check-ignore` exits 0 when the path IS ignored, 1 when it is not. */
function isIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

test('the caches the Data workflow commits are not gitignored', (t) => {
  if (!existsSync(resolve(REPO_ROOT, '.git'))) return t.skip('not a git checkout');
  for (const path of COMMITTED_CACHES) {
    assert.equal(isIgnored(path), false, `${path} is gitignored; the "Commit updated caches" step will fail on every run`);
  }
});

test('the parsed-feed cache key reads a file that is actually in the checkout', (t) => {
  if (!existsSync(resolve(REPO_ROOT, '.git'))) return t.skip('not a git checkout');
  // hashFiles() over a missing file yields a constant key, so the cache would never be refreshed.
  const tracked = execFileSync('git', ['ls-files', '--', 'pipeline/cache/etags.json'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  assert.notEqual(tracked, '', 'pipeline/cache/etags.json must be tracked: data.yml keys its cache on hashFiles() of it');
});
