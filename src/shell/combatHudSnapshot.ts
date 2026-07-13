import { RUN_STATE } from '../game/Run.js';
import { STATUS_EFFECT, SURGE_AP_BONUS } from '../game/constants.js';
import type { Run } from '../game/Run.js';
import type { CombatHudDefenseInput, CombatHudSummaryInput } from '../render/combatHud.js';
import { CyberAvatar } from '../game/cyber/CyberAvatar.js';
import { Crew } from '../game/Crew.js';
import { activeActorOf, isCyberView } from './activeView.js';
import { isRun } from './sceneView.js';
import type { ShellScene } from './sceneView.js';

export function buildCombatHudSnapshot(scene: ShellScene | null): CombatHudSummaryInput | null {
  if (!scene || scene.state !== RUN_STATE.COMBAT) return null;
  if (!isRun(scene)) {
    throw new Error('[shell] combat HUD requires an active run');
  }
  if (!scene.player || !scene.queue) {
    throw new Error('[shell] combat HUD requires player and turn queue');
  }
  return {
    objective:
      scene.contract && scene.world
        ? {
            title: scene.contract.objective.title,
            done: scene.isObjectiveSatisfied(),
            turnsRemaining: scene.objectiveTurnsRemaining(),
            progress: scene.objectiveProgress(),
          }
        : null,
    ...combatHudBodyPanes(scene),
    turn: {
      currentFaction: scene.queue.currentFaction,
      turnNumber: scene.queue.turnNumber,
    },
    cyber: isCyberView(scene),
  };
}

/**
 * P3.M3.6/M4.3: identity/HP/AP panes track whoever the player is controlling
 * right now — the avatar (RAM pool) while flipped to the grid, otherwise the
 * active Meatspace crew (the partner after a dual jack-in, else the operator).
 */
export function combatHudBodyPanes(
  scene: Run
): Pick<CombatHudSummaryInput, 'identity' | 'hp' | 'defense' | 'ap'> {
  const actor = activeActorOf(scene);
  if (isCyberView(scene) && actor instanceof CyberAvatar) {
    return {
      identity: {
        callsign: actor.callsign,
        archetype: 'Avatar',
        stealthed: actor.stealthed,
        stunned: actor.hasEffect(STATUS_EFFECT.STUN),
        surging: actor.hasEffect(STATUS_EFFECT.SURGE),
        crashing: actor.hasEffect(STATUS_EFFECT.CRASH),
      },
      hp: { hp: actor.hp, maxHp: actor.maxHp, label: 'RAM' },
      ap: { ap: actor.ap, maxAp: actor.maxAp },
    };
  }
  const crew = actor instanceof Crew ? actor : scene.player!;
  const defense = crewDefense(crew);
  return {
    identity: {
      callsign: crew.callsign,
      // The active meat crew may be the partner — show its own archetype.
      archetype: crew === scene.player ? scene.archetype : crew.archetype,
      stealthed: crew.stealthed,
      stunned: crew.hasEffect(STATUS_EFFECT.STUN),
      surging: crew.hasEffect(STATUS_EFFECT.SURGE),
      crashing: crew.hasEffect(STATUS_EFFECT.CRASH),
    },
    hp: { hp: crew.hp, maxHp: crew.maxHp },
    ...(defense ? { defense } : {}),
    ap: {
      ap: crew.ap,
      maxAp: crew.maxAp + (crew.hasEffect(STATUS_EFFECT.SURGE) ? SURGE_AP_BONUS : 0),
    },
  };
}

function crewDefense(crew: Crew): CombatHudDefenseInput | undefined {
  const armor = crew.damageReduction;
  const shieldCapacity = crew.gear?.shieldRegen ?? 0;
  if (armor <= 0 && shieldCapacity <= 0) return undefined;
  return {
    ...(armor > 0 ? { armor } : {}),
    ...(shieldCapacity > 0 ? { shield: { current: crew.shieldHp, capacity: shieldCapacity } } : {}),
  };
}
