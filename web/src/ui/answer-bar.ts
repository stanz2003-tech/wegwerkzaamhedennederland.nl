/**
 * The compact answer bar of a long road / place page on a phone (mobiel-12): once the forecast
 * block has scrolled out of view, a bar at the bottom of the screen keeps the answer in sight —
 * [A27] "Nu: Rijbaan dicht bij Gorinchem" — with an "Andere dag" button that brings the day
 * strip back.
 *
 * The bar never has an answer of its own: it copies the headline and colour of the answer card
 * the forecast block rendered for the current state, so it can never read lighter than the card.
 * Shown at ≤768 px only (entity-list.css); wider screens have room for the block itself.
 */
import { prefersReducedMotion } from './theme';

export interface AnswerBar {
  /** Copies the card's current headline; call after every state change of the forecast block. */
  update(whenLabel: string): void;
}

const PHONE = '(max-width: 768px)';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Mounts the bar after `#main`; null when the browser has no IntersectionObserver. */
export function mountAnswerBar(forecastEl: HTMLElement, badgeHtml = ''): AnswerBar | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  const bar = document.createElement('div');
  bar.className = 'answer-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Antwoord in het kort');
  bar.innerHTML = `${badgeHtml ? `<span class="answer-bar__badge">${badgeHtml}</span>` : ''}
    <p class="answer-bar__text"><span class="answer-bar__when" data-bar-when></span> <strong data-bar-headline></strong></p>
    <button type="button" class="btn btn--secondary answer-bar__btn" data-bar-day>Andere dag</button>`;
  const whenEl = bar.querySelector<HTMLElement>('[data-bar-when]');
  const headlineEl = bar.querySelector<HTMLElement>('[data-bar-headline]');
  const btn = bar.querySelector<HTMLButtonElement>('[data-bar-day]');
  if (!whenEl || !headlineEl || !btn) return null;
  (document.getElementById('main') ?? document.body).after(bar);

  const phone = window.matchMedia(PHONE);
  let past = false;
  const apply = (): void => {
    const show = past && phone.matches;
    bar.hidden = !show;
    // Room under the last content, so the bar never covers the footer or an ad slot.
    document.body.classList.toggle('has-answer-bar', show);
  };

  new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    if (!e) return;
    // Only once the block is above the viewport; it starts in view at the top of the page.
    past = !e.isIntersecting && e.boundingClientRect.bottom <= 0;
    apply();
  }).observe(forecastEl);
  phone.addEventListener('change', apply);

  btn.addEventListener('click', () => {
    forecastEl.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const day =
      forecastEl.querySelector<HTMLElement>('[data-fc-day][aria-checked="true"]') ?? forecastEl.querySelector<HTMLElement>('[data-fc-day]');
    day?.focus({ preventScroll: true });
  });

  return {
    update(whenLabel) {
      const card = forecastEl.querySelector<HTMLElement>('.answer');
      const headline = card?.querySelector('.answer__headline')?.textContent?.trim() ?? '';
      whenEl.textContent = `${capitalize(whenLabel)}:`;
      headlineEl.textContent = headline;
      const color = card?.style.getPropertyValue('--vpill-color') ?? '';
      if (color) bar.style.setProperty('--vpill-color', color);
      else bar.style.removeProperty('--vpill-color');
    },
  };
}
