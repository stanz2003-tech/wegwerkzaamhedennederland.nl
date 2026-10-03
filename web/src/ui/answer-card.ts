/**
 * The answer card at the top of the panel in road mode ("Kan ik over de A27?"): road badge,
 * the chosen moment, one big verdict line for the chosen mode, at most three specifics and a
 * prominent "× Alle wegen" that leaves road mode. Also used as the headline of /weg/<slug>/, and
 * in place mode on the map ("Kan ik door Almkerk?", "× Alle plaatsen", a link to the place page).
 */
import { BEYOND_HORIZON_HEADLINE, horizonDateLabel, type Answer } from '../data/answer';
import type { RoadType } from '../data/types';
import { VERDICT_META, type VehicleMode, type VerdictLevel } from '../data/verdict';
import { roadBadge } from './badge';
import { esc } from './format';
import { ICONS } from './icons';

export interface AnswerCardModel {
  /** Road number for road mode / road pages; omit for a gemeente or woonplaats page. */
  road?: string | null;
  roadType?: RoadType | null;
  /** Question subject when there is no road: "de gemeente Utrecht", "Breda". */
  subject?: string;
  /** "nu" / "vandaag" / "za 20 sep 14:00" */
  whenLabel: string;
  mode: VehicleMode;
  answer: Answer;
  /** Total items of the entity in the current data (all moments), for the "niets gemeld" wording. */
  total: number;
  /** Omit the exit button (entity page headline). */
  exit?: boolean;
  /** Visible text of the exit button: "Alle wegen" (default), "Alle plaatsen" in place mode. */
  exitLabel?: string;
  /** What the exit does, as its accessible name: "Alle wegen tonen" (default). */
  exitAction?: string;
  /**
   * A page that answers the same question per day ("Almkerk per dag bekijken →" to
   * /plaats/almkerk/). Only set when that page exists (data/entity-pages.ts).
   */
  pageHref?: string;
  pageLabel?: string;
  /**
   * Set while the data is older than it should be ("20:17" / "wo 23 sep 21:31"): an answer for
   * "nu" then names the moment it really describes, so it cannot pass for the current situation.
   */
  dataAsOf?: string;
}

const MODE_LABEL: Record<VehicleMode, string> = { auto: "voor auto's", vracht: 'voor vrachtverkeer', fiets: 'voor fietsers' };

function levelOf(a: Answer): VerdictLevel {
  return a.level ?? 'geen';
}

/**
 * Past the planning horizon a non-empty answer is true for what IS published, but more work for
 * that date may still be announced. Without this line "Rijbaan dicht bij Gorinchem" for a date
 * seven weeks out read exactly as sure as today's answer. The empty case already says
 * "Nog niet bekend" with its own note.
 */
function horizonLine(a: Answer): string {
  if (!a.beyondHorizon || a.horizonMs === null || a.headline === BEYOND_HORIZON_HEADLINE) return '';
  return `<p class="answer__horizon">${ICONS.info}<span>Let op: werk na ${esc(horizonDateLabel(a.horizonMs))} is nog niet aangemeld. Hierboven staat alleen wat nu al bekend is; er kan meer dicht zijn.</span></p>`;
}

/** "nu", or "nu (gegevens van 20:17)" while the data is stale. */
function whenText(m: AnswerCardModel): string {
  return m.dataAsOf && m.whenLabel === 'nu' ? `nu (gegevens van ${m.dataAsOf})` : m.whenLabel;
}

function modeLine(m: AnswerCardModel): string {
  return `${MODE_LABEL[m.mode]} · ${whenText(m)}`;
}

/**
 * The headline the card shows. `level === null` means the selection was empty within the data we
 * have; `'onbekend'` with an empty selection means the question was about a date the dataset does
 * not reach yet. The second must not borrow the reassuring wording of the first.
 */
export function cardHeadline(m: Pick<AnswerCardModel, 'answer' | 'total'>): string {
  return m.answer.level === null ? (m.total === 0 ? 'Niets gemeld' : 'Geen hinder gemeld') : m.answer.headline;
}

/**
 * What a screen reader hears after the user changes the question (ui/announce.ts): the subject,
 * the mode, the moment and the card headline — "A27, voor auto's, morgen: Rijbaan dicht bij
 * Gorinchem." Built from the same model as the card, so the spoken answer is never lighter
 * than the one on screen; the stale-data moment is spoken too.
 */
export function answerAnnouncement(m: AnswerCardModel): string {
  const raw = m.road ?? m.subject ?? 'dit gebied';
  const subject = raw.charAt(0).toUpperCase() + raw.slice(1);
  return `${subject}, ${MODE_LABEL[m.mode]}, ${whenText(m)}: ${cardHeadline(m).replace(/[.s]+$/, '')}.`;
}

/** "× Alle wegen" / "× Alle plaatsen": leaves road or place mode (the caller wires `[data-answer-exit]`). */
function exitButton(m: AnswerCardModel): string {
  const action = esc(m.exitAction ?? 'Alle wegen tonen');
  return `<button type="button" class="btn btn--secondary answer__exit" data-answer-exit aria-label="${action}" title="${action}">${ICONS.x}<span class="answer__exit-text">${esc(m.exitLabel ?? 'Alle wegen')}</span></button>`;
}

export function renderAnswerCard(m: AnswerCardModel): string {
  const level = levelOf(m.answer);
  const meta = VERDICT_META[level];
  const headline = cardHeadline(m);
  const specifics = m.answer.specifics.map((s) => `<li>${esc(s)}</li>`).join('');
  const hidden = m.answer.hidden.length;
  const question = m.road
    ? `Kan ik ${m.mode === 'fiets' ? 'langs' : 'over'} de ${esc(m.road)}?`
    : `Kan ik door ${esc(m.subject ?? 'dit gebied')}?`;
  return `<section class="answer answer--${level}" style="--vpill-color: var(${meta.color})" aria-labelledby="answer-q answer-title">
      <div class="answer__top">
        ${m.road ? roadBadge(m.road, m.roadType ?? null, { size: 'xl' }) : ''}
        <div class="answer__q">
          <p class="answer__kicker" id="answer-q">${question} <span class="answer__mode">${esc(modeLine(m))}</span></p>
        </div>
        ${m.exit === false ? '' : exitButton(m)}
      </div>
      <h2 class="answer__headline" id="answer-title" tabindex="-1">${esc(headline)}</h2>
      ${specifics ? `<ul class="answer__specifics">${specifics}</ul>` : ''}
      ${horizonLine(m.answer)}
      ${m.pageHref ? `<p class="answer__page"><a class="btn btn--link answer__page-link" href="${esc(m.pageHref)}">${esc(m.pageLabel ?? 'Per dag bekijken →')}</a></p>` : ''}
      ${hidden > 0 ? `<p class="answer__hidden">${hidden === 1 ? '1 melding geldt' : `${hidden} meldingen gelden`} niet ${esc(MODE_LABEL[m.mode])} en ${hidden === 1 ? 'is' : 'zijn'} weggelaten.</p>` : ''}
    </section>`;
}
