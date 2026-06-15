/**
 * P3.M4.2 — Jacked body anchor + partner spawn (Run-model layer).
 *
 * On a dual-deploy jack-in the Decker's Meatspace body freezes at the port
 * (immobile, still targetable) and the reserved partner spawns onto the meat
 * grid as the controllable operator — control stays in Meatspace until the
 * first flip (the flip command + shell wiring land in P3.M4.3). A solo Decker
 * jack-in (no partner) drops straight into Cyberspace as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Run } from '../../../../src/game/Run.js';
import { JackInPoint } from '../../../../src/game/entities/JackInPoint.js';
import { Decker } from '../../../../src/game/archetypes/Decker.js';
import { CyberAvatar } from '../../../../src/game/cyber/CyberAvatar.js';
import { FACTION } from '../../../../src/game/constants.js';
import { buildCrewMember } from '../../../../src/game/archetypes/index.js';
import { OBJECTIVES } from '../../../../src/game/hub/Curator.js';
import { Rng } from '../../../../src/rng.js';
import { snapshot, restore } from '../../../../src/game/persistence.js';
import { testContractContext } from '../contractTestUtils.js';
import type { World } from '../../../../src/game/World.js';
import type { Entity } from '../../../../src/game/Entity.js';

const cyberContract = (overrides = {}) => ({
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
  ...overrides,
});

const makeDecker = () => buildCrewMember('decker', { x: 0, y: 0 }, new Rng(100), { id: 'crew-decker' });
const makeMerc = () => buildCrewMember('merc', { x: 0, y: 0 }, new Rng(101), { id: 'crew-merc' });

function dualRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), partnerMember: makeMerc(), seed });
  run.enterBriefing(cyberContract({ seed }));
  run.enterCombat();
  return run;
}

function soloRun(seed = 12345) {
  const run = new Run({ crewMember: makeDecker(), seed });
  run.enterBriefing(cyberContract({ seed }));
  run.enterCombat();
  return run;
}

function jackInPoint(run: Run): JackInPoint {
  const point = [...run.world!.entities.values()].find(e => e instanceof JackInPoint);
  assert.ok(point, 'cyber contract placed a jack-in point');
  return point as JackInPoint;
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

/** Walk the Decker to the port and link — fires EVENT.JACK_IN → run.jackIn. */
function jackIn(run: Run) {
  const point = jackInPoint(run);
  const spot = adjacentFreeTile(run.world!, point);
  run.world!.relocateEntity(run.player!, spot.x, spot.y);
  run.player!.refreshAp();
  const result = point.interact(run.world!, run.player!);
  assert.equal(result.ok, true, `link failed: ${result.message}`);
  assert.equal(run.cyberspace?.phase, 'active');
}

// ---------------------------------------------------------------------------
// Dual-deploy jack-in
// ---------------------------------------------------------------------------

test('P3.M4.2: dual jack-in freezes the body and spawns the partner in Meatspace', () => {
  const run = dualRun();
  const body = run.player!;
  jackIn(run);

  // The Decker body is the frozen anchor.
  assert.equal(run.deckerBody, body);
  assert.equal(body.frozen, true);
  assert.ok(body instanceof Decker);

  // The partner is now a live meat-grid entity and the controllable operator.
  const partner = run.partnerMember!;
  assert.equal(run.meatActor, partner);
  assert.equal(run.world!.entities.get(partner.id), partner);
  assert.equal(partner.alive, true);
  assert.equal(partner.faction, FACTION.PLAYER);

  // Control stays in Meatspace until the first flip.
  assert.equal(run.activeLayer, 'meat');
  assert.equal(run.activeActor, partner);
  assert.equal(run.activeWorld, run.world);
});

test('P3.M4.2: the partner spawns on a valid, distinct, passable tile', () => {
  const run = dualRun();
  const body = run.player!;
  jackIn(run);
  const partner = run.partnerMember!;

  assert.ok(run.world!.grid.inBounds(partner.x, partner.y));
  assert.equal(run.world!.grid.isPassable(partner.x, partner.y), true);
  assert.ok(partner.x !== body.x || partner.y !== body.y, 'partner is not on the body tile');
  // Exactly one entity occupies the partner's tile — itself.
  assert.equal(run.world!.entityAt(partner.x, partner.y), partner);
});

test('P3.M4.2: partner spawn is deterministic for a given seed', () => {
  const a = dualRun(777);
  const b = dualRun(777);
  jackIn(a);
  jackIn(b);
  assert.deepEqual(
    { x: a.partnerMember!.x, y: a.partnerMember!.y },
    { x: b.partnerMember!.x, y: b.partnerMember!.y }
  );
});

test('P3.M4.2: the frozen body refuses movement but stays on its tile', () => {
  const run = dualRun();
  jackIn(run);
  const body = run.deckerBody!;
  const { x, y } = body;
  const check = run.world!.canMoveEntity(body, 1, 0);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'jacked-in');
  // It is still present and targetable on the grid.
  assert.equal(run.world!.entityAt(x, y), body);
});

// ---------------------------------------------------------------------------
// Solo jack-in (no partner) — unchanged from M3
// ---------------------------------------------------------------------------

test('P3.M4.2: solo jack-in drops control into Cyberspace with no partner', () => {
  const run = soloRun();
  const body = run.player!;
  jackIn(run);

  assert.equal(run.partnerMember, null);
  assert.equal(run.activeLayer, 'cyber');
  assert.equal(run.meatActor, body);
  assert.equal(body.frozen, true);
  assert.ok(run.activeActor instanceof CyberAvatar);
  assert.equal(run.deckerBody, body);
});

// ---------------------------------------------------------------------------
// Jack-out releases the body
// ---------------------------------------------------------------------------

test('P3.M4.2: jack-out unfreezes the body and returns meat control to the Decker', () => {
  const run = dualRun();
  const body = run.player!;
  jackIn(run);
  assert.equal(body.frozen, true);

  // No onJackOutRequested hook → an incomplete jack-out resolves immediately.
  run.jackOut();
  assert.equal(run.cyberspace?.phase, 'resolved');
  assert.equal(body.frozen, false);
  assert.equal(run.meatActor, body);
  assert.equal(run.activeLayer, 'meat');
});

// ---------------------------------------------------------------------------
// Persistence round-trips
// ---------------------------------------------------------------------------

test('P3.M4.2: a jacked dual run round-trips body + partner + flip state', () => {
  const run = dualRun();
  jackIn(run);
  const restored = restore(snapshot(run)).run;

  const body = restored.deckerBody!;
  assert.ok(body instanceof Decker);
  assert.equal(body.frozen, true);
  assert.equal(restored.activeLayer, 'meat');

  const partner = restored.partnerMember!;
  assert.ok(!(partner instanceof Decker));
  assert.equal(restored.meatActor, partner);
  assert.equal(restored.world!.entities.get(partner.id), partner);
  assert.equal(restored.activeActor, partner);
});

test('P3.M4.2: a run flipped into Cyberspace restores on the cyber side', () => {
  const run = dualRun();
  jackIn(run);
  // Simulate the M4.3 flip at the model level.
  run.activeLayer = 'cyber';
  const restored = restore(snapshot(run)).run;

  assert.equal(restored.activeLayer, 'cyber');
  assert.ok(restored.activeActor instanceof CyberAvatar);
  assert.equal(restored.deckerBody!.frozen, true);
});
