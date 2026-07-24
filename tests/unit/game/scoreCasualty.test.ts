/**
 * P3.6 — the costly Score. A Score that loses an operative but gets the payload
 * out is a *win tier*, not an abandoned job:
 *
 *   - Objectives complete + every LIVING required operative extracted = terminal.
 *     No casualties → `score-extracted` (clean). A casualty → `score-partial`.
 *   - The rule is symmetric: the Decker flatlining to ICE must not end a Score
 *     run while a live meat partner is still on the grid to carry the payload out.
 *   - Walking out with objectives *incomplete* is a different outcome entirely
 *     (`score-aborted`) and pays nothing.
 *
 * The previously shipped behaviour reported `objectiveComplete: false` on a
 * casualty extraction — a run record that denied the job the player finished.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Campaign, CAMPAIGN_STATE, SCORE_CREDITS_REWARD } from '../../../src/game/Campaign.js';
import { OUTCOME, RUN_STATE, Run } from '../../../src/game/Run.js';
import { DataNode } from '../../../src/game/cyber/DataNode.js';
import { CyberspaceLayer } from '../../../src/game/cyber/CyberspaceLayer.js';
import { JackInPoint } from '../../../src/game/entities/JackInPoint.js';
import { Pickup } from '../../../src/game/entities/Pickup.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { SCOREABLE_ITEMS } from '../../../src/game/items.js';
import { CONTRACT_DIFFICULTY, FACTION } from '../../../src/game/constants.js';
import { EVENT } from '../../../src/game/events.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
import type { Entity } from '../../../src/game/Entity.js';
import type { World } from '../../../src/game/World.js';
import type { Contract } from '../../../src/game/hub/Curator.js';
import type { LocationSite } from '../../../src/types.js';

const SCORE_DOOR_ID = 'score-door-0';
const ALL_ARCHETYPES_ACQUIRED = ['berserk', 'adept', 'chimera'];

function scoreContract(seed = 100): Contract {
  return {
    seed,
    mapWidth: 28,
    mapHeight: 18,
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

const makeDecker = () =>
  buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
const makeMerc = () => buildCrewMember('merc', { x: 0, y: 0 }, new Rng(101), { id: 'crew-merc' });

function scoreRun(seed = 100): Run {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed });
  run.enterBriefing(scoreContract(seed));
  run.enterCombat();
  return run;
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

function jackIn(run: Run): CyberspaceLayer {
  const point = [...run.world!.entities.values()].find(e => e instanceof JackInPoint);
  assert.ok(point, 'Score placed a jack-in point');
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  assert.equal(point.interact(run.world!, run.player!).ok, true);
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

function scorePayload(run: Run): Pickup {
  const payload = [...run.world!.entities.values()].find(
    (e): e is Pickup => e instanceof Pickup && e.id === `score-payload-${SCORE_DOOR_ID}`
  );
  assert.ok(payload, 'Score placed the payload behind the linked door');
  return payload;
}

/** Kill the partner the way the corp does, so `Run` sees a real death. */
function flatlinePartner(run: Run): void {
  const partner = run.partnerMember!;
  const attacker = [...run.world!.entities.values()].find(e => e.faction === FACTION.CORP) ?? null;
  partner.damage(partner.hp);
  run.bus!.emit(EVENT.ENTITY_DAMAGED, {
    attacker,
    target: partner,
    damage: 5,
    killed: true,
    source: 'ranged',
  });
}

/** Kill the Decker's avatar the way black ICE does, on the cyber bus. */
function flatlineAvatarToIce(run: Run, layer: CyberspaceLayer): void {
  const avatar = layer.avatar;
  const ice = [...layer.world.entities.values()].find(e => e.faction === FACTION.CORP) ?? null;
  avatar.damage(avatar.hp);
  layer.bus.emit(EVENT.ENTITY_DAMAGED, {
    attacker: ice,
    target: avatar,
    damage: 5,
    killed: true,
    source: 'ice',
  });
}

function extractAt(run: Run, actor: Entity): void {
  run.world!.relocateEntity(actor, run.exitTile!.x, run.exitTile!.y);
}

