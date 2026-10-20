/**
 * The forecast slot on road and place pages (#entity-forecast) is reserved in the static HTML
 * (`data-pending` + a skeleton, height from `--forecast-reserve` in pages.css): the block is
 * 400–950 px tall and used to appear from nothing once the data was in, pushing the map and the
 * list a whole screen down. This ends the reservation, after mounting or when loading failed.
 */

type SlotElement = Pick<HTMLElement, 'removeAttribute' | 'querySelector' | 'replaceChildren'>;

/**
 * Drops the reservation; a slot still holding only the skeleton is emptied so `:empty` hides it.
 * A slot with the build's snapshot (`data-reserve`, ui/entity-snapshot.ts) keeps its answer: that
 * names the moment of its data, which beats an empty slot when the live data failed to load.
 */
export function releaseForecastSlot(el: SlotElement | null): void {
  if (!el) return;
  el.removeAttribute('data-pending');
  el.removeAttribute('data-reserve');
  if (el.querySelector('.forecast-pending')) el.replaceChildren();
}
