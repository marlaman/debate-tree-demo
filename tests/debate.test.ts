import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { averageScore } from '../src/lib/types';
import { commandSchema, AppError } from '../src/lib/validation';
import { assertReadable, claimScore, finishScore, getScoringContext, mutate, openDatabase, readDebates, readVisibleDebates } from '../src/lib/db';
import { assessArgument, type ScoringContext } from '../src/lib/scoring';
import { checkOrigin } from '../src/lib/http';
const assessment = { score: 80, explanation: 'Supported reasoning.', strengths: ['Clear logic'], weaknesses: ['Evidence is limited'] };
const context: ScoringContext = { debate: { title: 'Should parks be free?', description: '' }, stance: { title: 'Keep them free', description: '' }, argument: { title: 'Access matters', body: 'Free admission makes access easier for people with low incomes.', sources: [] } };
test('averages include a real zero and exclude unscored arguments', () => {
  assert.equal(averageScore([{ assessment: null }]), null);
  assert.equal(averageScore([{ assessment }, { assessment: { ...assessment, score: 0 } }, { assessment: null }]), 40);
  assert.equal(averageScore([80, 70, 90].map(score => ({ assessment: { ...assessment, score } }))), 80);
});
test('persisted hierarchy, score invalidation, stale scoring, and cascading deletion', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'debate-test-'));
  const filename = path.join(dir, 'test.sqlite');
  let db = openDatabase(filename);
  try {
    const debate = mutate({ action: 'createDebate', title: 'Should parks be free?', description: '' }, db);
    const stance = mutate({ action: 'createStance', debateId: debate, title: 'Keep them free', description: '' }, db);
    const argument = mutate({ action: 'createArgument', stanceId: stance, title: 'Access matters', body: context.argument.body, sources: [{ url: 'https://example.com/evidence', excerpt: 'Example supplied excerpt' }] }, db);
    const token = claimScore(argument, db);
    assert.throws(() => claimScore(argument, db), /already being scored/);
    finishScore(argument, token, assessment, 'test-model', db);
    db.close(); db = openDatabase(filename);
    assert.equal(readDebates(db)[0].stances[0].arguments[0].assessment?.score, 80);
    assert.equal(getScoringContext(argument, db).argument.sources[0].excerpt, 'Example supplied excerpt');
    const pending = claimScore(argument, db);
    mutate({ action: 'updateStance', id: stance, title: 'Charge a small fee', description: 'Changed context' }, db);
    assert.equal(getScoringContext(argument, db).argument.assessment, null);
    assert.throws(() => finishScore(argument, pending, assessment, 'test-model', db), /changed during scoring/);
    finishScore(argument, claimScore(argument, db), assessment, 'test-model', db);
    mutate({ action: 'updateDebate', id: debate, title: 'Should museums be free?', description: '' }, db);
    assert.equal(getScoringContext(argument, db).argument.assessment, null);
    finishScore(argument, claimScore(argument, db), assessment, 'test-model', db);
    mutate({ action: 'updateArgument', id: argument, title: 'New reasoning', body: 'Here is a revised argument.', sources: [] }, db);
    assert.equal(getScoringContext(argument, db).argument.assessment, null);
    mutate({ action: 'delete', entity: 'debate', id: debate }, db);
    assert.equal(readDebates(db).length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM arguments').get()?.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stances').get()?.n, 0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('invalid input and unsafe source protocols are rejected', () => {
  assert.equal(commandSchema.safeParse({ action: 'createDebate', title: '   ' }).success, false);
  assert.equal(commandSchema.safeParse({ action: 'createArgument', stanceId: 'a', title: 'Argument', body: 'A sufficiently long argument.', sources: [{ url: 'javascript:alert(1)', excerpt: '' }] }).success, false);
});
test('anonymous drafts stay private, published debates are public and read-only, discarded drafts vanish', () => {
  const db = openDatabase(':memory:');
  try {
    const first = mutate({ action: 'createDebate', title: 'Should parks be free?', description: '' }, db, 'visitor-a');
    const second = mutate({ action: 'createDebate', title: 'Should museums be free?', description: '' }, db, 'visitor-b');
    assert.deepEqual(readVisibleDebates('visitor-a', db).map(item => item.id), [first]);
    assert.deepEqual(readVisibleDebates('visitor-b', db).map(item => item.id), [second]);
    assert.throws(() => assertReadable('debate', first, 'visitor-b', db), /not available/);
    assert.throws(() => mutate({ action: 'createStance', debateId: first, title: 'Keep access free', description: '' }, db, 'visitor-b'), /not available/);
    mutate({ action: 'createStance', debateId: first, title: 'Keep access free', description: '' }, db, 'visitor-a');
    mutate({ action: 'publish', id: first }, db, 'visitor-a');
    assert.deepEqual(readVisibleDebates('visitor-b', db).map(item => item.id), [second, first]);
    assert.throws(() => mutate({ action: 'updateDebate', id: first, title: 'Changed question', description: '' }, db, 'visitor-a'), /read-only/);
    assert.throws(() => mutate({ action: 'delete', entity: 'debate', id: first }, db, 'visitor-b'), /read-only/);
    mutate({ action: 'delete', entity: 'debate', id: second }, db, 'visitor-b');
    assert.deepEqual(readVisibleDebates('visitor-b', db).map(item => item.id), [first]);
  } finally { db.close(); }
});
test('cross-origin writes are rejected', () => {
  assert.throws(() => checkOrigin(new Request('http://localhost:3000/api/workspace', { headers: { origin: 'https://another-site.example' } })), /Cross-origin/);
  assert.doesNotThrow(() => checkOrigin(new Request('http://localhost:3000/api/workspace', { headers: { origin: 'http://localhost:3000' } })));
  assert.doesNotThrow(() => checkOrigin(new Request('http://localhost:3000/api/workspace', { headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } })));
  assert.throws(() => checkOrigin(new Request('http://localhost:3000/api/workspace', { headers: { host: 'untrusted.example', origin: 'http://untrusted.example' } })), /Cross-origin/);
  const previous = process.env.PUBLIC_SHARING;
  process.env.PUBLIC_SHARING = '1';
  try {
    assert.doesNotThrow(() => checkOrigin(new Request('http://localhost/api/workspace', { headers: { host: 'debate-tree.onrender.com', 'x-forwarded-proto': 'https', origin: 'https://debate-tree.onrender.com' } })));
    assert.throws(() => checkOrigin(new Request('http://localhost/api/workspace', { headers: { host: 'debate-tree.onrender.com', 'x-forwarded-proto': 'https', origin: 'https://different.example' } })), /Cross-origin/);
  } finally { if (previous === undefined) delete process.env.PUBLIC_SHARING; else process.env.PUBLIC_SHARING = previous; }
});
test('Grok structured response is validated and request uses untrusted context', async () => {
  const mock: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.x.ai/v1/responses');
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.store, false);
    assert.equal(payload.text.format.type, 'json_schema');
    assert.deepEqual(JSON.parse(payload.input[1].content), context);
    return Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(assessment) }] }] });
  };
  assert.deepEqual(await assessArgument(context, 'test-key', 'test-model', mock), assessment);
});
test('invalid scores, provider failures, and timeouts are actionable errors', async () => {
  const malformed: typeof fetch = async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...assessment, score: 110 }) }] }] });
  await assert.rejects(() => assessArgument(context, 'test-key', 'test-model', malformed), /invalid assessment/);
  const limited: typeof fetch = async () => new Response('', { status: 429 });
  await assert.rejects(() => assessArgument(context, 'test-key', 'test-model', limited), (e: unknown) => e instanceof AppError && e.status === 429);
  const timeout: typeof fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
  await assert.rejects(() => assessArgument(context, 'test-key', 'test-model', timeout), /too long/);
});
