import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { TurnQueue } from '../../../src/game/TurnQueue.js';
import { EventBus, EVENT } from '../../../src/game/events.js';
import {
  TILE,
  FACTION,
  AP_COST,
  MELEE_DAMAGE,
  SALVAGE_PER_IMPROVISED_TURRET,
  SALVAGE_PER_NANITE_HEAL,
  NANITE_HEAL_AMOUNT,
  STATUS_EFFECT,
} from '../../../src/game/constants.js';
import { makeSalvage, totalSalvage } from '../../../src/game/salvage.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Razor } from '../../../src/game/archetypes/Razor.js';
import { Tech } from '../../../src/game/archetypes/Tech.js';
import { Decker } from '../../../src/game/archetypes/Decker.js';
import { Berserk } from '../../../src/game/archetypes/Berserk.js';
import { Adept } from '../../../src/game/archetypes/Adept.js';
import { Chimera } from '../../../src/game/archetypes/Chimera.js';
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
        : archetype === 'berserk'
          ? new Berserk({ id: 'berserk', x: 2, y: 2, maxAp: 4 })
          : archetype === 'adept'
            ? new Adept({ id: 'adept', x: 2, y: 2, maxAp: 4 })
            : archetype === 'chimera'
              ? new Chimera({ id: 'chimera', x: 2, y: 2, maxAp: 4 })
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
    jackOut: 0,
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
        case PLAYER_ACTIONS.JACK_OUT:
          calls.jackOut++;
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

test('securing a pickup with flavor detail logs the flavor as a second beat', () => {
  const { ctx, log, world } = buildCtx({ placeDrone: false });
  world.addEntity(
    new Pickup({
      id: 'pickup-0',
      x: 2,
      y: 3,
      label: 'Monoblade',
      detail: 'A monomolecular blade schematic — an edge that never dulls.',
    })
  );

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  assert.ok(log.some(l => l.includes('secures Monoblade')));
  assert.ok(
    log.some(l => l.includes('A monomolecular blade schematic')),
    'flavor detail surfaced on secure'
  );
});

test('securing a pickup without detail logs only the secure beat', () => {
  const { ctx, log, world } = buildCtx({ placeDrone: false });
  world.addEntity(new Pickup({ id: 'pickup-0', x: 2, y: 3, label: 'Plain cache' }));

  applyIntent({ type: 'move', dx: 0, dy: 1 }, ctx);

  const beats = log.filter(l => l.startsWith('> '));
  assert.equal(beats.length, 1, 'no flavor beat without detail');
  assert.ok(beats[0]!.includes('secures Plain cache'));
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
      consumableId: ITEM_ID.MOLOTOV,
      label: 'Incendiary',
    })
  );
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(player.inventory?.consumables[0]?.id, ITEM_ID.MOLOTOV);
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
  const { ctx, player, world } = buildCtx({ archetype: 'razor' });
  const cloaks = [];
  world.events.on(EVENT.RAZOR_CLOAKED, payload => cloaks.push(payload));
  // Player at (2,2). Special dy=1 wants to land at (2,4) — but (3,2) is cover
  // so dy=1 (down) avoids it: step (2,3), land (2,4). Both should be FLOOR.
  applyIntent({ type: 'special', dx: 0, dy: 1 }, ctx);
  assert.equal(player.x, 2);
  assert.equal(player.y, 4);
  assert.equal(player.stealthed, true);
  // Presentation hook fires for the shell's cloak pulse, at the landing tile.
  assert.deepEqual(cloaks, [{ actor: player }]);
});

test('a stunned (0-AP) player concludes its turn instead of crashing on spendAp', () => {
  const { ctx, log, calls, player } = buildCtx();
  // Simulate an EMP'd body: refreshed into its turn at 0 AP.
  player.ap = 0;
  const advanceBefore = calls.advanceTurn;
  // A move intent would otherwise trip Entity.spendAp's overspend crash.
  assert.doesNotThrow(() => applyIntent({ type: 'move', dx: 1, dy: 0 }, ctx));
  assert.equal(player.x, 2, 'no move committed while stunned');
  assert.equal(calls.advanceTurn, advanceBefore + 1, 'turn concluded via advanceTurn fallback');
  assert.ok(
    log.some(line => line.includes('STUNNED')),
    'legibility line names the stun'
  );
});

test('a stunned player can still cancel without ending the turn', () => {
  const { ctx, calls, player } = buildCtx();
  player.ap = 0;
  const advanceBefore = calls.advanceTurn;
  applyIntent({ type: 'cancel' }, ctx);
  assert.equal(calls.advanceTurn, advanceBefore, 'cancel does not conclude the turn');
  assert.equal(calls.resetInputModes, 1, 'cancel still clears aim modes');
});

