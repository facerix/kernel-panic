import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Berserk } from '../../../src/game/archetypes/Berserk.js';
import { Entity } from '../../../src/game/Entity.js';
import {
  AP_COST,
  CRASH_AP_PENALTY,
  CRASH_DURATION,
  CRASH_HIT_PENALTY,
  STATUS_EFFECT,
  SURGE_AP_BONUS,
  SURGE_ARMOR_BONUS,
  SURGE_DAMAGE_BONUS,
} from '../../../src/game/constants.js';

function makeBerserk() {
  return new Berserk({ id: 'berserk', x: 2, y: 2, maxAp: 4 });
}

test('Berserk inherits Entity, uses baseline stats, and starts without effects', () => {
  const berserk = makeBerserk();
  assert.ok(berserk instanceof Entity);
  assert.equal(berserk.baseHitChance, 0.78);
  assert.equal(berserk.baseDodgeChance, 0.36);
  assert.equal(berserk.hasEffect(STATUS_EFFECT.SURGE), false);
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), false);
});

test('Berserk.surge debits AP once and arms SURGE', () => {
  const berserk = makeBerserk();
  const apBefore = berserk.ap;
  berserk.surge();
  assert.equal(berserk.ap, apBefore - AP_COST.SURGE);
  assert.equal(berserk.hasEffect(STATUS_EFFECT.SURGE), true);
});

test('Berserk.canSurge rejects dead, low-AP, already-surging, and crashing states', () => {
  const dead = makeBerserk();
  dead.damage(dead.maxHp);
  assert.equal(dead.canSurge().reason, 'dead');

  const poor = makeBerserk();
  poor.ap = AP_COST.SURGE - 1;
  assert.equal(poor.canSurge().reason, 'insufficient-ap');

  const active = makeBerserk();
  active.surge();
  assert.equal(active.canSurge().reason, 'already-surging');

  active.refreshAp();
  active.refreshAp();
  assert.equal(active.hasEffect(STATUS_EFFECT.CRASH), true);
  assert.equal(active.canSurge().reason, 'crashing');
});

test('SURGE adds ranged and melee damage without hiding gear damage', () => {
  const berserk = makeBerserk();
  const rangedBefore = berserk.rangedAttackDamage();
  const meleeBefore = berserk.meleeAttackDamage();
  berserk.surge();
  assert.equal(berserk.rangedAttackDamage(), rangedBefore + SURGE_DAMAGE_BONUS);
  assert.equal(berserk.meleeAttackDamage(), meleeBefore + SURGE_DAMAGE_BONUS);
});

test('SURGE grants bonus AP on an active refresh', () => {
  const berserk = makeBerserk();
  berserk.surge();
  berserk.refreshAp();
  assert.equal(berserk.ap, berserk.maxAp + SURGE_AP_BONUS);
  assert.equal(berserk.hasEffect(STATUS_EFFECT.SURGE), true);
});

test('STUN keeps a surging Berserk at 0 AP instead of leaking the Surge bonus', () => {
  const berserk = makeBerserk();
  berserk.surge();
  berserk.applyEffect(STATUS_EFFECT.STUN, 1);
  berserk.refreshAp();
  assert.equal(berserk.ap, 0);
  assert.equal(berserk.hasEffect(STATUS_EFFECT.SURGE), true);
});

test('SURGE grants bonus combat armor for its whole duration and drops it on expiry', () => {
  const berserk = makeBerserk();
  const baseArmor = berserk.damageReduction;
  berserk.surge();
  // The stored base is never touched — only the computed combat value spikes.
  assert.equal(berserk.damageReduction, baseArmor, 'stored base armor unchanged by surge');
  assert.equal(
    berserk.effectiveDamageReduction,
    baseArmor + SURGE_ARMOR_BONUS,
    'combat armor spikes on surge'
  );

  // Armor holds while SURGE is active (i.e. through the enemy turn where it matters).
  berserk.refreshAp();
  assert.equal(berserk.hasEffect(STATUS_EFFECT.SURGE), true);
  assert.equal(
    berserk.effectiveDamageReduction,
    baseArmor + SURGE_ARMOR_BONUS,
    'armor holds mid-surge'
  );

  // SURGE expiry into CRASH drops the armor back to base — Crash grants no armor.
  berserk.refreshAp();
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), true);
  assert.equal(
    berserk.effectiveDamageReduction,
    baseArmor,
    'combat armor returns to base after surge'
  );
});

test('SURGE armor stacks on top of gear/base armor without mutating the stored base', () => {
  const berserk = new Berserk({ id: 'berserk', x: 2, y: 2, maxAp: 4, damageReduction: 2 });
  assert.equal(berserk.effectiveDamageReduction, 2, 'no buff before surge');
  berserk.surge();
  assert.equal(berserk.damageReduction, 2, 'stored base armor never mutated');
  assert.equal(berserk.effectiveDamageReduction, 2 + SURGE_ARMOR_BONUS);
  berserk.refreshAp();
  berserk.refreshAp();
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), true);
  assert.equal(
    berserk.effectiveDamageReduction,
    2,
    'combat armor back to base after the surge buff clears'
  );
});

test('SURGE expiry automatically applies CRASH and its AP/accuracy penalties', () => {
  const berserk = makeBerserk();
  const baseHitChance = berserk.baseHitChance;
  berserk.surge();
  berserk.refreshAp();
  berserk.refreshAp();

  assert.equal(berserk.hasEffect(STATUS_EFFECT.SURGE), false);
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), true);
  assert.equal(berserk.ap, berserk.maxAp - CRASH_AP_PENALTY);
  assert.equal(berserk.baseHitChance, baseHitChance - CRASH_HIT_PENALTY);
});

test('CRASH penalty persists for its full duration and restores hit chance exactly once', () => {
  const berserk = makeBerserk();
  const baseHitChance = berserk.baseHitChance;
  berserk.surge();
  // Two refreshes drive SURGE (duration 2) to expiry and arm CRASH.
  berserk.refreshAp();
  berserk.refreshAp();
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), true, 'crash armed on surge expiry');

  // CRASH is active for CRASH_DURATION player turns, penalising AP and accuracy
  // the whole way; each refresh here advances one crash turn.
  for (let turn = 0; turn < CRASH_DURATION; turn++) {
    assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), true, `crash active on turn ${turn}`);
    assert.equal(berserk.baseHitChance, baseHitChance - CRASH_HIT_PENALTY);
    assert.equal(berserk.ap, berserk.maxAp - CRASH_AP_PENALTY);
    berserk.refreshAp();
  }

  // The refresh after the last crash turn clears it exactly once.
  assert.equal(berserk.hasEffect(STATUS_EFFECT.CRASH), false, 'crash cleared after its duration');
  assert.equal(berserk.baseHitChance, baseHitChance);
  assert.equal(berserk.ap, berserk.maxAp);

  berserk.refreshAp();
  assert.equal(
    berserk.baseHitChance,
    baseHitChance,
    'later refreshes do not over-restore accuracy'
  );
});
