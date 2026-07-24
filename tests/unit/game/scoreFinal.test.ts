import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Campaign,
  CAMPAIGN_STATE,
  SCORE_CREDITS_REWARD,
  ABSTRACT_SCORE_TARGETS,
} from '../../../src/game/Campaign.js';
import { OUTCOME, RUN_STATE, Run } from '../../../src/game/Run.js';
import { DataNode } from '../../../src/game/cyber/DataNode.js';
import { CyberspaceLayer } from '../../../src/game/cyber/CyberspaceLayer.js';
import { Door } from '../../../src/game/entities/Door.js';
import { JackInPoint } from '../../../src/game/entities/JackInPoint.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import {
  snapshot,
  restore,
  snapshotCampaign,
  restoreCampaign,
} from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { explorationReachableKeys, coordKey } from '../../../src/game/mapConnectivity.js';
import { SCOREABLE_ITEMS, SCOREABLE_ITEM_IDS } from '../../../src/game/items.js';
import { CONTRACT_DIFFICULTY } from '../../../src/game/constants.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Entity } from '../../../src/game/Entity.js';
import type { World } from '../../../src/game/World.js';
import type { Contract } from '../../../src/game/hub/Curator.js';
import type { LocationSite } from '../../../src/types.js';

const SCORE_DOOR_ID = 'score-door-0';

/**
 * P3.5.M7: `buildScoreContract` now draws from a merged item+archetype pool.
 * This file's tests predate that merge and assert deterministic seed→item
 * mappings — passing every archetype as already-"acquired" keeps the pool
 * item-only, preserving those assertions untouched. Archetype-specific draw
 * behavior is covered separately (Campaign.test.ts, § P3.5.M7).
 */
const ALL_ARCHETYPES_ACQUIRED = ['berserk', 'adept', 'chimera'];

function scoreContract(seed = 100, mapWidth = 28, mapHeight = 18): Contract {
  return {
    seed,
    mapWidth,
    mapHeight,
    objective: {
      kind: OBJECTIVES.SCORE_FINAL,
      title: 'The Score',
      briefing: 'Slice the core, secure the payload, and extract both operators.',
      params: { requiresCyberspace: true, count: 1, doorId: SCORE_DOOR_ID },
    },
    difficulty: CONTRACT_DIFFICULTY.CRITICAL,
    threatCount: 1,
    label: '// Matsuda server farm - THE SCORE',
    context: {
      ...testContractContext(OBJECTIVES.SCORE_FINAL),
      recipeId: 'score-final',
      tags: ['score', 'meatspace', 'cyberspace', `objective:${OBJECTIVES.SCORE_FINAL}`],
      arcStage: 'score',
      locationSiteId: 'score',
    },
    reward: { credits: SCORE_CREDITS_REWARD, repDelta: 0 },
  };
}

function makeDecker() {
  return buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
}

function makeMerc() {
  return buildCrewMember('merc', { x: 0, y: 0 }, new Rng(101), { id: 'crew-merc' });
}

function adjacentFreeTile(world: World, target: Entity) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = target.x + dx;
      const y = target.y + dy;
      if (world.grid.inBounds(x, y) && world.grid.isPassable(x, y) && !world.entityAt(x, y)) {
        return { x, y };
      }
    }
  }
  throw new Error(`no free tile adjacent to ${target.id}`);
}

function scoreRun(seed = 100, mapWidth = 28, mapHeight = 18): Run {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed });
  run.enterBriefing(scoreContract(seed, mapWidth, mapHeight));
  run.enterCombat();
  return run;
}

/**
 * The Score door is unlocked only by jacking in and slicing the cyber core, so
 * the jack-in point MUST sit on the spawn side of the locked door. We isolate
 * exactly that failure: flood the grid from spawn treating ONLY `score-door-0`
 * as a wall (`respectEntityBlockers: false` so transient mobs and unrelated
 * doors don't muddy the verdict). If the jack-in tile is unreachable, the run is
 * sealed by the very door the jack-in is supposed to open.
 */
