/**
 * The answer card at the top of the panel in road mode ("Kan ik over de A27?"): road badge,
 * the chosen moment, one big verdict line for the chosen mode, at most three specifics and a
 * prominent "× Alle wegen" that leaves road mode. Also used as the headline of /weg/<slug>/.
 */
import type { Answer } from '../data/answer';
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
}

const MODE_LABEL: Record<VehicleMode, string> = { auto: "voor auto's", vracht: 'voor vrachtverkeer', fiets: 'voor fietsers' };

function levelOf(a: Answer): VerdictLevel {
  return a.level ?? 'geen';
}

export function renderAnswerCard(m: AnswerCardModel): string {
  const level = levelOf(m.answer);
  const meta = VERDICT_META[level];
  // `level === null` means the selection was empty within the data we have; `'onbekend'` with an
  // empty selection means the question was about a date the dataset does not reach yet. The second
  // must not borrow the reassuring wording of the first.
  const headline = m.answer.level === null ? (m.total === 0 ? 'Niets gemeld' : 'Geen hinder gemeld') : m.answer.headline;
  const specifics = m.answer.specifics.map((s) => `<li>${esc(s)}</li>`).join('');
  const hidden = m.answer.hidden.length;
  const question = m.road
    ? `Kan ik ${m.mode === 'fiets' ? 'langs' : 'over'} de ${esc(m.road)}?`
    : `Kan ik door ${esc(m.subject ?? 'dit gebied')}?`;
  return `<section class="answer answer--${level}" style="--vpill-color: var(${meta.color})" aria-labelledby="answer-title">
      <div class="answer__top">
        ${m.road ? roadBadge(m.road, m.roadType ?? null, { size: 'xl' }) : ''}
        <div class="answer__q">
          <p class="answer__kicker">${question} <span class="answer__mode">${esc(MODE_LABEL[m.mode])} · ${esc(m.whenLabel)}</span></p>
        </div>
        ${m.exit === false ? '' : `<button type="button" class="btn btn--secondary answer__exit" data-road-exit aria-label="Alle wegen tonen">${ICONS.x}<span>Alle wegen</span></button>`}
      </div>
      <h2 class="answer__headline" id="answer-title" tabindex="-1">${esc(headline)}</h2>
      ${specifics ? `<ul class="answer__specifics">${specifics}</ul>` : ''}
      ${hidden > 0 ? `<p class="answer__hidden">${hidden === 1 ? '1 melding geldt' : `${hidden} meldingen gelden`} niet ${esc(MODE_LABEL[m.mode])} en ${hidden === 1 ? 'is' : 'zijn'} weggelaten.</p>` : ''}
    </section>`;
}
