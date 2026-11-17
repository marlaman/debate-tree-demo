import type { Debate, Stance } from './types';
import { averageScore } from './types';

export type Outcome = { label: string; text: string };

export function caseQuality(score: number | null): string {
  if (score === null) return 'Unscored';
  if (score <= 25) return 'Very weak';
  if (score <= 50) return 'Limited';
  if (score <= 75) return 'Moderate';
  return 'Strong';
}

export function stanceOutcome(stance: Stance): Outcome {
  const score = averageScore(stance.arguments);
  if (score === null) return { label: 'CASE SO FAR', text: stance.arguments.length ? 'Awaiting argument scores.' : 'Add an argument to build the case.' };
  const count = stance.arguments.filter(argument => argument.assessment !== null).length;
  const label = `CASE SO FAR · ${count} SCORED`;
  if (stance.summaryFresh && stance.summary) return { label, text: stance.summary };
  return { label, text: 'Reading the arguments…' };
}

export function debateOutcome(debate: Debate): Outcome {
  const scored = debate.stances
    .map(stance => ({ title: stance.title, score: averageScore(stance.arguments) }))
    .filter((stance): stance is { title: string; score: number } => stance.score !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length < 2) return { label: 'CURRENT ANSWER', text: 'Score two stances to compare.' };
  const [leader, runnerUp] = scored;
  if (leader.score - runnerUp.score < 5) return { label: 'CURRENT ANSWER · SCORES ARE CLOSE', text: 'No clear lead yet.' };
  return { label: `LEADING CASE · ${leader.score}% vs ${runnerUp.score}%`, text: leader.title };
}
