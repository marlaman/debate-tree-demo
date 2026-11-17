import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoFillInputSchema, generateSuggestions } from '../src/lib/autofill';

const context = { debate: { title: 'Should public protests require permits?', description: '' }, existingTitles: [] };
const stances = [
  { title: 'Protests should require permits.', description: 'Advance notice may help reduce disruption.', body: '' },
  { title: 'People should be free to protest without permits.', description: 'Requiring permission can limit spontaneous expression.', body: '' },
];
const mock = (suggestions: unknown): typeof fetch => async (_url, options) => {
  const body = JSON.parse(options?.body as string);
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(JSON.parse(body.input[1].content).debate.title, context.debate.title);
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ suggestions }) }] }] });
};

test('Auto fill returns two distinct stances without persisting them', async () => {
  const input = { kind: 'stances' as const, debateId: '00000000-0000-0000-0000-000000000000' };
  assert.deepEqual(await generateSuggestions(input, context, 'test-key', 'test-model', mock(stances)), stances);
});
test('Auto fill rejects duplicates, malformed arguments, and invalid targets', async () => {
  const input = { kind: 'stances' as const, debateId: '00000000-0000-0000-0000-000000000000' };
  await assert.rejects(() => generateSuggestions(input, { ...context, existingTitles: [stances[0].title] }, 'test-key', 'test-model', mock(stances)), /repeated suggestions/);
  const argumentInput = { kind: 'arguments' as const, stanceId: input.debateId };
  await assert.rejects(() => generateSuggestions(argumentInput, context, 'test-key', 'test-model', mock(stances)), /repeated suggestions/);
  assert.equal(autoFillInputSchema.safeParse({ kind: 'arguments', stanceId: 'missing' }).success, false);
});
