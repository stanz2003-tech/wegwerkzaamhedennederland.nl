/**
 * Replaces the build's answers in `#road-questions` ("Is de A2 vandaag dicht?", "Is er morgen een
 * weg dicht in Mildam?") with the live ones, on road and place pages alike.
 */
import type { Meta } from '../data/types';
import { fmtDayTime } from './format';
import { renderRoadQuestions, type RoadQuestion } from './road-questions';

export function updateQuestionBlock(questions: (now: number) => RoadQuestion[], meta: Meta | null): void {
  const section = document.getElementById('road-questions');
  const body = document.getElementById('road-questions-body');
  // Only where the build wrote the block: appearing late it would push the page below it down.
  if (!section || !body || section.hidden) return;
  const now = Date.now();
  const generated = meta ? Date.parse(meta.generated) : Number.NaN;
  const stamp = `stand van ${fmtDayTime(Number.isFinite(generated) ? generated : now)}`;
  body.innerHTML = renderRoadQuestions(questions(now), stamp);
}
