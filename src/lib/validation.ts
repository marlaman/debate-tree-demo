import { z } from 'zod';
const title = z.string().trim().min(3, 'Use at least 3 characters.').max(240);
const description = z.string().trim().max(2000).default('');
const source = z.object({ url: z.string().trim().url().max(2000).refine(url => ['http:', 'https:'].includes(new URL(url).protocol), 'Use an http or https link.'), excerpt: z.string().trim().max(4000).default('') });
const argument = { title, body: z.string().trim().min(10, 'Give your argument at least 10 characters.').max(10000), sources: z.array(source).max(5).default([]) };
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('createDebate'), title, description }),
  z.object({ action: z.literal('updateDebate'), id: z.string(), title, description }),
  z.object({ action: z.literal('createStance'), debateId: z.string(), title, description }),
  z.object({ action: z.literal('updateStance'), id: z.string(), title, description }),
  z.object({ action: z.literal('createArgument'), stanceId: z.string(), ...argument }),
  z.object({ action: z.literal('updateArgument'), id: z.string(), ...argument }),
  z.object({ action: z.literal('publish'), id: z.string() }),
  z.object({ action: z.literal('delete'), entity: z.enum(['debate','stance','argument']), id: z.string() })
]);
export type Command = z.infer<typeof commandSchema>;
export const assessmentSchema = z.object({ score: z.number().int().min(0).max(100), explanation: z.string().min(1).max(2000), strengths: z.array(z.string().min(1).max(500)).max(3), weaknesses: z.array(z.string().min(1).max(500)).max(3) });
export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
