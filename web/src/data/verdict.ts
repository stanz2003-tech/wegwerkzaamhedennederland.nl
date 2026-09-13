/**
 * The verdict: what a measure means for *you* — a car driver, a lorry driver or a cyclist —
 * in one short Dutch phrase. Pure functions; unit-tested in web/test/verdict.test.mjs.
 *
 * Input is the v3 impact data (`imp`, `veh`, `per`, `spd`, `lc`) that the pipeline puts on
 * every item, plus whatever the detail shard adds (`to`, `delay`, `queueM`, `periods`).
 * v2 data has none of that: `imp` is then read as `onbekend` and the verdict says so.
 */
import type { Period } from './periods';
import { parsePeriods, summarizePeriods } from './periods';
import type { Category, DelayBand, Impact, Vehicle } from './types';

/** Who is asking. Stored in the URL as `?v=` and in localStorage. */
export type VehicleMode = 'auto' | 'vracht' | 'fiets';

export const VEHICLE_MODES: readonly { id: VehicleMode; label: string; title: string }[] = [
  { id: 'auto', label: 'Auto', title: "Wat betekent dit voor auto's?" },
  { id: 'vracht', label: 'Vracht', title: 'Wat betekent dit voor vrachtverkeer?' },
  { id: 'fiets', label: 'Fiets', title: 'Wat betekent dit voor fietsers en brommers?' },
];

export const DEFAULT_VEHICLE_MODE: VehicleMode = 'auto';

export function isVehicleMode(v: string | null | undefined): v is VehicleMode {
  return v === 'auto' || v === 'vracht' || v === 'fiets';
}

/** `nvt` = the measure does not apply to the chosen vehicle group at all. */
export type VerdictLevel = 'dicht' | 'rijbaan' | 'hinder' | 'geen' | 'nvt' | 'onbekend';

export interface Verdict {
  level: VerdictLevel;
  /** Short Dutch headline: "Weg dicht", "Doorrijden mogelijk", "Geldt niet voor auto's". */
  label: string;
  /** One line of specifics: "1 rijstrook dicht · max 70 km/u · op bepaalde tijden". */
  detail?: string;
}

/** Order used for "worst verdict of the day": lower index = worse. `nvt` never wins. */
export const VERDICT_SEVERITY: readonly VerdictLevel[] = ['dicht', 'rijbaan', 'hinder', 'onbekend', 'geen', 'nvt'];

export interface VerdictMeta {
  /** Legend / pill wording. */
  label: string;
  /** One-line meaning for the legend. */
  meaning: string;
  /** CSS custom property that colours the pill (append-only block in tokens.css). */
  color: string;
}

export const VERDICT_META: Record<VerdictLevel, VerdictMeta> = {
  dicht: { label: 'Weg dicht', meaning: 'Je kunt er niet langs; volg de omleiding.', color: '--v-dicht' },
  rijbaan: { label: 'Rijbaan dicht', meaning: 'Eén rijbaan of richting is dicht; de andere kant is meestal open.', color: '--v-rijbaan' },
  hinder: { label: 'Doorrijden mogelijk', meaning: 'Je kunt er langs, met minder rijstroken, een lagere snelheid of vertraging.', color: '--v-hinder' },
  geen: { label: 'Geen hinder', meaning: 'De melding heeft geen merkbaar gevolg voor het verkeer.', color: '--v-geen' },
  nvt: { label: 'Geldt niet voor jou', meaning: 'De maatregel geldt alleen voor een ander soort verkeer.', color: '--v-nvt' },
  onbekend: { label: 'Hinder onbekend', meaning: 'De wegbeheerder heeft niet gemeld wat de maatregel voor je betekent.', color: '--v-onbekend' },
};

/* --------------------------------- vehicles --------------------------------- */

const MODE_GROUPS: Record<VehicleMode, readonly Vehicle[]> = {
  auto: ['car'],
  vracht: ['lorry'],
  fiets: ['bicycle', 'moped'],
};

const MODE_NOT_FOR: Record<VehicleMode, string> = {
  auto: "Geldt niet voor auto's",
  vracht: 'Geldt niet voor vrachtverkeer',
  fiets: 'Geldt niet voor fietsers',
};

const VEHICLE_ONLY: Record<Vehicle, string> = {
  car: "alleen auto's",
  lorry: 'alleen vrachtverkeer',
  bicycle: 'alleen fietspad',
  moped: 'alleen fietspad',
  bus: 'alleen bussen',
  agricultural: 'alleen landbouwverkeer',
  other: 'alleen overig verkeer',
};

