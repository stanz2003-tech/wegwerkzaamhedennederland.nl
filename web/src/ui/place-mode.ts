/**
 * Place mode on the map (zoek-2, owner decision 3): a woonplaats or gemeente picked in the search
 * keeps the map, but the map and the list show only that place's items, and the answer card asks
 * "Kan ik door Almkerk?" with a link "Almkerk per dag bekijken →" to the place page.
 *
 * Kept out of main.ts so main only wires it. The items are matched with the same predicates as
 * the place pages (data/index.ts) and judged like road mode: map features without their detail
 * shard (`d: null`), which is conservative — a nightly closure can read heavier than on the place
 * page, never lighter. No verdict is computed differently here.
 */
import { answerFor } from '../data/answer';
import type { EntityPages } from '../data/entity-pages';
import { normalizeText } from '../data/filter';
import { horizonMs } from '../data/horizon';
import { matchesGemeente, matchesWoonplaats } from '../data/index';
import { applyAlias, didYouMeanHits, suggestPlaces, type PlaceHit } from '../data/search-index';
import { slugify, type ItemFeature, type ItemProperties } from '../data/types';
import { DEFAULT_URL_STATE, serializeUrlState, type PlaceRef } from '../data/url-state';
import { answerAnnouncement, renderAnswerCard, type AnswerCardModel } from './answer-card';
import { asForecast, isNotNow, questionWhenOf, whenLabelOf, whenOf, type PanelAnswerEls, type PanelQuestion } from './panel-answer';

/** "Almkerk" / "de gemeente Altena": the subject of "Kan ik door …?". */
export function placeSubject(place: Pick<PlaceRef, 'kind' | 'name'>): string {
  return place.kind === 'gemeente' ? `de gemeente ${place.name}` : place.name;
}

/** "In Almkerk" / "In de gemeente Altena": the start of the sentence above the list. */
export function placePrefix(place: Pick<PlaceRef, 'kind' | 'name'>): string {
  return `In ${placeSubject(place)}`;
}

