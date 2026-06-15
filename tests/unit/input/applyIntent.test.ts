import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TurnQueue } from '../../../src/game/TurnQueue.js';
import { EventBus } from '../../../src/game/events.js';
import {
  TILE,
  FACTION,
  AP_COST,
  MELEE_DAMAGE,
  SALVAGE_PER_IMPROVISED_TURRET,
} from '../../../src/game/constants.js';
import { makeSalvage, totalSalvage } from '../../../src/game/salvage.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Tech } from '../../../src/game/archetypes/Tech.js';
import { CyberAvatar } from '../../../src/game/cyber/CyberAvatar.js';
import { ProbeIce } from '../../../src/game/cyber/ProbeIce.js';
import { Turret } from '../../../src/game/Turret.js';
import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { ConsumablePickup } from '../../../src/game/entities/ConsumablePickup.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { ITEM_ID } from '../../../src/game/items.js';
import { Rng } from '../../../src/rng.js';
import { applyIntent, pickFireTarget, PLAYER_ACTIONS } from '../../../src/input/applyIntent.js';

function buildCtx({ archetype = 'merc', placeDrone = true } = {}) {
  const grid = new Grid(10, 6);
  // Walls around the perimeter so movement off-grid fails predictably.
  for (let x = 0; x < 10; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, 5, TILE.WALL);
  }
  for (let y = 0; y < 6; y++) {
    grid.setTile(0, y, TILE.WALL);
    grid.setTile(9, y, TILE.WALL);
  }
  // A cover tile to make Vault legal: place at (3,2) with landing at (4,2).
  grid.setTile(3, 2, TILE.COVER);

  const bus = new EventBus();
  const world = new World(grid, { events: bus });

  const player =
    archetype === 'merc'
      ? new Merc({ id: 'merc', x: 2, y: 2, maxAp: 4 })
      : archetype === 'tech'
        ? new Tech({ id: 'tech', x: 2, y: 2, maxAp: 4 })
        : new Razor({ id: 'razor', x: 2, y: 2, maxAp: 4 });
  world.addEntity(player);

  let drone = null;
  if (placeDrone) {
    drone = new Skirmisher({ id: 'd1', x: 7, y: 2, maxAp: 3 });
    world.addEntity(drone);
    drone.bindToBus(bus);
  }

  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  const rng = new Rng(1);

  const log = [];
  const calls = {
    advanceTurn: 0,
    resetInputModes: 0,
    interact: 0,
    inventory: 0,
    reachedExit: 0,
    corpseSalvaged: 0,
    securedInteract: 0,
  };
  const ctx = {
    world,
    player,
    queue,
    rng,
    log: line => log.push(line),
    advanceTurn: () => {
      calls.advanceTurn++;
      queue.endTurn(world);
    },
    resetInputModes: () => {
      calls.resetInputModes++;
    },
    onSecuredInteract: (_entity, { apExhausted }) => {
      calls.securedInteract++;
      if (apExhausted) calls.advanceTurn++;
    },
    onPlayerAction: actionName => {
      switch (actionName) {
        case PLAYER_ACTIONS.REACHED_EXIT:
          calls.reachedExit++;
          break;
        case PLAYER_ACTIONS.INTERACT:
          calls.interact++;
          break;
        case PLAYER_ACTIONS.INVENTORY:
          calls.inventory++;
          break;
        default:
          throw new Error(`Unknown player action: ${actionName}`);
      }
    },
    onCorpseSalvaged: () => {
      calls.corpseSalvaged++;
    },
  };
  return { ctx, log, calls, drone, world, player, queue };
}

test('move intent commits without per-step move coordinate log line', () => {
  const { ctx, log, player } = buildCtx();
  // Move down — (2,3) is plain floor, while (3,2) holds the test's cover tile.
  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 3);
  assert.ok(!log.some(l => l.includes('moved to')));
});

test('move into a wall is denied (logs MOVE DENIED, no mutation)', () => {
  const { ctx, log, player } = buildCtx();
  player.x = 1;
  player.y = 1;
  applyIntent({ type: 'move', dx: -1, dy: 0 }, ctx); // into the wall at x=0
  assert.equal(player.x, 1);
  assert.equal(player.y, 1);
  assert.ok(log.some(l => l.includes('MOVE DENIED')));
});

