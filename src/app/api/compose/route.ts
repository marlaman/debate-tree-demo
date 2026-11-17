import { composeDraft, composeInputSchema } from '@/lib/compose';
import { readDebates, readVisibleDebates, assertEditable } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/http';
import { AppError } from '@/lib/validation';
import { sessionToken } from '@/lib/session';
export const runtime = 'nodejs';
export const maxDuration = 75;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { token } = sessionToken(request);
    const body = await request.text();
    if (body.length > 10000) throw new AppError('That is a bit too long. Try a shorter thought.', 413);
    const input = composeInputSchema.parse(JSON.parse(body));
    const key = process.env.XAI_API_KEY?.trim();
    if (!key) throw new AppError('Grok is not configured yet. Open Grok setup to add your key.', 503);
    const debates = token ? readVisibleDebates(token) : readDebates();
    let context = {};
    if (input.kind === 'stance') {
      const debate = debates.find(item => item.id === input.debateId);
      if (!debate) throw new AppError('This debate no longer exists.', 404);
      if (token) assertEditable('debate', input.debateId, token);
      context = { debate: { title: debate.title, description: debate.description } };
    }
    if (input.kind === 'argument') {
      const pair = debates.flatMap(debate => debate.stances.map(stance => ({ debate, stance }))).find(item => item.stance.id === input.stanceId);
      if (!pair) throw new AppError('This stance no longer exists.', 404);
      if (token) assertEditable('stance', input.stanceId, token);
      context = { debate: { title: pair.debate.title, description: pair.debate.description }, stance: { title: pair.stance.title, description: pair.stance.description } };
    }
    const draft = await composeDraft(input, context, key, process.env.XAI_MODEL || 'grok-4.7');
    return Response.json({ draft });
  } catch (error) { return errorResponse(error); }
}
