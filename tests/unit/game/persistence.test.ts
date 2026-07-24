import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign, CAMPAIGN_STATE } from '../../../src/game/Campaign.js';
import { Run, RUN_STATE } from '../../../src/game/Run.js';
import { buildContractRecipeFixture, OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import { Door } from '../../../src/game/entities/Door.js';
import { Guard } from '../../../src/game/ai/Guard.js';
import { Bruiser } from '../../../src/game/ai/Bruiser.js';
import { Juggernaut } from '../../../src/game/ai/Juggernaut.js';
import { Flanker } from '../../../src/game/ai/Flanker.js';
import { Medic } from '../../../src/game/ai/Medic.js';
import {
  restore,
  restoreCampaign,
  snapshot,
  snapshotCampaign,
} from '../../../src/game/persistence.js';
import {
  CONTRACT_DIFFICULTY,
  CRASH_HIT_PENALTY,
  FACTION,
  INCENDIARY_BURN_TURNS,
  SALVAGE_TO_CRED_RATE,
  STATUS_EFFECT,
  TILE,
} from '../../../src/game/constants.js';
import { placeSmoke } from '../../../src/game/Smoke.js';
import { makeSalvage, totalSalvage } from '../../../src/game/salvage.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { Decker } from '../../../src/game/archetypes/Decker.js';
import { Berserk } from '../../../src/game/archetypes/Berserk.js';
import { Adept } from '../../../src/game/archetypes/Adept.js';
import { Chimera } from '../../../src/game/archetypes/Chimera.js';
import {
  DEFAULT_HIT_CHANCE_BY_ARCHETYPE,
  DEFAULT_DODGE_CHANCE_BY_ARCHETYPE,
} from '../../../src/game/crewStatRoll.js';
import { PatrolHostile } from '../../../src/game/ai/PatrolHostile.js';
import { applyOverride } from '../../../src/game/mindInfluence.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';

const fakeContract = (overrides = {}) => ({
  seed: 12345,
  objective: {
    kind: OBJECTIVES.REACH_EXIT,
    title: 'Extract clean',
    briefing: 'Reach the exit.',
  },
  difficulty: 'standard',
  threatCount: 1,
  label: 'test job',
  context: testContractContext(OBJECTIVES.REACH_EXIT),
  reward: { credits: 0, repDelta: 0 },
  ...overrides,
});

const terminalSliceContract = (overrides = {}) =>
  fakeContract({
    objective: {
      kind: OBJECTIVES.TERMINAL_SLICE,
      title: 'Slice server rack',
      briefing: 'Reach the server terminal, complete the slice, then extract.',
      params: { target: 'server-rack', count: 1 },
    },
    label: 'terminal test job',
    context: testContractContext(OBJECTIVES.TERMINAL_SLICE),
    ...overrides,
  });

function makeCrew(archetype = 'razor') {
  return buildCrewMember(archetype, { x: 0, y: 0 }, new Rng(100), {
    id: `crew-${archetype}`,
  });
}

function relocateAdjacentTo(run, entity) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = entity.x + dx;
      const y = entity.y + dy;
      if (!run.world.grid.inBounds(x, y)) continue;
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.liveEntityAt(x, y)) continue;
      run.world.relocateEntity(run.player, x, y);
      return;
    }
  }
  throw new Error(`No adjacent passable tile for ${entity.id}`);
}

function freeCombatTile(run, after = { x: 0, y: 0 }) {
  for (let y = after.y; y < run.world.grid.height; y++) {
    for (let x = y === after.y ? after.x : 0; x < run.world.grid.width; x++) {
      if (!run.world.grid.isPassable(x, y)) continue;
      if (run.world.liveEntityAt(x, y)) continue;
      return { x, y };
    }
  }
  throw new Error('No free passable tile in fixture run');
}

function freshCombatRun(seed = 1, archetype = 'razor') {
  const run = new Run({ crewMember: makeCrew(archetype), seed });
  run.enterBriefing(fakeContract());
  run.enterCombat();
  return run;
}

test('run snapshot → restore → snapshot is byte-for-byte stable', () => {
  const run = freshCombatRun(0xfeedface);
  const recA = snapshot(run);
  const { run: restoredRun } = restore(recA);
  const recB = snapshot(restoredRun);
  assert.deepEqual(recB, recA, 'round-trip should reproduce the source record');
});

test('snapshot/restore preserves an unlooted hostile corpse and its exact salvage', () => {
  const run = freshCombatRun(0xdecafbad);
  const corpse = [...run.world.entities.values()].find(entity => entity instanceof PatrolHostile);
  assert.ok(corpse, 'fixture should contain a patrol hostile');
  corpse.hp = 0;
  corpse.alive = false;
  corpse.loot = { salvage: makeSalvage({ scrap: 2, chips: 1 }) };

  const rec = snapshot(run);
  const corpseRec = rec.entities.find(entity => entity.id === corpse.id);
  assert.deepEqual(corpseRec?.loot?.salvage, makeSalvage({ scrap: 2, chips: 1 }));

  const { world: restoredWorld } = restore(rec);
  const restoredCorpse = restoredWorld.lootableCorpseAt(corpse.x, corpse.y);
  assert.ok(restoredCorpse, 'restored corpse should remain lootable');
  assert.equal(restoredCorpse.id, corpse.id);
  assert.deepEqual(restoredCorpse.loot.salvage, makeSalvage({ scrap: 2, chips: 1 }));
});

test('restore rejects malformed corpse loot instead of discarding it', () => {
  const run = freshCombatRun(0xdecafbad);
  const corpse = [...run.world.entities.values()].find(entity => entity instanceof PatrolHostile);
  assert.ok(corpse, 'fixture should contain a patrol hostile');
  corpse.hp = 0;
  corpse.alive = false;

  const rec = snapshot(run);
  const corpseRec = rec.entities.find(entity => entity.id === corpse.id);
  assert.ok(corpseRec);
  corpseRec.loot = { salvage: { scrap: -1, chips: 0, bio: 0, data: 0 } };

  assert.throws(() => restore(rec), /salvage.*scrap/i);
});

test('snapshot/restore round-trips a Decker deploy (P3.M2)', () => {
  const run = freshCombatRun(0xc0ffee, 'decker');
  assert.ok(run.player instanceof Decker, 'fixture should deploy a Decker');
  const rec = snapshot(run);
  const { run: restoredRun } = restore(rec);
  assert.ok(restoredRun.player instanceof Decker, 'Decker should restore as a Decker');
  assert.equal(restoredRun.player.callsign, run.player.callsign);
  // Stable round-trip through a second snapshot.
  assert.deepEqual(snapshot(restoredRun), rec);
});

