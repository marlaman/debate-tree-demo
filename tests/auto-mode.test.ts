import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEBATE_IDEAS, pickDebateIdeas } from '../src/lib/debate-ideas';
import { runAutoMode } from '../src/lib/auto-mode';
import type { Suggestion } from '../src/lib/autofill';

test('landing page has 50 distinct questions and picks three without repetition', () => {
  assert.equal(DEBATE_IDEAS.length, 50);
  assert.equal(new Set(DEBATE_IDEAS).size, 50);
  assert.ok(DEBATE_IDEAS.every(idea => idea.endsWith('?')));
  const first = pickDebateIdeas(3, () => 0);
  const shifted = pickDebateIdeas(3, () => 0.99);
  assert.equal(first.length, 3);
  assert.equal(new Set(first).size, 3);
  assert.notDeepEqual(first, shifted);
});

test('auto mode creates both stances before adding and scoring their arguments', async () => {
  const calls: string[] = [];
  const stanceSuggestion = (title: string): Suggestion => ({ title, description: 'A rationale.', body: '' });
  const argumentSuggestion = (title: string): Suggestion => ({ title, description: '', body: 'A complete reason supporting this position.' });
  await runAutoMode('debate-1', {
    suggestStances: async id => { calls.push(`suggest stances:${id}`); return [stanceSuggestion('For'), stanceSuggestion('Against')]; },
    createStance: async (_id, suggestion) => { calls.push(`create stance:${suggestion.title}`); return suggestion.title; },
    suggestArguments: async id => { calls.push(`suggest arguments:${id}`); return [argumentSuggestion(`${id} point 1`), argumentSuggestion(`${id} point 2`)]; },
    createArgument: async (_id, suggestion) => { calls.push(`create argument:${suggestion.title}`); return suggestion.title; },
    scoreArgument: async id => { calls.push(`score:${id}`); },
  }, () => {});
  assert.deepEqual(calls, [
    'suggest stances:debate-1', 'create stance:For', 'create stance:Against',
    'suggest arguments:For', 'create argument:For point 1', 'score:For point 1', 'create argument:For point 2', 'score:For point 2',
    'suggest arguments:Against', 'create argument:Against point 1', 'score:Against point 1', 'create argument:Against point 2', 'score:Against point 2',
  ]);
});
