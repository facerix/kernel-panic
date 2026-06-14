import { REP } from '../game/constants.js';
import { EVENT, alarmPayloadTriggersRepPenalty } from '../game/events.js';
import { resolveEntityLabel } from '../game/Entity.js';
import {
  ANIMATION_DURATIONS,
  runMuzzleFlash,
  triggerDamageFlash,
  triggerShake,
} from '../render/animations.js';
import { cyberLayerOf, isJackedIn } from './activeView.js';
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
          killed,
          source,
        } = (payload ?? {}) as EntityDamagedPayload;
        const jacked = isJackedIn(run);
        if (run?.player && target === run.player && damage > 0) {
          triggerShake(dom.stageEl);
          triggerDamageFlash(dom.stageEl);
          animLock.push(ANIMATION_DURATIONS.DAMAGE_FLASH);
          if (jacked) {
            const attackerLabel = attacker
              ? resolveEntityLabel(attacker.id, run.world!.entities)
              : 'unknown';
            effects.flash(
              killed
                ? `BODY FLATLINED — ${attackerLabel} killed your meatspace link.`
                : `BODY HIT — ${attackerLabel} struck for ${damage} (meatspace).`
            );
            dom.pipCanvas.classList.remove('pip-hit');
            void dom.pipCanvas.offsetWidth;
            dom.pipCanvas.classList.add('pip-hit');
            effects.paintPip();
          }
        }
        if (source === 'melee' && target && damage > 0) {
          if (jacked && target === run.player) {
            const fired = runMuzzleFlash(renderers.pip, effects.paintPip, target.x, target.y);
            if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
          } else if (!jacked) {
            const fired = runMuzzleFlash(renderers.main, effects.paint, target.x, target.y);
            if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
          }
        }
        if (killed && target) {
          this.#deps.memoriseMeatCorpse(target, (x, y) => meatVision.isVisible(x, y));
        }
      }),
      run.bus.on(EVENT.NOISE, payload => {
        const noise = (payload ?? {}) as NoisePayload;
        if (noise.kind !== 'ranged') return;
        const origin = noise.origin;
        if (!origin) return;
        const jacked = isJackedIn(run);
        const flashRenderer = jacked ? renderers.pip : renderers.main;
        const repaint = jacked ? effects.paintPip : effects.paint;
        const fired = runMuzzleFlash(flashRenderer, repaint, origin.x, origin.y);
        if (fired) animLock.push(ANIMATION_DURATIONS.MUZZLE_FLASH);
      }),
      run.bus.on(EVENT.DOOR_UNLOCKED, payload => {
        const { label = 'Door' } = (payload ?? {}) as DoorUnlockPayload;
        effects.flash(`${label} unlocked — passage open.`);
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
        if (target === layer.avatar && damage > 0) {
          triggerShake(dom.stageEl);
          triggerDamageFlash(dom.stageEl);
          animLock.push(ANIMATION_DURATIONS.DAMAGE_FLASH);
        }
        if (source === 'melee' && target && damage > 0) {
          const fired = runMuzzleFlash(renderers.main, effects.paint, target.x, target.y);
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
        const fired = runMuzzleFlash(renderers.main, effects.paint, origin.x, origin.y);
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
