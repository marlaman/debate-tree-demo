import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDraft, composeInputSchema } from '../src/lib/compose';
const draft = { title: 'Should people be free to practise religion?', description: '', body: '' };
test('rough input becomes a structured draft without saving or rewriting the intended side', async () => {
  const request: typeof fetch = async (_url, options) => {
    const body = JSON.parse(options?.body as string);
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(JSON.parse(body.input[1].content).roughText, 'shud religon b a rite');
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }] });
  };
  assert.deepEqual(await composeDraft({ kind: 'debate', text: 'shud religon b a rite' }, {}, 'test-key', 'test-model', request), draft);
});
test('malformed drafts and invalid input are rejected', async () => {
  const bad: typeof fetch = async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...draft, body: 'Invented content' }) }] }] });
  await assert.rejects(() => composeDraft({ kind: 'debate', text: 'some topic' }, {}, 'test-key', 'test-model', bad), /incomplete draft/);
  assert.equal(composeInputSchema.safeParse({ kind: 'stance', text: 'yes', debateId: 'missing' }).success, false);
});
