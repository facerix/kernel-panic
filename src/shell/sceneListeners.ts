import { REP } from '../game/constants.js';
import { EVENT, alarmPayloadTriggersRepPenalty } from '../game/events.js';
import { resolveEntityLabel } from '../game/Entity.js';
import {
  ANIMATION_DURATIONS,
  runBurnFlash,
  runMuzzleFlash,
  triggerCrashFlash,
  triggerDamageFlash,
  triggerEmpFlash,
  triggerHealFlash,
  triggerMitigationFlash,
  triggerShake,
  triggerSurgeFlash,
} from '../render/animations.js';
import { COMBAT_HUD_COLORS } from '../render/combatHud.js';
import { CLOAK_FLASH_FG, MIND_INFLUENCE_FG, VAULT_IMPACT_FG } from '../render/palette.js';
import { cyberLayerOf, isCyberView } from './activeView.js';
import { isRun } from './sceneView.js';
import type {
  DoorUnlockPayload,
  EntityDamagedPayload,
  HazardDamagePayload,
  MindInfluencedPayload,
  NoisePayload,
  RazorCloakedPayload,
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
        if ((source === 'melee' || source === 'vault') && target && damage > 0) {
          const flashRenderer = meatInPip ? renderers.pip : renderers.main;
          const repaint = meatInPip ? effects.paintPip : effects.paint;
          // Vault's body-check gets its own gold "kinetic slam" burst instead
          // of the yellow gunfire-shaped muzzle flash — same tile, different
          // beat (P3.5.M5).
          const fired =
            source === 'vault'
              ? runMuzzleFlash(flashRenderer, repaint, target.x, target.y, {
                  duration: ANIMATION_DURATIONS.VAULT_IMPACT_FLASH,
                  char: '!',
                  color: VAULT_IMPACT_FG,
                })
              : runMuzzleFlash(flashRenderer, repaint, target.x, target.y);
          if (fired) {
            animLock.push(
              source === 'vault'
                ? ANIMATION_DURATIONS.VAULT_IMPACT_FLASH
                : ANIMATION_DURATIONS.MUZZLE_FLASH
            );
          }
        }
        // A molotov's ignition tick (P3.6). The per-round standing tick is the
        // HAZARD_DAMAGE listener below; both are contact with fire, so they
        // share one ember burst. Deliberately not folded into the branch above
        // — that one is keyed on `damage > 0`, and a body whose shield eats the
        // whole ignition is still visibly on fire.
        if (source === 'incendiary' && target) {
          const flashRenderer = meatInPip ? renderers.pip : renderers.main;
          const repaint = meatInPip ? effects.paintPip : effects.paint;
          const fired = runBurnFlash(flashRenderer, repaint, target.x, target.y, target.glyph);
          if (fired) animLock.push(ANIMATION_DURATIONS.BURN_FLASH);
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
      run.bus.on(EVENT.HAZARD_DAMAGE, payload => {
        // Ember burst on each body taking a standing tick in fire (P3.6). The
        // event has carried x/y since hazards shipped but nothing listened, so
        // burning was invisible unless it was happening to *you* (the
        // ENTITY_DAMAGED handler's shake/vignette). Now every body that burns
        // says so, on its own tile.
        //
        // Fires once per burning entity per round, so several can land in one
        // aftermath. animLock takes the longest outstanding window rather than
        // summing, so a crowded fire doesn't stack into a long input freeze.
        const { entity } = (payload ?? {}) as HazardDamagePayload;
        if (!entity) return;
        const meatInPip = isCyberView(run);
        const flashRenderer = meatInPip ? renderers.pip : renderers.main;
        const repaint = meatInPip ? effects.paintPip : effects.paint;
        const fired = runBurnFlash(flashRenderer, repaint, entity.x, entity.y, entity.glyph);
        if (fired) animLock.push(ANIMATION_DURATIONS.BURN_FLASH);
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
      }),
      run.bus.on(EVENT.BERSERK_SURGED, () => {
        // Blaze-orange spike as Surge arms — a beat of feedback beyond the HUD
        // status tag. Meatspace-only perk, so the shared stage flash suffices.
        triggerSurgeFlash(dom.stageEl);
        animLock.push(ANIMATION_DURATIONS.SURGE_FLASH);
      }),
      run.bus.on(EVENT.BERSERK_CRASHED, () => {
        // Ashen comedown pulse the instant Surge expires into Crash.
        triggerCrashFlash(dom.stageEl);
        animLock.push(ANIMATION_DURATIONS.CRASH_FLASH);
      }),
      run.bus.on(EVENT.NANITE_HEALED, () => {
        // Green heal pulse as a Chimera converts scrap into HP. Meatspace-only
        // perk, so the shared stage flash suffices (same shape as Surge/Crash).
        // Shared with the STIM consumable's direct trigger in shellRuntime.
        triggerHealFlash(dom.stageEl);
        animLock.push(ANIMATION_DURATIONS.HEAL_FLASH);
      }),
      run.bus.on(EVENT.MIND_INFLUENCED, payload => {
        // Violet burst on the dominated (or resisting) hostile's own tile —
        // the Adept's Influence. Fires on both outcomes; log copy carries the
        // success/fail nuance (P3.5.M5). CyberAvatar's Override wires the
        // same event on the cyber bus below.
        const { target } = (payload ?? {}) as MindInfluencedPayload;
        if (!target) return;
        const meatInPip = isCyberView(run);
        const flashRenderer = meatInPip ? renderers.pip : renderers.main;
        const repaint = meatInPip ? effects.paintPip : effects.paint;
        const fired = runMuzzleFlash(flashRenderer, repaint, target.x, target.y, {
          duration: ANIMATION_DURATIONS.MIND_INFLUENCE_FLASH,
          char: target.glyph,
          color: MIND_INFLUENCE_FG,
        });
        if (fired) animLock.push(ANIMATION_DURATIONS.MIND_INFLUENCE_FLASH);
      }),
      run.bus.on(EVENT.RAZOR_CLOAKED, payload => {
        // Pale mint burst on the Razor's own landing tile as Slide engages
        // the cloak — subtler and self-centered, not a screen-wide wash
        // (P3.5.M5). Meatspace-only perk.
        const { actor } = (payload ?? {}) as RazorCloakedPayload;
        if (!actor) return;
        const meatInPip = isCyberView(run);
        const flashRenderer = meatInPip ? renderers.pip : renderers.main;
        const repaint = meatInPip ? effects.paintPip : effects.paint;
        const fired = runMuzzleFlash(flashRenderer, repaint, actor.x, actor.y, {
          duration: ANIMATION_DURATIONS.CLOAK_FLASH,
          char: actor.glyph,
          color: CLOAK_FLASH_FG,
        });
        if (fired) animLock.push(ANIMATION_DURATIONS.CLOAK_FLASH);
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
      }),
      layer.bus.on(EVENT.MIND_INFLUENCED, payload => {
        // Same violet burst as the Adept's Influence (above), on the cyber
        // grid for the CyberAvatar's Override — same underlying roll, same
        // fires-on-both-outcomes shape (P3.5.M5).
        const { target } = (payload ?? {}) as MindInfluencedPayload;
        if (!target) return;
        const cyberInPip = !isCyberView(run);
        const flashRenderer = cyberInPip ? renderers.pip : renderers.main;
        const repaint = cyberInPip ? effects.paintPip : effects.paint;
        const fired = runMuzzleFlash(flashRenderer, repaint, target.x, target.y, {
          duration: ANIMATION_DURATIONS.MIND_INFLUENCE_FLASH,
          char: target.glyph,
          color: MIND_INFLUENCE_FG,
        });
        if (fired) animLock.push(ANIMATION_DURATIONS.MIND_INFLUENCE_FLASH);
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
