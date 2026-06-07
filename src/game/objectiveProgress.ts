/**
 * Objective progress tallies for combat HUD objective chips.
 */

import { FACTION } from './constants.js';
import { Hostile } from './Hostile.js';
import { CorpTurret } from './entities/CorpTurret.js';
import { RelayNode } from './entities/RelayNode.js';
import { EscortNpc } from './entities/EscortNpc.js';
import { OBJECTIVES } from './hub/Curator.js';
import { coordKey, explorationReachableKeys } from './mapConnectivity.js';
import type { Contract } from './hub/Curator.js';
import type { Entity } from './Entity.js';
import type { World } from './World.js';

/** Fractional progress shown as `[LABEL:current/total]` on the objective chip. */
export type ObjectiveProgress = Readonly<{
  label: string;
  current: number;
  total: number;
}>;

export type ReconProgress = {
  mapped: number;
  required: number;
};

export type SweepProgress = {
  cleared: number;
  total: number;
};

export const SWEEP_QUOTA = Object.freeze({
  HOSTILE_ALL: 'hostile-all',
  /** @deprecated Legacy save alias for HOSTILE_ALL. New contracts emit hostile-all. */
  DRONE_ALL: 'drone-all',
  RELAY_NODE: 'relay-node',
  TURRET: 'turret',
});

export function sweepQuotaType(contract: Contract): string {
  const target = (contract.objective.params?.sweepTarget ?? contract.objective.params?.target) as
    | string
    | undefined;
  if (!target) return SWEEP_QUOTA.HOSTILE_ALL;
  if (target === 'hostile-all' || target === 'drone-all') return SWEEP_QUOTA.HOSTILE_ALL;
  if (target === 'relay-node' || target === 'skybridge-relay') return SWEEP_QUOTA.RELAY_NODE;
  if (target === 'turret' || target === 'corp-turret') return SWEEP_QUOTA.TURRET;
  return SWEEP_QUOTA.HOSTILE_ALL;
}

export function sweepObjectiveProgress(
  contract: Contract,
  world: World | null | undefined
): SweepProgress {
  if (!world) return { cleared: 0, total: 0 };
  const quota = sweepQuotaType(contract);
  switch (quota) {
    case SWEEP_QUOTA.HOSTILE_ALL:
    case SWEEP_QUOTA.DRONE_ALL: {
      let cleared = 0;
      let total = 0;
      for (const entity of world.entities.values()) {
        if (!(entity instanceof Hostile)) continue;
        total++;
        if (!entity.alive) cleared++;
      }
      return { cleared, total };
    }
    case SWEEP_QUOTA.RELAY_NODE: {
      let cleared = 0;
      let alive = 0;
      for (const entity of world.entities.values()) {
        if (!(entity instanceof RelayNode)) continue;
        if (entity.alive) alive++;
        else cleared++;
      }
      const countParam = contract.objective.params?.count;
      if (Number.isInteger(countParam) && Number(countParam) > 0) {
        return { cleared, total: Number(countParam) };
      }
      return { cleared, total: cleared + alive };
    }
    case SWEEP_QUOTA.TURRET: {
      let cleared = 0;
      let alive = 0;
      for (const entity of world.entities.values()) {
        if (!(entity instanceof CorpTurret)) continue;
        if (entity.alive) alive++;
        else cleared++;
      }
      const countParam = contract.objective.params?.count;
      if (Number.isInteger(countParam) && Number(countParam) > 0) {
        return { cleared, total: Number(countParam) };
      }
      return { cleared, total: cleared + alive };
    }
    default:
      return { cleared: 0, total: 0 };
  }
}

export function reconEligibleCellKeys(world: World | null | undefined): Set<string> {
  if (!world) return new Set();
  const player = playerInWorld(world);
  if (!player) return allPassableCellKeys(world);
  return explorationReachableKeys(
    world,
    { x: player.x, y: player.y },
    { reconEligibleArea: true }
  );
}

export function reconObjectiveProgress(
  world: World | null | undefined,
  seen: ReadonlySet<string> | readonly string[] = []
): ReconProgress {
  const eligible = reconEligibleCellKeys(world);
  const seenSet = asKeySet(seen);
  let mapped = 0;
  for (const key of eligible) {
    if (seenSet.has(key)) mapped++;
  }
  return { mapped, required: eligible.size };
}

/**
 * Progress tally for objectives that expose a fractional meter (recon, sweep).
 * Returns `null` when the contract kind has no meter or `total` is zero.
 */
export function objectiveProgress(
  contract: Contract,
  world: World | null | undefined,
  mapSeen: ReadonlySet<string> | readonly string[] = []
): ObjectiveProgress | null {
  switch (contract.objective.kind) {
    case OBJECTIVES.RECON: {
      const { mapped, required } = reconObjectiveProgress(world, mapSeen);
      if (required <= 0) return null;
      return { label: 'MAP', current: mapped, total: required };
    }
    case OBJECTIVES.SWEEP: {
      const { cleared, total } = sweepObjectiveProgress(contract, world);
      if (total <= 0) return null;
      return { label: 'SWEEP', current: cleared, total };
    }
    default:
      return null;
  }
}

function asKeySet(keys: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return keys instanceof Set ? keys : new Set(keys);
}

function playerInWorld(world: World): Entity | null {
  for (const entity of world.entities.values()) {
    if (entity instanceof EscortNpc) continue;
    if (entity.faction === FACTION.PLAYER && entity.alive) return entity;
  }
  return null;
}

function allPassableCellKeys(world: World): Set<string> {
  const keys = new Set<string>();
  for (let y = 0; y < world.grid.height; y++) {
    for (let x = 0; x < world.grid.width; x++) {
      if (world.grid.isPassable(x, y)) keys.add(coordKey(x, y));
    }
  }
  return keys;
}