test('move into a terminal bumps interact and notifies onSecuredInteract', () => {
  const { ctx, log, calls, player, world } = buildCtx({ placeDrone: false });
  const terminal = new Terminal({ id: 'term-0', x: 4, y: 2, raisesAlarm: false });
  world.addEntity(terminal);
  player.x = 3;
  player.y = 2;

  applyIntent({ type: 'move', dx: 1, dy: 0 }, ctx);

  assert.equal(player.x, 3, 'bump does not enter the terminal tile');
  assert.equal(terminal.sliced, true);
  assert.equal(terminal.secured, true);
  assert.equal(calls.securedInteract, 1);
  assert.equal(calls.interact, 0, 'bump must not route through the Space interact handler');
  assert.ok(log.some(l => l.includes('sliced')));
});

test('move into a locked door gives door feedback without routing generic interact', () => {
  const { ctx, log, calls, player, world } = buildCtx({ placeDrone: false });
  const door = new Door({ id: 'door-0', doorId: 'door-0', x: 4, y: 2 });
  world.addEntity(door);
  player.x = 3;
  player.y = 2;
  const beforeAp = player.ap;

  applyIntent({ type: 'move', dx: 1, dy: 0 }, ctx);

  assert.equal(player.x, 3);
  assert.equal(player.y, 2);
  assert.equal(player.ap, beforeAp);
  assert.equal(calls.interact, 0);
  assert.ok(log.some(l => l.includes('locked')));
});

test('move onto exit always emits REACHED_EXIT (abort extraction allowed)', () => {
  const { ctx, log, player, calls, world } = buildCtx({ placeDrone: false });
  world.grid.setTile(2, 3, TILE.EXIT);

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(player.x, 2);
  assert.equal(player.y, 3);
  assert.equal(calls.reachedExit, 1, 'REACHED_EXIT emitted — run handles abort vs. completion');
  assert.ok(log.some(l => l.includes('EXIT REACHED')));
});

test('move onto a lootable corpse auto-salvages (M4.1)', () => {
  const { ctx, log, player, world, calls } = buildCtx({ placeDrone: false });
  player.initInventory();
  // Drop a dead lootable drone one tile south of the player.
  const drone = new Skirmisher({ id: 'corpse', x: 2, y: 3, maxAp: 3 });
  world.addEntity(drone);
  drone.damage(drone.maxHp);
  drone.loot = { salvage: makeSalvage({ scrap: 4 }) };
  assert.equal(drone.alive, false);

  const apBefore = player.ap;
  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(player.x, 2);
  assert.equal(player.y, 3, 'player stepped onto the corpse tile');
  assert.equal(player.inventory.salvage.scrap, 4, 'scrap transferred on step');
  assert.equal(totalSalvage(player.inventory.salvage), 4, 'total wallet matches pickup');
  assert.equal(world.entities.has('corpse'), false, 'corpse removed from world (M4.1)');
  assert.ok(
    log.some(l => l.includes('salvages +4')),
    'auto-salvage log line emitted'
  );
  assert.equal(calls.corpseSalvaged, 1, 'shell notified to clear corpse memory');
  assert.equal(player.ap, apBefore - 1, 'only MOVE AP spent; walk-onto salvage is pickup-like');
});

test('move onto a corpse with 1 AP still salvages after the move spends AP', () => {
  const { ctx, log, player, world } = buildCtx({ placeDrone: false });
  player.initInventory();
  // Only 1 AP: the move spends it, and walk-onto salvage must not require
  // a second interact AP.
  player.ap = 1;
  const drone = new Skirmisher({ id: 'corpse', x: 2, y: 3, maxAp: 3 });
  world.addEntity(drone);
  drone.damage(drone.maxHp);
  drone.loot = { salvage: makeSalvage({ scrap: 2 }) };

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(player.x, 2);
  assert.equal(player.y, 3, 'move still committed');
  assert.equal(totalSalvage(player.inventory.salvage), 2, 'salvage taken after movement');
  assert.equal(world.entities.has('corpse'), false, 'corpse removed from world');
  assert.ok(
    log.some(l => l.includes('salvages +2')),
    'auto-salvage log line emitted'
  );
});

test('move onto an objective pickup secures it without routing to interact', () => {
  const { ctx, log, player, world, calls } = buildCtx({ placeDrone: false });
  world.addEntity(new Pickup({ id: 'pickup-0', x: 2, y: 3, label: 'Sublevel cache' }));
  const beforeAp = player.ap;

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(player.x, 2);
  assert.equal(player.y, 3);
  assert.equal(world.entities.has('pickup-0'), false);
  assert.equal(world.securedPickupCount(), 1);
  assert.equal(player.ap, beforeAp - 1, 'only MOVE AP spent');
  assert.equal(calls.interact, 0, 'walk-onto must not fire the interact shell handler');
  assert.ok(log.some(l => l.includes('secures Sublevel cache')));
});