const VEHICLE_NOUN: Record<Vehicle, string> = {
  car: "auto's",
  lorry: 'vrachtverkeer',
  bicycle: 'fietsers',
  moped: 'brommers',
  bus: 'bussen',
  agricultural: 'landbouwverkeer',
  other: 'overig verkeer',
};

const IMPACTS: readonly Impact[] = ['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend'];
const VEHICLES: readonly Vehicle[] = ['car', 'lorry', 'bicycle', 'moped', 'bus', 'agricultural', 'other'];

export function isImpact(v: unknown): v is Impact {
  return typeof v === 'string' && (IMPACTS as readonly string[]).includes(v);
}

export function isVehicle(v: unknown): v is Vehicle {
  return typeof v === 'string' && (VEHICLES as readonly string[]).includes(v);
}

/** Keeps only known vehicle groups; null when nothing (valid) is left. */
export function cleanVehicles(v: unknown): Vehicle[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter(isVehicle);
  return out.length > 0 ? Array.from(new Set(out)) : null;
}

/** True when a measure for these vehicle groups applies to the mode. Absent/empty = everyone. */
export function appliesToMode(veh: readonly Vehicle[] | null | undefined, mode: VehicleMode): boolean {
  if (!veh || veh.length === 0) return true;
  return MODE_GROUPS[mode].some((g) => veh.includes(g));
}

/** "alleen fietspad", "alleen vrachtverkeer", "alleen bussen en landbouwverkeer". */
export function onlyForLabel(veh: readonly Vehicle[]): string {
  const uniq = Array.from(new Set(veh.map((v) => VEHICLE_ONLY[v])));
  if (uniq.length === 1) return uniq[0] ?? '';
  const nouns = Array.from(new Set(veh.map((v) => VEHICLE_NOUN[v])));
  const last = nouns.pop();
  return `alleen ${nouns.join(', ')} en ${last}`;
}

/** Plural noun for the mode, used in count lines: "12 meldingen alleen voor fietsers verborgen". */
export function modeNoun(mode: VehicleMode): string {
  return mode === 'auto' ? "auto's" : mode === 'vracht' ? 'vrachtverkeer' : 'fietsers';
}

/** Who the hidden items ARE for, given the mode that hides them. */
export function othersNoun(veh: readonly Vehicle[] | null | undefined): string {
  if (!veh || veh.length === 0) return 'ander verkeer';
  const nouns = Array.from(new Set(veh.map((v) => (v === 'moped' ? 'fietsers' : VEHICLE_NOUN[v]))));
  if (nouns.length === 1) return nouns[0] ?? 'ander verkeer';
  return 'ander verkeer';
}

/* ---------------------------------- input ----------------------------------- */

/**
 * Everything the verdict reads. Both `ItemProperties` (GeoJSON) and `IndexItem` (index rows)
 * satisfy it; the optional detail fields come from the detail shard or an EntityFile.
 */
export interface VerdictInput {
  cat: Category;
  imp?: Impact | null;
  veh?: readonly Vehicle[] | null;
  per?: boolean | 0 | 1 | null;
  spd?: number | null;
  lc?: number | null;
}

export interface VerdictDetail {
  to?: string;
  delay?: DelayBand;
  delaySec?: number;
  queueM?: number;
  /** Recurring sub-periods, when the detail shard / EntityFile has been loaded. */
  periods?: readonly (readonly [string, string])[] | null;
  /** The moment the question is asked; defaults to "no moment" (period check skipped). */
  now?: number;
}

const DELAY_TEXT: Record<DelayBand, string | null> = {
  negligible: null,
  upToTenMinutes: 'tot 10 min vertraging',
  betweenTenMinutesAndThirtyMinutes: '10–30 min vertraging',
  betweenThirtyMinutesAndOneHour: '30–60 min vertraging',
  betweenOneHourAndThreeHours: '1–3 uur vertraging',
  longerThanThreeHours: 'meer dan 3 uur vertraging',
};

const PERIOD_HINT = 'op bepaalde tijden';

function kmLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 50) * 50} m`;
  return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(metres / 1000)} km`;
}