test('special intent routes to EMP on a Decker and stuns a same-faction ally in radius', () => {
  const grid = new Grid(10, 6);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const decker = new Decker({ id: 'decker', x: 4, y: 2, maxAp: 4 });
  const ally = new Merc({ id: 'ally', x: 5, y: 2, maxAp: 4 }); // adjacent, PLAYER faction
  const corp = new Skirmisher({ id: 'c1', x: 3, y: 2, maxAp: 3 }); // adjacent, CORP faction
  world.addEntity(decker);
  world.addEntity(ally);
  world.addEntity(corp);
  corp.bindToBus(bus);

  const queue = new TurnQueue([FACTION.PLAYER, FACTION.CORP]);
  const log = [];
  const ctx = {
    world,
    player: decker,
    queue,
    rng: new Rng(1),
    log: line => log.push(line),
    advanceTurn: () => queue.endTurn(world),
    resetInputModes: () => {},
    onPlayerAction: () => {},
  };

  const apBefore = decker.ap;
  applyIntent({ type: 'special', dx: 0, dy: 0 }, ctx);

  assert.equal(decker.ap, apBefore - AP_COST.EMP, 'EMP debited once');
  // The ally is same-faction but the blast ignores faction — it gets stunned.
  ally.refreshAp();
  assert.equal(ally.ap, 0, 'same-faction ally caught in the EMP is at 0 AP next refresh');
  corp.refreshAp();
  assert.equal(corp.ap, 0, 'corp unit in radius is stunned too');
  assert.ok(log.some(line => line.includes('EMP')));
});

test('special intent routes to Surge on a Berserk without entering directional movement', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'berserk', placeDrone: false });
  const positionBefore = { x: player.x, y: player.y };
  const surges = [];
  world.events.on(EVENT.BERSERK_SURGED, payload => surges.push(payload));
  applyIntent({ type: 'special', dx: 0, dy: 0 }, ctx);
  assert.deepEqual({ x: player.x, y: player.y }, positionBefore);
  assert.equal(player.hasEffect(STATUS_EFFECT.SURGE), true);
  assert.equal(player.ap, player.maxAp - AP_COST.SURGE);
  assert.ok(log.some(line => line.includes('SURGES')));
  // Presentation hook fires for the shell's surge pulse.
  assert.deepEqual(surges, [{ origin: { x: player.x, y: player.y } }]);
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

  const influenced = [];
  world.events.on(EVENT.MIND_INFLUENCED, payload => influenced.push(payload));

  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);

  assert.equal(probe.faction, FACTION.PLAYER);
  assert.equal(avatar.ap, avatar.maxAp - AP_COST.INFLUENCE);
  assert.ok(log.some(line => line.includes('OVERRIDES Probe')));
  // Presentation hook fires on the cyber-grid bus for the shell's violet pulse.
  assert.deepEqual(influenced, [{ actor: avatar, target: probe, success: true }]);
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
  assert.equal(avatar.ap, avatar.maxAp - AP_COST.INFLUENCE);
  assert.ok(log.some(line => line.includes('OVERRIDES Probe')));
});

test('special intent routes to Influence on an Adept and dominates the aimed hostile', () => {
  const grid = new Grid(10, 6);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const adept = new Adept({ id: 'adept', x: 2, y: 2, maxAp: 4 });
  const drone = new Skirmisher({ id: 'd1', x: 5, y: 2, maxAp: 3 });
  world.addEntity(adept);
  world.addEntity(drone);
  drone.bindToBus(bus);
  const log = [];
  const ctx = {
    world,
    player: adept,
    queue: new TurnQueue([FACTION.PLAYER, FACTION.CORP]),
    rng: { next: () => 0 }, // deterministic success
    log: line => log.push(line),
    advanceTurn: () => {},
    resetInputModes: () => {},
    onPlayerAction: () => {},
  };
  const apBefore = adept.ap;
  const influenced = [];
  world.events.on(EVENT.MIND_INFLUENCED, payload => influenced.push(payload));

  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);

  assert.equal(drone.faction, FACTION.PLAYER);
  assert.equal(adept.ap, apBefore - AP_COST.INFLUENCE);
  assert.ok(log.some(line => line.includes('DOMINATES')));
  // Presentation hook fires on the Meatspace bus for the shell's violet pulse.
  assert.deepEqual(influenced, [{ actor: adept, target: drone, success: true }]);
});

