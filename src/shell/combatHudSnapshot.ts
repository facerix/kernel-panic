import { RUN_STATE } from '../game/Run.js';
import type { Run } from '../game/Run.js';
import type { CombatHudSummaryInput } from '../render/combatHud.js';
import { cyberLayerOf } from './activeView.js';
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
 * P3.M3.6: identity/HP/AP panes track whoever the player is being right now —
 * the crew body in Meatspace, the avatar (RAM pool) on the grid.
 */
export function combatHudBodyPanes(
  scene: Run
): Pick<CombatHudSummaryInput, 'identity' | 'hp' | 'ap'> {
  const layer = cyberLayerOf(scene);
  if (layer) {
    const avatar = layer.avatar;
    return {
      identity: {
        callsign: avatar.callsign,
        archetype: 'Avatar',
        stealthed: avatar.stealthed,
      },
      hp: { hp: avatar.hp, maxHp: avatar.maxHp, label: 'RAM' },
      ap: { ap: avatar.ap, maxAp: avatar.maxAp },
    };
  }
  const player = scene.player!;
  return {
    identity: {
      callsign: player.callsign,
      archetype: scene.archetype,
      stealthed: player.stealthed,
    },
    hp: { hp: player.hp, maxHp: player.maxHp },
    ap: { ap: player.ap, maxAp: player.maxAp },
  };
}
