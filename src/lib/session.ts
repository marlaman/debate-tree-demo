import { randomUUID } from 'node:crypto';
import { AppError } from './validation';
import { sharingEnabled } from './db';

const COOKIE = 'debate_session';
export function sessionToken(request: Request, create = false): { token: string | null; cookie?: string } {
  if (!sharingEnabled()) return { token: null };
  const raw = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (raw && /^[0-9a-f-]{36}$/.test(raw)) return { token: raw };
  if (!create) throw new AppError('Refresh the page to start a private session.', 401);
  const token = randomUUID();
  const secure = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { token, cookie: `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` };
}
