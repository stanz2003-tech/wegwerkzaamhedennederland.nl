/**
 * The question block of a road page: "Is de A2 vandaag dicht? / vannacht? / dit weekend? / hoe
 * lang nog?", one sentence each, for cars. These are the questions people type into Google
 * ("Mensen vragen ook", docs/groei-onderzoek-2026-10.md 4.8). The build writes the answers into
 * the HTML from the morning's data; the page script replaces them with the live answers.
 *
 * The sentences come from the same `answerFor` as the answer card, so the block never says
 * "open" next to a card that says "dicht". Pure, no DOM.
 */
import { answerFor, type Answer } from '../data/answer';
import type { ForecastItem, When } from '../data/forecast';
import { MS, timeWindowRange, zonedParts, zonedToMs } from '../data/time';
import { esc } from './format';

export interface RoadQuestion {
  /** "vandaag" | "vannacht" | "weekend" | "hoelang": stable hook for tests and styling. */
  id: string;
  q: string;
  a: string;
}

/** "Vannacht" runs from 21:00 to 06:00: most night closures fall inside it. */
export const NIGHT_START_HOUR = 21;
export const NIGHT_END_HOUR = 6;
const LOOKAHEAD_DAYS = 30;

/** The night ahead (or the one in progress before 06:00), from `now` on. */
export function nightWindow(now: number): { from: number; to: number } {
  const p = zonedParts(now);
  if (p.hour < NIGHT_END_HOUR) return { from: now, to: zonedToMs(p.year, p.month, p.day, NIGHT_END_HOUR) - 1 };
  const from = zonedToMs(p.year, p.month, p.day, NIGHT_START_HOUR);
  return { from: Math.max(from, now), to: zonedToMs(p.year, p.month, p.day + 1, NIGHT_END_HOUR) - 1 };
}

function isClosure(a: Answer): boolean {
  return a.level === 'dicht' || a.level === 'rijbaan';
}

/** "Ja. Rijbaan dicht bij Gorinchem, richting Utrecht (tot za 3 okt 10:00)." */
function closedSentence(a: Answer): string {
  return `Ja. ${a.headline}${a.timePhrase ? ` (${a.timePhrase})` : ''}.`;
}

function windowSentence(a: Answer, road: string, when: string): string {
  if (isClosure(a)) return closedSentence(a);
  if (a.level === 'onbekend' && a.items.length === 0) return `${a.headline}.`;
  if (a.level === 'hinder') return `Nee, de ${road} is ${when} niet dicht, maar er is wel hinder gemeld.`;
  return `Nee, voor ${when} is op de ${road} geen afsluiting gemeld.`;
}

function howLongSentence(items: readonly ForecastItem[], road: string, now: number, horizonMs?: number): string {
  const subject = { kind: 'road' as const, name: road };
  const current = answerFor(items, 'auto', { kind: 'moment', at: now }, subject, now, horizonMs);
  if (isClosure(current)) {
    return `${current.headline}: ${current.timePhrase || 'einde niet opgegeven'}.`;
  }
  const ahead: When = { kind: 'window', from: now, to: now + LOOKAHEAD_DAYS * MS.day };
  const next = answerFor(items, 'auto', ahead, subject, now, horizonMs);
  if (isClosure(next)) {
    return `Nu is de ${road} niet dicht. Eerstvolgende afsluiting: ${next.headline}${next.timePhrase ? ` (${next.timePhrase})` : ''}.`;
  }
  return `Nu is de ${road} niet dicht, en voor de komende ${LOOKAHEAD_DAYS} dagen is geen afsluiting gemeld.`;
}

export function roadQuestions(items: readonly ForecastItem[], road: string, now: number, horizonMs?: number): RoadQuestion[] {
  const subject = { kind: 'road' as const, name: road };
  const ask = (w: { from: number; to: number }): Answer => answerFor(items, 'auto', { kind: 'window', ...w }, subject, now, horizonMs);
  return [
    { id: 'vandaag', q: `Is de ${road} vandaag dicht?`, a: windowSentence(ask(timeWindowRange('vandaag', now)), road, 'vandaag') },
    { id: 'vannacht', q: `Is de ${road} vannacht dicht?`, a: windowSentence(ask(nightWindow(now)), road, 'vannacht') },
    { id: 'weekend', q: `Is de ${road} dit weekend dicht?`, a: windowSentence(ask(timeWindowRange('weekend', now)), road, 'dit weekend') },
    { id: 'hoelang', q: `Hoe lang is de ${road} nog dicht?`, a: howLongSentence(items, road, now, horizonMs) },
  ];
}

/** Inner HTML of `#road-questions`; `stamp` says which data it describes ("stand van ma 20 okt 06:41"). */
export function renderRoadQuestions(questions: readonly RoadQuestion[], stamp: string): string {
  const rows = questions
    .map((x) => `<div class="road-questions__item" data-q="${esc(x.id)}"><dt>${esc(x.q)}</dt><dd>${esc(x.a)}</dd></div>`)
    .join('');
  return `<dl class="road-questions__list">${rows}</dl><p class="road-questions__meta">Voor auto's · ${esc(stamp)}</p>`;
}
