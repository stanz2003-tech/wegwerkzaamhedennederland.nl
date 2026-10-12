/**
 * The route card at the top of the panel in route mode: "Kan ik nu van Almkerk naar Montfoort?",
 * the verdict for the chosen route in one big line (the answer card's wording and colours), the
 * routes to choose from with travel time and verdict, and "Open in Google Maps".
 *
 * Pure HTML from a model, like ui/answer-card.ts; ui/route-controller.ts builds the model and
 * wires the buttons (`data-route-*`). Unit-tested in web/test/route-card.test.mjs.
 */
import type { Answer } from '../data/answer';
import type { BesideNote } from '../data/route-plan';
import type { LonLat } from '../data/route-match';
import { usesFossgis, type RouteOption, type Stop } from '../data/routing';
import { VERDICT_META, type VehicleMode, type VerdictLevel } from '../data/verdict';
import { esc, fmtTime } from './format';
import { ICONS } from './icons';
import { renderVerdictPill } from './verdict-pill';

const MODE_LABEL: Record<VehicleMode, string> = { auto: "voor auto's", vracht: 'voor vrachtverkeer', fiets: 'voor fietsers' };
const TRAVEL_MODE: Record<VehicleMode, string> = { auto: 'driving', vracht: 'driving', fiets: 'bicycling' };

export interface RouteChoice {
  option: RouteOption;
  answer: Answer;
  /** Planned round the closures of a faster route. */
  avoiding: boolean;
  /** Has a closure for this vehicle during the trip. */
  blocked: boolean;
  /** Via points for Google Maps: where this route leaves the fastest one; none for the fastest. */
  via: LonLat[];
}

export type RouteCardModel =
  | { status: 'loading'; from: Stop; to: Stop; mode: VehicleMode }
  | { status: 'error'; from: Stop; to: Stop; mode: VehicleMode; message: string }
  | {
      status: 'ready';
      from: Stop;
      to: Stop;
      mode: VehicleMode;
      /** The moment as part of the question: "nu", "zaterdag 3 oktober om 08:00", "morgen". */
      questionWhen: string;
      /** Departure for an exact moment (also "nu"); null for a window question (a day, the weekend). */
      departAt: number | null;
      choices: RouteChoice[];
      selected: number;
      recommended: number;
      noClearRoute: boolean;
      /** Items alongside the chosen route (the other direction): said, never counted in the verdict. */
      beside: BesideNote;
      /** Re-judging after a change of moment or data. */
      updating: boolean;
      dataAsOf?: string;
    };

/** "42 min" / "1 u 47 min" */
export function tripDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min - h * 60;
  return rest > 0 ? `${h} u ${rest} min` : `${h} u`;
}

