/**
 * Hides an ad slot that no real AdSense script will ever fill. An ad blocker can swap
 * adsbygoogle.js for a stand-in that loads fine but takes nothing from the queue (uBlock Origin's
 * surrogate: `push` is an empty function), so `onFail` never fires and the visitor kept an empty
 * grey box with "Advertenties" above it.
 *
 * Real AdSense marks every slot it has taken with `data-adsbygoogle-status`, within ~200 ms of
 * loading and also while the consent dialog is still open (measured on the live site, 16 Nov
 * 2026); the ad itself may come later. A slot still unmarked TAKEN_CHECK_MS after the script
 * loaded is therefore not going to be filled.
 */

/** Generous for a slow phone, short enough that an empty box does not linger. */
export const TAKEN_CHECK_MS = 3000;

const STATUS_ATTR = 'data-adsbygoogle-status';

/** True once AdSense has taken the slot (`<ins class="adsbygoogle">`) from its queue. */
export function slotTaken(ins: Pick<Element, 'hasAttribute'>): boolean {
  return ins.hasAttribute(STATUS_ATTR);
}

/** Call once the AdSense script has loaded: `hide()` runs when the slot is still untaken later. */
export function hideIfNotTaken(
  ins: Pick<Element, 'hasAttribute'>,
  hide: () => void,
  setTimer: (cb: () => void, ms: number) => void = (cb, ms) => window.setTimeout(cb, ms),
): void {
  setTimer(() => {
    if (!slotTaken(ins)) hide();
  }, TAKEN_CHECK_MS);
}