function jackInReachableWithDoorLocked(run: Run): boolean {
  const door = scoreDoor(run);
  assert.equal(door.locked, true, 'invariant only meaningful while the door is locked');
  const point = [...run.world!.entities.values()].find(e => e instanceof JackInPoint);
  assert.ok(point, 'Score placed a jack-in point');
  const spawn = { x: run.player!.x, y: run.player!.y };
  const reachable = explorationReachableKeys(run.world!, spawn, {
    respectEntityBlockers: false,
    extraBlockers: new Set([coordKey(door.x, door.y)]),
  });
  return reachable.has(coordKey(point.x, point.y));
}

function jackIn(run: Run): CyberspaceLayer {
  const point = [...run.world!.entities.values()].find(e => e instanceof JackInPoint);
  assert.ok(point, 'Score placed a jack-in point');
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
  assert.equal(run.cyberspace?.phase, 'active');
  return (run.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
}

function sliceCore(layer: CyberspaceLayer): void {
  const node = [...layer.world.entities.values()].find(e => e instanceof DataNode);
  assert.ok(node, 'Score placed a core data node');
  while (!node.sliced) {
    const spot = adjacentFreeTile(layer.world, node);
    layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
    layer.avatar.refreshAp();
    assert.equal(node.interact(layer.world, layer.avatar).ok, true);
  }
}

function routeOut(layer: CyberspaceLayer): void {
  const spot = adjacentFreeTile(layer.world, layer.port);
  layer.world.relocateEntity(layer.avatar, spot.x, spot.y);
  layer.avatar.refreshAp();
  assert.equal(layer.port.interact(layer.world, layer.avatar).ok, true);
}

function scoreDoor(run: Run): Door {
  const door = [...run.world!.entities.values()].find(
    (e): e is Door => e instanceof Door && e.doorId === SCORE_DOOR_ID
  );
  assert.ok(door, 'Score placed the linked Meatspace door');
  return door;
}

function scorePayload(run: Run): Pickup {
  const payload = [...run.world!.entities.values()].find(
    (e): e is Pickup => e instanceof Pickup && e.id === `score-payload-${SCORE_DOOR_ID}`
  );
  assert.ok(payload, 'Score placed the payload behind the linked door');
  return payload;
}

function scoreSite(overrides: Partial<LocationSite> = {}): LocationSite {
  const principal = { id: 'matsuda', label: 'Matsuda', groups: ['corp'] };
  return {
    id: 'score',
    seed: '100',
    mapWidth: 28,
    mapHeight: 18,
    label: '// Matsuda server farm - Score target',
    tier: 'score',
    scoreTarget: true,
    mutationDeltas: [],
    seenKeys: [],
    lastVisitedJob: 5,
    principal,
    site: { id: 'server-farm', label: 'server farm', groups: ['corp', 'data'] },
    ...overrides,
  };
}

test('Score run places linked Meatspace and Cyberspace objectives', () => {
  const run = scoreRun();
  const door = scoreDoor(run);
  assert.equal(door.locked, true);
  assert.ok(scorePayload(run));
  const layer = jackIn(run);
  assert.equal([...layer.world.entities.values()].filter(e => e instanceof DataNode).length, 1);
});

test('Score jack-in point is reachable from spawn with the score door locked (regression: dead seed 1277998342)', () => {
  // Reproduces a shipped soft-lock: the jack-in point — the only way to unlock
  // score-door-0 — generated *behind* that door, sealing the run. 32x20 map.
  const run = scoreRun(1277998342, 32, 20);
  assert.ok(
    jackInReachableWithDoorLocked(run),
    'jack-in must be reachable before the door it unlocks is opened'
  );
});

test('Score jack-in point is always spawn-side reachable across a seed sweep', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const run = scoreRun(seed);
    assert.ok(
      jackInReachableWithDoorLocked(run),
      `seed ${seed}: jack-in unreachable with score door locked (soft-lock)`
    );
  }
});