/** "53 km" / "8,4 km" */
export function tripDistance(metres: number): string {
  const km = metres / 1000;
  return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

function levelOf(a: Answer): VerdictLevel {
  return a.level ?? 'geen';
}

/** The pill wording of a route: the verdict's own label; no items at all reads "Geen hinder gemeld". */
function pillLabel(a: Answer): string {
  return a.level === null ? 'Geen hinder gemeld' : VERDICT_META[a.level].label;
}

/**
 * Google Maps along the chosen route. Any route but the fastest gets via points on the stretch
 * where it leaves the fastest one (ui/route-controller.ts, `deviatingPoints`), or Google picks
 * its own fastest way — straight back through the closure. The fastest route itself gets none:
 * Google then also weighs its live traffic. Coordinates, not names: "Montfort" is ambiguous.
 */
export function routeMapsUrl(from: Stop, to: Stop, via: readonly LonLat[], mode: VehicleMode): string {
  const fmt = (c: readonly [number, number]): string => `${c[1].toFixed(5)},${c[0].toFixed(5)}`;
  const waypoints = via.length ? `&waypoints=${via.map(fmt).join('%7C')}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${fmt([from.lon, from.lat])}&destination=${fmt([to.lon, to.lat])}${waypoints}&travelmode=${TRAVEL_MODE[mode]}`;
}

/** The headline the card shows for a route. */
export function routeHeadline(a: Answer): string {
  if (a.level === null) return 'Geen werkzaamheden op je route gemeld';
  if (a.level === 'geen') return 'Geen hinder op je route';
  return a.headline;
}

/** "Snelste route" / "Om de afsluiting heen" / "Alternatief" */
function choiceName(c: RouteChoice, i: number): string {
  if (c.avoiding) return 'Om de afsluiting heen';
  return i === 0 ? 'Snelste route' : 'Andere route';
}

/** "+6 min" against the fastest; '' for the fastest itself. */
function extraTime(c: RouteChoice, fastest: RouteChoice | undefined): string {
  if (!fastest || c === fastest) return '';
  const d = Math.round((c.option.durationS - fastest.option.durationS) / 60);
  return d > 0 ? `+${d} min` : '';
}

/**
 * The one sentence that says why this route is recommended: "De snelste route is dicht; deze gaat
 * er omheen (+6 min)." Empty when the fastest route is also the recommended one.
 */
export function adviceLine(m: Extract<RouteCardModel, { status: 'ready' }>): string {
  if (m.noClearRoute) return 'We vonden geen route zonder afsluiting. Kijk bij elke route wat er dicht is, of kies een ander moment.';
  if (m.recommended === 0) return '';
  const rec = m.choices[m.recommended];
  const extra = rec ? extraTime(rec, m.choices[0]) : '';
  return `De snelste route heeft een afsluiting; de aanbevolen route gaat er omheen${extra ? ` (${extra})` : ''}.`;
}

function stopsLine(from: Stop, to: Stop): string {
  return `<span class="route-card__stop">${esc(from.name)}</span> <span aria-hidden="true">→</span><span class="sr-only">naar</span> <span class="route-card__stop">${esc(to.name)}</span>`;
}

function exitButton(): string {
  return `<button type="button" class="btn btn--secondary answer__exit" data-route-exit aria-label="Route sluiten" title="Route sluiten">${ICONS.x}<span class="answer__exit-text">Sluiten</span></button>`;
}

function credit(): string {
  return `<p class="route-card__credit">Route: <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener">Valhalla</a>${usesFossgis() ? ' via FOSSGIS' : ''} · kaartdata © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-bijdragers (ODbL) · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">fout in de kaart melden</a></p>`;
}

function choiceRow(c: RouteChoice, i: number, m: Extract<RouteCardModel, { status: 'ready' }>): string {
  const selected = i === m.selected;
  const tags = [choiceName(c, i), ...(i === m.recommended && !m.noClearRoute ? ['aanbevolen'] : [])];
  const extra = extraTime(c, m.choices[0]);
  return `<li><button type="button" class="route-opt${selected ? ' is-selected' : ''}${i === m.recommended && !m.noClearRoute ? ' is-recommended' : ''}" data-route-opt="${i}" aria-pressed="${selected ? 'true' : 'false'}">
      <span class="route-opt__time">${esc(tripDuration(c.option.durationS))}${extra ? ` <span class="route-opt__extra">${esc(extra)}</span>` : ''}</span>
      <span class="route-opt__name">${esc(tags.join(' · '))} <span class="route-opt__km">${esc(tripDistance(c.option.distanceM))}</span></span>
      <span class="route-opt__verdict">${renderVerdictPill({ level: levelOf(c.answer), label: pillLabel(c.answer) }, { size: 'sm' })}</span>
    </button></li>`;
}

/**
 * "3 meldingen liggen naast je route …", and a closure there by name: should the geometry have
 * put it on the wrong side, the driver still reads which road it is.
 */
export function besideLine(b: BesideNote): string {
  if (b.count <= 0) return '';
  const what = `${b.count === 1 ? '1 melding ligt' : `${b.count} meldingen liggen`} naast je route (andere rijrichting of parallelweg) en ${b.count === 1 ? 'telt' : 'tellen'} niet mee`;
  const named = b.closures.slice(0, 2);
  const more = b.closures.length > named.length ? ` en nog ${b.closures.length - named.length}` : '';
  const closed = named.length ? `. Daarvan dicht: ${named.join('; ')}${more}.` : '.';
  return `<p class="route-card__note">${esc(what + closed)}</p>`;
}

function readyCard(m: Extract<RouteCardModel, { status: 'ready' }>): string {
  const chosen = m.choices[m.selected] ?? m.choices[0];
  if (!chosen) return '';
  const a = chosen.answer;
  const level = levelOf(a);
  const arrive = m.departAt !== null ? m.departAt + chosen.option.durationS * 1000 : null;
  const modeBits = [MODE_LABEL[m.mode], ...(m.departAt !== null && arrive !== null ? [`vertrek ${fmtTime(m.departAt)}, aankomst ± ${fmtTime(arrive)}`] : []), ...(m.dataAsOf ? [`gegevens van ${m.dataAsOf}`] : [])];
  const when = m.questionWhen ? ` ${m.questionWhen}` : '';
  const advice = adviceLine(m);
  const specifics = a.specifics.map((s) => `<li>${esc(s)}</li>`).join('');
  const more = a.moreCount > 0 ? `<p class="answer__more"><a href="#list-heading" data-skip>+ nog ${a.moreCount} ${a.moreCount === 1 ? 'plek' : 'plekken'} op je route, zie de lijst <span aria-hidden="true">↓</span></a></p>` : '';
  const maps = routeMapsUrl(m.from, m.to, chosen.via, m.mode);
  return `<section class="answer answer--${level} route-card${m.updating ? ' is-updating' : ''}" style="--vpill-color: var(${VERDICT_META[level].color})" aria-labelledby="route-q route-title" aria-busy="${m.updating ? 'true' : 'false'}">
      <div class="answer__top">
        <div class="answer__q">
          <p class="answer__kicker answer__kicker--when" id="route-q">Kan ik${esc(when)} van ${stopsLine(m.from, m.to)}? <span class="answer__mode">${esc(modeBits.join(' · '))}</span></p>
        </div>
        ${exitButton()}
      </div>
      <h2 class="answer__headline" id="route-title" tabindex="-1">${esc(routeHeadline(a))}</h2>
      ${a.timePhrase ? `<p class="answer__time">${ICONS.clock}<span>${esc(a.timePhrase.charAt(0).toUpperCase() + a.timePhrase.slice(1))}</span></p>` : ''}
      ${a.subline ? `<p class="answer__sub">${esc(a.subline)}</p>` : ''}
      ${specifics ? `<ul class="answer__specifics">${specifics}</ul>` : ''}
      ${more}
      ${advice ? `<p class="route-card__advice">${ICONS.info}<span>${esc(advice)}</span></p>` : ''}
      <h3 class="route-card__h">Routes</h3>
      <ul class="route-opts" role="list">${m.choices.map((c, i) => choiceRow(c, i, m)).join('')}</ul>
      <div class="route-card__actions">
        <a class="btn btn--primary route-card__maps" href="${esc(maps)}" target="_blank" rel="noopener">${ICONS.navigation}<span>Open in Google Maps</span></a>
        <button type="button" class="btn btn--secondary" data-route-edit>${ICONS.route}<span>Route wijzigen</span></button>
      </div>
      <p class="route-card__note">Reistijd zonder file en zonder vertraging door werk. ${chosen.via.length > 0 ? 'Deze route gaat met tussenpunten mee naar Google Maps, zodat Google niet zijn eigen snelste weg kiest.' : 'Google Maps kiest daar zelf de route, met de files van dat moment.'}</p>
      ${besideLine(m.beside)}
      ${credit()}
    </section>`;
}

export function renderRouteCard(m: RouteCardModel): string {
  if (m.status === 'ready') return readyCard(m);
  const body =
    m.status === 'loading'
      ? `<p class="route-card__status" role="status">${ICONS.refreshCw}<span>Route berekenen en wegwerkzaamheden opzoeken…</span></p>`
      : `<p class="route-card__status route-card__status--error" role="alert">${ICONS.circleAlert}<span>${esc(m.message)}</span></p>
         <div class="route-card__actions">
           <button type="button" class="btn btn--primary" data-route-retry>${ICONS.refreshCw}<span>Opnieuw</span></button>
           <button type="button" class="btn btn--secondary" data-route-edit>${ICONS.route}<span>Route wijzigen</span></button>
         </div>`;
  return `<section class="answer answer--onbekend route-card" aria-labelledby="route-q" aria-busy="${m.status === 'loading' ? 'true' : 'false'}">
      <div class="answer__top">
        <div class="answer__q"><p class="answer__kicker" id="route-q">Route van ${stopsLine(m.from, m.to)} <span class="answer__mode">${esc(MODE_LABEL[m.mode])}</span></p></div>
        ${exitButton()}
      </div>
      ${body}
      ${credit()}
    </section>`;
}

/** What a screen reader hears once the route is judged: "Route naar Montfoort, voor auto's: Doorrijden mogelijk. 42 minuten." */
export function routeAnnouncement(m: RouteCardModel): string {
  if (m.status === 'loading') return `Route naar ${m.to.name} wordt berekend.`;
  if (m.status === 'error') return m.message;
  const c = m.choices[m.selected];
  if (!c) return '';
  return `Route naar ${m.to.name}, ${MODE_LABEL[m.mode]}: ${routeHeadline(c.answer)}. ${tripDuration(c.option.durationS).replace(' u ', ' uur ').replace(/ u$/, ' uur').replace('min', 'minuten')}.`;
}
