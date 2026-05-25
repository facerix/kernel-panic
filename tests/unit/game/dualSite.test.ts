/**
 * M2.8: Dual-site sync objectives.
 *
 * Tests cover SyncPad interaction, dual-site objective satisfaction, run
 * placement, order-free extraction gating, hazard-adjacent pad placement, and
 * snapshot round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { SyncPad } from '../../../src/game/entities/SyncPad.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { entityLabel } from '../../../src/game/Entity.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { AP_COST, FACTION, SYNC_PAD_GLYPH, TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
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

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
  });
}

function makeDualSiteContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.DUAL_SITE,
      title: 'Sync payroll mirrors',
      briefing: 'Touch both payroll mirrors on-site before extraction.',
      params: { target: 'payroll-mirror', count: 2 },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Matsuda payroll mirror',
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function relocateAdjacentTo(run: Run, entity: SyncPad): void {
  if (!run.world || !run.player) throw new Error('run must be in combat');
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = entity.x + dx;
      const y = entity.y + dy;
      if (!run.world.grid.inBounds(x, y)) continue;
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.entityAt(x, y)) continue;
      run.world.relocateEntity(run.player, x, y);
      return;
    }
  }
  throw new Error(`No adjacent passable tile for ${entity.id}`);
}

function syncPadsIn(run: Run): SyncPad[] {
  if (!run.world) throw new Error('run must be in combat');
  return [...run.world.entities.values()].filter(
    (entity): entity is SyncPad => entity instanceof SyncPad
  );
}

describe('SyncPad', () => {
  it('constructs as a neutral interactable with the sync pad glyph', () => {
    const pad = new SyncPad({ id: 'sync-pad-0', x: 5, y: 5, label: 'Payroll mirror' });
    assert.equal(pad.faction, FACTION.NEUTRAL);
    assert.equal(pad.glyph, SYNC_PAD_GLYPH);
    assert.equal(pad.label, 'Payroll mirror');
    assert.equal(pad.synced, false);
    assert.equal(pad.secured, false);
    assert.equal(pad.armed, true);
  });

  it('syncs once, spends AP once, and rejects repeat interaction', () => {
    const world = makeWorld();
    const player = new Merc({ id: 'crew-merc', x: 4, y: 5 });
    const pad = new SyncPad({ id: 'sync-pad-0', x: 5, y: 5, label: 'Payroll mirror' });
    world.addEntity(player);
    world.addEntity(pad);

    const beforeAp = player.ap;
    const first = pad.interact(world, player);
    const second = pad.interact(world, player);

    assert.equal(first.ok, true);
    assert.equal(pad.synced, true);
    assert.equal(pad.secured, true);
    assert.equal(pad.armed, false);
    assert.equal(player.ap, beforeAp - AP_COST.INTERACT);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'already-synced');
    assert.equal(player.ap, beforeAp - AP_COST.INTERACT);
  });

  it('has a player-facing entity label', () => {
    const pad = new SyncPad({ id: 'sync-pad-0', x: 5, y: 5, label: 'Mirror' });
    assert.equal(entityLabel(pad), '[Neutral]Sync Pad');
  });
});

describe('dual-site objective satisfaction', () => {
  it('requires both default sync pads when params.count is omitted', () => {
    const world = makeWorld();
    const pads = [
      new SyncPad({ id: 'sync-pad-0', x: 3, y: 3, label: 'Mirror 1' }),
      new SyncPad({ id: 'sync-pad-1', x: 4, y: 3, label: 'Mirror 2' }),
    ];
    for (const pad of pads) world.addEntity(pad);
    const contract = makeDualSiteContract({
      objective: {
        kind: OBJECTIVES.DUAL_SITE,
        title: 'Sync mirrors',
        briefing: 'Sync both mirrors.',
        params: { target: 'payroll-mirror' },
      },
    });

    pads[0]!.synced = true;
    assert.equal(isObjectiveSatisfied(contract, world), false);
    pads[1]!.synced = true;
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('respects params.count when more pads are required', () => {
    const world = makeWorld();
    const pads = [
      new SyncPad({ id: 'sync-pad-0', x: 3, y: 3, label: 'Bore 1' }),
      new SyncPad({ id: 'sync-pad-1', x: 4, y: 3, label: 'Bore 2' }),
      new SyncPad({ id: 'sync-pad-2', x: 5, y: 3, label: 'Bore 3' }),
    ];
    for (const pad of pads) world.addEntity(pad);
    const contract = makeDualSiteContract({
      objective: {
        kind: OBJECTIVES.DUAL_SITE,
        title: 'Sample bores',
        briefing: 'Tap three bores.',
        params: { target: 'sampling-bore', count: 3 },
      },
    });

    pads[0]!.synced = true;
    pads[1]!.synced = true;
    assert.equal(isObjectiveSatisfied(contract, world), false);
    pads[2]!.synced = true;
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

describe('dual-site runs', () => {
  it('spawns sync pads and gates extraction until all pads are synced in any order', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeDualSiteContract());
    run.enterCombat();

    const pads = syncPadsIn(run);
    assert.equal(pads.length, 2);
    assert.ok(run.exitTile, 'dual-site run should have an exit tile');
    for (const pad of pads) {
      assert.equal(pad.glyph, SYNC_PAD_GLYPH);
      assert.ok(
        Math.max(Math.abs(pad.x - run.exitTile.x), Math.abs(pad.y - run.exitTile.y)) > 1,
        'sync pad should not spawn adjacent to extraction'
      );
    }
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), false);

    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile.x, y: run.exitTile.y },
    });
    assert.equal(run.state, RUN_STATE.COMBAT, 'extract is blocked before sync is complete');
    assert.equal(results.length, 0);

    const [first, second] = pads.toReversed();
    assert.ok(first && second);
    relocateAdjacentTo(run, first);
    assert.equal(first.interact(run.world!, run.player!).ok, true);
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), false);
    run.player!.refreshAp();
    relocateAdjacentTo(run, second);
    assert.equal(second.interact(run.world!, run.player!).ok, true);
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), true);

    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile.x, y: run.exitTile.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT);
    assert.equal((results[0] as { outcome: string }).outcome, OUTCOME.EXIT);
  });

  it('places count-many sync pads for dual-site contracts', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 43 });
    run.enterBriefing(
      makeDualSiteContract({
        objective: {
          kind: OBJECTIVES.DUAL_SITE,
          title: 'Sample bores',
          briefing: 'Tap three sampling bores.',
          params: { target: 'sampling-bore', count: 3 },
        },
      })
    );
    run.enterCombat();

    const pads = syncPadsIn(run);
    assert.equal(pads.length, 3);
    assert.deepEqual(pads.map(pad => pad.label).sort(), [
      'Sampling Bore 1',
      'Sampling Bore 2',
      'Sampling Bore 3',
    ]);
  });

  it('co-locates hazard-flavored dual-site pads with a hazard cluster', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 44 });
    run.enterBriefing(
      makeDualSiteContract({
        label: 'Yutani water table tap',
        objective: {
          kind: OBJECTIVES.DUAL_SITE,
          title: 'Dual-site sampling bores',
          briefing: 'Tap both sampling bores and return with the material.',
          params: { target: 'sampling-bore', count: 2, hazardFlavor: 'tainted-water' },
        },
      })
    );
    run.enterCombat();

    const [pad] = syncPadsIn(run);
    assert.ok(pad);
    const adjacentHazards: string[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = pad.x + dx;
        const y = pad.y + dy;
        if (run.world!.grid.inBounds(x, y) && run.world!.grid.tileAt(x, y) === TILE.HAZARD) {
          adjacentHazards.push(`${x},${y}`);
        }
      }
    }
    assert.ok(adjacentHazards.length > 0, 'hazard-flavored dual-site should have nearby hazards');
  });

  it('snapshot/restore round-trips sync pad state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 45 });
    run.enterBriefing(makeDualSiteContract());
    run.enterCombat();
    const [pad] = syncPadsIn(run);
    assert.ok(pad);

    relocateAdjacentTo(run, pad);
    pad.interact(run.world!, run.player!);

    const rec = snapshot(run);
    const padRec = rec.entities.find(entity => entity.id === pad.id);
    assert.equal(padRec?.archetype, 'sync-pad');
    assert.equal(padRec?.syncPad?.synced, true);
    assert.equal(padRec?.syncPad?.armed, false);

    const { world: restoredWorld } = restore(rec);
    const restoredPad = [...restoredWorld.entities.values()].find(
      (entity): entity is SyncPad => entity instanceof SyncPad
    );
    assert.ok(restoredPad, 'expected restored sync pad');
    assert.equal(restoredPad.synced, true);
    assert.equal(restoredPad.secured, true);
    assert.equal(restoredPad.armed, false);
  });
});
