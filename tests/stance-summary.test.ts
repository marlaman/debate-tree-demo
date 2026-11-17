import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimScore, finishScore, getStanceSummaryContext, mutate, openDatabase, readDebates, saveStanceSummary } from '../src/lib/db';
import { summarizeStance } from '../src/lib/stance-summary';

const assessment = { score: 42, explanation: 'The access concern is relevant, but evidence is thin.', strengths: ['Clear relevance'], weaknesses: ['No cost evidence'] };
const summary = 'Free entry could widen access for people with low incomes, which is the case’s clearest point. The arguments offer no evidence about operating costs or whether fees would actually exclude visitors, limiting the average score.';

test('older stance tables gain summary columns without losing data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stance-migration-'));
  const filename = path.join(dir, 'debates.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec("CREATE TABLE stances (id TEXT PRIMARY KEY, debateId TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL); INSERT INTO stances VALUES ('s1', 'd1', 'Existing stance', '');");
  legacy.close();
  try {
    const db = openDatabase(filename);
    try {
      const columns = (db.prepare('PRAGMA table_info(stances)').all() as { name: string }[]).map(column => column.name);
      assert.ok(columns.includes('summary') && columns.includes('summaryKey'));
      assert.equal(db.prepare("SELECT title FROM stances WHERE id='s1'").get()?.title, 'Existing stance');
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Grok receives complete stance arguments and their assessments', async () => {
  const db = openDatabase(':memory:');
  try {
    const debateId = mutate({ action: 'createDebate', title: 'Should parks be free?', description: '' }, db);
    const stanceId = mutate({ action: 'createStance', debateId, title: 'Parks should be free.', description: '' }, db);
    const argumentId = mutate({ action: 'createArgument', stanceId, title: 'Access matters', body: 'Free entry helps people who cannot afford fees visit public parks.', sources: [] }, db);
    finishScore(argumentId, claimScore(argumentId, db), assessment, 'test-model', db);
    const { debate, stance } = getStanceSummaryContext(stanceId, db);
    const request: typeof fetch = async (_url, options) => {
      const payload = JSON.parse(options?.body as string);
      const input = JSON.parse(payload.input[1].content);
      assert.equal(payload.store, false);
      assert.equal(input.averageScore, 42);
      assert.equal(input.arguments[0].body, 'Free entry helps people who cannot afford fees visit public parks.');
      assert.deepEqual(input.arguments[0].assessment, assessment);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary }) }] }] });
    };
    assert.equal(await summarizeStance(debate, stance, 'test-key', 'test-model', request), summary);
  } finally { db.close(); }
});

test('saved summaries become stale after arguments or scores change', () => {
  const db = openDatabase(':memory:');
  try {
    const debateId = mutate({ action: 'createDebate', title: 'Should parks be free?', description: '' }, db);
    const stanceId = mutate({ action: 'createStance', debateId, title: 'Parks should be free.', description: '' }, db);
    const argumentId = mutate({ action: 'createArgument', stanceId, title: 'Access matters', body: 'Free entry helps people who cannot afford fees visit public parks.', sources: [] }, db);
    finishScore(argumentId, claimScore(argumentId, db), assessment, 'test-model', db);
    const revision = getStanceSummaryContext(stanceId, db).revision!;
    assert.equal(saveStanceSummary(stanceId, revision, summary, db), true);
    assert.equal(readDebates(db)[0].stances[0].summaryFresh, true);
    const second = mutate({ action: 'createArgument', stanceId, title: 'A second point', body: 'Open access could encourage more regular visits.', sources: [] }, db);
    assert.equal(readDebates(db)[0].stances[0].summaryFresh, true);
    finishScore(second, claimScore(second, db), { ...assessment, score: 55 }, 'test-model', db);
    assert.equal(readDebates(db)[0].stances[0].summaryFresh, false);
    assert.equal(saveStanceSummary(stanceId, revision, summary, db), false);
  } finally { db.close(); }
});