test('snapshot/restore round-trips a Berserk deploy (P3.5.M3)', () => {
  const run = freshCombatRun(0xb3e5e4, 'berserk');
  assert.ok(run.player instanceof Berserk, 'fixture should deploy a Berserk');
  const rec = snapshot(run);
  const { run: restoredRun } = restore(rec);
  assert.ok(restoredRun.player instanceof Berserk, 'Berserk should restore as a Berserk');
  assert.equal(restoredRun.player.callsign, run.player.callsign);
  assert.deepEqual(snapshot(restoredRun), rec);
});

test('snapshot/restore round-trips an Adept deploy (P3.5.M4)', () => {
  const run = freshCombatRun(0xadeb70, 'adept');
  assert.ok(run.player instanceof Adept, 'fixture should deploy an Adept');
  const rec = snapshot(run);
  const { run: restoredRun } = restore(rec);
  assert.ok(restoredRun.player instanceof Adept, 'Adept should restore as an Adept');
  assert.equal(restoredRun.player.callsign, run.player.callsign);
  assert.deepEqual(snapshot(restoredRun), rec);
});

test('snapshot/restore round-trips a Chimera deploy (P3.5.M5)', () => {
  const run = freshCombatRun(0xc4171e4, 'chimera');
  assert.ok(run.player instanceof Chimera, 'fixture should deploy a Chimera');
  const rec = snapshot(run);
  const { run: restoredRun } = restore(rec);
  assert.ok(restoredRun.player instanceof Chimera, 'Chimera should restore as a Chimera');
  assert.equal(restoredRun.player.callsign, run.player.callsign);
  assert.deepEqual(snapshot(restoredRun), rec);
});

test('snapshot/restore preserves an active Berserk Surge, including bonus AP and armor', () => {
  const run = freshCombatRun(0xb3e5e5, 'berserk');
  const berserk = run.player as Berserk;
  const baseArmor = berserk.damageReduction;
  berserk.surge();
  berserk.refreshAp();
  assert.equal(berserk.ap, berserk.maxAp + 1);
  assert.equal(berserk.effectiveDamageReduction, baseArmor + 1, 'surge armor live before save');

  const rec = snapshot(run);
  // The record stores the pristine base armor — the +armor is a computed combat
  // value derived from the SURGE effect, never a stored stat, so it can't leak.
  assert.equal(rec.entities.find(e => e.id === berserk.id)?.damageReduction, baseArmor);

  const { run: restoredRun } = restore(rec);
  const restored = restoredRun.player as Berserk;
  assert.ok(restored instanceof Berserk);
  assert.equal(restored.hasEffect(STATUS_EFFECT.SURGE), true);
  assert.equal(restored.ap, restored.maxAp + 1);
  assert.equal(restored.damageReduction, baseArmor, 'stored base armor round-trips clean');
  assert.equal(
    restored.effectiveDamageReduction,
    baseArmor + 1,
    'surge armor re-derived from effect'
  );
  assert.deepEqual(snapshot(restoredRun), rec);

  // Drive Surge to expiry on the restored Berserk — combat armor falls to base.
  restored.refreshAp();
  assert.equal(restored.hasEffect(STATUS_EFFECT.CRASH), true);
  assert.equal(restored.effectiveDamageReduction, baseArmor, 'combat armor drops on surge expiry');
});

test('snapshot/restore preserves Berserk Crash and its derived hit penalty', () => {
  const run = freshCombatRun(0xb3e5e6, 'berserk');
  const berserk = run.player as Berserk;
  berserk.surge();
  berserk.refreshAp();
  berserk.refreshAp();
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), true);

  const rec = snapshot(run);
  const { run: restoredRun } = restore(rec);
  const restored = restoredRun.player as Berserk;
  assert.ok(restored instanceof Berserk);
  assert.equal(restored.hasEffect(STATUS_EFFECT.CRASH), true);
  assert.equal(restored.baseHitChance, 0.78 - CRASH_HIT_PENALTY);
  assert.deepEqual(snapshot(restoredRun), rec);
});

test('snapshot/restore preserves a live drone-override (P3.M2)', () => {
  const run = freshCombatRun(0xbadbeef, 'decker');
  const drone = [...run.world.entities.values()].find(e => e instanceof PatrolHostile);
  assert.ok(drone, 'fixture run should contain at least one patrol hostile');
  const originalFaction = drone.faction;
  applyOverride(drone, FACTION.PLAYER);

  const rec = snapshot(run);
  const { world: restoredWorld } = restore(rec);
  const restoredDrone = [...restoredWorld.entities.values()].find(e => e.id === drone.id);
  assert.ok(restoredDrone, 'overridden drone should survive the round-trip');
  assert.equal(restoredDrone.faction, FACTION.PLAYER, 'flipped faction preserved');
  assert.equal(restoredDrone.factionBeforeOverride, originalFaction, 'prior faction preserved');
  assert.equal(restoredDrone.overrideTurnsRemaining, drone.overrideTurnsRemaining);
  assert.equal(restoredDrone.isOverridden, true);
});

test('a never-overridden drone snapshot omits override fields (no shape drift)', () => {
  const run = freshCombatRun(0x1234, 'razor');
  const rec = snapshot(run);
  const droneRec = rec.entities.find(e => e.archetype === 'drone' || e.archetype === 'guard');
  assert.ok(droneRec, 'expected a patrol hostile in the snapshot');
  assert.equal(droneRec.extra.overrideTurnsRemaining, undefined);
  assert.equal(droneRec.extra.factionBeforeOverride, undefined);
});

test('snapshot/restore round-trips a Tech with a placed turret (M1)', () => {
  const run = freshCombatRun(0xc0ffee, 'tech');
  const tech = run.player;
  let placed = null;
  for (let dy = -1; dy <= 1 && !placed; dy++) {
    for (let dx = -1; dx <= 1 && !placed; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (tech.canDeploy(run.world, dx, dy).ok) {
        placed = tech.deployTurret(run.world, dx, dy);
      }
    }
  }
  assert.ok(placed, 'should have found at least one legal deploy tile around the Tech');
  placed.hp = 2;

  const rec = snapshot(run);
  const { run: restoredRun, world: restoredWorld } = restore(rec);
  assert.equal(restoredRun.player.turretReady, false);
  const restoredTurret = [...restoredWorld.entities.values()].find(e => e.id === placed.id);
  assert.ok(restoredTurret, 'restored world should contain the deployed turret');
  assert.equal(restoredTurret.faction, FACTION.PLAYER);
  assert.equal(restoredTurret.hp, 2);
  assert.equal(restoredTurret.ownerId, tech.id);
  assert.equal(typeof restoredTurret.damage, 'function');
});

