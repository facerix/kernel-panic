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
    principal: { id: 'test-principal', label: 'Test Principal', groups: ['test'] },
    asset: { id: 'test-asset', label: 'test asset', groups: ['test'] },
    action: { id: 'test-action', label: 'test action', groups: ['test'] },
    tags: ['test-fixture', `objective:${objectiveKind}`],
    ...overrides,
  };
}
