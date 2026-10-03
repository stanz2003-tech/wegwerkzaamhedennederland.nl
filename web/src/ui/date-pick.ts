/**
 * The date control of "Wanneer?" — on the map panel (ui/when-control.ts) and on the road and
 * place pages (ui/forecast-block.ts): a labelled `<input type="date">`, then a row of day-part
 * chips "Hele dag · Nacht 00–06 · Ochtend 06–12 · Middag 12–18 · Avond 18–24 · Precies tijdstip".
 *
 * A date alone is a question about the whole day, answered with the heaviest verdict of that day
 * (owner decision 1); a day part narrows the window. Only "Precies tijdstip" plus a time makes a
 * moment. The old `datetime-local` did nothing until both date and time were filled in, so
 * picking "dinsdag" in the calendar silently changed nothing (vooruit-9).
 */
import { DAY_PARTS, isDateKey, localDateKey, type DayPart } from '../data/time';
import { formatLocalDateTime, parseLocalDateTime, type UrlState } from '../data/url-state';
import { esc } from './format';
import { ICONS } from './icons';

export type DatePick = { kind: 'day'; date: string; part: DayPart | null } | { kind: 'moment'; at: number };

/** The date control's view of the URL: a moment, a day (+ part), or nothing. */
export function pickOfUrl(u: Pick<UrlState, 'moment' | 'day' | 'part'>): DatePick | null {
  if (u.moment !== null) return { kind: 'moment', at: u.moment };
  if (u.day !== null) return { kind: 'day', date: u.day, part: u.part };
  return null;
}

/** The chip that is on: the whole day, a part, or the exact time. */
type ChipId = 'hele' | DayPart | 'tijd';

const CHIPS: readonly { id: ChipId; label: string }[] = [
  { id: 'hele', label: 'Hele dag' },
  ...DAY_PARTS.map((p) => ({ id: p.id as ChipId, label: `${p.label} ${String(p.fromHour).padStart(2, '0')}–${String(p.toHour).padStart(2, '0')}` })),
  { id: 'tijd', label: 'Precies tijdstip' },
];

/**
 * The one hint under "Wanneer?", the same on the map and on the entity pages: what the answer
 * means for the kind of question asked. '' for "nu".
 */
export function whenHint(kind: 'nu' | 'window' | 'day' | 'part' | 'moment'): string {
  switch (kind) {
    case 'moment':
      return 'Je ziet wat op dat moment geldt. Werk dat alleen op bepaalde tijden geldt, wordt zo gemeld.';
    case 'day':
      return 'Je ziet het zwaarste dat die dag ergens geldt. Kies een dagdeel of een precies tijdstip om het smaller te maken.';
    case 'part':
      return 'Je ziet het zwaarste dat in dat dagdeel ergens geldt.';
    case 'window':
      return 'Je ziet het zwaarste dat in die periode ergens geldt.';
    default:
      return '';
  }
}

/** The hint kind of a pick (null = no date chosen). */
export function pickHintKind(p: DatePick | null): 'nu' | 'day' | 'part' | 'moment' {
  if (!p) return 'nu';
  if (p.kind === 'moment') return 'moment';
  return p.part ? 'part' : 'day';
}

export interface DatePickOptions {
  /** BEM block of the host ("when" / "forecast"): the date row keeps its `<block>__date` styling. */
  block: string;
  /** Prefix for element ids ("when" → #when-date, #when-time). */
  id: string;
  /** Ids of the hint lines the date input is described by. */
  describedBy: string;
  onPick(pick: DatePick | null): void;
}

export interface DatePickControl {
  /** Shows a pick without reporting it back (URL, strip day, "Terug naar nu"). */
  set(pick: DatePick | null): void;
  get(): DatePick | null;
  focus(): void;
}

function sameDatePick(a: DatePick | null, b: DatePick | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'moment' || b.kind === 'moment') return a.kind === b.kind && (a as { at: number }).at === (b as { at: number }).at;
  return a.date === b.date && a.part === b.part;
}

