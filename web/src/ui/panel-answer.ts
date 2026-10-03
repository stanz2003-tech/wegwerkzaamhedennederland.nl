/**
 * The two answer surfaces of the map panel, moved out of main.ts so the panel can grow (place
 * mode, "per dag vooruitkijken") without main.ts growing with it:
 *   - the answer card in road mode ("Kan ik over de A27?"),
 *   - the line above the list outside road mode: "Zoek je weg of plaats voor een antwoord", or
 *     with a text filter the verdict sentence for the matches ("Met “Almkerk”: 1 plek dicht").
 *
 * Both take the part of the URL state they need, the items and `now`, and write into the
 * elements they are given; they hold no state of their own. Both return the sentence a screen
 * reader should hear when the user changed the question (main.ts passes it to ui/announce.ts
 * after a user action only).
 */
import { answerFor, areaSentence, hiddenSentence, type Answer } from '../data/answer';
import type { ForecastItem, When } from '../data/forecast';
import { horizonMs } from '../data/horizon';
import { TIME_WINDOWS, dayWindow, timeWindowRange, windowFromNow } from '../data/time';
import type { ItemFeature } from '../data/types';
import type { UrlState } from '../data/url-state';
import { slugify } from '../data/types';
import { answerAnnouncement, renderAnswerCard, type AnswerCardModel } from './answer-card';
import { SEARCH_PROMPT } from './copy';
import { fmtDay, fmtDayTime, plural } from './format';
import { roadPageHref } from './map-link';
import { dayQuestionWords, momentLong, windowQuestionWords } from './when-words';

/** The part of the URL state the panel answer reads. */
export type PanelQuestion = Pick<UrlState, 'mode' | 'time' | 'moment' | 'day' | 'part' | 'road' | 'query'>;

export interface PanelAnswerEls {
  panel: HTMLElement;
  answer: HTMLElement;
  summary: HTMLElement;
  hiddenBtn: HTMLButtonElement;
}

/**
 * The window of a picked date (`?dag=`, + `&deel=`), from `now` on as the strip judges today;
 * null without one. The list, the map and the answer card all use this one window.
 */
export function dayWindowOf(q: Pick<PanelQuestion, 'moment' | 'day' | 'part'>, now: number): { from: number; to: number } | null {
  if (q.moment !== null || q.day === null) return null;
  const w = dayWindow(q.day, q.part);
  return w ? windowFromNow(w, now) : null;
}

/** The "Wanneer?" choice as the answer module sees it. */
export function whenOf(q: PanelQuestion, now: number): When {
  if (q.moment !== null) return { kind: 'moment', at: q.moment };
  const day = dayWindowOf(q, now);
  if (day) return { kind: 'window', ...day };
  if (q.time === 'nu') return { kind: 'moment', at: now };
  const { from, to } = timeWindowRange(q.time, now);
  return { kind: 'window', from, to };
}

/** "nu" / "vandaag" / "za 20 sep 14:00" */
export function whenLabelOf(q: PanelQuestion): string {
  if (q.moment !== null) return fmtDayTime(q.moment);
  const day = q.day !== null ? dayWindow(q.day) : null;
  if (day) return q.part ? `${fmtDay(day.from)}, ${q.part}` : fmtDay(day.from);
  return (TIME_WINDOWS.find((w) => w.id === q.time)?.label ?? 'nu').toLowerCase();
}

/** The moment as part of the card's question: "zaterdag 3 oktober om 08:00", "dit weekend (…)". */
export function questionWhenOf(q: PanelQuestion, now: number): string {
  if (q.moment !== null) return momentLong(q.moment);
  if (q.day !== null) return dayQuestionWords(q.day, q.part, now) || 'nu';
  return windowQuestionWords(q.time, now);
}

/** True when the question is about another moment than now: the card then offers "Terug naar nu". */
export function isNotNow(q: Pick<PanelQuestion, 'moment' | 'day' | 'time'>): boolean {
  return q.moment !== null || q.day !== null || q.time !== 'nu';
}

/** Map features carry no detail shard: judged conservatively, as the map does (`d: null`). */
export function asForecast(features: readonly ItemFeature[]): ForecastItem[] {
  return features.map((f) => ({ f, d: null }));
}

export interface RoadAnswerOptions {
  /** "20:17" while the data is stale; the card then says "nu (gegevens van 20:17)". */
  dataAsOf?: string;
  /** Whether /weg/<slug>/ exists (data/entity-pages.ts); without it the card has no page link. */
  hasRoadPage?: (slug: string) => boolean;
  onExit(): void;
  /** "Terug naar nu" in the card: the caller resets the question to now. */
  onNow?(): void;
}

