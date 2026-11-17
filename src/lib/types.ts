export type Source = { url: string; excerpt: string };
export type Assessment = { score: number; explanation: string; strengths: string[]; weaknesses: string[] };
export type Argument = { id: string; stanceId: string; title: string; body: string; sources: Source[]; assessment: Assessment | null; model: string | null; scoredAt: string | null; error: string | null; scoringStarted: number | null; createdAt: string };
export type Stance = { id: string; debateId: string; title: string; description: string; arguments: Argument[]; summary?: string | null; summaryKey?: string | null; summaryRevision?: string | null; summaryFresh?: boolean };
export type Debate = { id: string; title: string; description: string; createdAt: string; publishedAt?: string | null; stances: Stance[] };
export type Workspace = { debates: Debate[]; scoringConfigured: boolean; sharingEnabled?: boolean };
export function asDebateQuestion(title: string): string {
  return `${title.trim().replace(/[?!.\s]+$/, '')}?`;
}
export function averageScore(args: Pick<Argument, 'assessment'>[]): number | null {
  const scored = args.flatMap(a => a.assessment ? [a.assessment.score] : []);
  return scored.length ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length * 10) / 10 : null;
}
