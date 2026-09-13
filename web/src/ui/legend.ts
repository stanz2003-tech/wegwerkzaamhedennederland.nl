/**
 * "Legenda": a small dismissible popover with the category colours, the verdict pills with
 * their meaning, and the two line styles (dashed red = rijbaan/weg dicht, dashed blue =
 * omleiding). Keyboard accessible: Escape closes, focus returns to the button.
 */
import { VERDICT_META, type VerdictLevel } from '../data/verdict';
import { ALL_CATEGORIES, CATEGORY_META } from './categories';
import { esc } from './format';
import { ICONS } from './icons';
import { renderVerdictPill } from './verdict-pill';

const LEVELS: readonly VerdictLevel[] = ['dicht', 'rijbaan', 'hinder', 'geen', 'nvt', 'onbekend'];

export interface Legend {
  root: HTMLElement;
  close(): void;
}

function popHtml(): string {
  const cats = ALL_CATEGORIES.map((cat) => {
    const m = CATEGORY_META[cat];
    return `<li style="--legend-color: var(${m.color})"><span class="legend__swatch" aria-hidden="true"></span>${m.icon}<span>${esc(m.plural)}</span></li>`;
  }).join('');
  const verdicts = LEVELS.map((level) => {
    const m = VERDICT_META[level];
    return `<li>${renderVerdictPill({ level, label: m.label }, { size: 'sm' })}<span>${esc(m.meaning)}</span></li>`;
  }).join('');
  return `<div class="legend__pop" role="dialog" aria-modal="false" aria-labelledby="legend-title" data-legend-pop>
      <div class="legend__head">
        <h2 class="legend__title" id="legend-title">Legenda</h2>
        <button type="button" class="legend__close" data-legend-close aria-label="Legenda sluiten">${ICONS.x}</button>
      </div>
      <h3 class="legend__h">Wat betekent het voor jou</h3>
      <ul class="legend__list">${verdicts}</ul>
      <h3 class="legend__h">Kleuren op de kaart</h3>
      <ul class="legend__cats">${cats}</ul>
      <ul class="legend__list">
        <li><span class="legend__line" aria-hidden="true"></span><span>Gestippeld rood: rijbaan of weg dicht</span></li>
        <li><span class="swatch--detour" aria-hidden="true"></span><span>Gestippeld blauw: omleiding (bij een geopende melding)</span></li>
      </ul>
    </div>`;
}

export function mountLegend(root: HTMLElement): Legend {
  root.classList.add('legend');
  root.innerHTML = `<button type="button" class="btn btn--ghost legend__btn" data-legend-toggle aria-expanded="false" aria-haspopup="dialog">${ICONS.list}<span>Legenda</span></button>`;
  const btn = root.querySelector<HTMLButtonElement>('[data-legend-toggle]');
  if (!btn) throw new Error('legend markup ontbreekt');
  let pop: HTMLElement | null = null;

  const close = (): void => {
    if (!pop) return;
    pop.remove();
    pop = null;
    btn.setAttribute('aria-expanded', 'false');
  };

  const open = (): void => {
    if (pop) return;
    root.insertAdjacentHTML('beforeend', popHtml());
    pop = root.querySelector<HTMLElement>('[data-legend-pop]');
    btn.setAttribute('aria-expanded', 'true');
    pop?.querySelector<HTMLButtonElement>('[data-legend-close]')?.addEventListener('click', () => {
      close();
      btn.focus();
    });
    pop?.querySelector<HTMLButtonElement>('[data-legend-close]')?.focus();
  };

  btn.addEventListener('click', () => (pop ? close() : open()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop) {
      e.stopPropagation();
      close();
      btn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (pop && e.target instanceof Node && !root.contains(e.target)) close();
  });

  return { root, close };
}