function hinderDetail(item: VerdictInput, d: VerdictDetail): string | undefined {
  const parts: string[] = [];
  if (item.cat === 'file') {
    const bits = ['file'];
    if (typeof d.queueM === 'number' && d.queueM > 0) bits.push(kmLabel(d.queueM));
    if (typeof d.delaySec === 'number' && d.delaySec > 0) bits.push(`${Math.max(1, Math.round(d.delaySec / 60))} min`);
    parts.push(bits.join(', '));
  } else {
    if (typeof item.lc === 'number' && item.lc > 0) parts.push(`${item.lc} ${item.lc === 1 ? 'rijstrook' : 'rijstroken'} dicht`);
    if (typeof item.spd === 'number' && item.spd > 0) parts.push(`max ${item.spd} km/u`);
    if (typeof d.delaySec === 'number' && d.delaySec > 0) parts.push(`${Math.max(1, Math.round(d.delaySec / 60))} min vertraging`);
    else if (d.delay && DELAY_TEXT[d.delay]) parts.push(DELAY_TEXT[d.delay] ?? '');
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/** Text for the recurring pattern when periods are known, else the generic hint. */
export function periodHint(periods: VerdictDetail['periods'], now: number | undefined): string {
  if (periods && periods.length > 0) {
    const s = summarizePeriods(periods, now ?? 0);
    if (s.kind === 'pattern') return `${s.days} ${s.from}–${s.to}`;
  }
  return PERIOD_HINT;
}

function insidePeriod(periods: readonly Period[], now: number): boolean {
  return periods.some((p) => p.start <= now && now <= p.end);
}

function join(...parts: (string | undefined)[]): string | undefined {
  const filled = parts.filter((p): p is string => typeof p === 'string' && p !== '');
  return filled.length ? filled.join(' · ') : undefined;
}

/* --------------------------------- verdict ---------------------------------- */

/**
 * The verdict of one item for one vehicle mode.
 *
 * 1. `veh` present and the mode's groups are not in it → `nvt` ("Geldt niet voor auto's"),
 *    with a detail naming who it IS for ("alleen fietspad").
 * 2. Recurring periods known and a moment given, moment outside every period → `geen`
 *    ("Geen hinder · buiten werktijden (ma–vr 22:00–05:00)").
 * 3. Otherwise `imp` decides; `per` appends the pattern or "op bepaalde tijden".
 */
export function verdictFor(item: VerdictInput, mode: VehicleMode, d: VerdictDetail = {}): Verdict {
  const veh = item.veh && item.veh.length > 0 ? item.veh : null;
  if (veh && !appliesToMode(veh, mode)) {
    return { level: 'nvt', label: MODE_NOT_FOR[mode], detail: onlyForLabel(veh) };
  }
  const hasPer = item.per === true || item.per === 1;
  const periods = hasPer && d.periods && d.periods.length > 0 ? parsePeriods(d.periods) : [];
  if (periods.length > 0 && typeof d.now === 'number' && !insidePeriod(periods, d.now)) {
    return { level: 'geen', label: 'Geen hinder', detail: `buiten werktijden (${periodHint(d.periods, d.now)})` };
  }
  const per = hasPer ? periodHint(d.periods, d.now) : undefined;
  const imp: Impact = isImpact(item.imp) ? item.imp : 'onbekend';
  switch (imp) {
    case 'dicht':
      return { level: 'dicht', label: 'Weg dicht', detail: join(d.to ? `richting ${d.to}` : undefined, per) };
    case 'rijbaan':
      return { level: 'rijbaan', label: 'Rijbaan dicht', detail: join(d.to ? `richting ${d.to}` : undefined, per) };
    case 'hinder':
      return { level: 'hinder', label: 'Doorrijden mogelijk', detail: join(hinderDetail(item, d), per) };
    case 'geen':
      return { level: 'geen', label: 'Geen hinder', detail: per };
    default:
      return { level: 'onbekend', label: 'Hinder onbekend', detail: per };
  }
}

/** Worse of two levels (`nvt` loses against everything). */
export function worseLevel(a: VerdictLevel | null, b: VerdictLevel): VerdictLevel {
  if (a === null) return b;
  return VERDICT_SEVERITY.indexOf(b) < VERDICT_SEVERITY.indexOf(a) ? b : a;
}

/** Is the item relevant for the mode at all (not `nvt`)? */
export function isRelevantFor(item: VerdictInput, mode: VehicleMode): boolean {
  return appliesToMode(item.veh ?? null, mode);
}

/** Counts per level over a list of verdicts (used by the day strip and the legend counts). */
export function countLevels(levels: readonly VerdictLevel[]): Record<VerdictLevel, number> {
  const counts: Record<VerdictLevel, number> = { dicht: 0, rijbaan: 0, hinder: 0, geen: 0, nvt: 0, onbekend: 0 };
  for (const l of levels) counts[l] += 1;
  return counts;
}

/** "2 dicht · 5 hinder" — only the levels that occur, worst first, `nvt`/`geen` last. */
export function countsLine(counts: Record<VerdictLevel, number>): string {
  const parts: string[] = [];
  for (const level of VERDICT_SEVERITY) {
    const n = counts[level];
    if (n <= 0 || level === 'nvt') continue;
    parts.push(`${n} ${level === 'onbekend' ? 'onbekend' : level}`);
  }
  return parts.join(' · ');
}