test('restored Rng produces the same next 5 numbers as the live one', () => {
  const run = freshCombatRun(7);
  run.rng.next();
  run.rng.next();
  run.rng.next();
  const liveValues = [];
  const rec = snapshot(run);
  for (let i = 0; i < 5; i++) liveValues.push(run.rng.next());

  const { rng: restoredRng } = restore(rec);
  const restoredValues = [];
  for (let i = 0; i < 5; i++) restoredValues.push(restoredRng.next());
  assert.deepEqual(restoredValues, liveValues);
});

test('restore reconstructs world entities with their HP / AP / stealth state and callsign', () => {
  const run = freshCombatRun(42);
  run.player.hp = 1;
  run.player.ap = 2;
  run.player.stealthed = true;
  run.player.damageReduction = 1;
  const rec = snapshot(run);
  const { player } = restore(rec);
  assert.equal(player.hp, 1);
  assert.equal(player.ap, 2);
  assert.equal(player.stealthed, true);
  assert.equal(player.damageReduction, 1);
  assert.equal(player.callsign, run.player.callsign);
});

test('restore preserves drone AI state (mode + lastKnownTarget + patrol index)', () => {
  const run = freshCombatRun(0xdead);
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one drone for threatCount=1');
  drone.state = 'investigate';
  drone.lastKnownTarget = { x: 5, y: 7 };
  drone.patrolIndex = 1;
  const rec = snapshot(run);
  const { world: restoredWorld } = restore(rec);
  const restoredDrone = [...restoredWorld.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.equal(restoredDrone.state, 'investigate');
  assert.deepEqual(restoredDrone.lastKnownTarget, { x: 5, y: 7 });
  assert.equal(restoredDrone.patrolIndex, 1);
});

test('restore throws on a drone patrolIndex past the waypoint list', () => {
  // Regression: takeTurnSteps dereferences patrolWaypoints[patrolIndex]
  // without a guard. A corrupt / stale index must fail loudly at restore,
  // not crash mid-turn.
  const run = freshCombatRun(0xbad1);
  const fodder = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(fodder, 'expected at least one fodder hostile for threatCount=1');
  const rec = snapshot(run);
  const fodderRec = rec.entities.find(e => e.id === fodder.id);
  // The composition resolver may roll a skirmisher or a guard; both serialise
  // the shared PatrolHostile state machine into the slim `extra` bag (M6.2).
  // The patrolIndex bounds-check is identical for either.
  const patrolRec = fodderRec?.extra as { patrolIndex: number; patrolWaypoints: unknown[] };
  assert.ok(patrolRec, 'expected a patrol-hostile state-machine record');
  patrolRec.patrolIndex = patrolRec.patrolWaypoints.length + 5;
  assert.throws(() => restore(rec), /patrolIndex/);
});

test('Guard round-trips through snapshot/restore as archetype "guard"', () => {
  // fakeContract seed 12345 / fodderCount 1 deterministically rolls a guard.
  const run = freshCombatRun(7);
  const guard = [...run.world.entities.values()].find(e => e instanceof Guard);
  assert.ok(guard, 'expected a Guard from this contract seed');
  guard.state = 'engage';
  guard.lastKnownTarget = { x: 4, y: 9 };

  const rec = snapshot(run);
  const guardRec = rec.entities.find(e => e.id === guard.id);
  assert.equal(guardRec?.archetype, 'guard', 'serialises under its own archetype tag');
  assert.ok(guardRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(guardRec?.extra?.state, 'engage');

  const { world: restoredWorld } = restore(rec);
  const restored = [...restoredWorld.entities.values()].find(e => e.id === guard.id);
  assert.ok(restored instanceof Guard, 'restored as a Guard');
  assert.equal(restored.glyph, 'g');
  assert.equal(restored.state, 'engage');
  assert.deepEqual(restored.lastKnownTarget, { x: 4, y: 9 });
});

test('Bruiser round-trips through snapshot/restore as archetype "bruiser"', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 7 });
  // contract seed 0 deterministically rolls a Bruiser after M4.3 widened the
  // CRITICAL elite pool to include Flanker.
  run.enterBriefing(fakeContract({ seed: 0, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const bruiser = [...run.world.entities.values()].find(e => e instanceof Bruiser);
  assert.ok(bruiser instanceof Bruiser, 'expected a Bruiser from this critical contract');
  bruiser.state = 'engage';
  bruiser.lastKnownTarget = { x: 3, y: 8 };

  const rec = snapshot(run);
  const bruiserRec = rec.entities.find(e => e.id === bruiser.id);
  assert.equal(bruiserRec?.archetype, 'bruiser');
  assert.ok(bruiserRec?.extra, 'state machine lives in the slim extra bag (M6.2)');

  const { world: restoredWorld } = restore(rec);
  const restored = [...restoredWorld.entities.values()].find(e => e.id === bruiser.id);
  assert.ok(restored instanceof Bruiser, 'restored as a Bruiser');
  assert.equal(restored.glyph, 'b');
  assert.equal(restored.state, 'engage');
  assert.deepEqual(restored.lastKnownTarget, { x: 3, y: 8 });
});

test('Juggernaut round-trips through snapshot/restore as archetype "juggernaut"', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 7 });
  // contract seed 1 deterministically rolls a Juggernaut elite.
  run.enterBriefing(fakeContract({ seed: 1, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const juggernaut = [...run.world.entities.values()].find(e => e instanceof Juggernaut);
  assert.ok(juggernaut instanceof Juggernaut, 'expected a Juggernaut from this critical contract');
  juggernaut.state = 'engage';
  juggernaut.lastKnownTarget = { x: 5, y: 4 };

  const rec = snapshot(run);
  const jugRec = rec.entities.find(e => e.id === juggernaut.id);
  assert.equal(jugRec?.archetype, 'juggernaut');
  assert.ok(jugRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(jugRec?.extra?.state, 'engage');

  const { world: restoredWorld } = restore(rec);
  const restored = [...restoredWorld.entities.values()].find(e => e.id === juggernaut.id);
  assert.ok(restored instanceof Juggernaut, 'restored as a Juggernaut');
  assert.equal(restored.glyph, 'j');
  assert.equal(restored.state, 'engage');
  assert.deepEqual(restored.lastKnownTarget, { x: 5, y: 4 });
});

test('Flanker round-trips through snapshot/restore as archetype "flanker"', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 7 });
  // contract seed 2 deterministically rolls a Flanker elite.
  run.enterBriefing(fakeContract({ seed: 2, difficulty: 'critical', threatCount: 4 }));
  run.enterCombat();
  const flanker = [...run.world.entities.values()].find(e => e instanceof Flanker);
  assert.ok(flanker instanceof Flanker, 'expected a Flanker from this critical contract');
  flanker.state = 'engage';
  flanker.lastKnownTarget = { x: 5, y: 4 };
  flanker.slideConcealed = true;

  const rec = snapshot(run);
  const flankerRec = rec.entities.find(e => e.id === flanker.id);
  assert.equal(flankerRec?.archetype, 'flanker');
  assert.ok(flankerRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(flankerRec?.extra?.slideConcealed, true);

  const { world: restoredWorld } = restore(rec);
  const restored = [...restoredWorld.entities.values()].find(e => e.id === flanker.id);
  assert.ok(restored instanceof Flanker, 'restored as a Flanker');
  assert.equal(restored.glyph, 'f');
  assert.equal(restored.state, 'engage');
  assert.deepEqual(restored.lastKnownTarget, { x: 5, y: 4 });
  assert.equal(restored.slideConcealed, true);
});

test('Medic and temporary shield round-trip through snapshot/restore', () => {
  const run = freshCombatRun(0x6d3d1c);
  const medicAnchor = freeCombatTile(run);
  const patientAnchor = freeCombatTile(run, { x: medicAnchor.x + 1, y: medicAnchor.y });
  const medic = new Medic({ id: 'medic-0', x: medicAnchor.x, y: medicAnchor.y, maxAp: 1 });
  medic.state = 'engage';
  medic.lastKnownTarget = { x: run.player.x, y: run.player.y };
  const patient = new Juggernaut({
    id: 'juggernaut-fixture',
    x: patientAnchor.x,
    y: patientAnchor.y,
  });
  patient.addShield(2);
  run.world.addEntity(medic);
  run.world.addEntity(patient);

  const rec = snapshot(run);
  const medicRec = rec.entities.find(e => e.id === medic.id);
  const patientRec = rec.entities.find(e => e.id === patient.id);
  assert.equal(medicRec?.archetype, 'medic');
  assert.ok(medicRec?.extra, 'state machine lives in the slim extra bag (M6.2)');
  assert.equal(patientRec?.shieldHp, 2, 'patient shield persists in the common snapshot');

  const { world: restoredWorld } = restore(rec);
  const restoredMedic = [...restoredWorld.entities.values()].find(e => e.id === medic.id);
  const restoredPatient = [...restoredWorld.entities.values()].find(e => e.id === patient.id);
  assert.ok(restoredMedic instanceof Medic, 'restored as a Medic');
  assert.equal(restoredMedic.glyph, 'm');
  assert.equal(restoredMedic.state, 'engage');
  assert.deepEqual(restoredMedic.lastKnownTarget, { x: run.player.x, y: run.player.y });
  assert.ok(restoredPatient instanceof Juggernaut);
  assert.equal(restoredPatient.shieldHp, 2);
});

test('restore preserves turnNumber and currentFaction', () => {
  const run = freshCombatRun(11);
  run.queue.endTurn(run.world);
  run.queue.endTurn(run.world);
  const rec = snapshot(run);
  const { queue } = restore(rec);
  assert.equal(queue.turnNumber, run.queue.turnNumber);
  assert.equal(queue.currentFaction, run.queue.currentFaction);
});

test('snapshot/restore round-trips terminal interactable state', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 0x51ced });
  run.enterBriefing(terminalSliceContract());
  run.enterCombat();
  const terminal = [...run.world.entities.values()].find(e => e instanceof Terminal);
  assert.ok(terminal, 'expected a terminal interactable');

  relocateAdjacentTo(run, terminal);
  terminal.interact(run.world, run.player);

  const rec = snapshot(run);
  const terminalRec = rec.entities.find(e => e.id === terminal.id);
  assert.equal(terminalRec?.extra?.sliced, true);
  assert.equal(terminalRec?.extra?.armed, false);

  const { world: restoredWorld } = restore(rec);
  const restoredTerminal = [...restoredWorld.entities.values()].find(e => e instanceof Terminal);
  assert.ok(restoredTerminal, 'expected restored terminal');
  assert.equal(restoredTerminal.sliced, true);
  assert.equal(restoredTerminal.armed, false);
});