test('Run.onCombatEntered fires once after a successful enterCombat, never on failure', () => {
  let ok = 0;
  const good = new Run({
    crewMember: makeDecker(),
    partnerMember: makeMerc(),
    seed: 100,
    onCombatEntered: () => ok++,
  });
  good.enterBriefing(scoreContract(100));
  good.enterCombat();
  assert.equal(ok, 1, 'hook fires exactly once when the run becomes playable');

  let bad = 0;
  const doomed = new Run({
    crewMember: makeDecker(),
    partnerMember: makeMerc(),
    seed: 100,
    onCombatEntered: () => bad++,
  });
  doomed.enterBriefing(scoreContract(100, 8, 8)); // valid dims, but no door-gated layout fits
  assert.throws(() => doomed.enterCombat());
  assert.equal(bad, 0, 'a generation failure must not fire the combat-entered hook');
});

test('a Score map that fails to generate does not consume the (terminal) attempt', () => {
  const campaign = new Campaign({
    seed: 42,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      scoreSite({ mapWidth: 8, mapHeight: 8 }), // valid but un-buildable door-gated map
      scoreSite({ id: 'case-1', tier: 'roster', scoreTarget: false, seed: '101' }),
      scoreSite({ id: 'case-2', tier: 'roster', scoreTarget: false, seed: '102' }),
      scoreSite({ id: 'case-3', tier: 'roster', scoreTarget: false, seed: '103' }),
      scoreSite({ id: 'case-4', tier: 'roster', scoreTarget: false, seed: '104' }),
    ],
  });
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  const run = campaign.deployCrewMember(decker.id, campaign.buildScoreContract(), partner.id);
  assert.equal(campaign.arc.scoreAttempted, false, 'deploy alone never commits the Score');

  assert.throws(() => run.enterCombat(), 'a 3x3 Score map cannot be generated');
  // The terminal flag stayed clear — the campaign can redeploy instead of being
  // stranded in score-partial by a generation failure.
  assert.equal(campaign.arc.scoreAttempted, false);
  assert.equal(campaign.arcStage, 'act-3');
});

test('slicing the Score core unlocks the linked Meatspace door', () => {
  const run = scoreRun();
  const door = scoreDoor(run);
  const layer = jackIn(run);
  sliceCore(layer);
  assert.equal(door.locked, false);
});

test('partner can extract first; Decker later jacks out and completes the Score', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  scorePayload(run).secureWalkOnto(run.world!);
  assert.equal(run.isObjectiveSatisfied(), true);

  const partner = run.partnerMember!;
  run.world!.relocateEntity(partner, run.exitTile!.x, run.exitTile!.y);
  assert.deepEqual([...run.extractedOperativeIds], [partner.id]);
  assert.equal(run.state, RUN_STATE.COMBAT);
  assert.equal(run.world!.entities.has(partner.id), false);
  assert.equal(run.activeLayer, 'cyber');

  routeOut(layer);
  run.world!.relocateEntity(run.player!, run.exitTile!.x, run.exitTile!.y);
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(run.telemetry.outcome, OUTCOME.EXIT);
  assert.equal(run.telemetry.objectiveComplete, true);
});

test('mid-Score restore preserves extracted partner and can still finish', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  scorePayload(run).secureWalkOnto(run.world!);
  const partner = run.partnerMember!;
  run.world!.relocateEntity(partner, run.exitTile!.x, run.exitTile!.y);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  assert.deepEqual([...restored.extractedOperativeIds], [partner.id]);
  assert.equal(restored.world!.entities.has(partner.id), false);
  assert.equal(restored.partnerMember?.id, partner.id);
  assert.equal(restored.cyberspace?.phase, 'active');

  const restoredLayer = (restored.cyberspace as { phase: 'active'; layer: CyberspaceLayer }).layer;
  routeOut(restoredLayer);
  restored.world!.relocateEntity(restored.player!, restored.exitTile!.x, restored.exitTile!.y);
  assert.equal(restored.state, RUN_STATE.RESULT);
  assert.equal(restored.telemetry.objectiveComplete, true);
});

