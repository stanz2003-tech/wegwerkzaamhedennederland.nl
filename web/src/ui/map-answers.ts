/**
 * Everything above the map page's list that answers the question, in one call from main.ts
 * `render()`: the sentence above the list (or the search prompt), the closed motorways at
 * national zoom (overzicht-5), the road card (`?weg=`) and the place card (`?plaats=`).
 * Returns the text a screen reader should hear after a user action, in that order of precedence:
 * the road card, the place card, the closed motorways, the sentence.
 */
import type { EntityPages } from '../data/entity-pages';
import type { Category, ItemFeature } from '../data/types';
import type { PlaceRef, UrlState } from '../data/url-state';
import { MAX_CLOSED_ROADS, NATIONAL_ZOOM, closedMotorways, renderClosedRoads } from './closed-roads';
import { renderPanelSummary, renderRoadAnswer, whenLabelOf, type PanelAnswerEls } from './panel-answer';
import { clearPlaceAnswer, hasPlacePage, placePageHref, placePrefix, renderPlaceAnswer } from './place-mode';

export interface MapAnswersInput {
  els: PanelAnswerEls;
  closedRoadsEl: HTMLElement;
  url: UrlState;
  /** The resolved place of place mode, or null. */
  place: PlaceRef | null;
  /** In view (or on the road / in the place / matching the text) including the hidden nvt items. */
  inViewAll: readonly ItemFeature[];
  roadAll: readonly ItemFeature[];
  placeAll: readonly ItemFeature[];
  cats: ReadonlySet<Category> | null;
  /** Rows in the list, for "N meldingen op de A27". */
  total: number;
  hideNvt: boolean;
  zoom: number;
  /** "20:17" while the data is stale. */
  dataAsOf: string | undefined;
  pages: EntityPages | null;
  now: number;
  onExitRoad(): void;
  onExitPlace(): void;
  onNow(): void;
}

export interface MapAnswers {
  /** What the last render put on screen, in the form a screen reader should hear it. */
  text: string;
  /** How many items the relevance switch hides (for the filters summary). */
  hidden: number;
}

export function renderMapAnswers(i: MapAnswersInput): MapAnswers {
  const { els, url, place, cats, now } = i;
  const inCats = (list: readonly ItemFeature[]): readonly ItemFeature[] => (cats ? list.filter((f) => cats.has(f.properties.cat)) : list);
  const summary = renderPanelSummary(els, url, i.inViewAll, now, { total: i.total }, i.hideNvt, place ? placePrefix(place) : undefined);
  // At national zoom, outside road, place and text mode: name the motorways with a closure.
  const national = !url.road && !url.query && !place && i.zoom < NATIONAL_ZOOM;
  const closed = national ? closedMotorways(summary.answer.items, Number.POSITIVE_INFINITY) : [];
  const closedText = renderClosedRoads(i.closedRoadsEl, closed.slice(0, MAX_CLOSED_ROADS), whenLabelOf(url), closed.length > MAX_CLOSED_ROADS);
  const stale = i.dataAsOf ? { dataAsOf: i.dataAsOf } : {};
  const roadText = renderRoadAnswer(els, url, inCats(i.roadAll), now, {
    ...stale,
    hasRoadPage: (slug) => i.pages?.hasRoadPage(slug) ?? false,
    onExit: i.onExitRoad,
    onNow: i.onNow,
  });
  let placeText: string | null = null;
  if (place) {
    const pageHref = hasPlacePage(place, i.pages) ? placePageHref(place, url) : null;
    placeText = renderPlaceAnswer(els, url, place, inCats(i.placeAll), now, { ...stale, pageHref, onExit: i.onExitPlace, onNow: i.onNow });
  } else clearPlaceAnswer(els);
  return { text: roadText ?? placeText ?? closedText ?? summary.text, hidden: summary.hidden };
}
