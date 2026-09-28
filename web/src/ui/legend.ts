/**
 * "Legenda": a small dismissible popover with the verdict pills and their meaning, then the map
 * colours. The map colours lines and points by VERDICT (map/layers.ts), so the legend shows a line
 * swatch per verdict level — it used to list the category colours, and "geel = werkzaamheden" in
 * the legend contradicted "geel = doorrijden mogelijk" on the map (overzicht-7). Files and
 * incidents keep their own colour on the map, so they keep a point swatch here, plus the dashed
 * detour line. Keyboard accessible: Escape closes, focus returns to the button.
 */
import { VERDICT_META, VERDICT_SEVERITY, type VerdictLevel } from '../data/verdict';
import { CATEGORY_META } from './categories';
import { esc } from './format';
import { ICONS } from './icons';
import { renderVerdictPill } from './verdict-pill';

/** Worst first, the order of the list rows and the day strip. */
const LEVELS: readonly VerdictLevel[] = VERDICT_SEVERITY;

/** How each level looks on the map, in words (the swatch shows it; the text says it for everyone). */
const LINE_NOTE: Partial<Record<VerdictLevel, string>> = {
  dicht: 'rood met witte streepjes',
  nvt: 'vervaagd',
};

/**
 * One line swatch per verdict level. The colour comes from the level's --v-* token, which
 * VERDICT_HEX mirrors for the map paint (test/v3-ui.test.mjs keeps the two equal), so the swatch
 * follows the theme exactly as the map does.
 */
export function verdictLinesHtml(): string {
  return LEVELS.map((level) => {
    const m = VERDICT_META[level];
    const note = LINE_NOTE[level];
    return `<li style="--legend-color: var(${m.color})"><span class="legend__vline legend__vline--${level}" aria-hidden="true"></span><span>${esc(m.label)}${note ? ` <span class="legend__note">(${esc(note)})</span>` : ''}</span></li>`;
  }).join('');
}

export interface Legend {
  root: HTMLElement;
  close(): void;
}

function popHtml(): string {
  const points = (['file', 'incident'] as const)
    .map((cat) => {
      const m = CATEGORY_META[cat];
      return `<li style="--legend-color: var(${m.color})"><span class="legend__swatch" aria-hidden="true"></span>${m.icon}<span>${esc(m.label)} (eigen kleur)</span></li>`;
    })
    .join('');
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
      <ul class="legend__cats legend__lines">${verdictLinesHtml()}</ul>
      <ul class="legend__cats">${points}</ul>
      <ul class="legend__list">
        <li><span class="swatch--detour" aria-hidden="true"></span><span>Gestippeld blauw: omleiding (bij een geopende melding)</span></li>
      </ul>
    </div>`;
}

export function mountLegend(root: HTMLElement): Legend {
  root.classList.add('legend');
  root.innerHTML = `<button type="button" class="btn btn--ghost legend__btn" data-legend-toggle aria-expanded="false" aria-haspopup="dialog" title="Legenda">${ICONS.list}<span class="legend__btn-text">Legenda</span></button>`;
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
    // No scroll on focus: inside the map panel that scrolled the whole page (mobiel-2).
    pop?.querySelector<HTMLButtonElement>('[data-legend-close]')?.focus({ preventScroll: true });
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
