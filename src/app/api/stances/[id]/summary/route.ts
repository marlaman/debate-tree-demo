import { getStanceSummaryContext, saveStanceSummary, assertReadable } from '@/lib/db';
import { summarizeStance } from '@/lib/stance-summary';
import { checkOrigin, errorResponse } from '@/lib/http';
import { AppError } from '@/lib/validation';
import { sessionToken } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const { id } = await params;
    const { token: owner } = sessionToken(request);
    if (owner) assertReadable('stance', id, owner);
    const key = process.env.XAI_API_KEY?.trim();
    if (!key) throw new AppError('Connect Grok to summarize the stance.', 503);
    const { debate, stance, revision } = getStanceSummaryContext(id);
    if (!revision) throw new AppError('Score an argument before summarizing the stance.');
    if (stance.summaryFresh) return Response.json({ summary: stance.summary });
    const summary = await summarizeStance(debate, stance, key, process.env.XAI_MODEL || 'grok-4.7');
    if (!saveStanceSummary(id, revision, summary)) return Response.json({ stale: true });
    return Response.json({ summary });
  } catch (error) { return errorResponse(error); }
}