test('move onto a consumable pickup adds it to inventory and removes the pickup', () => {
  const { ctx, log, player, world } = buildCtx({ placeDrone: false });
  world.addEntity(
    new ConsumablePickup({
      id: 'consumable-pickup-0',
      x: 2,
      y: 3,
      consumableId: ITEM_ID.STIM,
      label: 'Stim',
    })
  );

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(player.x, 2);
  assert.equal(player.y, 3);
  assert.equal(player.inventory?.consumables.length, 1);
  assert.equal(player.inventory?.consumables[0]?.id, ITEM_ID.STIM);
  assert.equal(world.entities.has('consumable-pickup-0'), false);
  assert.ok(log.some(l => l.includes('picks up Stim')));
});

test('move onto consumable plus low-AP corpse collects both pickups', () => {
  const { ctx, log, player, world } = buildCtx({ placeDrone: false });
  player.initInventory();
  player.ap = 1;
  const drone = new Skirmisher({ id: 'corpse', x: 2, y: 3, maxAp: 3 });
  world.addEntity(drone);
  drone.damage(drone.maxHp);
  drone.loot = { salvage: makeSalvage({ scrap: 2 }) };
  world.addEntity(
    new ConsumablePickup({
      id: 'consumable-pickup-0',
      x: 2,
      y: 3,
      consumableId: ITEM_ID.SMOKE_CHARGE,
      label: 'Smoke Charge',
    })
  );

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(player.inventory?.consumables[0]?.id, ITEM_ID.SMOKE_CHARGE);
  assert.equal(world.entities.has('consumable-pickup-0'), false);
  assert.equal(world.entities.has('corpse'), false, 'corpse also collected by move-to-loot');
  assert.equal(totalSalvage(player.inventory!.salvage), 2);
  assert.ok(log.some(l => l.includes('picks up Smoke Charge')));
  assert.ok(log.some(l => l.includes('salvages +2')));
});

test('move onto exit reaches exit when canExit allows it', () => {
  const { ctx, log, calls, world } = buildCtx({ placeDrone: false });
  world.grid.setTile(2, 3, TILE.EXIT);
  ctx.canExit = () => true;

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.equal(calls.reachedExit, 1);
  assert.ok(log.some(l => l.includes('EXIT REACHED')));
});

test('special intent routes to Vault on a Merc and lands two tiles away', () => {
  // Cover is at (3,2); player at (2,2) — special dx=1 should land at (4,2).
  // applyIntent.doSpecial dispatches by capability check on the live player.
  const { ctx, player } = buildCtx({ archetype: 'merc' });
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4);
  assert.equal(player.y, 2);
});

test('vault onto an objective pickup secures it', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  world.addEntity(new Pickup({ id: 'pickup-0', x: 4, y: 2, label: 'Cache' }));
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4);
  assert.equal(world.entities.has('pickup-0'), false);
  assert.equal(world.securedPickupCount(), 1);
  assert.ok(log.some(l => l.includes('secures Cache')));
});

test('vault onto a consumable pickup collects it', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  player.initInventory();
  world.addEntity(
    new ConsumablePickup({
      id: 'consumable-pickup-0',
      x: 4,
      y: 2,
      consumableId: ITEM_ID.STIM,
      label: 'Stim',
    })
  );
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4);
  assert.equal(player.y, 2);
  assert.equal(player.inventory?.consumables[0]?.id, ITEM_ID.STIM);
  assert.equal(world.entities.has('consumable-pickup-0'), false);
  assert.ok(log.some(l => l.includes('picks up Stim')));
});

test('vault onto consumable succeeds when knockback lane beyond landing is a wall', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  player.initInventory();
  world.grid.setTile(5, 2, TILE.WALL);
  const pickup = new ConsumablePickup({
    id: 'consumable-pickup-0',
    x: 4,
    y: 2,
    consumableId: ITEM_ID.STIM,
    label: 'Stim',
  });
  pickup.passable = false;
  world.addEntity(pickup);
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4);
  assert.equal(player.y, 2);
  assert.equal(player.inventory?.consumables[0]?.id, ITEM_ID.STIM);
  assert.ok(log.some(l => l.includes('broke through')));
  assert.ok(log.some(l => l.includes('picks up Stim')));
});

