/**
 * Chimera archetype tests — Nanite Repair legality matrix and commit
 * semantics.
 *
 * The contract mirrors Tech's improvised-turret tests: `canConvertScrap` is a
 * pure legality check returning `{ ok, reason }`; `convertScrapToHp` commits
 * the spend (AP + scrap) on success and throws — without mutating state — on
 * any illegal precondition. No world/grid involvement: Nanite Repair is
 * self-targeted, so there's no tile to validate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Chimera } from '../../../src/game/archetypes/Chimera.js';
import { Crew } from '../../../src/game/Crew.js';
import {
  AP_COST,
  NANITE_HEAL_AMOUNT,
  SALVAGE_PER_NANITE_HEAL,
} from '../../../src/game/constants.js';
import { makeSalvage, totalSalvage } from '../../../src/game/salvage.js';

function makeChimera({ salvage = SALVAGE_PER_NANITE_HEAL } = {}) {
  const chimera = new Chimera({ id: 'chimera', x: 0, y: 0 });
  chimera.initInventory();
  chimera.inventory.salvage = makeSalvage({ scrap: salvage });
  return chimera;
}

test('Chimera inherits from Crew and uses its own baseline stats', () => {
  const chimera = makeChimera();
  assert.ok(chimera instanceof Crew, 'Chimera must extend Crew');
  assert.equal(chimera.baseHitChance, 0.75);
  assert.equal(chimera.baseDodgeChance, 0.25);
});

test('Chimera.canConvertScrap rejects when dead', () => {
  const chimera = makeChimera();
  chimera.damage(chimera.maxHp);
  assert.equal(chimera.canConvertScrap().reason, 'dead');
});

test('Chimera.canConvertScrap rejects when AP < NANITE_HEAL cost', () => {
  const chimera = makeChimera();
  chimera.spendAp(chimera.ap - (AP_COST.NANITE_HEAL - 1));
  assert.equal(chimera.canConvertScrap().reason, 'insufficient-ap');
});

test('Chimera.canConvertScrap rejects when inventory is not initialised', () => {
  const chimera = new Chimera({ id: 'chimera', x: 0, y: 0 }); // no initInventory()
  assert.equal(chimera.canConvertScrap().reason, 'no-inventory');
});

test('Chimera.canConvertScrap rejects when scrap < cost', () => {
  const chimera = makeChimera({ salvage: SALVAGE_PER_NANITE_HEAL - 1 });
  assert.equal(chimera.canConvertScrap().reason, 'insufficient-salvage');
});

test('Chimera.canConvertScrap accepts with sufficient AP and scrap', () => {
  const chimera = makeChimera();
  assert.equal(chimera.canConvertScrap().ok, true);
});

test('Chimera.convertScrapToHp debits AP + scrap and heals, clamped at maxHp', () => {
  const chimera = makeChimera({ salvage: 10 });
  chimera.damage(2);
  const apBefore = chimera.ap;
  const scrapBefore = chimera.inventory.salvage.scrap;
  const hpBefore = chimera.hp;
  const healed = chimera.convertScrapToHp();
  assert.equal(chimera.ap, apBefore - AP_COST.NANITE_HEAL, 'AP debited once');
  assert.equal(
    chimera.inventory.salvage.scrap,
    scrapBefore - SALVAGE_PER_NANITE_HEAL,
    'scrap deducted by nanite-heal cost'
  );
  assert.equal(healed, Math.min(NANITE_HEAL_AMOUNT, chimera.maxHp - hpBefore));
  assert.equal(chimera.hp, Math.min(chimera.maxHp, hpBefore + NANITE_HEAL_AMOUNT));
});

test('Chimera.convertScrapToHp clamps at maxHp and still spends the resources', () => {
  const chimera = makeChimera({ salvage: 10 });
  assert.equal(chimera.hp, chimera.maxHp, 'starts at full HP');
  const apBefore = chimera.ap;
  const scrapBefore = chimera.inventory.salvage.scrap;
  const healed = chimera.convertScrapToHp();
  assert.equal(healed, 0, 'no HP actually restored at full health');
  assert.equal(chimera.hp, chimera.maxHp);
  assert.equal(chimera.ap, apBefore - AP_COST.NANITE_HEAL, 'AP still spent');
  assert.equal(
    chimera.inventory.salvage.scrap,
    scrapBefore - SALVAGE_PER_NANITE_HEAL,
    'scrap still spent'
  );
});

test('Chimera.convertScrapToHp throws on illegal preconditions without mutating state', () => {
  const chimera = makeChimera({ salvage: 0 });
  const apBefore = chimera.ap;
  assert.throws(() => chimera.convertScrapToHp(), /Illegal nanite conversion/);
  assert.equal(chimera.ap, apBefore, 'AP not debited on illegal conversion');
  assert.equal(totalSalvage(chimera.inventory.salvage), 0, 'salvage wallet untouched');
});

test('Chimera.convertScrapToHp is repeatable across turns as long as scrap lasts', () => {
  const chimera = makeChimera({ salvage: SALVAGE_PER_NANITE_HEAL * 2 });
  chimera.damage(chimera.maxHp - 1); // leave 1 HP so repeated heals have room to matter
  chimera.convertScrapToHp();
  chimera.refreshAp();
  const secondHeal = chimera.convertScrapToHp();
  assert.ok(secondHeal >= 0);
  assert.equal(chimera.inventory.salvage.scrap, 0, 'both activations spent scrap');
  assert.equal(chimera.canConvertScrap().reason, 'insufficient-salvage', 'scrap now exhausted');
});
