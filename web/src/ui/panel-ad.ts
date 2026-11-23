/**
 * The one ad of the map page: inside an opened melding, under its answer (verdict, when, detour
 * and the route buttons; ui/detail.ts writes the melding around the slot), never on the map
 * itself. Measured in the week to 16 Nov 2026: some 700 readers a day click from a text page on
 * to the map and click about 10,000 times a day inside it, and none of that showed an ad.
 *
 * When it asks for an ad:
 *   - only after the reader opened a melding, and only once the slot is within reach (an ad
 *     nobody scrolls to is never requested, ui/ad-lazy.ts);
 *   - a new one only when the reader opens another melding at least RENEW_AFTER_MS after the last
 *     request. A melding is a page of its own here (its own URL, title and text), so the reader
 *     asking for the next one is the request AdSense's refresh rule wants; a timer never is.
 *     Half a minute gives the ad before it time to be seen, and a reader who flips through ten
 *     meldingen does not burn through ten ads nobody looked at.
 * In between, the ad that is there stays while the reader moves from one melding to the next.
 * Back in the list the melding is gone from the screen and the ad goes with it: it is taken out of
 * the page, not hidden (AdSense: never hide an ad unit), and the half minute keeps counting.
 */

/** The shortest time between two ad requests of the slot. */
export const RENEW_AFTER_MS = 30_000;

/** What the panel ad needs of its slot (ui/ads.ts `renewableSlot`). */
export interface PanelAdSlot {
  /** Puts a fresh ad in the slot; the one before it, if any, leaves the page. */
  show(): void;
  /** Calls `cb` once, when the slot comes within reach of the reader; returns the cancel. */
  whenInReach(cb: () => void): () => void;
  /** Takes the ad and its box out of the page. */
  clear(): void;
}

export interface PanelAd {
  /** The reader opened a melding other than the one on screen. */
  meldingOpened(): void;
  /** The reader went back to the list: the melding and the ad in it leave the screen. */
  meldingClosed(): void;
}

export function createPanelAd(slot: PanelAdSlot, now: () => number = () => Date.now()): PanelAd {
  let lastRequest: number | null = null;
  /** True while the slot is watched for coming within reach. */
  let waiting = false;
  let stopWaiting: () => void = () => undefined;

  return {
    meldingOpened() {
      if (waiting) return;
      if (lastRequest !== null && now() - lastRequest < RENEW_AFTER_MS) return;
      waiting = true;
      stopWaiting = slot.whenInReach(() => {
        waiting = false;
        lastRequest = now();
        slot.show();
      });
    },
    meldingClosed() {
      if (waiting) stopWaiting();
      waiting = false;
      slot.clear();
    },
  };
}