/** Whether a title names the place as a whole word: "N322 · Almkerk" yes, "Almkerkseweg" no. */
export function titleNamesPlace(title: string | null | undefined, name: string): boolean {
  if (!title || !name) return false;
  const n = normalizeText(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${n}($|[^a-z0-9])`).test(normalizeText(title));
}

/**
 * Which items belong to the place: its woonplaats name, as on the place pages. A name that
 * occurs in more than one gemeente ("Hengelo") also needs the gemeente; an item without a
 * gemeente is kept. An item the pipeline gave no woonplaats but whose title names the place
 * ("N322 · Almkerk", gemeente Altena) is counted in too: leaving it out made "Kan ik door
 * Almkerk?" read "Niets gemeld" next to a closure at Almkerk. Every rule here can only add items,
 * so the answer can only get heavier, never lighter.
 */
export function placeMatcher(place: PlaceRef, pages: EntityPages | null): (p: Pick<ItemProperties, 'woonplaats' | 'gemeente' | 'title'>) => boolean {
  if (place.kind === 'gemeente') return (p) => matchesGemeente(p.gemeente, place.name);
  const gemeente = place.gemeente && pages?.isAmbiguousWoonplaats(place.name) ? place.gemeente : null;
  const home = place.gemeente ?? null;
  return (p) => {
    if (!p.woonplaats) return titleNamesPlace(p.title, place.name) && (!home || !p.gemeente || matchesGemeente(p.gemeente, home));
    return matchesWoonplaats(p.woonplaats, place.name) && (!gemeente || !p.gemeente || matchesGemeente(p.gemeente, gemeente));
  };
}

/** The place page with the same vehicle and moment or day: `/plaats/almkerk/?v=fiets&dag=2026-10-06`. */
export function placePageHref(place: Pick<PlaceRef, 'kind' | 'slug'>, q: Pick<PanelQuestion, 'mode' | 'time' | 'moment' | 'day' | 'part'>): string {
  const qs = serializeUrlState({ ...DEFAULT_URL_STATE, mode: q.mode, time: q.time, moment: q.moment, day: q.day, part: q.part });
  return `/${place.kind === 'gemeente' ? 'gemeente' : 'plaats'}/${place.slug}/${qs ? `?${qs}` : ''}`;
}

/** "Almkerk per dag bekijken →" / "De gemeente Altena per dag bekijken →". */
export function placePageLabel(place: Pick<PlaceRef, 'kind' | 'name'>): string {
  const s = placeSubject(place);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} per dag bekijken →`;
}

/**
 * A picked PDOK woonplaats or gemeente as a place reference: the slug of its page when the
 * manifest knows it (an ambiguous name is told apart by the gemeente in the PDOK weergavenaam),
 * otherwise the slug gen-pages would give it. Null for other types (a provincie stays zoom-only).
 */
export function placeFromHit(hit: Pick<PlaceHit, 'type' | 'label' | 'gemeente'>, pages: EntityPages | null): PlaceRef | null {
  if (hit.type === 'woonplaats') {
    const page = pages?.findWoonplaats(hit.label, hit.gemeente) ?? null;
    return { kind: 'woonplaats', slug: page?.slug ?? slugify(hit.label), name: page?.name ?? hit.label, gemeente: page?.gemeente ?? hit.gemeente };
  }
  if (hit.type === 'gemeente') {
    const page = pages?.findGemeente(hit.label) ?? null;
    return { kind: 'gemeente', slug: page?.slug ?? slugify(hit.label), name: page?.name ?? hit.label };
  }
  return null;
}

/**
 * `?plaats=<slug>` back to a named place; null when the manifest does not know the slug. A place
 * that already has a name (picked before the manifest arrived) gets the manifest's slug.
 */
export function resolvePlace(ref: PlaceRef, pages: EntityPages | null): PlaceRef | null {
  if (ref.name) return pages ? (placeFromHit({ type: ref.kind, label: ref.name, gemeente: ref.gemeente ?? null }, pages) ?? ref) : ref;
  if (!pages) return null;
  if (ref.kind === 'gemeente') {
    const g = pages.gemeenteBySlug(ref.slug);
    return g ? { kind: 'gemeente', slug: g.slug, name: g.name } : null;
  }
  const w = pages.woonplaatsBySlug(ref.slug);
  return w ? { kind: 'woonplaats', slug: w.slug, name: w.name, gemeente: w.gemeente } : null;
}

/** Whether the manifest has the page, so the card may link to it. */
export function hasPlacePage(place: PlaceRef, pages: EntityPages | null): boolean {
  if (!pages) return false;
  return place.kind === 'gemeente' ? pages.gemeenteBySlug(place.slug) !== null : pages.woonplaatsBySlug(place.slug) !== null;
}

export interface PlaceAnswerOptions {
  dataAsOf?: string;
  /** Only when the place page exists. */
  pageHref?: string | null;
  onExit(): void;
  /** "Terug naar nu" in the card: the caller resets the question to now. */
  onNow?(): void;
}

/**
 * The answer card in place mode, with the place's items (all moments; the answer picks the
 * moment). Returns the spoken form ("Almkerk, voor auto's, nu: Weg dicht.").
 */
export function renderPlaceAnswer(els: PanelAnswerEls, q: PanelQuestion, place: PlaceRef, items: readonly ItemFeature[], now: number, opts: PlaceAnswerOptions): string {
  const subject = { kind: place.kind, name: place.name } as const;
  const answer = answerFor(asForecast(items), q.mode, whenOf(q, now), subject, now, horizonMs());
  const model: AnswerCardModel = {
    subject: placeSubject(place),
    whenLabel: whenLabelOf(q),
    questionWhen: questionWhenOf(q, now),
    backToNow: opts.onNow !== undefined && isNotNow(q),
    mode: q.mode,
    answer,
    total: items.length,
    // The panel says how many items the relevance switch hides under the switch itself (taal-8).
    hiddenNote: false,
    exitLabel: 'Alle plaatsen',
    exitAction: 'Alle plaatsen tonen',
    ...(opts.pageHref ? { pageHref: opts.pageHref, pageLabel: placePageLabel(place) } : {}),
    ...(opts.dataAsOf ? { dataAsOf: opts.dataAsOf } : {}),
  };
  els.answer.hidden = false;
  els.panel.classList.remove('is-road');
  els.panel.classList.add('is-place');
  els.answer.innerHTML = renderAnswerCard(model);
  els.answer.querySelector('[data-answer-exit]')?.addEventListener('click', () => opts.onExit());
  els.answer.querySelector('[data-answer-now]')?.addEventListener('click', () => opts.onNow?.());
  return answerAnnouncement(model);
}

/** Clears the place-mode marker on the panel (the road card or the summary takes over). */
export function clearPlaceAnswer(els: PanelAnswerEls): void {
  els.panel.classList.remove('is-place');
}

/**
 * "Bedoelde je Gorinchem?" for the empty state of a text filter (the P1 hook in ui/list.ts):
 * PDOK first as typed, then fuzzy, once per query. Returns the hit when it is known, undefined
 * while it is being asked (`onReady` then fires), null when there is none.
 */
export function createDidYouMean(onReady: (query: string) => void): (query: string) => PlaceHit | null | undefined {
  const cache = new Map<string, PlaceHit | null>();
  return (query) => {
    const key = normalizeText(query);
    if (cache.has(key)) return cache.get(key);
    cache.set(key, null);
    const q = applyAlias(query);
    void suggestPlaces(q, undefined, 4, 'towns')
      .then((hits) => (hits.length > 0 ? hits : suggestPlaces(q, undefined, 4, 'towns', true)))
      .then((hits) => {
        const best = didYouMeanHits(hits)[0] ?? null;
        cache.set(key, best);
        if (best) onReady(query);
      })
      .catch(() => undefined);
    return undefined;
  };
}
