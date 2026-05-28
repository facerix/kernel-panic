/**
 * M2.6: Handoff contact objectives.
 *
 * Tests cover Contact interaction, handoff objective satisfaction, run
 * placement, extraction gating, target/contact label selection, and snapshot
 * round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Run, RUN_STATE, OUTCOME, isObjectiveSatisfied } from '../../../src/game/Run.js';
import { Contact } from '../../../src/game/entities/Contact.js';
import { Merc } from '../../../src/game/archetypes/Merc.js';
import { Grid } from '../../../src/game/Grid.js';
import { World } from '../../../src/game/World.js';
import { EventBus } from '../../../src/game/events.js';
import { entityLabel } from '../../../src/game/Entity.js';
import { OBJECTIVES } from '../../../src/game/hub/Curator.js';
import { snapshot, restore } from '../../../src/game/persistence.js';
import { buildCrewMember } from '../../../src/game/archetypes/index.js';
import { AP_COST, CONTACT_GLYPH, FACTION, TILE } from '../../../src/game/constants.js';
import { Rng } from '../../../src/rng.js';
import { testContractContext } from './contractTestUtils.js';
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

function makeHandoffContract(overrides: Partial<Contract> = {}): Contract {
  return {
    seed: 42,
    objective: {
      kind: OBJECTIVES.HANDOFF,
      title: 'Make the handoff',
      briefing: 'Locate the Pier 9 contact, complete the transfer, then extract.',
      params: { contact: 'Pier 9 fence' },
    },
    difficulty: 'standard',
    threatCount: 1,
    label: 'Black market dropoff — Pier 9',
    context: testContractContext(OBJECTIVES.HANDOFF),
    reward: { credits: 50, repDelta: 5 },
    ...overrides,
  };
}

function relocateAdjacentTo(run: Run, entity: Contact): void {
  if (!run.world || !run.player) throw new Error('run must be in combat');
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

function contactsIn(run: Run): Contact[] {
  if (!run.world) throw new Error('run must be in combat');
  return [...run.world.entities.values()].filter(
    (entity): entity is Contact => entity instanceof Contact
  );
}

describe('Contact', () => {
  it('constructs as a neutral interactable with the contact glyph', () => {
    const contact = new Contact({ id: 'contact-0', x: 5, y: 5, label: 'Pier 9 fence' });
    assert.equal(contact.faction, FACTION.NEUTRAL);
    assert.equal(contact.glyph, CONTACT_GLYPH);
    assert.equal(contact.label, 'Pier 9 fence');
    assert.equal(contact.handoffComplete, false);
    assert.equal(contact.secured, false);
    assert.equal(contact.armed, true);
  });

  it('completes once, spends AP once, and rejects repeat interaction', () => {
    const world = makeWorld();
    const player = new Merc({ id: 'crew-merc', x: 4, y: 5 });
    const contact = new Contact({ id: 'contact-0', x: 5, y: 5, label: 'Pier 9 fence' });
    world.addEntity(player);
    world.addEntity(contact);

    const beforeAp = player.ap;
    const first = contact.interact(world, player);
    const second = contact.interact(world, player);

    assert.equal(first.ok, true);
    assert.equal(contact.handoffComplete, true);
    assert.equal(contact.secured, true);
    assert.equal(contact.armed, false);
    assert.equal(player.ap, beforeAp - AP_COST.INTERACT);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'handoff-complete');
    assert.equal(player.ap, beforeAp - AP_COST.INTERACT);
  });

  it('has a player-facing entity label', () => {
    const contact = new Contact({ id: 'contact-0', x: 5, y: 5, label: 'Fence' });
    assert.equal(entityLabel(contact), '[Neutral]Contact');
  });
});

describe('handoff objective satisfaction', () => {
  it('requires a completed contact handoff', () => {
    const world = makeWorld();
    const contact = new Contact({ id: 'contact-0', x: 3, y: 3, label: 'Fence' });
    world.addEntity(contact);
    const contract = makeHandoffContract();

    assert.equal(isObjectiveSatisfied(contract, world), false);
    contact.handoffComplete = true;
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });

  it('respects params.count when multiple contacts are required', () => {
    const world = makeWorld();
    const contacts = [
      new Contact({ id: 'contact-0', x: 3, y: 3, label: 'Fence 1' }),
      new Contact({ id: 'contact-1', x: 4, y: 3, label: 'Fence 2' }),
      new Contact({ id: 'contact-2', x: 5, y: 3, label: 'Fence 3' }),
    ];
    for (const contact of contacts) world.addEntity(contact);
    const contract = makeHandoffContract({
      objective: {
        kind: OBJECTIVES.HANDOFF,
        title: 'Make two handoffs',
        briefing: 'Complete two handoffs.',
        params: { contact: 'relay courier', count: 2 },
      },
    });

    contacts[0]!.handoffComplete = true;
    assert.equal(isObjectiveSatisfied(contract, world), false);
    contacts[1]!.handoffComplete = true;
    assert.equal(isObjectiveSatisfied(contract, world), true);
  });
});

describe('handoff runs', () => {
  it('spawns a contact and allows abort or completion extraction', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeHandoffContract());
    run.enterCombat();

    const [contact] = contactsIn(run);
    assert.ok(contact, 'handoff combat map should include a contact');
    assert.equal(contact.glyph, CONTACT_GLYPH);
    assert.equal(contact.label, 'Pier 9 fence');
    assert.ok(run.exitTile, 'handoff run should have an exit tile');
    assert.ok(
      Math.max(Math.abs(contact.x - run.exitTile.x), Math.abs(contact.y - run.exitTile.y)) > 1,
      'contact should not spawn adjacent to extraction'
    );
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), false);

    // Reaching exit before handoff is an abort extraction.
    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile.x, y: run.exitTile.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT, 'abort extraction ends the run');
    const abortResult = results[0] as {
      outcome: string;
      telemetry: { objectiveComplete: boolean };
    };
    assert.equal(abortResult.outcome, OUTCOME.EXIT);
    assert.equal(
      abortResult.telemetry.objectiveComplete,
      false,
      'abort marks objective incomplete'
    );
  });

  it('extraction after handoff marks objective complete', () => {
    const results: unknown[] = [];
    const run = new Run({
      crewMember: makeCrew('razor'),
      seed: 42,
      onResult: result => results.push(result),
    });
    run.enterBriefing(makeHandoffContract());
    run.enterCombat();

    const [contact] = contactsIn(run);
    assert.ok(contact);
    relocateAdjacentTo(run, contact);
    const result = contact.interact(run.world!, run.player!);
    assert.equal(result.ok, true);
    assert.equal(isObjectiveSatisfied(run.contract!, run.world), true);

    run.bus!.emit('entity:moved', {
      entity: run.player,
      from: { x: run.player!.x, y: run.player!.y },
      to: { x: run.exitTile!.x, y: run.exitTile!.y },
    });
    assert.equal(run.state, RUN_STATE.RESULT);
    const completionResult = results[0] as {
      outcome: string;
      telemetry: { objectiveComplete: boolean };
    };
    assert.equal(completionResult.outcome, OUTCOME.EXIT);
    assert.equal(completionResult.telemetry.objectiveComplete, true);
  });

  it('falls back to target-derived contact labels when params.contact is absent', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 43 });
    run.enterBriefing(
      makeHandoffContract({
        label: 'Cryo convoy manifest',
        objective: {
          kind: OBJECTIVES.HANDOFF,
          title: 'Deliver manifest to journo',
          briefing: 'Find our indie journalist contact and hand off the convoy manifest.',
          params: { target: 'cryo-manifest' },
        },
      })
    );
    run.enterCombat();

    const [contact] = contactsIn(run);
    assert.ok(contact);
    assert.equal(contact.label, 'Cryo Manifest');
  });

  it('places count-many contacts for handoff contracts', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 44 });
    run.enterBriefing(
      makeHandoffContract({
        objective: {
          kind: OBJECTIVES.HANDOFF,
          title: 'Make two handoffs',
          briefing: 'Complete two handoffs.',
          params: { contact: 'relay courier', count: 2 },
        },
      })
    );
    run.enterCombat();

    const contacts = contactsIn(run);
    assert.equal(contacts.length, 2);
    assert.deepEqual(contacts.map(contact => contact.label).sort(), [
      'Relay courier 1',
      'Relay courier 2',
    ]);
  });

  it('snapshot/restore round-trips contact handoff state', () => {
    const run = new Run({ crewMember: makeCrew('razor'), seed: 45 });
    run.enterBriefing(makeHandoffContract());
    run.enterCombat();
    const [contact] = contactsIn(run);
    assert.ok(contact);

    relocateAdjacentTo(run, contact);
    contact.interact(run.world!, run.player!);

    const rec = snapshot(run);
    const contactRec = rec.entities.find(entity => entity.id === contact.id);
    assert.equal(contactRec?.archetype, 'contact');
    assert.equal(contactRec?.contact?.handoffComplete, true);
    assert.equal(contactRec?.contact?.armed, false);

    const { world: restoredWorld } = restore(rec);
    const restoredContact = [...restoredWorld.entities.values()].find(
      (entity): entity is Contact => entity instanceof Contact
    );
    assert.ok(restoredContact, 'expected restored contact');
    assert.equal(restoredContact.handoffComplete, true);
    assert.equal(restoredContact.secured, true);
    assert.equal(restoredContact.armed, false);
  });
});
