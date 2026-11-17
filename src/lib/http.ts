import { ZodError } from 'zod';
import { AppError } from './validation';
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const requestUrl = new URL(request.url);
  // Next.js can normalize a request URL; Host retains the browser's authority.
  const host = request.headers.get('host') || requestUrl.host;
  let expected: URL;
  const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https:' : requestUrl.protocol;
  try { expected = new URL(`${protocol}//${host}`); }
  catch { throw new AppError('Invalid request host.', 403); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname);
  if ((!loopback && process.env.PUBLIC_SHARING !== '1') || origin !== expected.origin) {
    throw new AppError('Cross-origin requests are not allowed.', 403);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message || 'Please check the form.' }, { status: 400 });
  if (error instanceof SyntaxError) return Response.json({ error: 'The request must contain valid JSON.' }, { status: 400 });
  console.error('Debate Tree request failed:', error instanceof Error ? error.name : 'Unknown error');
  return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
