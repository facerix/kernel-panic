import {
  OBJECTIVES,
  type ContractContext,
  type ObjectiveKind,
} from '../../../src/game/hub/Curator.js';

export function testContractContext(
  objectiveKind: ObjectiveKind = OBJECTIVES.REACH_EXIT,
  overrides: Partial<ContractContext> = {}
): ContractContext {
  return {
    recipeId: 'test-fixture',
    // A real lexicon principal so Phase 2.9 alias resolution (enemyAliases) finds
    // a curated entry instead of warning + falling back to a generic name.
    principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp', 'finance'] },
    asset: { id: 'test-asset', label: 'test asset', groups: ['test'] },
    action: { id: 'test-action', label: 'test action', groups: ['test'] },
    tags: ['test-fixture', `objective:${objectiveKind}`],
    ...overrides,
  };
}