test('slide onto an objective pickup secures it', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'razor', placeDrone: false });
  world.addEntity(new Pickup({ id: 'pickup-0', x: 2, y: 4, label: 'Cache' }));
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(world.entities.has('pickup-0'), false);
  assert.ok(log.some(l => l.includes('secures Cache')));
});

test('slide onto a consumable pickup collects it', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'razor', placeDrone: false });
  player.initInventory();
  world.addEntity(
    new ConsumablePickup({
      id: 'consumable-pickup-0',
      x: 2,
      y: 4,
      consumableId: ITEM_ID.INCENDIARY,
      label: 'Incendiary',
    })
  );
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(player.inventory?.consumables[0]?.id, ITEM_ID.INCENDIARY);
  assert.equal(world.entities.has('consumable-pickup-0'), false);
  assert.ok(log.some(l => l.includes('picks up Incendiary')));
});

test('special intent routes to Deploy on a Tech and places a Turret adjacent', () => {
  // Player at (2,2). Special dy=1 (south) targets (2,3) — plain floor in the
  // shared `buildCtx` grid, so the deploy is legal.
  const { ctx, world, player } = buildCtx({ archetype: 'tech', placeDrone: false });
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  const placed = world.entityAt(2, 3);
  assert.ok(placed instanceof Turret, 'expected a Turret placed south of the Tech');
  assert.equal(placed.faction, FACTION.PLAYER);
  assert.equal(player.turretReady, false, 'Tech.turretReady consumed on commit');
});

test('special intent routes to Slide on a Razor (moves 2 tiles, engages stealth)', () => {
  const { ctx, player } = buildCtx({ archetype: 'razor' });
  // Player at (2,2). Special dy=1 wants to land at (2,4) — but (3,2) is cover
  // so dy=1 (down) avoids it: step (2,3), land (2,4). Both should be FLOOR.
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(player.stealthed, true);
});

test('special intent routes CyberAvatar Override against Probe ICE', () => {
  const grid = new Grid(8, 5);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const avatar = new CyberAvatar({
    id: 'cyber-avatar-0',
    x: 1,
    y: 2,
    ram: 8,
    intrusionStrength: 2,
    iceResistance: 1,
  });
  const probe = new ProbeIce({ id: 'probe-ice-0', x: 3, y: 2 });
  world.addEntity(avatar);
  world.addEntity(probe);
  probe.bindToBus(bus);
  const log: string[] = [];
  const ctx = {
    world,
    player: avatar,
    queue: new TurnQueue([FACTION.PLAYER, FACTION.CORP]),
    rng: { next: () => 0 },
    log: (line: string) => log.push(line),
    advanceTurn: () => {},
    resetInputModes: () => {},
    onPlayerAction: () => {},
  };

  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);

  assert.equal(probe.faction, FACTION.PLAYER);
  assert.equal(avatar.ap, avatar.maxAp - AP_COST.OVERRIDE);
  assert.ok(log.some(line => line.includes('OVERRIDES Probe')));
});

test('CyberAvatar Override acquires an off-axis Probe in the aimed direction', () => {
  const grid = new Grid(8, 6);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const avatar = new CyberAvatar({
    id: 'cyber-avatar-0',
    x: 1,
    y: 2,
    ram: 8,
    intrusionStrength: 2,
    iceResistance: 1,
  });
  const probe = new ProbeIce({ id: 'probe-ice-0', x: 4, y: 3 });
  world.addEntity(avatar);
  world.addEntity(probe);
  probe.bindToBus(bus);
  const log: string[] = [];
  const ctx = {
    world,
    player: avatar,
    queue: new TurnQueue([FACTION.PLAYER, FACTION.CORP]),
    rng: { next: () => 0 },
    log: (line: string) => log.push(line),
    advanceTurn: () => {},
    resetInputModes: () => {},
    onPlayerAction: () => {},
  };

  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);

  assert.equal(probe.faction, FACTION.PLAYER);
  assert.equal(avatar.ap, avatar.maxAp - AP_COST.OVERRIDE);
  assert.ok(log.some(line => line.includes('OVERRIDES Probe')));
});

test('end-turn drains AP to 0, logs wait, and invokes advanceTurn once', () => {
  const { ctx, player, calls, log } = buildCtx();
  applyIntent({ type: 'end-turn' }, ctx);
  assert.equal(player.ap, 0);
  assert.equal(calls.advanceTurn, 1);
  assert.ok(
    log.some(l => l.includes('waits')),
    'combat log should mention waiting'
  );
});

