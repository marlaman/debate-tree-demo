import { autoFillInputSchema, generateSuggestions } from '@/lib/autofill';
import { readDebates, readVisibleDebates, assertEditable } from '@/lib/db';
import { checkOrigin, errorResponse } from '@/lib/http';
import { AppError } from '@/lib/validation';
import { sessionToken } from '@/lib/session';

export const runtime = 'nodejs';
export const maxDuration = 110;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { token } = sessionToken(request);
    const body = await request.text();
    if (body.length > 2000) throw new AppError('Invalid Auto fill request.', 413);
    const input = autoFillInputSchema.parse(JSON.parse(body));
    const key = process.env.XAI_API_KEY?.trim();
    if (!key) throw new AppError('Grok is not configured. Add XAI_API_KEY to .env.local and restart the app.', 503);
    const debates = token ? readVisibleDebates(token) : readDebates();
    const pair = input.kind === 'stances'
      ? { debate: debates.find(debate => debate.id === input.debateId), stance: undefined }
      : debates.flatMap(debate => debate.stances.map(stance => ({ debate, stance }))).find(item => item.stance.id === input.stanceId);
    if (!pair?.debate || (input.kind === 'arguments' && !pair.stance)) throw new AppError('This debate or stance no longer exists.', 404);
    if (token) assertEditable(input.kind === 'stances' ? 'debate' : 'stance', input.kind === 'stances' ? input.debateId : input.stanceId, token);
    const { debate, stance } = pair;
    const suggestions = await generateSuggestions(input, {
      debate: { title: debate.title, description: debate.description },
      stance: stance ? { title: stance.title, description: stance.description } : undefined,
      existingTitles: input.kind === 'stances' ? debate.stances.map(item => item.title) : stance!.arguments.map(item => item.title),
    }, key, process.env.XAI_MODEL || 'grok-4.7');
    return Response.json({ suggestions });
  } catch (error) { return errorResponse(error); }
}