test('early Score exit requests confirmation and confirmed extraction is partial', () => {
  const run = scoreRun();
  let requests = 0;
  run.onAbortRequested = () => requests++;
  run.world!.relocateEntity(run.player!, run.exitTile!.x, run.exitTile!.y);
  assert.equal(requests, 1);
  assert.equal(run.state, RUN_STATE.COMBAT);

  run.confirmAbort();
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(run.telemetry.objectiveComplete, false);
});

// P3.6: an early exit with the job unfinished is `score-aborted`, not
// `score-partial`. The costly-win path (objectives done, an operative lost)
// lives in scoreCasualty.test.ts and does pay.
test('Campaign records an abandoned Score as terminal without reward', () => {
  const campaign = new Campaign({
    seed: 42,
    credits: 25,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      scoreSite(),
      scoreSite({ id: 'case-1', tier: 'roster', scoreTarget: false, seed: '101' }),
      scoreSite({ id: 'case-2', tier: 'roster', scoreTarget: false, seed: '102' }),
      scoreSite({ id: 'case-3', tier: 'roster', scoreTarget: false, seed: '103' }),
      scoreSite({ id: 'case-4', tier: 'roster', scoreTarget: false, seed: '104' }),
    ],
  });
  const decker = campaign.crew.find(member => member.archetype === 'Decker')!;
  const partner = campaign.crew.find(member => member.archetype !== 'Decker')!;
  campaign.deployCrewMember(decker.id, campaign.buildScoreContract(), partner.id).enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });
  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.endReason, 'score-aborted');
  assert.equal(campaign.credits, 25);
});

// ---------------------------------------------------------------------------
// P3.M6.4 — Score target draws an unacquired scoreable blueprint
// ---------------------------------------------------------------------------

/** A Score-ready campaign (Act 3, living Decker + partner, designated target). */
function scoreReadyCampaign() {
  const campaign = new Campaign({
    seed: 42,
    credits: 25,
    rep: 65,
    completedJobs: 9,
    siteRoster: [
      scoreSite(),
      scoreSite({ id: 'case-1', tier: 'roster', scoreTarget: false, seed: '101' }),
      scoreSite({ id: 'case-2', tier: 'roster', scoreTarget: false, seed: '102' }),
      scoreSite({ id: 'case-3', tier: 'roster', scoreTarget: false, seed: '103' }),
      scoreSite({ id: 'case-4', tier: 'roster', scoreTarget: false, seed: '104' }),
    ],
  });
  assert.ok(campaign.canAttemptScore(), 'fixture should be Score-ready');
  return campaign;
}

test('buildScoreContract embeds an unacquired scoreable blueprint id + frames briefing', () => {
  const campaign = scoreReadyCampaign();
  const contract = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED);
  const itemId = contract.objective.params!.scoreItemId as string;
  assert.ok(SCOREABLE_ITEM_IDS.has(itemId), `payload "${itemId}" must be a known scoreable`);
  const item = SCOREABLE_ITEMS.find(i => i.id === itemId)!;
  // Briefing frames the heist around the specific prototype.
  assert.ok(contract.objective.briefing.includes(item.label), 'briefing names the payload');
});

test('buildScoreContract payload selection is deterministic for a campaign', () => {
  const campaign = scoreReadyCampaign();
  const a = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED).objective.params!.scoreItemId;
  const b = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED).objective.params!.scoreItemId;
  assert.equal(a, b, 'same seed + same acquired set → same payload');
});

test('buildScoreContract excludes already-acquired blueprints', () => {
  const campaign = scoreReadyCampaign();
  const firstPick = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED).objective.params!
    .scoreItemId as string;
  // Acquire the would-be pick — the Score must now target a different blueprint.
  const nextPick = campaign.buildScoreContract([firstPick], ALL_ARCHETYPES_ACQUIRED).objective
    .params!.scoreItemId as string;
  assert.notEqual(nextPick, firstPick);
  assert.ok(SCOREABLE_ITEM_IDS.has(nextPick));
});

