/**
 * The footer link "Cookie-instellingen" re-opens Google's consent dialog (AdSense "Privacy &
 * messaging"). That dialog arrives with the AdSense script, which loads only once the page is done
 * (ui/ad-loader.ts); a tap before then waits in Google's documented `googlefc.callbackQueue`
 * array and fetches the script at once, so the link works from the first moment.
 */
import type { AdScript } from './ad-loader';

export type FcCallback = Record<string, () => void>;

/** The part of Google's `window.googlefc` (Privacy & messaging JavaScript API) we use. */
export interface GoogleFc {
  /** A plain array until Google's script takes it over and runs what was queued. */
  callbackQueue?: { push(cb: FcCallback): void };
  showRevocationMessage?(): void;
}

export interface FcHost {
  googlefc?: GoogleFc;
}

export interface CmpTimers {
  setTimeout(cb: () => void, ms: number): void;
}

export type CmpOpener = (script: AdScript | null, onUnavailable?: () => void) => boolean;

/**
 * How long Google's consent script may take after the AdSense script has loaded (it took ~0.4 s
 * in the live check). A cookie-banner blocker can stop it while the AdSense script loads: then
 * the request is still unread in the plain array after this long, and the link says so.
 */
export const CMP_GRACE_MS = 5000;

const BROWSER_TIMERS: CmpTimers = { setTimeout: (cb, ms) => window.setTimeout(cb, ms) };

/**
 * Returns `open(script, onUnavailable)`. It returns false when there is no dialog to open (no ads
 * on this page, or the script failed to load) so the caller can explain that no ad cookies are in
 * use; `onUnavailable` also runs when a request made while the script was on its way finds no
 * dialog after all (the script fails, or Google's consent script never takes the queue over).
 */
export function createCmpOpener(host: FcHost, timers: CmpTimers = BROWSER_TIMERS): CmpOpener {
  /** The request that waits for Google; a second tap must not open the dialog twice. */
  let waiting: FcCallback | null = null;

  const request = (script: AdScript | null, onUnavailable?: () => void): void => {
    const fc = (host.googlefc ??= {});
    const queue = (fc.callbackQueue ??= [] as FcCallback[]);
    const entry: FcCallback = {
      CONSENT_DATA_READY: () => {
        if (waiting === entry) waiting = null;
        host.googlefc?.showRevocationMessage?.();
      },
    };
    const giveUp = (): void => {
      if (waiting !== entry) return; // answered, or the script failed
      waiting = null;
      const unread = Array.isArray(queue) && host.googlefc?.callbackQueue === queue && queue.includes(entry);
      if (!unread) return; // Google has the request; it just never answered
      queue.splice(queue.indexOf(entry), 1);
      onUnavailable?.();
    };
    waiting = entry;
    queue.push(entry);
    if (!script) {
      timers.setTimeout(giveUp, CMP_GRACE_MS);
      return;
    }
    script.onLoaded(() => timers.setTimeout(giveUp, CMP_GRACE_MS));
    script.onFail(() => {
      if (waiting !== entry) return;
      waiting = null;
      onUnavailable?.();
    });
  };

  return (script, onUnavailable) => {
    if (script?.state() === 'failed') return false;
    if (!script && !host.googlefc?.callbackQueue) return false;
    if (!waiting) request(script, onUnavailable);
    script?.now();
    return true;
  };
}
