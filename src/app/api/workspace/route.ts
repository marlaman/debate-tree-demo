import { readDebates, readVisibleDebates, mutate, purgeExpiredDrafts, sharingEnabled } from '@/lib/db';
import { commandSchema, AppError } from '@/lib/validation';
import { checkOrigin, errorResponse } from '@/lib/http';
import { sessionToken } from '@/lib/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const workspace = (token: string | null) => ({ debates: token ? readVisibleDebates(token) : readDebates(), scoringConfigured: Boolean(process.env.XAI_API_KEY?.trim()), sharingEnabled: sharingEnabled() });
export async function GET(request: Request) {
  try {
    const session = sessionToken(request, true);
    if (session.token) purgeExpiredDrafts();
    return Response.json(workspace(session.token), { headers: { 'Cache-Control': 'no-store', ...(session.cookie ? { 'Set-Cookie': session.cookie } : {}) } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const session = sessionToken(request);
    const body = await request.text();
    if (body.length > 40000) throw new AppError('This entry is too long.', 413);
    const command = commandSchema.parse(JSON.parse(body));
    const id = mutate(command, undefined, session.token ?? undefined);
    return Response.json({ ...workspace(session.token), id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