test('buildScoreContract targets the sole remaining blueprint when all others are acquired', () => {
  const campaign = scoreReadyCampaign();
  const allIds = SCOREABLE_ITEMS.map(i => i.id);
  const remaining = allIds[3]!; // arbitrary survivor
  const acquired = allIds.filter(id => id !== remaining);
  const pick = campaign.buildScoreContract(acquired, ALL_ARCHETYPES_ACQUIRED).objective.params!
    .scoreItemId;
  assert.equal(pick, remaining);
});

test('buildScoreContract never rolls a retired/foreign id passed as acquired', () => {
  const campaign = scoreReadyCampaign();
  // A ghost id isn't in the pool, so it can't shrink it — selection is unchanged.
  const baseline = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED).objective.params!
    .scoreItemId;
  const withGhost = campaign.buildScoreContract(['ghost-blueprint'], ALL_ARCHETYPES_ACQUIRED)
    .objective.params!.scoreItemId;
  assert.equal(withGhost, baseline);
  assert.ok(SCOREABLE_ITEM_IDS.has(withGhost as string));
});

// ---------------------------------------------------------------------------
// P3.M6.5 — Exhausted pool draws an abstract credit payload
// ---------------------------------------------------------------------------

test('buildScoreContract on an exhausted pool drops the blueprint id and frames an abstract target', () => {
  const campaign = scoreReadyCampaign();
  const allAcquired = SCOREABLE_ITEMS.map(i => i.id);
  const contract = campaign.buildScoreContract(allAcquired, ALL_ARCHETYPES_ACQUIRED);
  // No blueprint id — a clean completion must not write the meta-store.
  assert.equal(contract.objective.params!.scoreItemId, undefined);
  // Briefing is framed from exactly one abstract category.
  const named = ABSTRACT_SCORE_TARGETS.filter(t => contract.objective.briefing.includes(t.label));
  assert.equal(named.length, 1, 'briefing names exactly one abstract target');
});

test('abstract Score category selection is deterministic for a campaign', () => {
  const campaign = scoreReadyCampaign();
  const allAcquired = SCOREABLE_ITEMS.map(i => i.id);
  const a = campaign.buildScoreContract(allAcquired, ALL_ARCHETYPES_ACQUIRED).objective.briefing;
  const b = campaign.buildScoreContract(allAcquired, ALL_ARCHETYPES_ACQUIRED).objective.briefing;
  assert.equal(a, b, 'same seed + exhausted pool → same abstract briefing');
});

test('different Score seeds can draw different abstract categories', () => {
  // Sweep seeds; the picker must reach more than one category across the set.
  const labels = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const campaign = new Campaign({
      seed,
      rep: 65,
      completedJobs: 9,
      siteRoster: [
        scoreSite({ seed: String(seed) }),
        scoreSite({ id: 'case-1', tier: 'roster', scoreTarget: false, seed: `${seed}01` }),
        scoreSite({ id: 'case-2', tier: 'roster', scoreTarget: false, seed: `${seed}02` }),
        scoreSite({ id: 'case-3', tier: 'roster', scoreTarget: false, seed: `${seed}03` }),
        scoreSite({ id: 'case-4', tier: 'roster', scoreTarget: false, seed: `${seed}04` }),
      ],
    });
    const briefing = campaign.buildScoreContract(
      SCOREABLE_ITEMS.map(i => i.id),
      ALL_ARCHETYPES_ACQUIRED
    ).objective.briefing;
    for (const t of ABSTRACT_SCORE_TARGETS) {
      if (briefing.includes(t.label)) labels.add(t.id);
    }
  }
  assert.ok(labels.size > 1, 'abstract draw is not pinned to a single category');
});

