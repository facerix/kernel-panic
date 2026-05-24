/**
 * M2.4: Sweep objective + RelayNode tests.
 *
 * Tests cover:
 *   - RelayNode construction and destructibility
 *   - Sweep objective satisfaction (all three quota types)
 *   - Snapshot round-trip for CorpTurret and RelayNode
 *   - Entity labels for new entity types
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RelayNode } from '../../../src/game/entities/RelayNode.js';
import { CorpTurret } from '../../../src/game/entities/CorpTurret.js';
import { CorpDrone } from '../../../src/game/ai/CorpDrone.js';
import { entityLabel } from '../../../src/game/Entity.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Run, isObjectiveSatisfied, SWEEP_QUOTA } from '../../../src/game/Run.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { restore } from '../../../src/game/persistence.js';
import { FACTION, TILE, RELAY_NODE_HP } from '../../../src/game/constants.js';
import type { Contract } from '../../../src/game/hub/Curator.js';

function makeGrid(w = 12, h = 12): Grid {
  const grid = new Grid(w, h, TILE.WALL);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      grid.setTile(x, y, TILE.FLOOR);
    }
  }
  return grid;
}

function makeWorld(w = 12, h = 12): World {
  return new World(makeGrid(w, h), { events: new EventBus() });
}

function makeSweepContract(target: string, count?: number): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.SWEEP,
      title: 'Sweep test',
      briefing: 'Clear targets.',
      params: {
        target,
        ...(count !== undefined ? { count } : {}),
      },
    },
    difficulty: 'standard',
    threatCount: 2,
    label: '// Test sweep',
    reward: { credits: 50, repDelta: 5 },
  };
}

// --------------------------------------------------------------------------
// RelayNode
// --------------------------------------------------------------------------

describe('RelayNode', () => {
  it('constructs with CORP faction and default HP', () => {
    const node = new RelayNode({ id: 'relay-node-0', x: 5, y: 5 });
    assert.equal(node.faction, FACTION.CORP);
    assert.equal(node.glyph, '~');
    assert.equal(node.maxHp, RELAY_NODE_HP);
    assert.equal(node.maxAp, 0);
    assert.equal(node.alive, true);
    assert.equal(node.label, 'Relay node');
  });

  it('constructs with custom label', () => {
    const node = new RelayNode({ id: 'relay-node-0', x: 3, y: 3, label: 'Skybridge relay' });
    assert.equal(node.label, 'Skybridge relay');
  });

  it('can be destroyed', () => {
    const node = new RelayNode({ id: 'relay-node-0', x: 5, y: 5 });
    node.damage(RELAY_NODE_HP);
    assert.equal(node.alive, false);
    assert.equal(node.hp, 0);
  });

  it('has baseDodgeChance of 0 (stationary, cannot dodge)', () => {
    const node = new RelayNode({ id: 'relay-node-0', x: 5, y: 5 });
    assert.equal(node.baseDodgeChance, 0);
  });

  it('is not a Hostile (player turrets ignore it)', () => {
    const node = new RelayNode({ id: 'relay-node-0', x: 5, y: 5 });
    // RelayNode extends Entity directly, not Hostile. Import check via duck
    // typing: Hostile has `isHostileTo` method; RelayNode does not.
    assert.equal(typeof (node as unknown as { isHostileTo?: unknown }).isHostileTo, 'undefined');
  });
});

// --------------------------------------------------------------------------
// Sweep objective — drone-all quota
// --------------------------------------------------------------------------

describe('Sweep objective (drone-all)', () => {
  it('is NOT satisfied when live drones remain', () => {
    const world = makeWorld();
    const drone = new CorpDrone({ id: 'drone-0', x: 3, y: 3 });
    world.addEntity(drone);
    const contract = makeSweepContract('drone-all');
    assert.equal(isObjectiveSatisfied(contract, world), false);
  });

  it('is satisfied when all drones are dead', () => {
    const world = makeWorld();
    const drone = new CorpDrone({ id: 'drone-0', x: 3, y: 3 });
    world.addEntity(drone);
    drone.damage(drone.maxHp);
    const contract = makeSweepContract('drone-all');
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('is satisfied when no drones exist', () => {
    const world = makeWorld();
    const contract = makeSweepContract('drone-all');
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('falls back to drone-all for unrecognized target', () => {
    const world = makeWorld();
    const drone = new CorpDrone({ id: 'drone-0', x: 3, y: 3 });
    world.addEntity(drone);
    const contract = makeSweepContract('unknown-target');
    assert.equal(isObjectiveSatisfied(contract, world), false);
  });

  it('falls back to drone-all when no target param', () => {
    const contract: Contract = {
      seed: 42,
      objective: {
        kind: OBJECTIVES.SWEEP,
        title: 'Sweep',
        briefing: 'Clear all.',
      },
      difficulty: 'standard',
      threatCount: 2,
      label: '// Sweep',
      reward: { credits: 50, repDelta: 5 },
    };
    const world = makeWorld();
    const drone = new CorpDrone({ id: 'drone-0', x: 3, y: 3 });
    world.addEntity(drone);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    drone.damage(drone.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

// --------------------------------------------------------------------------
// Sweep objective — relay-node quota
// --------------------------------------------------------------------------

describe('Sweep objective (relay-node)', () => {
  it('is NOT satisfied when live relay nodes remain', () => {
    const world = makeWorld();
    const node = new RelayNode({ id: 'relay-node-0', x: 3, y: 3 });
    world.addEntity(node);
    const contract = makeSweepContract('relay-node');
    assert.equal(isObjectiveSatisfied(contract, world), false);
  });

  it('is satisfied when all relay nodes are dead', () => {
    const world = makeWorld();
    const node = new RelayNode({ id: 'relay-node-0', x: 3, y: 3 });
    world.addEntity(node);
    node.damage(node.maxHp);
    const contract = makeSweepContract('relay-node');
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('uses count param when present', () => {
    const world = makeWorld();
    for (let i = 0; i < 3; i++) {
      world.addEntity(new RelayNode({ id: `relay-node-${i}`, x: 3 + i, y: 3 }));
    }
    const contract = makeSweepContract('relay-node', 2);
    // 0 destroyed
    assert.equal(isObjectiveSatisfied(contract, world), false);
    // Destroy 1
    world.entities.get('relay-node-0')!.damage(RELAY_NODE_HP);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    // Destroy 2
    world.entities.get('relay-node-1')!.damage(RELAY_NODE_HP);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('skybridge-relay maps to relay-node quota', () => {
    const world = makeWorld();
    const node = new RelayNode({ id: 'relay-node-0', x: 3, y: 3 });
    world.addEntity(node);
    const contract = makeSweepContract('skybridge-relay');
    assert.equal(isObjectiveSatisfied(contract, world), false);
    node.damage(node.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

// --------------------------------------------------------------------------
// Sweep objective — turret quota
// --------------------------------------------------------------------------

describe('Sweep objective (turret)', () => {
  it('is NOT satisfied when live corp turrets remain', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 3, y: 3 });
    world.addEntity(turret);
    const contract = makeSweepContract('turret');
    assert.equal(isObjectiveSatisfied(contract, world), false);
  });

  it('is satisfied when all corp turrets are dead', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 3, y: 3 });
    world.addEntity(turret);
    turret.damage(turret.maxHp);
    const contract = makeSweepContract('turret');
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('uses count param when present', () => {
    const world = makeWorld();
    for (let i = 0; i < 3; i++) {
      world.addEntity(new CorpTurret({ id: `corp-turret-${i}`, x: 3 + i, y: 3 }));
    }
    const contract = makeSweepContract('turret', 2);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    world.entities.get('corp-turret-0')!.damage(10);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    world.entities.get('corp-turret-1')!.damage(10);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('corp-turret target alias works', () => {
    const world = makeWorld();
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 3, y: 3 });
    world.addEntity(turret);
    const contract = makeSweepContract('corp-turret');
    assert.equal(isObjectiveSatisfied(contract, world), false);
  });
});

// --------------------------------------------------------------------------
// Sweep: extract blocked until quota met (golden path)
// --------------------------------------------------------------------------

describe('Sweep golden path (extract gating)', () => {
  it('blocks extraction until all relay nodes destroyed', () => {
    const world = makeWorld();
    const node0 = new RelayNode({ id: 'relay-node-0', x: 3, y: 3 });
    const node1 = new RelayNode({ id: 'relay-node-1', x: 5, y: 5 });
    world.addEntity(node0);
    world.addEntity(node1);
    const contract = makeSweepContract('relay-node');

    // Not satisfied initially
    assert.equal(isObjectiveSatisfied(contract, world), false);

    // Destroy first node — still not done
    node0.damage(RELAY_NODE_HP);
    assert.equal(isObjectiveSatisfied(contract, world), false);

    // Destroy second node — satisfied
    node1.damage(RELAY_NODE_HP);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('blocks extraction until all drones killed (drone-all)', () => {
    const world = makeWorld();
    const d0 = new CorpDrone({ id: 'drone-0', x: 3, y: 3 });
    const d1 = new CorpDrone({ id: 'drone-1', x: 5, y: 5 });
    world.addEntity(d0);
    world.addEntity(d1);
    const contract = makeSweepContract('drone-all');

    assert.equal(isObjectiveSatisfied(contract, world), false);
    d0.damage(d0.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), false);
    d1.damage(d1.maxHp);
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

// --------------------------------------------------------------------------
// Snapshot round-trip
// --------------------------------------------------------------------------

describe('Snapshot round-trip', () => {
  it('CorpTurret survives snapshot + restore', () => {
    const merc = new Merc({ id: 'crew-merc', x: 1, y: 1, callsign: 'VIPER' });
    const run = new Run({ crewMember: merc, seed: 99 });
    const contract: Contract = {
      seed: 99,
      objective: {
        kind: OBJECTIVES.SWEEP,
        title: 'Sweep',
        briefing: 'Clear.',
        params: { target: 'relay-node' },
      },
      difficulty: 'standard',
      threatCount: 0,
      label: '// Test',
      reward: { credits: 50, repDelta: 5 },
    };
    run.enterBriefing(contract);
    run.enterCombat();

    // Find the corp turret placed by sweep placement
    let corpTurret: CorpTurret | null = null;
    for (const e of run.world!.entities.values()) {
      if (e instanceof CorpTurret) {
        corpTurret = e;
        break;
      }
    }
    assert.ok(corpTurret, 'Expected a CorpTurret to be placed for sweep contract');

    // Take a snapshot and restore
    const snap = run.snapshot();
    const { world: restoredWorld } = restore(snap);

    // Verify corp turret survived
    const restoredTurret = restoredWorld.entities.get(corpTurret.id);
    assert.ok(restoredTurret, 'Restored world should have the corp turret');
    assert.ok(restoredTurret instanceof CorpTurret);
    assert.equal(restoredTurret.range, corpTurret.range);
    assert.equal(restoredTurret.attackDamage, corpTurret.attackDamage);
    assert.equal(restoredTurret.faction, FACTION.CORP);
    assert.equal(restoredTurret.glyph, '$');
  });

  it('RelayNode survives snapshot + restore', () => {
    const merc = new Merc({ id: 'crew-merc', x: 1, y: 1, callsign: 'VIPER' });
    const run = new Run({ crewMember: merc, seed: 99 });
    const contract: Contract = {
      seed: 99,
      objective: {
        kind: OBJECTIVES.SWEEP,
        title: 'Sweep',
        briefing: 'Clear.',
        params: { target: 'relay-node' },
      },
      difficulty: 'standard',
      threatCount: 0,
      label: '// Test',
      reward: { credits: 50, repDelta: 5 },
    };
    run.enterBriefing(contract);
    run.enterCombat();

    // Find a relay node
    let relayNode: RelayNode | null = null;
    for (const e of run.world!.entities.values()) {
      if (e instanceof RelayNode) {
        relayNode = e;
        break;
      }
    }
    assert.ok(relayNode, 'Expected RelayNodes to be placed for relay-node sweep contract');

    const snap = run.snapshot();
    const { world: restoredWorld } = restore(snap);

    const restoredNode = restoredWorld.entities.get(relayNode.id);
    assert.ok(restoredNode, 'Restored world should have the relay node');
    assert.ok(restoredNode instanceof RelayNode);
    assert.equal(restoredNode.label, relayNode.label);
    assert.equal(restoredNode.faction, FACTION.CORP);
    assert.equal(restoredNode.glyph, '~');
  });

  it('dead RelayNode restores correctly', () => {
    const merc = new Merc({ id: 'crew-merc', x: 1, y: 1, callsign: 'VIPER' });
    const run = new Run({ crewMember: merc, seed: 99 });
    const contract: Contract = {
      seed: 99,
      objective: {
        kind: OBJECTIVES.SWEEP,
        title: 'Sweep',
        briefing: 'Clear.',
        params: { target: 'relay-node' },
      },
      difficulty: 'standard',
      threatCount: 0,
      label: '// Test',
      reward: { credits: 50, repDelta: 5 },
    };
    run.enterBriefing(contract);
    run.enterCombat();

    // Kill a relay node
    let relayNode: RelayNode | null = null;
    for (const e of run.world!.entities.values()) {
      if (e instanceof RelayNode && e.alive) {
        relayNode = e;
        break;
      }
    }
    assert.ok(relayNode);
    relayNode.damage(relayNode.maxHp);
    assert.equal(relayNode.alive, false);

    const snap = run.snapshot();
    const { world: restoredWorld } = restore(snap);
    const restoredNode = restoredWorld.entities.get(relayNode.id);
    assert.ok(restoredNode);
    assert.equal(restoredNode.alive, false);
    assert.equal(restoredNode.hp, 0);
  });
});

// --------------------------------------------------------------------------
// Entity labels
// --------------------------------------------------------------------------

describe('Entity labels for M2.4 entities', () => {
  it('CorpTurret gets [Corp]Turret label', () => {
    const turret = new CorpTurret({ id: 'corp-turret-0', x: 1, y: 1 });
    assert.equal(entityLabel(turret), '[Corp]Turret');
  });

  it('RelayNode gets [Corp]Relay label', () => {
    const node = new RelayNode({ id: 'relay-node-0', x: 1, y: 1 });
    assert.equal(entityLabel(node), '[Corp]Relay');
  });
});

// --------------------------------------------------------------------------
// Sweep quota type inference
// --------------------------------------------------------------------------

describe('SWEEP_QUOTA constants', () => {
  it('exports expected quota values', () => {
    assert.equal(SWEEP_QUOTA.DRONE_ALL, 'drone-all');
    assert.equal(SWEEP_QUOTA.RELAY_NODE, 'relay-node');
    assert.equal(SWEEP_QUOTA.TURRET, 'turret');
  });
});
