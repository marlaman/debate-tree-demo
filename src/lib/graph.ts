import type { Debate } from './types';
import { averageScore } from './types';
import { debateOutcome, stanceOutcome, type Outcome } from './outcome';
export type GraphItem = { id: string; kind: 'debate' | 'stance' | 'argument'; title: string; score: number | null; standing?: string; cardHeight?: number; outcome?: Outcome; parentId?: string; x: number; y: number };
/** Allocate a horizontal band to each stance according to its argument count. */
export function layoutDebate(debate: Debate): GraphItem[] {
  const nodes: GraphItem[] = [];
  const scores = debate.stances.map(stance => averageScore(stance.arguments)).filter((score): score is number => score !== null);
  const leadingScore = scores.length ? Math.max(...scores) : null;
  const sortedScores = [...scores].sort((a, b) => b - a);
  const closeLead = sortedScores.length > 1 && sortedScores[0] - sortedScores[1] < 5;
  const heights = debate.stances.map(stance => stance.summaryFresh && stance.summary ? Math.max(320, Math.min(500, 260 + Math.ceil(stance.summary.length / 36) * 17)) : 280);
  const argumentY = 350 + Math.max(280, ...heights) + 50;
  let column = 0;
  for (const [stanceIndex, stance] of debate.stances.entries()) {
    const width = Math.max(1, stance.arguments.length);
    const score = averageScore(stance.arguments);
    const standing = score === null || scores.length < 2 ? undefined : leadingScore! - score < 5 ? (closeLead ? 'Close' : 'Leading') : 'Trailing';
    nodes.push({ id: stance.id, kind: 'stance', title: stance.title, score, standing, cardHeight: heights[stanceIndex], outcome: stanceOutcome(stance), parentId: debate.id, x: (column + (width - 1) / 2) * 310, y: 350 });
    stance.arguments.forEach((argument, index) => nodes.push({ id: argument.id, kind: 'argument', title: argument.title, score: argument.assessment?.score ?? null, parentId: stance.id, x: (column + index) * 310, y: argumentY }));
    column += width + 0.4;
  }
  const centers = nodes.filter(node => node.kind === 'stance').map(node => node.x);
  nodes.unshift({ id: debate.id, kind: 'debate', title: debate.title, score: null, outcome: debateOutcome(debate), x: centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : 0, y: 0 });
  return nodes;
}
