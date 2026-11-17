import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debateOutcome, stanceOutcome } from '../src/lib/outcome';
import { asDebateQuestion, type Argument, type Debate, type Stance } from '../src/lib/types';

function stance(title: string, scores: (number | null)[]): Stance {
  return { id: title, debateId: 'debate', title, description: '', arguments: scores.map((score, index) => argument(score, `${title}-${index}`)) };
}
function argument(score: number | null, id: string): Argument {
  return { id, stanceId: '', title: '', body: '', sources: [], assessment: score === null ? null : { score, explanation: '', strengths: [], weaknesses: [] }, model: null, scoredAt: null, error: null, scoringStarted: null, createdAt: '' };
}
function debate(...stances: Stance[]): Debate {
  return { id: 'debate', title: 'Should this change happen?', description: '', createdAt: '', stances };
}

test('debate titles display as questions, including older period-ended titles', () => {
  assert.equal(asDebateQuestion('Should this change happen.'), 'Should this change happen?');
  assert.equal(asDebateQuestion('Should this change happen?'), 'Should this change happen?');
});

test('parent outcomes update from scored arguments and do not count pending scores', () => {
  const yes = stance('Yes.', [80, null]);
  const no = stance('No.', [60]);
  assert.deepEqual(stanceOutcome(yes), { label: 'CASE SO FAR · 1 SCORED', text: 'Reading the arguments…' });
  assert.deepEqual(debateOutcome(debate(yes, no)), { label: 'LEADING CASE · 80% vs 60%', text: 'Yes.' });
  yes.arguments.push(argument(20, 'yes-new'));
  assert.deepEqual(stanceOutcome(yes), { label: 'CASE SO FAR · 2 SCORED', text: 'Reading the arguments…' });
  assert.deepEqual(debateOutcome(debate(yes, no)), { label: 'LEADING CASE · 60% vs 50%', text: 'No.' });
});

test('stance outcome displays only a summary of its current arguments', () => {
  const item = stance('First', [33]);
  item.summary = 'The access argument identifies a concrete fairness concern. It lacks evidence about the proposed policy’s costs.';
  item.summaryFresh = true;
  assert.equal(stanceOutcome(item).text, item.summary);
  item.summaryFresh = false;
  assert.equal(stanceOutcome(item).text, 'Reading the arguments…');
});

test('debate waits for two scored stances and avoids declaring a close result', () => {
  const yes = stance('Yes.', [71]);
  const no = stance('No.', [null]);
  assert.equal(debateOutcome(debate(yes, no)).text, 'Score two stances to compare.');
  no.arguments[0].assessment = { score: 68, explanation: '', strengths: [], weaknesses: [] };
  assert.equal(debateOutcome(debate(yes, no)).text, 'No clear lead yet.');
});