export function mountDatePick(root: HTMLElement, opts: DatePickOptions): DatePickControl {
  const { block, id } = opts;
  root.classList.add('datepick');
  root.innerHTML = `<div class="${block}__date datepick__date">
      <label class="${block}__date-label" for="${id}-date">${ICONS.calendar}<span>Datum</span></label>
      <input id="${id}-date" class="${block}__input datepick__input" type="date" aria-describedby="${esc(opts.describedBy)}" />
      <button type="button" class="${block}__clear" data-dp-clear aria-label="Datum wissen" hidden>${ICONS.x}</button>
    </div>
    <div class="datepick__parts" role="radiogroup" aria-label="Welk deel van de dag?" data-dp-parts hidden>${CHIPS.map(
      (c) => `<button type="button" class="datepick__chip" role="radio" aria-checked="false" tabindex="-1" data-dp-chip="${c.id}">${esc(c.label)}</button>`,
    ).join('')}</div>
    <div class="datepick__time" data-dp-time hidden>
      <label class="datepick__time-label" for="${id}-time">Tijdstip</label>
      <input id="${id}-time" class="datepick__input" type="time" step="900" />
    </div>`;
  const dateInput = root.querySelector<HTMLInputElement>(`#${id}-date`);
  const timeInput = root.querySelector<HTMLInputElement>(`#${id}-time`);
  const clear = root.querySelector<HTMLButtonElement>('[data-dp-clear]');
  const partsEl = root.querySelector<HTMLElement>('[data-dp-parts]');
  const timeEl = root.querySelector<HTMLElement>('[data-dp-time]');
  if (!dateInput || !timeInput || !clear || !partsEl || !timeEl) throw new Error('datum-markup ontbreekt');

  let date: string | null = null;
  let chip: ChipId = 'hele';
  let last: DatePick | null = null;

  const current = (): DatePick | null => {
    if (date === null) return null;
    if (chip === 'tijd') {
      // Until a time is typed the question stays the whole day: the more cautious one.
      const at = timeInput.value ? parseLocalDateTime(`${date}T${timeInput.value}`) : null;
      return at === null ? { kind: 'day', date, part: null } : { kind: 'moment', at };
    }
    return { kind: 'day', date, part: chip === 'hele' ? null : chip };
  };

  const render = (): void => {
    const has = date !== null;
    root.classList.toggle('has-date', has);
    clear.hidden = !has;
    partsEl.hidden = !has;
    timeEl.hidden = !has || chip !== 'tijd';
    if (dateInput.value !== (date ?? '') && document.activeElement !== dateInput) dateInput.value = date ?? '';
    partsEl.querySelectorAll<HTMLButtonElement>('[data-dp-chip]').forEach((btn) => {
      const on = btn.dataset.dpChip === chip;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      btn.tabIndex = on ? 0 : -1;
    });
  };

  const emit = (): void => {
    render();
    const next = current();
    if (sameDatePick(next, last)) return;
    last = next;
    opts.onPick(next);
  };

  const applyDate = (): void => {
    const v = dateInput.value;
    if (isDateKey(v)) {
      if (v === date) return;
      date = v;
      emit();
      return;
    }
    // A half-typed date reports '' in every browser; only a cleared field resets the question.
    if (v === '' && date !== null && document.activeElement !== dateInput) {
      date = null;
      chip = 'hele';
      timeInput.value = '';
      emit();
    }
  };
  dateInput.addEventListener('change', applyDate);
  dateInput.addEventListener('blur', applyDate);
  dateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyDate();
    }
  });

  const pickChip = (next: ChipId, focus: boolean): void => {
    chip = next;
    emit();
    if (focus) partsEl.querySelector<HTMLButtonElement>(`[data-dp-chip="${next}"]`)?.focus();
    if (next === 'tijd' && !focus) timeInput.focus();
  };
  partsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-dp-chip]');
    if (btn) pickChip(btn.dataset.dpChip as ChipId, false);
  });
  partsEl.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const ids = CHIPS.map((c) => c.id);
    const i = Math.max(0, ids.indexOf(chip));
    let n = i;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + ids.length) % ids.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % ids.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = ids.length - 1;
    const next = ids[n];
    if (next) pickChip(next, true);
  });

  timeInput.addEventListener('change', emit);
  timeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      emit();
    }
  });

  clear.addEventListener('click', () => {
    date = null;
    chip = 'hele';
    timeInput.value = '';
    dateInput.value = '';
    emit();
    dateInput.focus();
  });

  const set = (pick: DatePick | null): void => {
    // The host echoes every pick back; "Precies tijdstip" without a time yet must stay open.
    if (sameDatePick(pick, current())) {
      last = pick;
      render();
      return;
    }
    if (pick === null) {
      date = null;
      chip = 'hele';
      timeInput.value = '';
      if (document.activeElement !== dateInput) dateInput.value = '';
    } else if (pick.kind === 'moment') {
      date = localDateKey(pick.at);
      chip = 'tijd';
      timeInput.value = formatLocalDateTime(pick.at).slice(11);
    } else {
      date = pick.date;
      chip = pick.part ?? 'hele';
    }
    last = pick;
    render();
  };

  render();
  return { set, get: () => last, focus: () => dateInput.focus() };
}
