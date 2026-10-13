/**
 * The forecast slot on road and place pages (#entity-forecast) is reserved in the static HTML
 * (`data-pending` + a skeleton, height from `--forecast-reserve` in pages.css): the block is
 * 400–950 px tall and used to appear from nothing once the data was in, pushing the map and the
 * list a whole screen down. This ends the reservation, after mounting or when loading failed.
 */

type SlotElement = Pick<HTMLElement, 'removeAttribute' | 'querySelector' | 'replaceChildren'>;

/** Drops the reservation; a slot still holding only the skeleton is emptied so `:empty` hides it. */
export function releaseForecastSlot(el: SlotElement | null): void {
  if (!el) return;
  el.removeAttribute('data-pending');
  if (el.querySelector('.forecast-pending')) el.replaceChildren();
}
