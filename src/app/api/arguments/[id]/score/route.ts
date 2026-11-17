import { claimScore, failScore, finishScore, getScoringContext, assertEditable } from '@/lib/db';
import { assessArgument } from '@/lib/scoring';
import { checkOrigin, errorResponse } from '@/lib/http';
import { AppError } from '@/lib/validation';
import { sessionToken } from '@/lib/session';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let token: number | undefined;
  const { id } = await params;
  try {
    checkOrigin(request);
    const { token: owner } = sessionToken(request);
    if (owner) assertEditable('argument', id, owner);
    const context = getScoringContext(id);
    const key = process.env.XAI_API_KEY?.trim();
    if (!key) throw new AppError('Add your Grok API key to XAI_API_KEY in .env.local, then restart the app. Your argument has been saved.', 503);
    if (context.argument.assessment) return Response.json({ assessment: context.argument.assessment });
    token = claimScore(id);
    const model = process.env.XAI_MODEL || 'grok-4.7';
    const assessment = await assessArgument(context, key, model);
    finishScore(id, token, assessment, model);
    return Response.json({ assessment });
  } catch (error) {
    if (token !== undefined) failScore(id, token, error instanceof AppError ? error.message : 'Scoring failed. Please try again.');
    return errorResponse(error);
  }
}