test('P3.M4.4: end-turn routes through passTurn when wired (Wait passes this operator)', () => {
  // Dual-deploy: Wait forfeits the active operator's AP but defers the
  // flip/end decision to the shell's pass handler, so the *other* operator
  // takes over instead of having its turn dumped.
  const { ctx, player, calls } = buildCtx();
  let passed = 0;
  ctx.passTurn = () => {
    passed++;
  };
  applyIntent({ type: 'end-turn' }, ctx);
  assert.equal(player.ap, 0, 'this operator forfeits its remaining AP');
  assert.equal(passed, 1, 'Wait drives the pass/flip path');
  assert.equal(calls.advanceTurn, 0, 'no hard end while passTurn is wired');
});

test('cancel calls resetInputModes and does not mutate state', () => {
  const { ctx, calls, player } = buildCtx();
  const beforeAp = player.ap;
  applyIntent({ type: 'cancel' }, ctx);
  assert.equal(calls.resetInputModes, 1);
  assert.equal(player.ap, beforeAp);
});

test('non-player turn refuses everything except cancel', () => {
  const { ctx, log, queue, calls } = buildCtx();
  queue.endTurn(ctx.world); // → CORP
  applyIntent({ type: 'move', dx: 1, dy: 0 }, ctx);
  assert.ok(log.some(l => l.includes('HOSTILES ACTIVE')));
  assert.ok(log.some(l => l.includes('controls locked')));
  // Cancel still works even out of turn (per the M7 cross-input cancel rule).
  log.length = 0;
  applyIntent({ type: 'cancel' }, ctx);
  assert.equal(calls.resetInputModes, 1);
});

test('unknown intent type throws (closed enum guard)', () => {
  const { ctx } = buildCtx();
  assert.throws(() => applyIntent({ type: 'teleport' }, ctx), /unknown intent/);
  assert.throws(() => applyIntent(null, ctx), /unknown intent/);
});

test('pickFireTarget returns null when no hostile is in line', () => {
  const { ctx } = buildCtx({ placeDrone: false });
  assert.equal(pickFireTarget(ctx, 1, 0), null);
});

test('pickFireTarget finds the hostile drone in LOS', () => {
  const { ctx, drone } = buildCtx({ placeDrone: true });
  // Player at (2,2), drone at (7,2). Both on y=2, no walls between.
  const target = pickFireTarget(ctx, 1, 0);
  assert.equal(target, drone);
});

test('interact intent fires the shell-supplied onPlayerAction callback once', () => {
  const { ctx, calls } = buildCtx();
  applyIntent({ type: 'interact' }, ctx);
  assert.equal(calls.interact, 1);
});

test('interact intent crashes when ctx.onPlayerAction is missing (no silent no-op)', () => {
  const { ctx } = buildCtx();
  delete ctx.onPlayerAction;
  assert.throws(() => applyIntent({ type: 'interact' }, ctx), /onPlayerAction is missing/);
});

test('use-item intent forwards a validated aim direction to the shell', () => {
  const { ctx } = buildCtx();
  const aims = [];
  ctx.onUseItem = aim => aims.push(aim);

  applyIntent({ type: 'use-item', dx: 1, dy: -1 }, ctx);

  assert.deepEqual(aims, [{ dx: 1, dy: -1 }]);
});

test('use-item intent crashes on missing handler or invalid aim', () => {
  const { ctx } = buildCtx();
  assert.throws(() => applyIntent({ type: 'use-item', dx: 1, dy: 0 }, ctx), /onUseItem/);
  ctx.onUseItem = () => {};
  assert.throws(() => applyIntent({ type: 'use-item', dx: 0, dy: 0 }, ctx), /requires/);
  assert.throws(() => applyIntent({ type: 'use-item', dx: 2, dy: 0 }, ctx), /requires/);
  assert.throws(() => applyIntent({ type: 'use-item', dx: 0.5, dy: 0 }, ctx), /requires/);
});

test('melee intent still resolves adjacent strikes (for AI / replay, not player keymap)', () => {
  const { ctx, log, drone } = buildCtx({ placeDrone: true });
  // Adjacent east of player at (2,2): park drone at (3,2).
  drone.x = 3;
  drone.y = 2;
  const hpBefore = drone.hp;
  applyIntent({ type: 'melee', dx: 1, dy: 0 }, ctx);
  assert.ok(
    log.some(l => l.includes('slashes')),
    'melee intent should log a strike'
  );
  assert.equal(drone.hp, hpBefore - MELEE_DAMAGE, 'MELEE_DAMAGE');
});

// --- Vault body-check + knockback (via the unified `special` intent) -----

