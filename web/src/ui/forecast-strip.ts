/**
 * The 14-day strip of a road or place page as one radio group: "Nu" plus a button per day
 * (ui/strip-model.ts says what each one shows). Desktop: two rows of seven under "Deze week" /
 * "Volgende week". Phone: one row that scrolls sideways from "vandaag", with the picked day
 * scrolled into view and a fade at the right edge as the cue that there is more.
 *
 * The buttons are built once; an update only changes classes, aria attributes, styles and span
 * texts. Rebuilding them with innerHTML on every choice dropped the keyboard focus on <body>
 * (toeg-3). Roving tabindex: Tab reaches the group once, ←/→/Home/End move and pick.
 */
import { DAY_PARTS } from '../data/time';
import { VERDICT_META, type VerdictLevel } from '../data/verdict';
import { esc } from './format';
import type { StripModel } from './strip-model';

/** `null` = "Nu"; otherwise the index of the day. */
export type StripChoice = number | null;

export interface ForecastStrip {
  /** `checked`: the radio that is on (null = "Nu"); `undefined` = none (a date outside the strip). */
  update(model: StripModel, checked: StripChoice | undefined): void;
  focusChecked(): void;
}

const WEEK_LENGTH = 7;
const colour = (level: VerdictLevel | null): string => `var(${level ? VERDICT_META[level].color : '--border'})`;

function dayButton(i: number): string {
  const parts = DAY_PARTS.map((p) => `<span class="forecast__part" data-fc-part="${p.id}"></span>`).join('');
  return `<button type="button" class="forecast__day" role="radio" aria-checked="false" tabindex="-1" data-fc-day="${i}">
      <span class="forecast__day-name"></span>
      <span class="forecast__day-verdict"></span>
      <span class="forecast__day-parts" aria-hidden="true">${parts}</span>
      <span class="forecast__day-line"></span>
    </button>`;
}

export function mountForecastStrip(root: HTMLElement, days: number, labelledBy: string, onPick: (choice: StripChoice, viaKeyboard: boolean) => void): ForecastStrip {
  const weeks: string[] = [];
  for (let w = 0; w * WEEK_LENGTH < days; w++) {
    const buttons: string[] = [];
    for (let i = w * WEEK_LENGTH; i < Math.min(days, (w + 1) * WEEK_LENGTH); i++) buttons.push(dayButton(i));
    weeks.push(`<p class="forecast__week" aria-hidden="true">${w === 0 ? 'Deze week' : 'Volgende week'}</p><div class="forecast__row">${buttons.join('')}</div>`);
  }
  // The strip first, the "Elke dag, de hele dag" lines after it: on a phone those lines pushed the
  // strip — the answer to "which day can I go" — below the fold on busy roads like the A27.
  root.innerHTML = `<div class="forecast__pick" role="radiogroup" aria-labelledby="${esc(labelledBy)}" data-fc-group>
      <button type="button" class="datepick__chip forecast__now" role="radio" aria-checked="true" tabindex="0" data-fc-now>Nu</button>
      <div class="forecast__scroller" data-fc-scroller>${weeks.join('')}</div>
    </div>
    <ul class="forecast__constants" data-fc-constants hidden></ul>`;
  const constantsEl = root.querySelector<HTMLElement>('[data-fc-constants]');
  const group = root.querySelector<HTMLElement>('[data-fc-group]');
  const scroller = root.querySelector<HTMLElement>('[data-fc-scroller]');
  const nowBtn = root.querySelector<HTMLButtonElement>('[data-fc-now]');
  if (!constantsEl || !group || !scroller || !nowBtn) throw new Error('strook-markup ontbreekt');
  const dayBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-fc-day]'));
  const radios = [nowBtn, ...dayBtns];
  let checked: StripChoice | undefined = null;

  /** Brings the picked day into the sideways scroller without scrolling the page. */
  const reveal = (btn: HTMLElement): void => {
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const s = scroller.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    if (r.left < s.left || r.right > s.right) scroller.scrollLeft += r.left - s.left - (s.width - r.width) / 2;
  };

  const syncFade = (): void => {
    scroller.classList.toggle('is-end', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2);
  };
  scroller.addEventListener('scroll', syncFade, { passive: true });

  const update = (model: StripModel, next: StripChoice | undefined): void => {
    const changed = next !== checked;
    checked = next;
    const lines = model.constantLines.map((l) => `<li><span class="forecast__swatch" aria-hidden="true"></span>${esc(l)}</li>`);
    if (model.moreConstants > 0) lines.push(`<li class="forecast__constants-more">en ${model.moreConstants} andere die elke dag de hele dag gelden (zie de lijst)</li>`);
    constantsEl.hidden = lines.length === 0;
    constantsEl.innerHTML = lines.join('');
    constantsEl.style.setProperty('--edge-color', colour(model.constants[0]?.level ?? null));

    nowBtn.setAttribute('aria-checked', next === null ? 'true' : 'false');
    nowBtn.classList.toggle('is-on', next === null);
    dayBtns.forEach((btn, i) => {
      const c = model.cells[i];
      btn.hidden = !c;
      if (!c) return;
      const on = next === i;
      btn.className = `forecast__day forecast__day--${c.level ?? 'leeg'}${on ? ' is-on' : ''}${c.edge ? ' has-edge' : ''}`;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.setAttribute('aria-label', c.aria);
      btn.style.setProperty('--vpill-color', colour(c.level));
      btn.style.setProperty('--edge-color', colour(c.edge));
      const [name, verdict, partsEl, line] = Array.from(btn.children) as HTMLElement[];
      if (name) name.textContent = c.name;
      if (verdict) verdict.textContent = c.headline;
      if (line) {
        line.textContent = c.line;
        line.hidden = c.line === '';
      }
      partsEl?.querySelectorAll<HTMLElement>('[data-fc-part]').forEach((el, p) => {
        const part = c.parts[p];
        el.className = `forecast__part forecast__part--${part?.worst ?? 'leeg'}${part && !part.ahead ? ' is-past' : ''}`;
        el.style.setProperty('--part-color', colour(part?.worst ?? null));
      });
    });
    // Roving tabindex: the checked radio, or "Nu" when the question is a date outside the strip.
    const focusIdx = next === undefined || next === null ? 0 : next + 1;
    radios.forEach((r, i) => {
      r.tabIndex = i === focusIdx ? 0 : -1;
    });
    const target = next === undefined || next === null ? null : dayBtns[next];
    if (target && changed) reveal(target);
    syncFade();
  };

  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fc-day], [data-fc-now]');
    if (!btn) return;
    onPick(btn.dataset.fcDay === undefined ? null : Number(btn.dataset.fcDay), false);
  });

  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const visible = radios.filter((r) => !r.hidden);
    const i = Math.max(0, visible.indexOf(document.activeElement as HTMLButtonElement));
    let n = i;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = Math.max(0, i - 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = Math.min(visible.length - 1, i + 1);
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = visible.length - 1;
    const target = visible[n];
    if (!target || n === i) return;
    target.focus();
    onPick(target.dataset.fcDay === undefined ? null : Number(target.dataset.fcDay), true);
  });

  return {
    update,
    focusChecked() {
      const r = radios.find((x) => x.tabIndex === 0);
      r?.focus();
    },
  };
}