test('a clean abstract Score settles the arc but writes no meta-store unlock', () => {
  const campaign = scoreReadyCampaign();
  const allAcquired = SCOREABLE_ITEMS.map(i => i.id);
  const decker = campaign.crew.find(member => member.archetype === 'Decker')!;
  const partner = campaign.crew.find(member => member.archetype !== 'Decker')!;
  const beforeCredits = campaign.credits;
  campaign
    .deployCrewMember(
      decker.id,
      campaign.buildScoreContract(allAcquired, ALL_ARCHETYPES_ACQUIRED),
      partner.id
    )
    .enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });
  // Arc reaches its climax exactly as a blueprint Score would.
  assert.equal(campaign.endReason, 'score-complete');
  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.credits, beforeCredits + SCORE_CREDITS_REWARD);
  // …but there is no blueprint to unlock.
  assert.equal(campaign.scoreUnlockedItemId, null);
});

test('clean Score completion records the stolen blueprint for the meta-store', () => {
  const campaign = scoreReadyCampaign();
  const decker = campaign.crew.find(member => member.archetype === 'Decker')!;
  const partner = campaign.crew.find(member => member.archetype !== 'Decker')!;
  const contract = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED);
  const expectedId = contract.objective.params!.scoreItemId as string;
  campaign.deployCrewMember(decker.id, contract, partner.id).enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });
  assert.equal(campaign.endReason, 'score-complete');
  assert.equal(campaign.scoreUnlockedItemId, expectedId, 'unlock recorded for settlement');
});

test('abandoned Score records no blueprint unlock (prototype not secured)', () => {
  const campaign = scoreReadyCampaign();
  const decker = campaign.crew.find(member => member.archetype === 'Decker')!;
  const partner = campaign.crew.find(member => member.archetype !== 'Decker')!;
  campaign
    .deployCrewMember(
      decker.id,
      campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED),
      partner.id
    )
    .enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });
  assert.equal(campaign.endReason, 'score-aborted');
  assert.equal(campaign.scoreUnlockedItemId, null);
});

test('Score payload pickup is labelled + flavored from the target blueprint', () => {
  const item = SCOREABLE_ITEMS[0]!;
  const contract = scoreContract();
  contract.objective.params = { ...contract.objective.params, scoreItemId: item.id };
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 100 });
  run.enterBriefing(contract);
  run.enterCombat();
  const payload = scorePayload(run);
  assert.equal(payload.label, item.label);
  assert.equal(payload.detail, item.flavor);
});

test('Score payload falls back to a generic label with no flavor for an abstract target', () => {
  const run = scoreRun(); // scoreContract() carries no scoreItemId
  const payload = scorePayload(run);
  assert.equal(payload.label, 'Score payload');
  assert.equal(payload.detail, undefined);
});

test('Score payload flavor detail survives a run snapshot/restore', () => {
  const item = SCOREABLE_ITEMS[0]!;
  const contract = scoreContract();
  contract.objective.params = { ...contract.objective.params, scoreItemId: item.id };
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 100 });
  run.enterBriefing(contract);
  run.enterCombat();

  const { run: restored } = restore(structuredClone(snapshot(run)));
  const payload = scorePayload(restored);
  assert.equal(payload.label, item.label);
  assert.equal(payload.detail, item.flavor);
});

test('recorded Score unlock survives campaign snapshot/restore (resume can still write it)', () => {
  const campaign = scoreReadyCampaign();
  const decker = campaign.crew.find(member => member.archetype === 'Decker')!;
  const partner = campaign.crew.find(member => member.archetype !== 'Decker')!;
  const contract = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED);
  const expectedId = contract.objective.params!.scoreItemId as string;
  campaign.deployCrewMember(decker.id, contract, partner.id).enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });

  const restored = restoreCampaign(snapshotCampaign(campaign));
  assert.equal(restored.endReason, 'score-complete');
  assert.equal(restored.scoreUnlockedItemId, expectedId);
});
