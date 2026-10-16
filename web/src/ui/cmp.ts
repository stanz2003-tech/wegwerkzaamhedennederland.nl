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

export type CmpOpener = (script: AdScript | null, onUnavailable?: () => void) => boolean;

/**
 * Returns `open(script, onUnavailable)`. It returns false when there is no dialog to open (no ads
 * on this page, or the script failed to load) so the caller can explain that no ad cookies are in
 * use; `onUnavailable` also runs when a script that was still on its way fails afterwards.
 */
export function createCmpOpener(host: FcHost): CmpOpener {
  /** A request already waits in the queue: a second tap must not open the dialog twice. */
  let queued = false;
  return (script, onUnavailable) => {
    if (script?.state() === 'failed') return false;
    if (!script && !host.googlefc?.callbackQueue) return false;
    const fc = (host.googlefc ??= {});
    fc.callbackQueue ??= [] as FcCallback[];
    if (!queued) {
      queued = true;
      fc.callbackQueue.push({
        CONSENT_DATA_READY: () => {
          queued = false;
          host.googlefc?.showRevocationMessage?.();
        },
      });
      if (onUnavailable) script?.onFail(onUnavailable);
    }
    script?.now();
    return true;
  };
}
