import { REP } from '../game/constants.js';
import { EVENT, alarmPayloadTriggersRepPenalty } from '../game/events.js';
import { resolveEntityLabel } from '../game/Entity.js';
import {
  ANIMATION_DURATIONS,
  runMuzzleFlash,
  triggerDamageFlash,
  triggerEmpFlash,
  triggerMitigationFlash,
  triggerShake,
} from '../render/animations.js';
import { COMBAT_HUD_COLORS } from '../render/combatHud.js';
import { cyberLayerOf, isCyberView } from './activeView.js';
import { isRun } from './sceneView.js';
import type {
  DoorUnlockPayload,
  EntityDamagedPayload,
  NoisePayload,
  SceneListenerDeps,
} from './domTypes.js';

/**
 * Owns run-bus and cyber-bus listener subscriptions for the game shell.
 * Call `rewire()` on every scene transition and after resume.
 */
export class SceneListenerController {
  #deps: SceneListenerDeps;
  #visionMoveUnsub: (() => void) | null = null;
  #animationUnsubs: (() => void)[] = [];
  #cyberUnsubs: (() => void)[] = [];
  #repUnsubs: (() => void)[] = [];

  constructor(deps: SceneListenerDeps) {
    this.#deps = deps;
  }

  rewire(): void {
    this.#attachVisionListener();
    this.#attachAnimationListeners();
    this.#attachRepListeners();
    this.#attachCyberListeners();
  }

