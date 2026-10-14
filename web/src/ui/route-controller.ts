/**
 * Route mode on the map page (`?van=…&naar=…`): the "Route plannen" form, the routes from the
 * router, the verdict per route, the route card, the routes on the map, and which items the list
 * and the map show (only those on the chosen route). main.ts owns the URL state and hands this
 * module what it needs (`RouteHost`), as with place mode (ui/place-controller.ts). What the list,
 * map and card show is computed in ui/route-view.ts; this module holds the state.
 *
 * The router is asked again only when the stops or the vehicle change, or when another moment
 * puts a closure on the fastest route that the routes at hand do not avoid yet. A change of
 * moment otherwise only re-judges the routes already known (the matches per route are cached).
 * A plan that a newer one (or leaving route mode) makes pointless is aborted, so its remaining
 * requests never reach the public router.
 */
import { loadDetail } from '../data/detail';
import { horizonMs } from '../data/horizon';
import { createRouteMatcher, type LonLat, type RouteMatch } from '../data/route-match';
import { assessMatches, planRoutes, rankRoutes, type AssessedRoute, type RoutePlan } from '../data/route-plan';
import { RoutingError, fetchRoutes, type RouteOption } from '../data/routing';
import type { ItemDetail, ItemFeature } from '../data/types';
import type { HistoryMarker, RouteStops, UrlState } from '../data/url-state';
import type { AppMap } from '../map/map';
import { ICONS } from './icons';
import type { LeaveOptions } from './place-controller';
import { questionWhenOf, whenOf } from './panel-answer';
import { renderRouteCard, routeAnnouncement, type RouteCardModel } from './route-card';
import { mountRouteForm } from './route-form';
import { bboxOfRoutes, drawingOf, optionKeyOf, pendingSelection, readyModel, routeSelection, stopsKeyOf, viaPointsFor, whenKeyOf, type RouteSelection } from './route-view';

export type { RouteSelection } from './route-view';

const STEP: HistoryMarker = { wegwerk: true };
const MINUTE = 60_000;
/** Clicking through moments: wait until the user settles before asking the router again. */
const REPLAN_DELAY_MS = 600;
/** A route across town should not zoom the map to street level. */
const FIT_MAX_ZOOM = 13;
const GEPLAND_FAILED = 'De geplande werkzaamheden konden niet worden geladen, dus we weten niet wat er onderweg begint. Probeer het opnieuw.';

export interface RouteHost {
  url(): UrlState;
  setUrl(next: UrlState): void;
  render(): void;
  syncUrl(push: HistoryMarker | false): void;
  map(): AppMap | null;
  /** Live, actueel and gepland items: a trip can run into work that starts on the way. */
  items(): readonly ItemFeature[];
  /** Changes whenever the items change (a live refresh, werk-gepland arriving). */
  dataVersion(): string;
  /** Loads werk-gepland; resolves to whether it is in. */
  ensureGepland(): Promise<boolean>;
  /** Empties the search box: a route replaces the road, place or text it held. */
  clearSearch(): void;
  deselect(): void;
  showAnswer(withMap: boolean): void;
  afterLeave(o: LeaveOptions): void;
  dataAsOf(now: number): string | undefined;
  /** The start data is in: before that a plan would judge the routes against nothing. */
  dataOk(): boolean;
  /** Room for the form: the full sheet on a phone (the keyboard comes up), `el` scrolled into view. */
  expand(el: HTMLElement): void;
}

export interface RouteController {
  /** Route mode is on (stops in the URL). */
  active(): boolean;
  selection(now: number): RouteSelection | null;
  /** Paints the card (or hides it); returns the spoken answer in route mode, else null. */
  paint(now: number): string | null;
  /** Frames the routes once after a new plan (no-op until the map and the plan are there). */
  fitOnce(): void;
  /** Stops from the URL (boot, back button): plan them without a history step. */
  restore(stops: RouteStops | null): void;
  exit(o?: LeaveOptions): void;
  open(): void;
}

interface Planned {
  stopsKey: string;
  mode: string;
  /** The moment the routes were planned for: a new closure at another moment may need a replan. */
  whenKey: string;
  options: { option: RouteOption; avoiding: boolean; match: (f: readonly ItemFeature[]) => RouteMatch[] }[];
}

async function loadDetails(ids: readonly string[]): Promise<Map<string, ItemDetail>> {
  const pairs = await Promise.all(ids.map((id) => loadDetail(id).then((d) => [id, d] as const).catch(() => [id, null] as const)));
  return new Map(pairs.filter((p): p is readonly [string, ItemDetail] => p[1] !== null));
}

