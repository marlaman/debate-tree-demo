import type { Suggestion } from './autofill';

export type AutoModeActions = {
  suggestStances: (debateId: string) => Promise<Suggestion[]>;
  createStance: (debateId: string, suggestion: Suggestion) => Promise<string>;
  suggestArguments: (stanceId: string) => Promise<Suggestion[]>;
  createArgument: (stanceId: string, suggestion: Suggestion) => Promise<string>;
  scoreArgument: (argumentId: string) => Promise<void>;
};
export type AutoModeProgress = { phase: string; completed: number; total: number };

export async function runAutoMode(debateId: string, actions: AutoModeActions, onProgress: (progress: AutoModeProgress) => void) {
  onProgress({ phase: 'Creating stances', completed: 0, total: 2 });
  const suggestions = await actions.suggestStances(debateId);
  const stanceIds: string[] = [];
  for (const [index, suggestion] of suggestions.entries()) {
    stanceIds.push(await actions.createStance(debateId, suggestion));
    onProgress({ phase: 'Creating stances', completed: index + 1, total: suggestions.length });
  }
  for (const [stanceIndex, stanceId] of stanceIds.entries()) {
    const argumentsToAdd = await actions.suggestArguments(stanceId);
    for (const [index, suggestion] of argumentsToAdd.entries()) {
      onProgress({ phase: `Stance ${stanceIndex + 1}: adding and scoring arguments`, completed: index, total: argumentsToAdd.length });
      const argumentId = await actions.createArgument(stanceId, suggestion);
      await actions.scoreArgument(argumentId);
      onProgress({ phase: `Stance ${stanceIndex + 1}: adding and scoring arguments`, completed: index + 1, total: argumentsToAdd.length });
    }
  }
}