test('snapshot/restore round-trips alarm cadence state', () => {
  const run = freshCombatRun(0xa1a12);
  run.world.raiseAlarm({ origin: { x: run.player.x, y: run.player.y } });
  run.world.tickAlarm();

  const rec = snapshot(run);
  assert.equal(rec.alarm.phase, 'alert');
  assert.equal(rec.alarm.holdTurnsRemaining, 1);

  const { world: restoredWorld } = restore(rec);
  assert.deepEqual(restoredWorld.alarm, run.world.alarm);
  assert.equal(restoredWorld.alarmActive, true);
});

test('restore migrates legacy alarmActive run snapshots into alarm state', () => {
  const run = freshCombatRun(0xa1a13);
  const rec = snapshot(run);
  delete rec.alarm;
  rec.alarmActive = true;

  const { world: restoredWorld } = restore(rec);
  assert.equal(restoredWorld.alarm.phase, 'alert');
  assert.equal(restoredWorld.alarmActive, true);
});

test('restore throws on corrupt run records', () => {
  const run = freshCombatRun(1);
  const missingRng = snapshot(run);
  delete missingRng.rng;
  assert.throws(() => restore(missingRng), /rng/);

  const badTiles = snapshot(run);
  badTiles.grid.tiles.pop();
  assert.throws(() => restore(badTiles), /tile count mismatch/);

  const oob = snapshot(run);
  oob.entities[0].x = oob.grid.w + 5;
  assert.throws(() => restore(oob), /out of bounds/);

  const unknownArchetype = snapshot(run);
  unknownArchetype.entities[0].archetype = 'wizard';
  assert.throws(() => restore(unknownArchetype), /unknown archetype/);

  const badHp = snapshot(run);
  badHp.entities[0].hp = badHp.entities[0].maxHp + 1;
  assert.throws(() => restore(badHp), /hp/);

  const badAlive = snapshot(run);
  badAlive.entities[0].hp = 0;
  badAlive.entities[0].alive = true;
  assert.throws(() => restore(badAlive));

  const badState = snapshot(run);
  badState.state = 'WIBBLE';
  assert.throws(() => restore(badState), /unknown run state/);

  const badType = snapshot(run);
  badType.type = 'other';
  assert.throws(() => restore(badType), /type/);
});