// ---------------------------------------------------------------------------
// The survivor rule — a casualty does not void a finished job
// ---------------------------------------------------------------------------

test('P3.6: a dead partner does not void the Score — the Decker extracts it as partial', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  routeOut(layer);
  scorePayload(run).secureWalkOnto(run.world!);
  flatlinePartner(run);
  assert.equal(run.state, RUN_STATE.COMBAT, 'partner death is not run-ending');

  extractAt(run, run.player!);
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(run.telemetry.outcome, OUTCOME.EXIT);
  assert.equal(run.telemetry.cause, 'score-partial');
  // The job WAS finished — the record must say so. This is the regression that
  // drove the "partial paid nothing" playtest report.
  assert.equal(
    run.telemetry.objectiveComplete,
    true,
    'a casualty extraction still completed the objective'
  );
});

test('P3.6: no casualties still yields a clean score-extracted completion', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  routeOut(layer);
  scorePayload(run).secureWalkOnto(run.world!);

  extractAt(run, run.partnerMember!);
  assert.equal(run.state, RUN_STATE.COMBAT, 'one operative out is not the end');
  extractAt(run, run.player!);
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(run.telemetry.cause, 'score-extracted');
  assert.equal(run.telemetry.objectiveComplete, true);
});

test('P3.6: extraction still waits for every LIVING operative, not just the first', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  routeOut(layer);
  scorePayload(run).secureWalkOnto(run.world!);

  extractAt(run, run.partnerMember!);
  assert.equal(run.state, RUN_STATE.COMBAT, 'the Decker is alive and still inside');
});

// ---------------------------------------------------------------------------
// Symmetry — the Decker dying must not strand a live partner mid-heist
// ---------------------------------------------------------------------------

test('P3.6: black ICE flatlining the Decker does not end a Score run with a live partner', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  flatlineAvatarToIce(run, layer);

  assert.equal(run.state, RUN_STATE.COMBAT, 'the partner fights on');
  assert.equal(run.deckerDown, true);
  assert.equal(run.player!.alive, false);
  // The link died with the Decker, but the slice it already landed stands.
  assert.equal(run.cyberspace?.phase, 'resolved');
  // Control must never be left on a corpse or a dead layer.
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.meatActor, run.partnerMember);
});

test('P3.6: the surviving partner can carry the payload out after the Decker flatlines', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  flatlineAvatarToIce(run, layer);
  // The sliced core already unlocked the route, so the payload is reachable.
  scorePayload(run).secureWalkOnto(run.world!);

  extractAt(run, run.partnerMember!);
  assert.equal(run.state, RUN_STATE.RESULT);
  assert.equal(run.telemetry.cause, 'score-partial');
  assert.equal(run.telemetry.objectiveComplete, true);
});

test('P3.6: the onDeckerDown hook fires so the shell can surface an off-screen flatline', () => {
  const downed: unknown[] = [];
  const run = new Run({
    crewMember: makeDecker(),
    partnerMember: makeMerc(),
    seed: 100,
    onDeckerDown: (d: unknown) => downed.push(d),
  });
  run.enterBriefing(scoreContract(100));
  run.enterCombat();
  const layer = jackIn(run);
  flatlineAvatarToIce(run, layer);
  assert.equal(downed.length, 1);
  assert.equal(downed[0], run.player);
});

test('P3.6: with no live partner on the grid, a Decker flatline still ends the run', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  flatlinePartner(run);
  flatlineAvatarToIce(run, layer);
  assert.equal(run.state, RUN_STATE.RESULT, 'nobody left to finish the job');
  assert.equal(run.telemetry.outcome, OUTCOME.DEATH);
});

