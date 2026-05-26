import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign } from '../../../src/game/Campaign.js';
import { Run } from '../../../src/game/Run.js';
import { buildContractRecipeFixture, OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Terminal } from '../../../src/game/entities/Terminal.js';
import {
  restore,
  restoreCampaign,
  snapshot,
  snapshotCampaign,
} from '../../../src/game/persistence.js';
import { CONTRACT_DIFFICULTY, FACTION, SALVAGE_TO_CRED_RATE } from '../../../src/game/constants.js';
import { makeSalvage, totalSalvage } from '../../../src/game/salvage.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
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
  const rec = snapshot(run);
  const { player } = restore(rec);
  assert.equal(player.hp, 1);
  assert.equal(player.ap, 2);
  assert.equal(player.stealthed, true);
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
  const drone = [...run.world.entities.values()].find(e => e.faction === FACTION.CORP);
  assert.ok(drone, 'expected at least one drone for threatCount=1');
  const rec = snapshot(run);
  const droneRec = rec.entities.find(e => e.id === drone.id);
  assert.ok(droneRec?.drone, 'expected drone record');
  droneRec.drone.patrolIndex = droneRec.drone.patrolWaypoints.length + 5;
  assert.throws(() => restore(rec), /patrolIndex/);
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
  assert.equal(terminalRec.terminal?.sliced, true);
  assert.equal(terminalRec.terminal?.armed, false);

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
  campaign.rep = 62;
  campaign.meta = { someFlag: true };
  campaign.crew[1].flatlined = true;

  const recA = snapshotCampaign(campaign);
  const restored = restoreCampaign(recA);
  const recB = snapshotCampaign(restored);

  assert.deepEqual(recB, recA);
  assert.deepEqual(restored.salvage, makeSalvage({ scrap: 3, chips: 2, bio: 1, data: 1 }));
  assert.equal(totalSalvage(restored.salvage), 7);
  assert.equal(restored.credits, 90);
  assert.equal(restored.rep, 62);
  assert.deepEqual(restored.meta, { someFlag: true });
  assert.equal(restored.crew[1].flatlined, true);
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
  assert.equal(restored.activeRun!.contract!.label, '// Matsuda payroll mirror');
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
