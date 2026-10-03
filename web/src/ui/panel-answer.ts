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
import { TIME_WINDOWS, timeWindowRange } from '../data/time';
import type { ItemFeature } from '../data/types';
import type { UrlState } from '../data/url-state';
import { answerAnnouncement, renderAnswerCard, type AnswerCardModel } from './answer-card';
import { SEARCH_PROMPT } from './copy';
import { fmtDayTime, plural } from './format';

/** The part of the URL state the panel answer reads. */
export type PanelQuestion = Pick<UrlState, 'mode' | 'time' | 'moment' | 'road' | 'query'>;

export interface PanelAnswerEls {
  panel: HTMLElement;
  answer: HTMLElement;
  summary: HTMLElement;
  hiddenBtn: HTMLButtonElement;
}

/** The "Wanneer?" choice as the answer module sees it. */
export function whenOf(q: PanelQuestion, now: number): When {
  if (q.moment !== null) return { kind: 'moment', at: q.moment };
  if (q.time === 'nu') return { kind: 'moment', at: now };
  const { from, to } = timeWindowRange(q.time, now);
  return { kind: 'window', from, to };
}

/** "nu" / "vandaag" / "za 20 sep 14:00" */
export function whenLabelOf(q: PanelQuestion): string {
  if (q.moment !== null) return fmtDayTime(q.moment);
  return (TIME_WINDOWS.find((w) => w.id === q.time)?.label ?? 'nu').toLowerCase();
}

/** Map features carry no detail shard: judged conservatively, as the map does (`d: null`). */
export function asForecast(features: readonly ItemFeature[]): ForecastItem[] {
  return features.map((f) => ({ f, d: null }));
}

export interface RoadAnswerOptions {
  /** "20:17" while the data is stale; the card then says "nu (gegevens van 20:17)". */
  dataAsOf?: string;
  onExit(): void;
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
    mode: q.mode,
    answer,
    total: roadItems.length,
    // The panel says how many items the relevance switch hides under the switch itself.
    hiddenNote: false,
    ...(opts.dataAsOf ? { dataAsOf: opts.dataAsOf } : {}),
  };
  els.answer.innerHTML = renderAnswerCard(model);
  els.answer.querySelector('[data-road-exit]')?.addEventListener('click', () => opts.onExit());
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
): { text: string; hidden: number; answer: Answer } {
  const answer = answerFor(asForecast(inView), q.mode, whenOf(q, now), { kind: 'gebied', name: '' }, now, horizonMs());
  const text = q.road
    ? `${plural(counts.total, 'melding', 'meldingen')} op de ${q.road} · ${whenLabelOf(q)}`
    : q.query
      ? areaSentence(answer, `Met “${q.query}”`)
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