test('snapshot before any Run state set throws', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 1 });
  assert.throws(() => snapshot(run), /no live world/);
});

test('snapshot without a Run instance throws TypeError', () => {
  assert.throws(() => snapshot({}), TypeError);
  assert.throws(() => snapshot(null), TypeError);
});

test('campaign snapshot/restore round-trips campaign scope', () => {
  const campaign = new Campaign({ seed: 0xface });
  // M4.2: typed-salvage wallet round-trip (use all four buckets to prove the
  // shape survives without scrap-only flattening).
  campaign.salvage = makeSalvage({ scrap: 3, chips: 2, bio: 1, data: 1 });
  campaign.credits = 90;
  campaign.rep = 49;
  campaign.meta = { someFlag: true };
  campaign.crew[1].flatlined = true;
  campaign.enterHub();

  const recA = snapshotCampaign(campaign);
  const restored = restoreCampaign(recA);
  const recB = snapshotCampaign(restored);

  assert.deepEqual(recB, recA);
  assert.deepEqual(restored.salvage, makeSalvage({ scrap: 3, chips: 2, bio: 1, data: 1 }));
  assert.equal(totalSalvage(restored.salvage), 7);
  assert.equal(restored.credits, 90);
  assert.equal(restored.rep, 49);
  assert.deepEqual(restored.meta, { someFlag: true });
  assert.equal(restored.crew[1].flatlined, true);
});

test('campaign snapshot round-trips healedThisVisit', () => {
  const campaign = new Campaign({ seed: 0xface });
  campaign.crew[0].hp = 1;
  campaign.credits = 200;
  campaign.healMember(campaign.crew[0].id);

  const recA = snapshotCampaign(campaign);
  const restored = restoreCampaign(recA);
  const recB = snapshotCampaign(restored);

  assert.deepEqual(recB.healedThisVisit, recA.healedThisVisit);
  assert.deepEqual([...restored.healedThisVisit], recA.healedThisVisit);
});

test('campaign snapshot captures an active briefing job', () => {
  const campaign = new Campaign({ seed: 0xbeef });
  campaign.deployCrewMember(campaign.crew[2].id, fakeContract({ label: 'briefing job' }));
  const rec = snapshotCampaign(campaign);
  assert.equal(rec.type, 'campaign');
  assert.equal(rec.activeRun.state, 'BRIEFING');
  assert.equal(rec.activeRun.contract.label, 'briefing job');
  assert.equal(rec.activeRun.contract.reward.credits, 0);

  const restored = restoreCampaign(rec);
  assert.equal(restored.activeRun.state, 'BRIEFING');
  assert.equal(restored.activeRun.contract.label, 'briefing job');
  assert.equal(restored.activeRun.crewMember.id, campaign.crew[2].id);
});

test('resumed briefing run enters combat without redeploying', () => {
  const campaign = new Campaign({ seed: 0xbeef });
  campaign.deployCrewMember(campaign.crew[2].id, fakeContract({ label: 'briefing job' }));
  const restored = restoreCampaign(snapshotCampaign(campaign));

  assert.equal(restored.state, CAMPAIGN_STATE.COMBAT);
  assert.equal(restored.activeRun!.state, RUN_STATE.BRIEFING);

  restored.activeRun!.enterCombat();
  assert.equal(restored.activeRun!.state, RUN_STATE.COMBAT);
  assert.ok(restored.activeRun!.world);
  assert.ok(restored.activeRun!.player);
});

test('campaign snapshot preserves generated contract context metadata', () => {
  const campaign = new Campaign({ seed: 0xbeef });
  const contract = buildContractRecipeFixture({
    recipeId: 'dual-site-sync',
    principalId: 'matsuda',
    siteId: 'contractor-annex',
    assetId: 'payroll',
    actionId: 'mirror',
    difficulty: CONTRACT_DIFFICULTY.STANDARD,
    seed: 0x1234,
    arcStage: 'act-1',
  });
  campaign.deployCrewMember(campaign.crew[2].id, contract);
  const rec = snapshotCampaign(campaign);

  const restored = restoreCampaign(rec);

  assert.deepEqual(restored.activeRun!.contract!.context, contract.context);
  assert.equal(restored.activeRun!.contract!.label, '// Matsuda contractor annex - payroll mirror');
});

test('restoreCampaign restores legacy snapshots without credits as zero', () => {
  // M4.2: passing a legacy numeric salvage exercises the constructor's
  // `migrateSalvage` path — it should bucket into scrap on load. Then we
  // overwrite the snapshot to look pre-M4.2 (numeric salvage) and confirm
  // restoreCampaign also accepts and migrates it.
  const campaign = new Campaign({ seed: 0xc0de, salvage: 4, credits: 70 });
  const rec = snapshotCampaign(campaign) as Record<string, unknown>;
  delete rec.credits;
  // Force the salvage field back to legacy number shape so we are actually
  // exercising the migration on restore, not just the typed round-trip.
  rec.salvage = 4;
  const restored = restoreCampaign(rec);
  assert.deepEqual(restored.salvage, makeSalvage({ scrap: 4 }));
  assert.equal(totalSalvage(restored.salvage), 4);
  assert.equal(restored.credits, 0);
});

test('restoreCampaign migrates legacy active-run salvage rewards to Creds', () => {
  const campaign = new Campaign({ seed: 0xbeef });
  campaign.deployCrewMember(campaign.crew[2].id, fakeContract({ label: 'legacy reward' }));
  const rec = snapshotCampaign(campaign) as Record<string, unknown>;
  const activeRun = rec.activeRun as { contract: { reward: Record<string, unknown> } };
  activeRun.contract.reward = { salvage: 6, repDelta: 2 };

  const restored = restoreCampaign(rec);

  assert.equal(restored.activeRun!.contract.reward.credits, 6 * SALVAGE_TO_CRED_RATE);
  assert.equal(restored.activeRun!.contract.reward.repDelta, 2);
});

test('restoreCampaign migrates legacy string objectives to objective records', () => {
  const campaign = new Campaign({ seed: 0xbeef });
  campaign.deployCrewMember(campaign.crew[2].id, fakeContract({ label: 'legacy objective' }));
  const rec = snapshotCampaign(campaign) as Record<string, unknown>;
  const activeRun = rec.activeRun as { contract: { objective: unknown } };
  activeRun.contract.objective = OBJECTIVES.REACH_EXIT;

  const restored = restoreCampaign(rec);

  assert.equal(restored.activeRun!.contract.objective.kind, OBJECTIVES.REACH_EXIT);
  assert.equal(typeof restored.activeRun!.contract.objective.briefing, 'string');
});

