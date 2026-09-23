/**
 * Which data contract this build of the site understands, and what to do when `meta.json` is
 * newer.
 *
 * The data refreshes every ten minutes, the site only on a deploy. A tab that stays open across a
 * contract change keeps running the old code against the new files: it still works (every
 * contract so far only added fields), but it ignores what the new fields were added for — v3 code
 * reads a v4 item's heaviest phase as the verdict for every moment. When the data is newer than
 * this build, the page reloads once to fetch the current code. The guard in sessionStorage makes
 * sure a stale HTML cache can never turn that into a reload loop.
 */
import type { Meta } from './types';

/** Meta.version this build was written for (pipeline/src/output.js DATA_VERSION). */
export const SUPPORTED_DATA_VERSION = 4;

const RELOAD_KEY = 'wegwerk:reloaded-for-data';

/** True when `version` is a contract this build does not know yet. Unparsable → false. */
export function isNewerThanSupported(version: unknown): boolean {
  const n = typeof version === 'string' ? Number.parseInt(version, 10) : Number.NaN;
  return Number.isFinite(n) && n > SUPPORTED_DATA_VERSION;
}

/**
 * Reloads the page once per data version when the data is newer than this build. Returns whether
 * a reload was started. Outside a browser (tests, the build) it does nothing.
 */
export function reloadIfDataNewer(meta: Pick<Meta, 'version'>): boolean {
  if (!isNewerThanSupported(meta.version)) return false;
  if (typeof window === 'undefined' || typeof window.location?.reload !== 'function') return false;
  try {
    if (window.sessionStorage.getItem(RELOAD_KEY) === meta.version) return false;
    window.sessionStorage.setItem(RELOAD_KEY, meta.version);
  } catch {
    // Storage blocked (private mode, cookie settings): without the guard a reload could repeat,
    // so the page keeps running the old code instead.
    return false;
  }
  window.location.reload();
  return true;
}