test('a failed Influence roll still pulses the target tile — log copy carries the fail, not the flash', () => {
  const grid = new Grid(10, 6);
  const bus = new EventBus();
  const world = new World(grid, { events: bus });
  const adept = new Adept({ id: 'adept', x: 2, y: 2, maxAp: 4 });
  const drone = new Skirmisher({ id: 'd1', x: 5, y: 2, maxAp: 3 });
  world.addEntity(adept);
  world.addEntity(drone);
  drone.bindToBus(bus);
  const log = [];
  const ctx = {
    world,
    player: adept,
    queue: new TurnQueue([FACTION.PLAYER, FACTION.CORP]),
    rng: { next: () => 0.99 }, // deterministic failure (>= INFLUENCE_SUCCESS_CHANCE)
    log: line => log.push(line),
    advanceTurn: () => {},
    resetInputModes: () => {},
    onPlayerAction: () => {},
  };
  const influenced = [];
  world.events.on(EVENT.MIND_INFLUENCED, payload => influenced.push(payload));

  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);

  assert.notEqual(drone.faction, FACTION.PLAYER, 'domination did not take');
  assert.ok(log.some(line => line.includes('INFLUENCE FAILED')));
  assert.deepEqual(influenced, [{ actor: adept, target: drone, success: false }]);
});

test('special intent on an Adept with no legal target logs a denial without spending AP', () => {
  const { ctx, log, player } = buildCtx({ archetype: 'adept', placeDrone: false });
  const apBefore = player.ap;

  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);

  assert.equal(player.ap, apBefore, 'no AP spent on an empty sector');
  assert.ok(log.some(line => line.includes('INFLUENCE DENIED')));
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

test('jack-out intent fires the shell-supplied onPlayerAction callback once', () => {
  const { ctx, calls } = buildCtx();
  applyIntent({ type: 'jack-out' }, ctx);
  assert.equal(calls.jackOut, 1);
});

test('jack-out intent crashes when ctx.onPlayerAction is missing (no silent no-op)', () => {
  const { ctx } = buildCtx();
  delete ctx.onPlayerAction;
  assert.throws(() => applyIntent({ type: 'jack-out' }, ctx), /onPlayerAction is missing/);
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
  const damaged = [];
  world.events.on(EVENT.ENTITY_DAMAGED, payload => damaged.push(payload));
  applyIntent({ type: 'special', dx: 1, dy: 0 }, ctx);
  assert.equal(player.x, 4, 'Merc lands where the hostile was');
  assert.equal(drone.x, 5, 'hostile knocked back 1 tile east');
  assert.equal(drone.hp, hpBefore - 2, 'hostile took VAULT_DAMAGE (2)');
  assert.ok(
    log.some(l => l.includes('SLAMMED')),
    'log mentions the slam'
  );
  // Presentation hook: sceneListeners keys its gold "impact" flash off this
  // source label, distinct from a melee strike (P3.5.M5).
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0].source, 'vault');
  assert.equal(damaged[0].target, drone);
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

// --- M5: Nanite Repair dispatch via special intent --------------------------

test('special intent routes to Nanite Repair on a Chimera without entering directional movement', () => {
  const { ctx, log, player, world } = buildCtx({ archetype: 'chimera', placeDrone: false });
  player.initInventory();
  player.inventory.salvage = makeSalvage({ scrap: SALVAGE_PER_NANITE_HEAL });
  player.damage(1);
  const positionBefore = { x: player.x, y: player.y };
  const apBefore = player.ap;
  const scrapBefore = player.inventory.salvage.scrap;
  const hpBefore = player.hp;
  const heals = [];
  world.events.on(EVENT.NANITE_HEALED, payload => heals.push(payload));
  applyIntent({ type: 'special', dx: 0, dy: 0 }, ctx);
  assert.deepEqual({ x: player.x, y: player.y }, positionBefore, 'self-targeted, no movement');
  assert.equal(player.ap, apBefore - AP_COST.NANITE_HEAL);
  assert.equal(player.inventory.salvage.scrap, scrapBefore - SALVAGE_PER_NANITE_HEAL);
  assert.equal(player.hp, hpBefore + NANITE_HEAL_AMOUNT);
  assert.ok(log.some(line => line.includes('scrap into tissue')));
  // Presentation hook fires for the shell's nanite-heal pulse.
  assert.deepEqual(heals, [{ origin: { x: player.x, y: player.y }, healed: NANITE_HEAL_AMOUNT }]);
});

test('special on a Chimera with no scrap logs a denial', () => {
  const { ctx, player, log } = buildCtx({ archetype: 'chimera', placeDrone: false });
  player.initInventory();
  // Default emptySalvage wallet — no scrap, can't convert.
  applyIntent({ type: 'special', dx: 0, dy: 0 }, ctx);
  assert.ok(
    log.some(l => l.includes('NANITE REPAIR DENIED')),
    'should log a denial when no scrap is available'
  );
});