test('restoreCampaign throws on corrupt campaign records', () => {
  const campaign = new Campaign({ seed: 0x123 });
  const rec = snapshotCampaign(campaign);
  assert.throws(() => restoreCampaign({ ...rec, type: 'run' }), /campaign/);
  assert.throws(() => restoreCampaign({ ...rec, crew: [] }), /crew/);
  assert.throws(() => restoreCampaign({ ...rec, salvage: -1 }), /salvage/);
  assert.throws(() => restoreCampaign({ ...rec, credits: -1 }), /credits/);
  assert.throws(() => restoreCampaign({ ...rec, rep: 101 }), /rep/);
  assert.throws(() => restoreCampaign({ ...rec, healedThisVisit: 'bad' }), /healedThisVisit/);
});

test('restoreCampaign migrates legacy "vouch" key to "rep"', () => {
  const campaign = new Campaign({ seed: 0xdead });
  campaign.rep = 75;
  const rec = snapshotCampaign(campaign);
  // Simulate a legacy save that used "vouch" instead of "rep"
  const legacy = { ...rec, vouch: rec.rep } as Record<string, unknown>;
  delete legacy.rep;
  const restored = restoreCampaign(legacy);
  assert.equal(restored.rep, 75);
});

test('restoreCampaign normalizes over-capped hitBonus in crew gear', () => {
  const campaign = new Campaign({ seed: 0xfade });
  const rec = snapshotCampaign(campaign);
  // Inject corrupted gear — 0.5 hitBonus exceeds any archetype's cap.
  rec.crew[0].gear = { maxHpBonus: 0, hitBonus: 0.5 };
  const restored = restoreCampaign(rec);
  const member = restored.crew[0];
  assert.ok(
    member.gear!.hitBonus <= member.maxHitBonus,
    `hitBonus ${member.gear!.hitBonus} should be ≤ maxHitBonus ${member.maxHitBonus}`
  );
  assert.equal(member.gear!.hitBonus, member.maxHitBonus);
});

test('restoreCampaign normalizes over-capped dodgeBonus in crew gear', () => {
  const campaign = new Campaign({ seed: 42 });
  const rec = snapshotCampaign(campaign);
  rec.crew[0].gear = { maxHpBonus: 0, hitBonus: 0, dodgeBonus: 0.9 };
  const restored = restoreCampaign(rec);
  const member = restored.crew[0];
  assert.ok(member.gear!.dodgeBonus <= member.maxDodgeBonus);
  assert.equal(member.gear!.dodgeBonus, member.maxDodgeBonus);
});

test('restoreCampaign preserves valid hitBonus below cap', () => {
  const campaign = new Campaign({ seed: 0xfade });
  const rec = snapshotCampaign(campaign);
  rec.crew[0].gear = { maxHpBonus: 0, hitBonus: 0.1 };
  const restored = restoreCampaign(rec);
  assert.equal(restored.crew[0].gear!.hitBonus, 0.1);
});

// --- P3.5.M6: rolled base stats round-trip -------------------------------

test('CampaignCrewSnapshot round-trips rolled baseHitChance/baseDodgeChance', () => {
  const campaign = new Campaign({ seed: 0xc0ffee });
  const rec = snapshotCampaign(campaign);
  for (const crewRec of rec.crew) {
    assert.equal(typeof crewRec.baseHitChance, 'number');
    assert.equal(typeof crewRec.baseDodgeChance, 'number');
  }
  const restored = restoreCampaign(rec);
  for (const member of campaign.crew) {
    const restoredMember = restored.crew.find(m => m.id === member.id)!;
    assert.equal(restoredMember.baseHitChance, member.baseHitChance);
    assert.equal(restoredMember.baseDodgeChance, member.baseDodgeChance);
  }
});

test('restoreCampaign falls back to the archetype default when baseHitChance/baseDodgeChance are absent (pre-P3.5 save)', () => {
  const campaign = new Campaign({ seed: 0xfeed });
  const rec = snapshotCampaign(campaign);
  for (const crewRec of rec.crew) {
    delete (crewRec as Record<string, unknown>).baseHitChance;
    delete (crewRec as Record<string, unknown>).baseDodgeChance;
  }
  const restored = restoreCampaign(rec);
  for (const crewRec of rec.crew) {
    const member = restored.crew.find(m => m.id === crewRec.id)!;
    assert.equal(member.baseHitChance, DEFAULT_HIT_CHANCE_BY_ARCHETYPE[crewRec.archetype]);
    assert.equal(member.baseDodgeChance, DEFAULT_DODGE_CHANCE_BY_ARCHETYPE[crewRec.archetype]);
  }
});

test('CampaignCrewSnapshot persists the pristine baseHitChance, not a live Berserk Crash penalty', () => {
  const berserk = buildCrewMember('berserk', { x: 0, y: 0 }, new Rng(3), {
    id: 'crew-berserk',
  }) as Berserk;
  berserk.applyEffect(STATUS_EFFECT.CRASH, 2);
  const pristine = berserk.pristineBaseHitChance;
  assert.ok(berserk.baseHitChance < pristine, 'precondition: Crash penalty is live');

  const campaign = new Campaign({ seed: 1, crew: [berserk] });
  const rec = snapshotCampaign(campaign);
  const crewRec = rec.crew.find(c => c.id === 'crew-berserk')!;
  assert.equal(
    crewRec.baseHitChance,
    pristine,
    'snapshot stores the pristine roll, not the live value'
  );

  const restored = restoreCampaign(rec);
  const restoredMember = restored.crew.find(m => m.id === 'crew-berserk')!;
  // Restored fresh — no Crash effect carried over via CampaignCrewSnapshot
  // (combat-run-scoped effects are out of scope for the Hub-level snapshot;
  // see P3.5.M1) — so the live getter now reads the pristine value back.
  assert.equal(restoredMember.baseHitChance, pristine);
});

test('restore normalizes over-capped hitBonus in run entity gear', () => {
  const run = freshCombatRun(0xc0de, 'merc');
  run.player.initGear();
  run.player.gear!.hitBonus = 0.5; // corrupt: exceeds Merc's 0.2 cap
  const rec = snapshot(run);
  const { player } = restore(rec);
  assert.ok(
    player.gear!.hitBonus <= player.maxHitBonus,
    `hitBonus ${player.gear!.hitBonus} should be ≤ maxHitBonus ${player.maxHitBonus}`
  );
});

