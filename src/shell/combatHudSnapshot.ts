import { RUN_STATE } from '../game/Run.js';
import type { Run } from '../game/Run.js';
import type { CombatHudSummaryInput } from '../render/combatHud.js';
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
  };
}

/**
 * P3.M3.6/M4.3: identity/HP/AP panes track whoever the player is controlling
 * right now — the avatar (RAM pool) while flipped to the grid, otherwise the
 * active Meatspace crew (the partner after a dual jack-in, else the operator).
 */
export function combatHudBodyPanes(
  scene: Run
): Pick<CombatHudSummaryInput, 'identity' | 'hp' | 'ap'> {
  const actor = activeActorOf(scene);
  if (isCyberView(scene) && actor instanceof CyberAvatar) {
    return {
      identity: {
        callsign: actor.callsign,
        archetype: 'Avatar',
        stealthed: actor.stealthed,
      },
      hp: { hp: actor.hp, maxHp: actor.maxHp, label: 'RAM' },
      ap: { ap: actor.ap, maxAp: actor.maxAp },
    };
  }
  const crew = actor instanceof Crew ? actor : scene.player!;
  return {
    identity: {
      callsign: crew.callsign,
      // The active meat crew may be the partner — show its own archetype.
      archetype: crew === scene.player ? scene.archetype : crew.archetype,
      stealthed: crew.stealthed,
    },
    hp: { hp: crew.hp, maxHp: crew.maxHp },
    ap: { ap: crew.ap, maxAp: crew.maxAp },
  };
}