test('vault body-check deals VAULT_DAMAGE and knocks hostile back', () => {
  // Place a drone on the vault landing tile (4,2) with open knockback at (5,2).
  const { ctx, log, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  const drone = new Skirmisher({ id: 'd1', x: 4, y: 2, maxAp: 3 });
  world.addEntity(drone);
  const hpBefore = drone.hp;
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4, 'Merc lands where the hostile was');
  assert.equal(drone.x, 5, 'hostile knocked back 1 tile east');
  assert.equal(drone.hp, hpBefore - 2, 'hostile took VAULT_DAMAGE (2)');
  assert.ok(
    log.some(l => l.includes('SLAMMED')),
    'log mentions the slam'
  );
});

test('vault body-check does not debit extra AP beyond the vault cost', () => {
  const { ctx, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  const drone = new Skirmisher({ id: 'd1', x: 4, y: 2, maxAp: 3 });
  world.addEntity(drone);
  const apBefore = player.ap; // 4
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.ap, apBefore - AP_COST.VAULT, 'only vault AP spent, slam is free');
});

test('vault on empty tile is pure repositioning (no damage log)', () => {
  const { ctx, log, player } = buildCtx({ archetype: 'merc', placeDrone: false });
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4, 'vault still lands');
  assert.ok(
    log.some(l => l.includes('broke through to')),
    'log mentions the vault'
  );
  assert.ok(!log.some(l => l.includes('SLAMMED')), 'no slam logged');
});

test('vault denied when knockback lane is blocked', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  // Place drone at (4,2) and wall at (5,2) to block knockback.
  const drone = new Skirmisher({ id: 'd1', x: 4, y: 2, maxAp: 3 });
  world.addEntity(drone);
  ctx.world.grid.setTile(5, 2, TILE.WALL);
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 2, 'Merc stays put');
  assert.ok(log.some(l => l.includes('BREAK DENIED')));
});

test('vault adjacent shove deals VAULT_DAMAGE and steps Merc back when clear', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'merc', placeDrone: false });
  // Clear the harness cover tile so hop fails and adjacent shove can fire.
  world.grid.setTile(3, 2, TILE.FLOOR);
  const drone = new Skirmisher({ id: 'd1', x: 3, y: 2, maxAp: 3 });
  world.addEntity(drone);
  const hpBefore = drone.hp;
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 1, 'Merc steps back opposite the shove');
  assert.equal(player.y, 2);
  assert.equal(drone.x, 4, 'hostile knocked back');
  assert.equal(drone.hp, hpBefore - 2);
  assert.ok(
    log.some(l => l.includes('shoved')),
    'log mentions the shove'
  );
  assert.ok(
    log.some(l => l.includes('SLAMMED')),
    'log mentions the slam'
  );
});

test('AP exhaustion triggers auto-end-turn during a move', () => {
  const { ctx, player, calls } = buildCtx();
  player.ap = 1; // one move's worth — should bottom out and auto-end.
  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);
  assert.equal(player.ap, 0);
  assert.equal(calls.advanceTurn, 1);
});

// --- M3: improvised turret dispatch via special intent ---------------------

test('special on a Tech routes to improviseTurret when turretReady is false and salvage is available', () => {
  const { ctx, world, player } = buildCtx({ archetype: 'tech', placeDrone: false });
  player.initInventory();
  player.inventory.salvage = makeSalvage({ scrap: SALVAGE_PER_IMPROVISED_TURRET });
  // Deploy the pre-built turret south — (2, 3) is plain floor.
  player.deployTurret(world, 0, 1);
  player.refreshAp();
  // Now special deploy west — (1, 2) is plain floor, not the cover at (3, 2).
  applyIntent({ type: 'special', dx: -1, dy: 0 }, ctx);
  const placed = world.entityAt(1, 2);
  assert.ok(placed instanceof Turret, 'expected an improvised turret placed');
  assert.equal(player.inventory.salvage.scrap, 0, 'scrap deducted for improvised turret');
  assert.equal(totalSalvage(player.inventory.salvage), 0, 'no other typed buckets touched');
});

test('special on a Tech with no turret and no salvage logs a denial', () => {
  const { ctx, player, log } = buildCtx({ archetype: 'tech', placeDrone: false });
  player.initInventory();
  // Default emptySalvage wallet — no scrap, can't improvise.
  player.turretReady = false;
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.ok(
    log.some(l => l.includes('DEPLOY DENIED')),
    'should log a denial when no turret and no salvage'
  );
});
