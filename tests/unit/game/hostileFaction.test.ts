import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Skirmisher } from '../../../src/game/ai/Skirmisher.js';
import { Guard } from '../../../src/game/ai/Guard.js';
import { Bruiser } from '../../../src/game/ai/Bruiser.js';
import { Juggernaut } from '../../../src/game/ai/Juggernaut.js';
import { Flanker } from '../../../src/game/ai/Flanker.js';
import { Lookout } from '../../../src/game/ai/Lookout.js';
import { Sniper } from '../../../src/game/ai/Sniper.js';
import { Medic } from '../../../src/game/ai/Medic.js';
import { PatrolHostile } from '../../../src/game/ai/PatrolHostile.js';
import { CorpCivilian } from '../../../src/game/entities/CorpCivilian.js';
import { CorpTurret } from '../../../src/game/entities/CorpTurret.js';
import { DenyTarget } from '../../../src/game/entities/DenyTarget.js';
import { RelayNode } from '../../../src/game/entities/RelayNode.js';
import { FACTION, type FactionId } from '../../../src/game/constants.js';

type Factory = (faction?: FactionId) => PatrolHostile;

const FACTORIES: ReadonlyArray<readonly [string, Factory]> = [
  ['Skirmisher', f => new Skirmisher({ id: 'drone-0', x: 1, y: 1, faction: f })],
  ['Guard', f => new Guard({ id: 'guard-0', x: 1, y: 1, faction: f })],
  ['Bruiser', f => new Bruiser({ id: 'bruiser-0', x: 1, y: 1, faction: f })],
  ['Juggernaut', f => new Juggernaut({ id: 'juggernaut-0', x: 1, y: 1, faction: f })],
  ['Flanker', f => new Flanker({ id: 'flanker-0', x: 1, y: 1, faction: f })],
  ['Lookout', f => new Lookout({ id: 'lookout-0', x: 1, y: 1, faction: f })],
  ['Sniper', f => new Sniper({ id: 'sniper-0', x: 1, y: 1, faction: f })],
  ['Medic', f => new Medic({ id: 'medic-0', x: 1, y: 1, faction: f })],
];

test('every patrol hostile defaults to FACTION.CORP when no faction is given', () => {
  for (const [name, make] of FACTORIES) {
    assert.equal(make().faction, FACTION.CORP, `${name} should default to CORP`);
  }
});

test('every patrol hostile honors an explicit FACTION.RIVAL allegiance', () => {
  for (const [name, make] of FACTORIES) {
    assert.equal(make(FACTION.RIVAL).faction, FACTION.RIVAL, `${name} should accept RIVAL`);
  }
});

test('the CORP default lives in one place (PatrolHostile), not per subclass', () => {
  // A direct subclass with no faction still defaults — proves the base owns it.
  const drone = new Skirmisher({ id: 'drone-1', x: 0, y: 0 });
  assert.equal(drone.faction, FACTION.CORP);
});

type EstablishmentFactory = (faction?: FactionId) => { faction: FactionId };

const ESTABLISHMENT_FACTORIES: ReadonlyArray<readonly [string, EstablishmentFactory]> = [
  ['CorpCivilian', f => new CorpCivilian({ id: 'civ-0', x: 0, y: 0, faction: f })],
  ['CorpTurret', f => new CorpTurret({ id: 'turret-0', x: 0, y: 0, faction: f })],
  ['RelayNode', f => new RelayNode({ id: 'relay-0', x: 0, y: 0, faction: f })],
  ['DenyTarget', f => new DenyTarget({ id: 'deny-0', x: 0, y: 0, faction: f })],
];

test('establishment entities default to FACTION.CORP when no faction is given', () => {
  for (const [name, make] of ESTABLISHMENT_FACTORIES) {
    assert.equal(make().faction, FACTION.CORP, `${name} should default to CORP`);
  }
});

test('establishment entities honor an explicit FACTION.RIVAL allegiance', () => {
  for (const [name, make] of ESTABLISHMENT_FACTORIES) {
    assert.equal(make(FACTION.RIVAL).faction, FACTION.RIVAL, `${name} should accept RIVAL`);
  }
});