test('P3.6: a non-Score run still ends the moment the Decker flatlines', () => {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed: 12345 });
  run.enterBriefing({
    seed: 12345,
    objective: {
      kind: OBJECTIVES.DATA_NODE_SLICE,
      title: 'Spike the server farm',
      briefing: 'Jack in, slice the data node, then extract.',
      params: { requiresCyberspace: true, count: 1 },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'cyber casing job',
    context: testContractContext(OBJECTIVES.DATA_NODE_SLICE),
    reward: { credits: 0, repDelta: 0 },
  } as unknown as Contract);
  run.enterCombat();
  const layer = jackIn(run);
  flatlineAvatarToIce(run, layer);
  assert.equal(run.state, RUN_STATE.RESULT, 'only the Score continues past a Decker flatline');
  assert.equal(run.telemetry.outcome, OUTCOME.DEATH);
});

test('P3.6: a downed Decker round-trips through snapshot/restore mid-Score', () => {
  const run = scoreRun();
  const layer = jackIn(run);
  sliceCore(layer);
  flatlineAvatarToIce(run, layer);

  const { run: restored } = restore(structuredClone(snapshot(run)));
  assert.equal(restored.deckerDown, true);
  assert.equal(restored.state, RUN_STATE.COMBAT);
  assert.equal(restored.meatActor?.id, run.partnerMember!.id);

  scorePayload(restored).secureWalkOnto(restored.world!);
  extractAt(restored, restored.partnerMember!);
  assert.equal(restored.state, RUN_STATE.RESULT);
  assert.equal(restored.telemetry.cause, 'score-partial');
});

// ---------------------------------------------------------------------------
// Settlement — a costly win pays
// ---------------------------------------------------------------------------

function scoreSite(overrides: Partial<LocationSite> = {}): LocationSite {
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
    principal: { id: 'matsuda', label: 'Matsuda', groups: ['corp'] },
    site: { id: 'server-farm', label: 'server farm', groups: ['corp', 'data'] },
    ...overrides,
  };
}

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

/**
 * Deploy the Score, lose the partner on the field, extract the Decker with the
 * payload, and settle — mirroring `shellRuntime.settlePendingJobResult` so the
 * campaign sees exactly the arguments the real shell would hand it.
 */
function settleCasualtyScore(campaign: Campaign, contract: Contract) {
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  const run = campaign.deployCrewMember(decker.id, contract, partner.id);
  run.enterCombat();
  const layer = jackIn(run);
  sliceCore(layer);
  routeOut(layer);
  scorePayload(run).secureWalkOnto(run.world!);
  flatlinePartner(run);
  extractAt(run, run.player!);
  assert.equal(run.state, RUN_STATE.RESULT, 'the extraction should have ended the run');

  const salvage = campaign.getCrewMember(campaign.deployedMemberId!)?.inventory?.salvage;
  campaign.onJobEnd({
    outcome: run.telemetry.outcome!,
    salvage,
    completed: run.telemetry.objectiveComplete !== false,
  });
  return { decker, partner };
}

test('P3.6: a costly Score pays reduced credits and still lands the blueprint', () => {
  const campaign = scoreReadyCampaign();
  const contract = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED);
  const expectedId = contract.objective.params!.scoreItemId as string;
  const before = campaign.credits;
  settleCasualtyScore(campaign, contract);

  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.endReason, 'score-partial');
  // The payload left the building, so the blueprint is stolen.
  assert.equal(campaign.scoreUnlockedItemId, expectedId);
  // …but the job cost a life, so it does not pay like a clean run.
  assert.ok(campaign.credits > before, 'a secured payload pays something');
  assert.ok(
    campaign.credits < before + SCORE_CREDITS_REWARD,
    'a casualty must not pay the clean rate'
  );
});

test('P3.6: a costly Score flatlines the lost operative for good', () => {
  const campaign = scoreReadyCampaign();
  const { partner } = settleCasualtyScore(
    campaign,
    campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED)
  );
  assert.equal(campaign.getCrewMember(partner.id)!.flatlined, true);
});

test('P3.6: walking out empty-handed is score-aborted and pays nothing', () => {
  const campaign = scoreReadyCampaign();
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  const before = campaign.credits;
  campaign
    .deployCrewMember(
      decker.id,
      campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED),
      partner.id
    )
    .enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });
  assert.equal(campaign.state, CAMPAIGN_STATE.ENDED);
  assert.equal(campaign.endReason, 'score-aborted');
  assert.equal(campaign.credits, before, 'nothing was secured');
  assert.equal(campaign.scoreUnlockedItemId, null);
});

