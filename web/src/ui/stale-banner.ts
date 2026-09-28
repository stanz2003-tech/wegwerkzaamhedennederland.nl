/**
 * The warning above the answer when the data is not current ("stale" = older than
 * STALE_AFTER_MINUTES, or no data at all). The topbar pill alone was a coloured dot on a phone,
 * while the answer card kept saying "nu" over data that could be hours old: a closure that started
 * since then was simply missing. This banner says what that means for the driver.
 *
 * It is the one `role="status"` for the data state (the pill is not a live region), so a screen
 * reader hears it once. Used by the map panel (main.ts) and the entity pages (page-boot.ts).
 */
import { toMs } from '../data/time';
import { esc } from './format';
import { ICONS } from './icons';
import { liveTimeLabel, type LiveStatus } from './topbar';

/** The banner sentence for a status, or null when there is nothing to warn about. */
export function staleBannerText(status: LiveStatus, now = Date.now()): string | null {
  if (status.kind === 'stale') {
    return `We krijgen sinds ${liveTimeLabel(toMs(status.generated), now)} geen nieuwe gegevens. Files en ongelukken van nu zie je misschien niet. Let op de borden langs de weg.`;
  }
  if (status.kind === 'error') {
    return 'We krijgen nu geen gegevens binnen. Files, ongelukken en afsluitingen van nu zie je misschien niet. Let op de borden langs de weg.';
  }
  return null;
}

/** Shows the banner in `host` for stale / error and hides the host otherwise. */
export function renderStaleBanner(host: HTMLElement, status: LiveStatus, now = Date.now()): void {
  const text = staleBannerText(status, now);
  if (text === null) {
    host.hidden = true;
    host.replaceChildren();
    delete host.dataset.staleText;
    return;
  }
  host.hidden = false;
  // Rewrite only on change: replacing an identical live region would announce it again on every
  // 90-second refresh.
  if (host.dataset.staleText === text) return;
  host.dataset.staleText = text;
  host.innerHTML = `<div class="banner banner--warn stale-banner" role="status">${ICONS.circleAlert}<p class="banner__title">${esc(text)}</p></div>`;
}