// ---------------------------------------------------------------------------
// Resilient restore: tile-collision nudge
// ---------------------------------------------------------------------------

test('restore nudges a colliding entity to an adjacent tile instead of throwing', () => {
  const run = freshCombatRun(0xbeef);
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one corp entity');

  const rec = snapshot(run);
  // Corrupt the snapshot: move the drone onto the player's tile.
  const playerRec = rec.entities.find(e => e.id === run.player.id);
  const droneRec = rec.entities.find(e => e.id === drone.id);
  assert.ok(playerRec && droneRec);
  droneRec.x = playerRec.x;
  droneRec.y = playerRec.y;

  // Should NOT throw — nudge should relocate the drone.
  const { world: restoredWorld } = restore(rec);
  const restoredDrone = restoredWorld.entities.get(drone.id);
  assert.ok(restoredDrone, 'drone should still be in the world after nudge');
  const restoredPlayer = [...restoredWorld.entities.values()].find(
    e => e.faction === FACTION.PLAYER
  );
  assert.ok(restoredPlayer);
  // The two entities must not share a tile.
  assert.ok(
    restoredDrone.x !== restoredPlayer.x || restoredDrone.y !== restoredPlayer.y,
    `drone (${restoredDrone.x},${restoredDrone.y}) should not overlap player (${restoredPlayer.x},${restoredPlayer.y})`
  );
});

test('restore throws when tile is occupied and no free neighbour exists', () => {
  const run = freshCombatRun(0xcafe);
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one corp entity');

  const rec = snapshot(run);
  const playerRec = rec.entities.find(e => e.id === run.player.id);
  const droneRec = rec.entities.find(e => e.id === drone.id);
  assert.ok(playerRec && droneRec);

  // Put drone on player's tile.
  droneRec.x = playerRec.x;
  droneRec.y = playerRec.y;

  // Wall off every adjacent tile so there's nowhere to nudge.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = playerRec.x + dx;
      const ny = playerRec.y + dy;
      if (nx >= 0 && nx < rec.grid.w && ny >= 0 && ny < rec.grid.h) {
        rec.grid.tiles[ny * rec.grid.w + nx] = TILE.WALL;
      }
    }
  }

  // Should throw — tier-1; no silent drop into a save with a missing entity.
  assert.throws(() => restore(rec), /occupied/i);
});

// ---------------------------------------------------------------------------
// M6.2: property-bag `extra` + per-entity snapshot ownership
// ---------------------------------------------------------------------------

test('M6.2: a fodder snapshot uses the slim extra bag, not a named sub-block', () => {
  const run = freshCombatRun(0xa5a5);
  const fodder = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(fodder, 'expected a corp fodder hostile');
  const rec = snapshot(run);
  const fodderRec = rec.entities.find(e => e.id === fodder.id);
  assert.ok(fodderRec?.extra, 'patrol state lives in the extra bag');
  assert.ok(typeof fodderRec.extra.state === 'string', 'extra carries the patrol state machine');
  const legacy = fodderRec as Record<string, unknown>;
  assert.equal(legacy.drone, undefined, 'no legacy drone sub-block');
  assert.equal(legacy.guard, undefined, 'no legacy guard sub-block');
});

test('M6.2: restore throws on a non-object extra bag', () => {
  const run = freshCombatRun(0xbad2);
  const rec = snapshot(run);
  const fodderRec = rec.entities.find(e => e.faction === FACTION.CORP);
  assert.ok(fodderRec);
  (fodderRec as Record<string, unknown>).extra = 42;
  assert.throws(() => restore(rec), /extra must be an object/);
});

test('M6.2: restore throws when a terminal record carries no state', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 0x51ced });
  run.enterBriefing(terminalSliceContract());
  run.enterCombat();
  const terminal = [...run.world.entities.values()].find(e => e instanceof Terminal);
  assert.ok(terminal, 'expected a terminal');
  const rec = snapshot(run);
  const tRec = rec.entities.find(e => e.id === terminal.id);
  assert.ok(tRec);
  tRec.extra = {};
  assert.throws(() => restore(rec), /requires terminal state/);
});

test('M6.2: restore throws on a door glyph that disagrees with locked', () => {
  const run = freshCombatRun(0xd00d);
  const tile = freeCombatTile(run);
  const door = new Door({ id: 'door-0', x: tile.x, y: tile.y, doorId: 'd-1', locked: true });
  run.world.addEntity(door);
  const rec = snapshot(run);
  const doorRec = rec.entities.find(e => e.id === 'door-0');
  assert.ok(doorRec?.extra, 'door state lives in the extra bag');
  doorRec.glyph = '.'; // neither the locked nor open door glyph
  assert.throws(() => restore(rec), /glyph/);
});

test('M6.2: restore normalizes a legacy patrol sub-block into extra', () => {
  // Back-compat: pre-M6.2 saves keyed the patrol block under the archetype id
  // (`drone` = Skirmisher) at the top level instead of `extra`.
  const run = freshCombatRun(0xfeed);
  const fodder = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(fodder);
  fodder.state = 'investigate';
  fodder.lastKnownTarget = { x: 3, y: 4 };
  const rec = snapshot(run);
  const fodderRec = rec.entities.find(e => e.id === fodder.id);
  assert.ok(fodderRec);
  const legacy = fodderRec as Record<string, unknown>;
  legacy[fodderRec.archetype] = legacy.extra;
  delete legacy.extra;

  const { world } = restore(rec);
  const restored = world.entities.get(fodder.id);
  assert.ok(restored, 'legacy-shaped fodder still restores');
  assert.equal(restored.state, 'investigate');
  assert.deepEqual(restored.lastKnownTarget, { x: 3, y: 4 });
});

test('M6.2: restore normalizes a legacy terminal sub-block into extra', () => {
  const run = new Run({ crewMember: makeCrew('razor'), seed: 0x51ced });
  run.enterBriefing(terminalSliceContract());
  run.enterCombat();
  const terminal = [...run.world.entities.values()].find(e => e instanceof Terminal);
  assert.ok(terminal);
  const rec = snapshot(run);
  const tRec = rec.entities.find(e => e.id === terminal.id);
  assert.ok(tRec);
  const legacy = tRec as Record<string, unknown>;
  legacy.terminal = legacy.extra;
  delete legacy.extra;

  const { world } = restore(rec);
  const restored = [...world.entities.values()].find(e => e instanceof Terminal);
  assert.ok(restored, 'legacy-shaped terminal still restores');
  assert.equal(restored.label, terminal.label);
  assert.equal(restored.raisesAlarm, terminal.raisesAlarm);
});