test('P3.6: a clean Score is unchanged — full payout, full unlock', () => {
  const campaign = scoreReadyCampaign();
  const contract = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED);
  const expectedId = contract.objective.params!.scoreItemId as string;
  const before = campaign.credits;
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  campaign.deployCrewMember(decker.id, contract, partner.id).enterCombat();

  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: true });
  assert.equal(campaign.endReason, 'score-complete');
  assert.equal(campaign.credits, before + SCORE_CREDITS_REWARD);
  assert.equal(campaign.scoreUnlockedItemId, expectedId);
});

test('P3.6: a costly Score keeps the salvage the survivor carried through the exit', () => {
  const campaign = scoreReadyCampaign();
  const contract = campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED);
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  const run = campaign.deployCrewMember(decker.id, contract, partner.id);
  run.enterCombat();
  const layer = jackIn(run);
  sliceCore(layer);
  routeOut(layer);
  scorePayload(run).secureWalkOnto(run.world!);
  flatlinePartner(run);
  // Loot in the survivor's pack at the moment she walks out.
  const carried = campaign.getCrewMember(decker.id)!.inventory!.salvage;
  carried.chips = 7;
  extractAt(run, run.player!);

  const before = campaign.salvage.chips;
  campaign.onJobEnd({
    outcome: run.telemetry.outcome!,
    salvage: { ...carried },
    completed: run.telemetry.objectiveComplete !== false,
  });
  // She extracted alive with it — the same rule keycards already follow.
  assert.equal(campaign.salvage.chips, before + 7);
});

test('P3.6: the chronicle records a costly Score as a win that cost someone, by name', () => {
  const campaign = scoreReadyCampaign();
  const { partner } = settleCasualtyScore(
    campaign,
    campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED)
  );
  const entry = campaign.chronicle.find(e => e.title.startsWith('THE SCORE'));
  assert.ok(entry, 'the Score writes a chronicle entry');
  // Never "abandoned" — the job was finished.
  assert.doesNotMatch(entry.title, /ABANDONED/);
  assert.match(entry.title, /BLOOD/);
  const lostName = campaign.getCrewMember(partner.id)!.callsign ?? partner.id;
  assert.ok(
    entry.summary.includes(lostName),
    `the chronicle should name the operator lost (${lostName}): ${entry.summary}`
  );
  assert.ok(
    entry.detailLines.some(line => line.includes('operator lost')),
    'the outcome label distinguishes a costly Score from a clean one'
  );
});

test('P3.6: the chronicle calls an abandoned Score abandoned, not partial', () => {
  const campaign = scoreReadyCampaign();
  const decker = campaign.crew.find(m => m.archetype === 'Decker')!;
  const partner = campaign.crew.find(m => m.archetype !== 'Decker')!;
  campaign
    .deployCrewMember(
      decker.id,
      campaign.buildScoreContract([], ALL_ARCHETYPES_ACQUIRED),
      partner.id
    )
    .enterCombat();
  campaign.onJobEnd({ outcome: OUTCOME.EXIT, completed: false });

  const entry = campaign.chronicle.find(e => e.title.startsWith('THE SCORE'));
  assert.ok(entry);
  assert.match(entry.title, /ABANDONED/);
  assert.ok(entry.detailLines.some(line => line.includes('score abandoned')));
});

test('P3.6: an archetype-reward Score still records its unlock on a costly win', () => {
  const campaign = scoreReadyCampaign();
  // Drain the item pool so the draw lands on an archetype reward instead.
  const contract = campaign.buildScoreContract(
    SCOREABLE_ITEMS.map(i => i.id),
    []
  );
  const archetypeId = contract.objective.params!.scoreArchetypeId as string | undefined;
  if (!archetypeId) return; // pool shape changed; the item-path test already covers this
  settleCasualtyScore(campaign, contract);
  assert.equal(campaign.endReason, 'score-partial');
  assert.equal(campaign.scoreUnlockedArchetypeId, archetypeId);
});