  detachCyber(): void {
    for (const off of this.#cyberUnsubs) off();
    this.#cyberUnsubs = [];
  }

  #attachVisionListener(): void {
    if (this.#visionMoveUnsub) {
      this.#visionMoveUnsub();
      this.#visionMoveUnsub = null;
    }
    const run = this.#deps.getScene();
    if (!run?.bus) return;
    this.#visionMoveUnsub = run.bus.on(EVENT.ENTITY_MOVED, () =>
      this.#deps.effects.recomputeVision()
    );
  }

  #attachAnimationListeners(): void {
    for (const off of this.#animationUnsubs) off();
    this.#animationUnsubs = [];
    const run = this.#deps.getScene();
    if (!run?.bus) return;
    const { dom, renderers, animLock, effects } = this.#deps;
    const meatVision = this.#deps.getMeatVision();

    this.#animationUnsubs.push(
      run.bus.on(EVENT.ENTITY_DAMAGED, payload => {
        const {
          attacker,
          target,
          damage = 0,
          damageResolution,
          killed,
          source,
        } = (payload ?? {}) as EntityDamagedPayload;
        const hpDamage = damageResolution?.hpDamage ?? damage;
        const armorAbsorbed = damageResolution?.armorAbsorbed ?? 0;
        const shieldAbsorbed = damageResolution?.shieldAbsorbed ?? 0;
        // P3.M4.5: the meat layer is in the PIP only while the player is
        // *viewing* Cyberspace; once flipped back to meat it is the main canvas.
        const meatInPip = isCyberView(run);
        const bodyHit = isRun(run) && !!run.player && target === run.player;
        const forcedBodyJackOut =
          bodyHit && killed === true && !!target?.alive && run.cyberspace?.phase === 'resolved';
        const bodyImpact = bodyHit && (hpDamage > 0 || armorAbsorbed > 0 || shieldAbsorbed > 0);
        if (bodyImpact) {
          triggerShake(dom.stageEl);
          if (hpDamage > 0) {
            triggerDamageFlash(dom.stageEl);
            animLock.push(ANIMATION_DURATIONS.DAMAGE_FLASH);
          } else {
            triggerMitigationFlash(dom.stageEl, shieldAbsorbed > 0 ? 'shield' : 'armor');
            animLock.push(ANIMATION_DURATIONS.MITIGATION_FLASH);
          }
          if (meatInPip) {
            const attackerLabel = attacker
              ? resolveEntityLabel(attacker.id, run.world!.entities)
              : 'unknown';
            effects.flash(
              killed
                ? `BODY CRITICAL — ${attackerLabel} forced an emergency jack-out.`
                : hpDamage > 0
                  ? `BODY HIT — ${attackerLabel} struck for ${hpDamage} (meatspace).`
                  : `BODY BLOCKED — ${attackerLabel}'s hit stopped by ${
                      shieldAbsorbed > 0 ? 'shield' : 'armor'
                    } (meatspace).`
            );
            const impactColor =
              hpDamage > 0
                ? ''
                : `${
                    shieldAbsorbed > 0 ? COMBAT_HUD_COLORS.SHIELD_CHARGED : COMBAT_HUD_COLORS.ARMOR
                  }8c`;
            if (impactColor) {
              dom.pipCanvas.style.setProperty('--kp-pip-impact-color', impactColor);
            } else {
              dom.pipCanvas.style.removeProperty('--kp-pip-impact-color');
            }
            dom.pipCanvas.classList.remove('pip-hit');
            void dom.pipCanvas.offsetWidth;
            dom.pipCanvas.classList.add('pip-hit');
            effects.paintPip();
          }
        }
        if (source === 'melee' && target && damage > 0) {
          const flashRenderer = meatInPip ? renderers.pip : renderers.main;
          const repaint = meatInPip ? effects.paintPip : effects.paint;
          const fired = runMuzzleFlash(flashRenderer, repaint, target.x, target.y);
          if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
        }
        if (killed && target && !forcedBodyJackOut) {
          this.#deps.memoriseMeatCorpse(target, (x, y) => meatVision.isVisible(x, y));
        }
      }),
      run.bus.on(EVENT.NOISE, payload => {
        const noise = (payload ?? {}) as NoisePayload;
        if (noise.kind !== 'ranged') return;
        const origin = noise.origin;
        if (!origin) return;
        const meatInPip = isCyberView(run);
        const flashRenderer = meatInPip ? renderers.pip : renderers.main;
        const repaint = meatInPip ? effects.paintPip : effects.paint;
        const fired = runMuzzleFlash(flashRenderer, repaint, origin.x, origin.y);
        if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
      }),
      run.bus.on(EVENT.DOOR_UNLOCKED, payload => {
        const { label = 'Door' } = (payload ?? {}) as DoorUnlockPayload;
        effects.flash(`${label} unlocked — passage open.`);
      }),
      run.bus.on(EVENT.EMP_DETONATED, () => {
        // Cyan discharge pulse on the shared stage. EMP is a Meatspace-only
        // perk; the flash reads whether or not the meat view is in the PIP.
        triggerEmpFlash(dom.stageEl);
        animLock.push(ANIMATION_DURATIONS.EMP_FLASH);
      })
    );
  }

  #attachCyberListeners(): void {
    for (const off of this.#cyberUnsubs) off();
    this.#cyberUnsubs = [];
    const run = this.#deps.getScene();
    const layer = cyberLayerOf(run);
    if (!run || !layer) return;

    const cyberVision = this.#deps.resetCyberVision();
    cyberVision.restoreSeen(layer.mapSeenKeys());
    const { dom, renderers, animLock, effects } = this.#deps;

    this.#cyberUnsubs.push(
      layer.bus.on(EVENT.ENTITY_MOVED, () => effects.recomputeVision()),
      layer.bus.on(EVENT.ENTITY_DAMAGED, payload => {
        const { target, damage = 0, killed, source } = (payload ?? {}) as EntityDamagedPayload;
        // P3.M4.5: the cyber grid is in the PIP while the player is viewing meat.
        const cyberInPip = !isCyberView(run);
        const flashRenderer = cyberInPip ? renderers.pip : renderers.main;
        const repaint = cyberInPip ? effects.paintPip : effects.paint;
        if (target === layer.avatar && damage > 0) {
          triggerShake(dom.stageEl);
          triggerDamageFlash(dom.stageEl);
          animLock.push(ANIMATION_DURATIONS.DAMAGE_FLASH);
          if (cyberInPip) {
            effects.flash(
              killed
                ? 'RAM WIPED — ICE flatlined your avatar on the grid.'
                : `RAM HIT — ICE burned ${damage} (cyberspace).`
            );
            dom.pipCanvas.classList.remove('pip-hit');
            void dom.pipCanvas.offsetWidth;
            dom.pipCanvas.classList.add('pip-hit');
            effects.paintPip();
          }
        }
        if (source === 'melee' && target && damage > 0) {
          const fired = runMuzzleFlash(flashRenderer, repaint, target.x, target.y);
          if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
        }
        if (killed && target) {
          this.#deps.memoriseCyberCorpse(target, (x, y) => cyberVision.isVisible(x, y));
        }
      }),
      layer.bus.on(EVENT.NOISE, payload => {
        const noise = (payload ?? {}) as NoisePayload;
        if (noise.kind !== 'ranged') return;
        const origin = noise.origin;
        if (!origin) return;
        const cyberInPip = !isCyberView(run);
        const flashRenderer = cyberInPip ? renderers.pip : renderers.main;
        const repaint = cyberInPip ? effects.paintPip : effects.paint;
        const fired = runMuzzleFlash(flashRenderer, repaint, origin.x, origin.y);
        if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
      })
    );
  }

  #attachRepListeners(): void {
    for (const off of this.#repUnsubs) off();
    this.#repUnsubs = [];
    this.#deps.onCivilianHarmReset();
    const run = this.#deps.getScene();
    const campaign = this.#deps.getCampaign();
    if (!run?.bus || !campaign) return;

    this.#repUnsubs.push(
      run.bus.on(EVENT.CIVILIAN_HARMED, payload => {
        const { killed } = (payload ?? {}) as { killed?: boolean };
        this.#deps.onCivilianHarmed(!!killed);
        if (killed) {
          const actual = campaign.adjustRep(REP.CIVILIAN_KILL_PENALTY);
          this.#deps.onRepAdjust(actual, 'civilian killed.');
        }
      }),
      run.bus.on(EVENT.ALARM, payload => {
        if (!alarmPayloadTriggersRepPenalty(payload)) return;
        const actual = campaign.adjustRep(REP.ALARM_PENALTY);
        this.#deps.onRepAdjust(actual, 'facility alarm triggered.');
      }),
      run.bus.on(EVENT.ALARM_CHANGED, payload => {
        const transition = (payload as { transition?: string } | undefined)?.transition;
        if (transition === 'cooldown') {
          this.#deps.effects.flash('ALERT: heat tapering — corp net entering cooldown.');
        } else if (transition === 'quiet') {
          this.#deps.effects.flash('ALERT: facility net quiet.');
        }
        if (transition) this.#deps.onAlarmTransition(transition);
      }),
      run.bus.on(EVENT.OBJECTIVE_TIMER_EXPIRED, payload => {
        const contract = (payload as { contract?: { objective?: { title?: string } } } | undefined)
          ?.contract;
        const title = contract?.objective?.title ?? 'objective';
        this.#deps.onObjectiveTimerExpired(title);
        this.#deps.effects.flash(`WINDOW CLOSED: ${title} can no longer be completed cleanly.`);
      })
    );
  }
}
