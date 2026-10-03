/**
 * Page-level helpers of the map page (/), moved out of main.ts so that file stays about the
 * one question and its state: the "Bijgewerkt om" line, the data-failure notice over the
 * map, the "Uitleg ↓" links and copying the link of an open melding.
 */
import { toMs } from '../data/time';
import type { Meta } from '../data/types';
import { esc, fmtTime } from './format';
import { ICONS } from './icons';
import { showToast } from './toast';

/**
 * "Bijgewerkt om 14:20" under the map. The count tiles ("Werkzaamheden 2.177") are gone: they
 * clashed with the numbers for the chosen moment and answered nothing (overzicht-5, taal-11).
 */
export function renderUpdatedLine(m: Meta): void {
  const updated = document.querySelector<HTMLElement>('[data-home-updated]');
  if (updated) updated.textContent = `Bijgewerkt om ${fmtTime(toMs(m.generated))}.`;
}

/** The notice over the map when the data could not be loaded, with a retry button. */
export function showMapNotice(el: HTMLElement, message: string, onRetry: () => void): void {
  el.hidden = false;
  el.classList.add('is-visible');
  el.setAttribute('role', 'alert');
  el.innerHTML = `<p class="map__notice-title">De gegevens konden niet worden geladen.</p>
    <p>${esc(message)}</p>
    <button type="button" class="btn btn--primary" data-retry>${ICONS.refreshCw}<span>Opnieuw proberen</span></button>`;
  el.querySelector('[data-retry]')?.addEventListener('click', onRetry);
}

export function clearMapNotice(el: HTMLElement): void {
  el.hidden = true;
  el.classList.remove('is-visible');
  el.removeAttribute('role');
  el.innerHTML = '';
}

/** Every "Uitleg ↓" link scrolls to the text section and puts the focus on its heading. */
export function wireUitlegLinks(reducedMotion: boolean): void {
  const scrollToUitleg = (): void => {
    const target = document.getElementById('uitleg');
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    target.querySelector<HTMLElement>('h2, h1')?.focus({ preventScroll: true });
  };
  document.querySelectorAll<HTMLElement>('[data-scroll-uitleg]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToUitleg();
    });
  });
}

/** Copies the link of a melding, with a toast either way. */
export async function copyLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link gekopieerd naar het klembord.');
  } catch {
    showToast('Kopiëren lukte niet. De link staat in de adresbalk.', 'error');
  }
}
