/**
 * What a road or place page shows before its script has run: the answer card for "nu", the count
 * and the first rows of the list, computed at build time from the same data file the page loads
 * (roads/<slug>.json, gemeenten/<slug>.json) with the same functions the page uses.
 *
 * Search engines and AI crawlers read the HTML as served; until 2026-10 that held no roadwork at
 * all, only template text and a hidden "Geen meldingen voor …" (docs/groei-onderzoek-2026-10.md,
 * fase 2). Every snapshot names the moment of its data, so it never passes for the live state.
 * Pure, no DOM; the page script replaces it with the live answer and list.
 */
import { answerFor, type AnswerSubject } from '../data/answer';
import { splitForEntity } from '../data/entity';
import { indexItemFromFeature } from '../data/entity-file';
import type { ForecastItem } from '../data/forecast';
import type { ItemDetail, RoadType } from '../data/types';
import { renderAnswerCard } from './answer-card';
import { renderSectionsHtml, type EntityListOptions } from './entity-list';
import { entitySections } from './entity-sections';
import { esc, plural } from './format';
import { mapContextQuery } from './map-link';

/** Rows in the HTML: enough to name the streets, few enough to keep the page light. */
export const SNAPSHOT_ROWS = 20;

export interface SnapshotInput {
  items: readonly ForecastItem[];
  subject: AnswerSubject;
  roadType?: RoadType | null;
  now: number;
  /** `Meta.horizon.until` in ms, when known. */
  horizonMs?: number;
  /** The moment of the data, as people read it: "ma 20 okt 06:41". */
  asOf: string;
  /**
   * A bridge page: the bridge with its article ("de Merwedebrug bij Gorinchem"). The card then asks
   * about the bridge and the stamp counts the meldingen "op en rond" it.
   */
  bridge?: string;
  /** Where "bekijk ze op de kaart" points. */
  mapHref: string;
  limit?: number;
}

export interface EntitySnapshot {
  /** The answer card, as the page renders it for "nu" and cars. */
  answerHtml: string;
  /** Stamp + sections + "en nog N" line, for `#entity-list`. */
  listHtml: string;
  /** Meldingen now active plus planned in the coming 30 days (all traffic). */
  count: number;
  /** The card's headline: "Rijbaan dicht bij Gorinchem", "Geen hinder gemeld". */
  headline: string;
  /**
   * Who reported the meldingen counted in `count` (the publisher as published, `src`), most first.
   * The pages answer "Wie heeft het werk aangemeld?" with it instead of a sentence that read the same
   * on every road and place page.
   */
  authorities: readonly Authority[];
}

export interface Authority {
  name: string;
  count: number;
}

/** Publishers of the given meldingen with their number, most first, then by name. */
export function authoritiesOf(items: readonly ForecastItem[], ids: ReadonlySet<string>): Authority[] {
  const tally = new Map<string, number>();
  for (const it of items) {
    if (!ids.has(it.f.properties.id)) continue;
    const name = (it.f.properties.src ?? '').trim();
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  return [...tally].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'nl'));
}

function subjectLabel(subject: AnswerSubject): string {
  return subject.kind === 'gemeente' ? `de gemeente ${subject.name}` : subject.name;
}

export function entitySnapshot(input: SnapshotInput): EntitySnapshot {
  const { items, subject, now } = input;
  const rows = items.map((it) => indexItemFromFeature(it.f, now));
  const { active, upcoming } = splitForEntity(rows, now);
  const details = new Map<string, ItemDetail>();
  for (const it of items) if (it.d) details.set(it.f.properties.id, it.d);
  const listOpts: EntityListOptions = {
    mode: 'auto',
    at: now,
    details,
    revealClosures: true,
    mapQuery: mapContextQuery('auto', { kind: 'all' }),
  };

  const answer = answerFor(items, 'auto', { kind: 'moment', at: now }, subject, now, input.horizonMs);
  const card = {
    road: subject.kind === 'road' ? subject.name : null,
    roadType: input.roadType ?? null,
    subject: subjectLabel(subject),
    ...(input.bridge ? { bridge: input.bridge } : {}),
    whenLabel: 'nu',
    questionWhen: 'nu',
    mode: 'auto' as const,
    answer,
    total: items.length,
    exit: false,
    dataAsOf: input.asOf,
  };
  const answerHtml = renderAnswerCard(card);
  const headline = answer.level === null ? (items.length === 0 ? 'Niets gemeld' : 'Geen hinder gemeld') : answer.headline;

  const count = active.length + upcoming.length;
  const sections = entitySections({ subjectKind: subject.kind, mode: 'auto', active, upcoming, now, listOpts });
  const { html, more } = renderSectionsHtml(sections, now, listOpts, input.limit ?? SNAPSHOT_ROWS);
  const where = input.bridge
    ? `op en rond ${input.bridge}`
    : subject.kind === 'road'
      ? `op de ${subject.name}`
      : subject.kind === 'gemeente'
        ? `in de gemeente ${subject.name}`
        : `in ${subject.name}`;
  const stamp =
    count === 0
      ? `Stand van ${input.asOf}: bij NDW waren geen werkzaamheden of afsluitingen ${where} gemeld voor nu en de komende 30 dagen.`
      : `Stand van ${input.asOf}: ${plural(count, 'melding', 'meldingen')} ${where}, nu en de komende 30 dagen.`;
  const moreLine = more > 0 ? `<p class="entity-snapshot__more">En nog ${plural(more, 'melding', 'meldingen')}: <a href="${esc(input.mapHref)}">bekijk ze op de kaart</a>.</p>` : '';
  const listHtml = `<p class="entity-snapshot__stamp">${esc(stamp)}</p>${html}${moreLine}`;
  const authorities = authoritiesOf(items, new Set([...active, ...upcoming].map((r) => r.id)));
  return { answerHtml, listHtml, count, headline, authorities };
}

