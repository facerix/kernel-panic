import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../src/game/Run.js';
import { Hostile } from '../../../src/game/Hostile.js';
import { CorpCivilian } from '../../../src/game/entities/CorpCivilian.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { FACTION, factionForPrincipalGroups } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import {
  OBJECTIVES,
  type Contract,
  type ContractContextToken,
} from '../../../src/game/hub/Curator.js';
import { testContractContext } from './contractTestUtils.js';

const PRINCIPALS: Record<string, ContractContextToken> = {
  matsuda: { id: 'matsuda', label: 'Matsuda', groups: ['corp', 'finance'] },
  choir: { id: 'chrome-choir', label: 'Chrome Choir', groups: ['rival', 'street'] },
  water: {
    id: 'district-water-board',
    label: 'District Water Board',
    groups: ['civic', 'infrastructure'],
  },
};

function contractFor(principal: ContractContextToken, seed = 7): Contract {
  return {
    seed,
    objective: { kind: OBJECTIVES.REACH_EXIT, title: 'Extract', briefing: 'Reach the exit.' },
    difficulty: 'critical',
    threatCount: 4,
    label: `${principal.label} job`,
    context: testContractContext(OBJECTIVES.REACH_EXIT, { principal }),
    reward: { credits: 0, repDelta: 0 },
  } as Contract;
}

function combatRun(principal: ContractContextToken, seed = 7): Run {
  const crew = buildCrewMember('razor', { x: 0, y: 0 }, new Rng(100), { id: 'crew-razor' });
  const run = new Run({ crewMember: crew, seed });
  run.enterBriefing(contractFor(principal, seed));
  run.enterCombat();
  return run;
}

function hostilesIn(run: Run): Hostile[] {
  return [...run.world!.entities.values()].filter((e): e is Hostile => e instanceof Hostile);
}

test('factionForPrincipalGroups maps rival groups to RIVAL, corp/civic to CORP', () => {
  assert.equal(factionForPrincipalGroups(['rival', 'street']), FACTION.RIVAL);
  assert.equal(factionForPrincipalGroups(['corp', 'finance']), FACTION.CORP);
  assert.equal(factionForPrincipalGroups(['civic', 'infrastructure']), FACTION.CORP);
  assert.equal(factionForPrincipalGroups([]), FACTION.CORP, 'no groups → establishment default');
});

test('a rival-group contract spawns RIVAL hostiles and a RIVAL turn slot', () => {
  const run = combatRun(PRINCIPALS.choir);
  assert.equal(run.hostileFaction, FACTION.RIVAL);
  assert.deepEqual(run.queue!.factionOrder, [FACTION.PLAYER, FACTION.RIVAL]);
  const hostiles = hostilesIn(run);
  assert.ok(hostiles.length > 0);
  for (const h of hostiles) assert.equal(h.faction, FACTION.RIVAL, `${h.id} should be RIVAL`);
});

test('corp and civic contracts both spawn CORP hostiles (the establishment)', () => {
  for (const key of ['matsuda', 'water'] as const) {
    const run = combatRun(PRINCIPALS[key]);
    assert.equal(run.hostileFaction, FACTION.CORP, `${key} → CORP`);
    for (const h of hostilesIn(run)) assert.equal(h.faction, FACTION.CORP, `${key}/${h.id}`);
  }
});

test('the enemy turn refreshes AP for RIVAL hostiles', () => {
  const run = combatRun(PRINCIPALS.choir);
  const h = hostilesIn(run)[0]!;
  h.ap = 0;
  // Queue starts on PLAYER; one endTurn advances to the RIVAL slot and refreshes it.
  run.queue!.endTurn(run.world!);
  assert.equal(run.queue!.currentFaction, FACTION.RIVAL);
  assert.equal(h.ap, h.maxAp, 'rival hostile AP should refresh on its turn');
});

test('rival contracts stamp establishment entities with FACTION.RIVAL', () => {
  const run = combatRun(PRINCIPALS.choir);
  const civs = [...run.world!.entities.values()].filter(
    (e): e is CorpCivilian => e instanceof CorpCivilian
  );
  assert.ok(civs.length > 0, 'map should include corp civilians');
  for (const civ of civs) {
    assert.equal(civ.faction, FACTION.RIVAL, `${civ.id} should match run allegiance`);
  }
});

test('RIVAL hostiles do not target same-faction establishment entities', () => {
  const run = combatRun(PRINCIPALS.choir);
  const rival = hostilesIn(run)[0]!;
  const civ = [...run.world!.entities.values()].find(e => e instanceof CorpCivilian);
  assert.ok(civ, 'expected a corp civilian on the map');
  assert.equal(civ.faction, FACTION.RIVAL);
  assert.equal(rival.isHostileTo(civ), false);
});

test('snapshot → restore round-trips a RIVAL run (faction + queue order)', () => {
  const run = combatRun(PRINCIPALS.choir);
  const { run: restored } = restore(snapshot(run));
  assert.equal(restored.hostileFaction, FACTION.RIVAL);
  assert.deepEqual(restored.queue!.factionOrder, [FACTION.PLAYER, FACTION.RIVAL]);
  for (const h of hostilesIn(restored)) assert.equal(h.faction, FACTION.RIVAL);
});