test('M6.2: restore normalizes legacy top-level crew fields into extra', () => {
  // Pre-M6.2 saves stored callsign/flatlined/inventory/gear at the top level.
  const run = freshCombatRun(0xc0b0, 'razor');
  run.player.callsign = 'Ghost';
  const rec = snapshot(run);
  const playerRec = rec.entities.find(e => e.id === run.player.id);
  assert.ok(playerRec);
  const legacy = playerRec as Record<string, unknown>;
  Object.assign(legacy, legacy.extra);
  delete legacy.extra;

  const { player } = restore(rec);
  assert.equal(player.callsign, 'Ghost');
});

// ---------------------------------------------------------------------------
// P3.6: timed tile effects (thrown fire, smoke)
//
// Effect lifetimes live on World specifically so they survive a save. Smoke
// used to keep its lifetime in shell state that was *not* persisted while
// grid.tiles *is* — so a mid-mission reload stranded smoke on the map forever.
// Autosave fires at the player→corp hand-off, which is exactly when smoke is
// on the grid, so this was reachable in ordinary play. These guard the fix.
// ---------------------------------------------------------------------------

test('P3.6: thrown-fire burn timers survive a snapshot round-trip', () => {
  const run = freshCombatRun(0xf1e5, 'razor');
  const tile = freeCombatTile(run);
  run.world.applyTileEffect(tile.x, tile.y, TILE.HAZARD, INCENDIARY_BURN_TURNS);

  const rec = snapshot(run);
  assert.deepEqual(
    rec.tileEffects,
    [
      {
        x: tile.x,
        y: tile.y,
        tile: TILE.HAZARD,
        turnsLeft: INCENDIARY_BURN_TURNS,
        restoreTo: TILE.FLOOR,
      },
    ],
    'effect timers ride the run snapshot'
  );

  const { run: restored } = restore(rec);
  assert.deepEqual(snapshot(restored), rec, 'stable round-trip');
});

test('P3.6: fire reloaded mid-burn still goes out on schedule', () => {
  const run = freshCombatRun(0xf1e6, 'razor');
  const tile = freeCombatTile(run);
  run.world.applyTileEffect(tile.x, tile.y, TILE.HAZARD, INCENDIARY_BURN_TURNS);

  const { run: restored } = restore(snapshot(run));
  assert.equal(restored.world.grid.tileAt(tile.x, tile.y), TILE.HAZARD, 'still alight on reload');

  for (let i = 0; i < INCENDIARY_BURN_TURNS; i++) {
    restored.world.tickTileEffects();
  }

  assert.equal(
    restored.world.grid.tileAt(tile.x, tile.y),
    TILE.FLOOR,
    'reloaded fire must still burn out — not become a permanent scar'
  );
});

// The regression this whole mechanism exists for.
test('P3.6: smoke saved mid-cloud does NOT become a permanent LOS wall on reload', () => {
  const run = freshCombatRun(0xf1e9, 'razor');
  const tile = freeCombatTile(run);
  placeSmoke(run.world, tile.x, tile.y, 0);
  assert.equal(run.world.grid.tileAt(tile.x, tile.y), TILE.SMOKE, 'cloud is on the grid');

  // Autosave fires at the player→corp hand-off — i.e. right here, with smoke up.
  const { run: restored } = restore(snapshot(run));
  assert.equal(restored.world.grid.tileAt(tile.x, tile.y), TILE.SMOKE, 'cloud survives reload');

  restored.world.tickTileEffects();

  assert.equal(
    restored.world.grid.tileAt(tile.x, tile.y),
    TILE.FLOOR,
    'reloaded smoke must still clear — it used to sit there blocking LOS forever'
  );
});

test('P3.6: smoke over the EXIT tile restores the EXIT, not FLOOR', () => {
  const run = freshCombatRun(0xf1ea, 'razor');
  const exit = run.exitTile;
  assert.ok(exit, 'fixture has an exit tile');
  assert.equal(run.world.grid.tileAt(exit.x, exit.y), TILE.EXIT);

  placeSmoke(run.world, exit.x, exit.y, 0);
  const { run: restored } = restore(snapshot(run));
  restored.world.tickTileEffects();

  assert.equal(
    restored.world.grid.tileAt(exit.x, exit.y),
    TILE.EXIT,
    'a cloud over the exit must not quietly delete the exit'
  );
});

test('P3.6: a pre-3.6 save with no tileEffects field restores as permanent fire', () => {
  const run = freshCombatRun(0xf1e7, 'razor');
  const tile = freeCombatTile(run);
  run.world.applyTileEffect(tile.x, tile.y, TILE.HAZARD, INCENDIARY_BURN_TURNS);

  const rec = snapshot(run);
  delete (rec as Record<string, unknown>).tileEffects; // as an old save would be

  const { run: restored } = restore(rec);
  for (let i = 0; i < INCENDIARY_BURN_TURNS + 3; i++) {
    restored.world.tickTileEffects();
  }

  assert.equal(
    restored.world.grid.tileAt(tile.x, tile.y),
    TILE.HAZARD,
    'an old save keeps the behaviour it was played under'
  );
});

test('P3.6: restore rejects a malformed tileEffects entry rather than guessing', () => {
  const run = freshCombatRun(0xf1e8, 'razor');
  const tile = freeCombatTile(run);
  run.world.applyTileEffect(tile.x, tile.y, TILE.HAZARD, INCENDIARY_BURN_TURNS);
  const rec = snapshot(run);

  const withEffect = (patch: Record<string, unknown>) => {
    const bad = structuredClone(rec) as Record<string, unknown>;
    bad.tileEffects = [
      { x: tile.x, y: tile.y, tile: TILE.HAZARD, turnsLeft: 1, restoreTo: TILE.FLOOR, ...patch },
    ];
    return bad;
  };

  assert.throws(
    () => restore(withEffect({ turnsLeft: 0 })),
    /turnsLeft/i,
    'turnsLeft must be >= 1'
  );
  assert.throws(() => restore(withEffect({ x: 'nope' })), /integer x,y/i, 'coords are integers');
  assert.throws(() => restore(withEffect({ tile: 99 })), /unknown tile/i, 'tile must be a TILE id');
  assert.throws(
    () => restore(withEffect({ restoreTo: 99 })),
    /unknown restoreTo/i,
    'restoreTo must be a TILE id'
  );

  const notArray = structuredClone(rec) as Record<string, unknown>;
  notArray.tileEffects = 'not-an-array';
  assert.throws(() => restore(notArray), /must be an array/i);
});