function mountToggle(slot: HTMLElement): { toggle: HTMLButtonElement; formEl: HTMLElement; cardEl: HTMLElement } {
  const toggle = document.createElement('button');
  const formEl = document.createElement('div');
  const cardEl = document.createElement('div');
  toggle.type = 'button';
  toggle.className = 'route-cta';
  toggle.setAttribute('aria-controls', 'route-form-box');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `${ICONS.route}<span class="route-cta__text"><strong>Route plannen</strong><span>Wegwerkzaamheden op je route, en de snelste route eromheen</span></span>${ICONS.chevronRight}`;
  formEl.id = 'route-form-box';
  formEl.hidden = true;
  slot.append(toggle, formEl, cardEl);
  slot.hidden = false;
  return { toggle, formEl, cardEl };
}

export function createRouteController(host: RouteHost, els: { panel: HTMLElement; slot: HTMLElement }): RouteController {
  const { toggle, formEl, cardEl } = mountToggle(els.slot);

  let formOpen = false;
  let planned: Planned | null = null;
  let planning: string | null = null;
  let status: 'idle' | 'loading' | 'error' = 'idle';
  let errorText = '';
  /** `stops|mode` the error belongs to: another vehicle or other stops deserve a fresh try. */
  let errorKey = '';
  /** The route the user picked, by identity: a re-judge may reorder the routes. */
  let selectedKey: string | null = null;
  let details = new Map<string, ItemDetail>();
  /** Ids whose detail was asked and is not there: not asked again every minute. */
  const noDetail = new Set<string>();
  let judged: { plan: RoutePlan; key: string } | null = null;
  const viaCache = new Map<string, LonLat[]>();
  let itemsMemo: { version: string; items: readonly ItemFeature[] } | null = null;
  // A route in the URL at boot is framed once its plan is in.
  let fitPending = host.url().route !== null;
  let announceWhenReady = false;
  let drawnKey = '';
  let seq = 0;
  let inFlight: AbortController | null = null;
  let replanTimer: ReturnType<typeof setTimeout> | null = null;

  const stops = (): RouteStops | null => host.url().route;
  const subjectKey = (s: RouteStops): string => `${stopsKeyOf(s)}|${host.url().mode}`;
  const horizon = (): { horizonMs?: number } => {
    const h = horizonMs();
    return h !== undefined ? { horizonMs: h } : {};
  };

  /** The items once per data version: `host.items()` deduplicates every call. */
  function items(): readonly ItemFeature[] {
    const version = host.dataVersion();
    if (itemsMemo?.version !== version) itemsMemo = { version, items: host.items() };
    return itemsMemo.items;
  }

  function cancel(): void {
    seq += 1;
    planning = null;
    inFlight?.abort();
    inFlight = null;
    if (replanTimer) clearTimeout(replanTimer);
    replanTimer = null;
  }

  function reset(): void {
    cancel();
    planned = null;
    judged = null;
    selectedKey = null;
    status = 'idle';
    viaCache.clear();
  }

  const form = mountRouteForm(formEl, {
    onSubmit: (next) => enter(next),
    onCancel: () => closeForm(),
  });

  /**
   * Opening or closing the form changes only this slot: repaint the slot, not the whole page.
   * A full render here (list, answer, map) made the tap on "Route plannen" slow (INP).
   */
  function paintSlot(): void {
    api.paint(Date.now());
  }

  function closeForm(): void {
    formOpen = false;
    toggle.setAttribute('aria-expanded', 'false');
    paintSlot();
    if (!stops()) toggle.focus();
    else cardEl.querySelector<HTMLElement>('.answer__headline')?.focus();
  }

  function openForm(): void {
    formOpen = true;
    toggle.setAttribute('aria-expanded', 'true');
    form.set(stops());
    paintSlot();
    host.expand(formEl);
    form.focus();
  }

  async function detailsFor(ids: readonly string[]): Promise<ReadonlyMap<string, ItemDetail>> {
    const missing = ids.filter((id) => !details.has(id) && !noDetail.has(id));
    if (missing.length > 0) {
      const more = await loadDetails(missing);
      for (const id of missing) if (!more.has(id)) noDetail.add(id);
      details = new Map([...details, ...more]);
    }
    return details;
  }

  async function runPlan(s: RouteStops, url: UrlState, now: number, signal: AbortSignal): Promise<Planned> {
    // A trip of an hour, asked "nu", can run into work that only starts on the way: that is in
    // werk-gepland. Without it the route would read clearer than it is.
    if (!(await host.ensureGepland())) throw new RoutingError(GEPLAND_FAILED, 'failed');
    const result = await planRoutes(
      { from: s.from, to: s.to, mode: url.mode, when: whenOf(url, now), now, ...horizon() },
      { route: (req) => fetchRoutes(req, signal), items, details: detailsFor },
    );
    return {
      stopsKey: stopsKeyOf(s),
      mode: url.mode,
      whenKey: whenKeyOf(url),
      options: result.routes.map((r) => ({ option: r.option, avoiding: r.avoiding, match: createRouteMatcher(r.option.coords) })),
    };
  }

  /** Asks the router (again) for the current stops, vehicle and moment. */
  function plan(now: number): void {
    const s = stops();
    if (!s) return;
    const url = host.url();
    const key = `${subjectKey(s)}|${whenKeyOf(url)}`;
    if (planning === key) return;
    cancel();
    planning = key;
    const mine = seq;
    const ctrl = new AbortController();
    inFlight = ctrl;
    if (!planned || planned.stopsKey !== stopsKeyOf(s) || planned.mode !== url.mode) status = 'loading';
    void runPlan(s, url, now, ctrl.signal)
      .then((next) => {
        if (mine !== seq) return;
        planned = next;
        status = 'idle';
        judged = null;
        viaCache.clear();
      })
      .catch((err: unknown) => {
        if (mine !== seq) return;
        status = 'error';
        errorKey = subjectKey(s);
        errorText = err instanceof RoutingError ? err.message : 'De route kon niet worden berekend. Probeer het zo nog eens.';
      })
      .finally(() => {
        if (mine !== seq) return;
        planning = null;
        inFlight = null;
        host.render();
        if (announceWhenReady && stops()) {
          announceWhenReady = false;
          host.showAnswer(true);
        }
      });
  }

  /** Waits until the user settles on a moment, then asks the router for a way round. */
  function scheduleReplan(): void {
    if (replanTimer || planning !== null || status !== 'idle') return;
    replanTimer = setTimeout(() => {
      replanTimer = null;
      plan(Date.now());
    }, REPLAN_DELAY_MS);
  }

  /** The plan judged for the current question; null while there is none. */
  function judge(now: number): RoutePlan | null {
    const s = stops();
    const url = host.url();
    if (!s || !planned || planned.stopsKey !== stopsKeyOf(s) || planned.mode !== url.mode) return null;
    // Re-judged every minute ("nu" moves on, and the trip window with it) and on every data change.
    const key = `${whenKeyOf(url)}|${Math.floor(now / MINUTE)}|${host.dataVersion()}|${details.size}|${url.mode}`;
    if (judged?.key === key) return judged.plan;
    const all = items();
    const q = { mode: url.mode, when: whenOf(url, now), now, ...horizon() };
    const assessed: AssessedRoute[] = planned.options.map((o) => assessMatches(o.option, o.match(all), all, details, q, o.avoiding));
    const plain = assessed.filter((r) => !r.avoiding);
    const fastest = [...plain].sort((a, b) => a.option.durationS - b.option.durationS)[0];
    // A route "om de afsluiting heen" only means something while the fastest route has one.
    const shown = fastest && fastest.blockers.length > 0 ? assessed : plain;
    const result = rankRoutes(shown.length > 0 ? shown : assessed);
    judged = { plan: result, key };
    // Details for items the routes meet now (live items appear, other moments): load, then re-judge.
    const ids = [...new Set(assessed.flatMap((r) => r.on.map((m) => m.id)))];
    if (ids.some((id) => !details.has(id) && !noDetail.has(id))) {
      const before = details.size;
      void detailsFor(ids).then(() => details.size > before && host.render());
    }
    // Another moment closed the fastest route and nothing at hand goes round it: ask the router.
    // Never on its own while the router fails: "Opnieuw" is the way out, not a retry every minute.
    if (result.noClearRoute && planned.whenKey !== whenKeyOf(url)) scheduleReplan();
    return result;
  }

  function chosenIndex(p: RoutePlan): number {
    const i = selectedKey ? p.routes.findIndex((r) => optionKeyOf(r.option) === selectedKey) : -1;
    return i >= 0 ? i : Math.min(p.recommended, p.routes.length - 1);
  }

  function viaOf(route: AssessedRoute, p: RoutePlan): LonLat[] {
    const key = `${optionKeyOf(route.option)}|${p.routes.map((r) => optionKeyOf(r.option)).join(',')}`;
    let via = viaCache.get(key);
    if (!via) {
      via = viaPointsFor(route, p);
      viaCache.set(key, via);
    }
    return via;
  }

  function draw(p: RoutePlan | null): void {
    const map = host.map();
    if (!map) return;
    const s = stops();
    const chosen = p ? chosenIndex(p) : -1;
    const key = s ? `${stopsKeyOf(s)}|${p ? p.routes.map((r, i) => `${optionKeyOf(r.option)}:${i === chosen ? 1 : 0}`).join(',') : '-'}` : '';
    if (key === drawnKey) return;
    drawnKey = key;
    map.setRoute(drawingOf(s, p, chosen));
  }

  function enter(next: RouteStops): void {
    host.clearSearch();
    host.deselect();
    host.setUrl({ ...host.url(), route: next, road: null, place: null, query: '' });
    formOpen = false;
    toggle.setAttribute('aria-expanded', 'false');
    reset();
    fitPending = true;
    announceWhenReady = true;
    host.render();
    host.syncUrl(STEP);
    host.showAnswer(true);
  }

  function exit(o: LeaveOptions = {}): void {
    if (!stops()) return;
    host.setUrl({ ...host.url(), route: null });
    reset();
    host.render();
    host.syncUrl(o.push === false ? false : STEP);
    host.afterLeave(o);
  }

  /** Another subject (a road, a place, a text filter) took over: stop what route mode was doing. */
  function leftByOthers(): void {
    if (planning !== null || inFlight || planned) reset();
    announceWhenReady = false;
    fitPending = false;
  }

  function cardModel(s: RouteStops, now: number): RouteCardModel {
    const url = host.url();
    if (status === 'error') return { status: 'error', from: s.from, to: s.to, mode: url.mode, message: errorText };
    const p = status === 'loading' ? null : judge(now);
    if (!p || p.routes.length === 0) return { status: 'loading', from: s.from, to: s.to, mode: url.mode };
    return readyModel({
      stops: s,
      url,
      plan: p,
      chosen: chosenIndex(p),
      items: items(),
      when: whenOf(url, now),
      now,
      questionWhen: questionWhenOf(url, now),
      updating: planning !== null,
      dataAsOf: host.dataAsOf(now),
      via: (r) => viaOf(r, p),
    });
  }

  toggle.addEventListener('click', () => openForm());

  cardEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const opt = t.closest<HTMLElement>('[data-route-opt]');
    if (opt && judged) {
      const route = judged.plan.routes[Number(opt.dataset.routeOpt)];
      if (route) selectedKey = optionKeyOf(route.option);
      host.render();
      cardEl.querySelector<HTMLElement>(`[data-route-opt="${opt.dataset.routeOpt ?? ''}"]`)?.focus();
      return;
    }
    if (t.closest('[data-route-exit]')) exit();
    else if (t.closest('[data-route-edit]')) openForm();
    else if (t.closest('[data-route-retry]')) {
      reset();
      announceWhenReady = true;
      host.render();
    }
  });

  const api: RouteController = {
    active: () => stops() !== null,

    selection(now) {
      const s = stops();
      if (!s) return null;
      if (status === 'error' && errorKey !== subjectKey(s)) status = 'idle';
      const url = host.url();
      if (!planned || planned.stopsKey !== stopsKeyOf(s) || planned.mode !== url.mode) {
        if (status !== 'error' && host.dataOk()) plan(now);
        return pendingSelection(status === 'error' ? 'error' : 'loading', now);
      }
      const p = judge(now);
      const route = p ? p.routes[chosenIndex(p)] : undefined;
      if (!p || !route) return pendingSelection('loading', now);
      return routeSelection(route, items(), whenOf(url, now), now);
    },

    paint(now) {
      const s = stops();
      els.panel.classList.toggle('is-route', s !== null);
      toggle.hidden = formOpen || s !== null;
      formEl.hidden = !formOpen;
      if (!s) {
        leftByOthers();
        cardEl.innerHTML = '';
        draw(null);
        return null;
      }
      const model = cardModel(s, now);
      draw(model.status === 'ready' ? judged?.plan ?? null : null);
      cardEl.hidden = formOpen && model.status !== 'ready';
      cardEl.innerHTML = renderRouteCard(model);
      return routeAnnouncement(model);
    },

    fitOnce() {
      const map = host.map();
      const bbox = fitPending && planned && map ? bboxOfRoutes(planned.options) : null;
      if (!map || !bbox) return;
      fitPending = false;
      map.fitBBox(bbox, FIT_MAX_ZOOM);
    },

    restore(next) {
      const s = stops();
      if (!next) {
        if (s) exit({ quiet: true, push: false, focus: false });
        return;
      }
      if (s && stopsKeyOf(s) === stopsKeyOf(next)) return;
      host.setUrl({ ...host.url(), route: next, road: null, place: null, query: '' });
      reset();
      fitPending = true;
      host.render();
    },

    exit,
    open: openForm,
  };
  return api;
}