/**
 * The answer card in road mode; hides the card outside it. Returns the spoken form of the card
 * ("A27, voor auto's, morgen: Rijbaan dicht bij Gorinchem."), or null outside road mode.
 */
export function renderRoadAnswer(els: PanelAnswerEls, q: PanelQuestion, roadItems: readonly ItemFeature[], now: number, opts: RoadAnswerOptions): string | null {
  const road = q.road;
  if (!road) {
    els.answer.hidden = true;
    els.answer.innerHTML = '';
    els.panel.classList.remove('is-road');
    return null;
  }
  const answer = answerFor(asForecast(roadItems), q.mode, whenOf(q, now), { kind: 'road', name: road }, now, horizonMs());
  const sample = roadItems.find((f) => f.properties.roadType);
  els.answer.hidden = false;
  els.panel.classList.add('is-road');
  const model: AnswerCardModel = {
    road,
    roadType: sample?.properties.roadType ?? null,
    whenLabel: whenLabelOf(q),
    questionWhen: questionWhenOf(q, now),
    backToNow: opts.onNow !== undefined && isNotNow(q),
    mode: q.mode,
    answer,
    total: roadItems.length,
    // The panel says how many items the relevance switch hides under the switch itself.
    hiddenNote: false,
    ...(opts.dataAsOf ? { dataAsOf: opts.dataAsOf } : {}),
    // The day overview lives on the road page; the panel links there instead of growing a
    // second strip next to "Wanneer?" (zoek-6, vooruit-8).
    ...(opts.hasRoadPage?.(slugify(road)) ? { pageHref: roadPageHref(road, q), pageLabel: `Per dag vooruitkijken op de ${road} →` } : {}),
  };
  els.answer.innerHTML = renderAnswerCard(model);
  els.answer.querySelector('[data-answer-exit]')?.addEventListener('click', () => opts.onExit());
  els.answer.querySelector('[data-answer-now]')?.addEventListener('click', () => opts.onNow?.());
  return answerAnnouncement(model);
}

/**
 * The sentence above the list and the "N meldingen … verborgen" button. With a text filter the
 * list is every match in the country, not the viewport, so the sentence says `Met “Almkerk”:`.
 * Without one there is no count sentence ("In beeld: 2604 plekken dicht, …" answered nothing,
 * overzicht-5): the panel asks for a road or place, and main.ts adds the closed motorways at
 * national zoom (ui/closed-roads.ts) from the `answer` returned here.
 * Returns the sentence, how many items the relevance switch hides (for the filters summary,
 * ui/panel-layout.ts) and the answer for the view. That the list stops at its first 800 rows is
 * said under the list itself (ui/list.ts), not in a `title` that touch and screen-reader users
 * never get (toeg-11).
 */
export function renderPanelSummary(
  els: PanelAnswerEls,
  q: PanelQuestion,
  inView: readonly ItemFeature[],
  now: number,
  counts: { total: number },
  hideNvt: boolean,
  /** Place mode: the list is that place, not the viewport ("In Almkerk: …"). */
  placePrefix?: string,
): { text: string; hidden: number; answer: Answer } {
  const answer = answerFor(asForecast(inView), q.mode, whenOf(q, now), { kind: 'gebied', name: '' }, now, horizonMs());
  // Without a subject or a text filter there is no question to answer yet: the panel asks for one
  // (P8 overzicht-5). A place (P4) or a text filter gets the sentence about its own items.
  const prefix = placePrefix ?? (q.query ? `Met “${q.query}”` : null);
  const text = q.road
    ? `${plural(counts.total, 'melding', 'meldingen')} op de ${q.road} · ${whenLabelOf(q)}`
    : prefix
      ? areaSentence(answer, prefix)
      : SEARCH_PROMPT;
  els.summary.textContent = text;
  els.summary.removeAttribute('title');
  const hidden = hideNvt ? answer.hidden.length : 0;
  if (hidden > 0) {
    els.hiddenBtn.hidden = false;
    els.hiddenBtn.textContent = hiddenSentence(answer.hidden, q.mode);
    els.hiddenBtn.title = 'Toon deze meldingen toch (lichter op de kaart)';
  } else {
    els.hiddenBtn.hidden = true;
  }
  return { text, hidden, answer };
}
