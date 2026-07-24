import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../src/game/Run.js';
import { Hostile } from '../../../src/game/Hostile.js';
import { Entity } from '../../../src/game/Entity.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { aliasFor } from '../../../src/game/enemyAliases.js';
import { ENEMY_ARCHETYPE, type EnemyArchetype } from '../../../src/game/encounters.js';
import { OBJECTIVES, type Contract } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';

const PRINCIPAL_ID = 'matsuda';

/** Entity id prefix → archetype, so we can assert each spawned hostile's alias. */
const PREFIX_ARCHETYPE: Readonly<Record<string, EnemyArchetype>> = {
  drone: ENEMY_ARCHETYPE.SKIRMISHER,
  guard: ENEMY_ARCHETYPE.GUARD,
  sniper: ENEMY_ARCHETYPE.SNIPER,
  lookout: ENEMY_ARCHETYPE.LOOKOUT,
  medic: ENEMY_ARCHETYPE.MEDIC,
  bruiser: ENEMY_ARCHETYPE.BRUISER,
  juggernaut: ENEMY_ARCHETYPE.JUGGERNAUT,
  flanker: ENEMY_ARCHETYPE.FLANKER,
};

function matsudaContract(): Contract {
  return {
    seed: 7,
    objective: { kind: OBJECTIVES.REACH_EXIT, title: 'Extract', briefing: 'Reach the exit.' },
    // CRITICAL → T3: pulls in specialist + elite anchors so we exercise all loops.
    difficulty: 'critical',
    threatCount: 4,
    label: 'matsuda job',
    context: testContractContext(OBJECTIVES.REACH_EXIT),
    reward: { credits: 0, repDelta: 0 },
  } as Contract;
}

function combatRun(seed = 7): Run {
  const crew = buildCrewMember('razor', { x: 0, y: 0 }, new Rng(100), { id: 'crew-razor' });
  const run = new Run({ crewMember: crew, seed });
  run.enterBriefing(matsudaContract());
  run.enterCombat();
  return run;
}

function hostilesIn(run: Run): Hostile[] {
  return [...run.world!.entities.values()].filter((e): e is Hostile => e instanceof Hostile);
}

test('Entity carries displayName/principalTag from init, undefined by default', () => {
  const aliased = new Entity({
    id: 'e1',
    x: 0,
    y: 0,
    faction: 'corp',
    displayName: 'Auditor',
    principalTag: 'Matsuda',
  });
  assert.equal(aliased.displayName, 'Auditor');
  assert.equal(aliased.principalTag, 'Matsuda');

  const plain = new Entity({ id: 'e2', x: 0, y: 0, faction: 'corp' });
  assert.equal(plain.displayName, undefined);
  assert.equal(plain.principalTag, undefined);
});

test('spawned hostiles carry the contract principal’s curated alias', () => {
  const run = combatRun();
  const hostiles = hostilesIn(run);
  assert.ok(hostiles.length > 0, 'a critical contract should spawn at least one hostile');

  for (const h of hostiles) {
    const prefix = h.id.split('-')[0]!;
    const archetype = PREFIX_ARCHETYPE[prefix];
    assert.ok(archetype, `unexpected hostile id prefix "${prefix}" (${h.id})`);
    const expected = aliasFor(PRINCIPAL_ID, archetype);
    assert.equal(h.principalTag, 'Matsuda', `${h.id} should carry the Matsuda tag`);
    assert.equal(h.displayName, expected.displayName, `${h.id} alias mismatch`);
  }
});

test('the player is not aliased (no displayName in snapshot)', () => {
  const run = combatRun();
  assert.equal(run.player!.displayName, undefined);
  const rec = snapshot(run);
  const playerRec = rec.entities.find(e => e.id === run.player!.id);
  assert.ok(playerRec);
  assert.ok(!('displayName' in playerRec), 'un-aliased entities omit displayName from snapshot');
});

test('snapshot → restore preserves hostile aliases', () => {
  const run = combatRun();
  const before = new Map(hostilesIn(run).map(h => [h.id, { d: h.displayName, t: h.principalTag }]));

  const rec = snapshot(run);
  const { run: restored } = restore(rec);

  const after = hostilesIn(restored);
  assert.equal(after.length, before.size, 'hostile count should survive round-trip');
  for (const h of after) {
    const expected = before.get(h.id);
    assert.ok(expected, `restored hostile ${h.id} was not in the original run`);
    assert.equal(h.displayName, expected.d, `${h.id} displayName lost on restore`);
    assert.equal(h.principalTag, expected.t, `${h.id} principalTag lost on restore`);
  }
});

test('a pre-2.9 save without identity fields still loads (backward compatible)', () => {
  const run = combatRun();
  const rec = JSON.parse(JSON.stringify(snapshot(run)));
  // Simulate an older save: strip the new fields from every entity record.
  for (const e of rec.entities) {
    delete e.displayName;
    delete e.principalTag;
  }
  const { run: restored } = restore(rec);
  for (const h of hostilesIn(restored)) {
    assert.equal(h.displayName, undefined, 'missing identity stays undefined, not invented');
    assert.equal(h.principalTag, undefined);
  }
});
