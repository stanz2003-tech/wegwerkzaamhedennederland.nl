/**
 * Verdict pill (list items, legend, day strip) and the verdict banner at the top of the detail
 * view. Colours come from the `--v-*` tokens (append-only block in tokens.css).
 */
import { VERDICT_META, type Verdict, type VerdictLevel } from '../data/verdict';
import { esc } from './format';
import { ICONS } from './icons';

export interface PillOptions {
  size?: 'sm' | 'md' | 'lg';
  /** Override the label (e.g. the short legend wording). */
  label?: string;
}

/**
 * The mark before the label. "Weg dicht" and "Rijbaan dicht" are red and orange-red, which look
 * alike to many colour-blind readers, so they also differ in shape: a cross for "weg dicht", the
 * barrier stripe in the dot for "rijbaan dicht" (components.css). Decorative; the label says it.
 */
export function pillMark(level: VerdictLevel): string {
  if (level === 'dicht') return `<span class="vpill__icon" aria-hidden="true">${ICONS.x}</span>`;
  return '<span class="vpill__dot" aria-hidden="true"></span>';
}

export function renderVerdictPill(v: Pick<Verdict, 'level' | 'label'>, opts: PillOptions = {}): string {
  const meta = VERDICT_META[v.level];
  const size = opts.size ?? 'md';
  return `<span class="vpill vpill--${v.level} vpill--${size}" style="--vpill-color: var(${meta.color})">${pillMark(v.level)}${esc(opts.label ?? v.label)}</span>`;
}

/**
 * "Weg dicht · richting Utrecht · nog 2 u 15 min" as a full-width banner. `extra` lines are
 * appended after the verdict detail (the status text, the period pattern).
 */
export function renderVerdictBanner(v: Verdict, extra: readonly string[] = []): string {
  const meta = VERDICT_META[v.level];
  const parts = [v.detail, ...extra].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return `<div class="vbanner vbanner--${v.level}" style="--vpill-color: var(${meta.color})" role="status">
      <p class="vbanner__label">${esc(v.label)}</p>
      ${parts.length ? `<p class="vbanner__detail">${parts.map((p) => esc(p)).join(' <span aria-hidden="true">·</span> ')}</p>` : ''}
    </div>`;
}
