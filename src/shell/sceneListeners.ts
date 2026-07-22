import { REP } from '../game/constants.js';
import { EVENT, alarmPayloadTriggersRepPenalty } from '../game/events.js';
import { resolveEntityLabel } from '../game/Entity.js';
import { Hostile } from '../game/Hostile.js';
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
import { audioManager, musicDirector } from '../audio/soundBoard.js';
import { tensionForAlarmTransition } from './musicScore.js';
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
  #audioUnsubs: (() => void)[] = [];
  #cyberAudioUnsubs: (() => void)[] = [];
  #musicUnsubs: (() => void)[] = [];

  constructor(deps: SceneListenerDeps) {
    this.#deps = deps;
  }

  rewire(): void {
    this.#attachVisionListener();
    this.#attachAnimationListeners();
    this.#attachRepListeners();
    this.#attachAudioListeners();
    this.#attachMusicListeners();
    this.#attachCyberListeners();
    this.#attachCyberAudioListeners();
  }

  detachCyber(): void {
    for (const off of this.#cyberUnsubs) off();
    this.#cyberUnsubs = [];
    for (const off of this.#cyberAudioUnsubs) off();
    this.#cyberAudioUnsubs = [];
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

  /**
   * Bus-driven sound effects. Kept separate from rep/animation wiring so the
   * audio seam is easy to find and reason about. Subscribes on the run bus (same
   * instance as `world.events`), so both `World.raiseAlarm()` alarms and
   * `collectTileLoot` pickups reach here.
   */
  #attachAudioListeners(): void {
    for (const off of this.#audioUnsubs) off();
    this.#audioUnsubs = [];
    const run = this.#deps.getScene();
    if (!run?.bus) return;

    this.#audioUnsubs.push(
      // The facility alarm *raising* is the sting worth hearing — not the later
      // cooldown/quiet transitions, which are ambient state changes.
      run.bus.on(EVENT.ALARM_CHANGED, payload => {
        const transition = (payload as { transition?: string } | undefined)?.transition;
        if (transition === 'raised') audioManager.play('alarm');
      }),
      run.bus.on(EVENT.ITEM_COLLECTED, () => audioManager.play('pickUp')),
      run.bus.on(EVENT.ENTITY_DAMAGED, payload => {
        const { source, killed, dodged, target } = (payload ?? {}) as EntityDamagedPayload;
        // Any connected melee strike — either side's. A dodge whiffs (no blade),
        // and armor-absorbed still counts as a hit (blade on plate).
        if (source === 'melee' && !dodged) audioManager.play('slash');
        // A hostile going down, however it died. Civilians aren't Hostiles — a
        // civilian death is a somber beat, not a satisfying thud.
        if (killed && target instanceof Hostile) audioManager.play('down');
      }),
      run.bus.on(EVENT.NOISE, payload => {
        const { kind } = payload as NoisePayload;
        if (kind === 'ranged') {
          audioManager.play('rangedShot');
        } else if (kind === 'vault') {
          // Merc BREAK has no dedicated event — its always-emitted 'vault' noise
          // (fired whether or not it connects) is the reliable hook for the slam.
          audioManager.play('vault');
        }
      }),
      // --- Operator perk cues -------------------------------------------------
      // Each perk resolver emits a presentation-only hook; we sonify them here,
      // alongside the combat SFX above. Gameplay is already committed upstream.
      run.bus.on(EVENT.RAZOR_CLOAKED, () => audioManager.play('slide')),
      run.bus.on(EVENT.EMP_DETONATED, () => audioManager.play('emp')),
      run.bus.on(EVENT.BERSERK_SURGED, () => audioManager.play('surge')),
      // The Surge comedown, a few turns later — the deflating inverse of 'surge'.
      run.bus.on(EVENT.BERSERK_CRASHED, () => audioManager.play('surgeCrash')),
      run.bus.on(EVENT.NANITE_HEALED, () => audioManager.play('heal')),
      run.bus.on(EVENT.MIND_INFLUENCED, payload => {
        // Covers the Adept's Influence and the CyberAvatar's Override. The
        // success flag splits the lock-in from the resisted whiff.
        const { success } = (payload ?? {}) as MindInfluencedPayload;
        audioManager.play(success ? 'influence' : 'influenceResist');
      }),
      run.bus.on(EVENT.TURRET_DEPLOYED, () =>
        // Two beats: the mechanical clunk, then a boot chirp ~90ms later.
        audioManager.playChain([
          { name: 'deploy', when: 0 },
          { name: 'deployOnline', when: 0.09 },
        ])
      )
    );
  }

  /**
   * Drives the generative score's tension from the facility alarm.
   *
   * Distinct from `#attachAudioListeners` on purpose: that maps events to
   * one-shot stings, this maps them to a persistent state change. The alarm is
   * the only run-bus event that changes the score — everything else the player
   * does is punctuation, and re-scoring on it would make the bed twitchy.
   *
   * Only the *state* mapping lives here; `shellRuntime` sets tension from the
   * persisted alarm phase on scene entry and resume, so a run reloaded mid-alarm
   * is scored correctly before any transition fires. Both go through
   * `musicScore.ts` so the two paths cannot drift apart.
   */
  #attachMusicListeners(): void {
    for (const off of this.#musicUnsubs) off();
    this.#musicUnsubs = [];
    const run = this.#deps.getScene();
    if (!run?.bus) return;

    this.#musicUnsubs.push(
      run.bus.on(EVENT.ALARM_CHANGED, payload => {
        const transition = (payload as { transition?: string } | undefined)?.transition;
        const tension = tensionForAlarmTransition(transition);
        // null → a transition with no musical meaning; hold what is playing
        // rather than inventing a level.
        if (tension !== null) musicDirector.setTension(tension);
      })
    );
  }

  /**
   * Bus-driven SFX for the cyber grid (P3.6) — the digital-combat sibling of
   * `#attachAudioListeners`, subscribed on `layer.bus` (the cyber World's own
   * event bus, distinct from `run.bus`) instead of the run bus. Same event
   * shapes as Meatspace (both `resolveRanged`/`resolveMelee` and
   * `World.raiseAlarm`/`tickAlarm` are shared code — see Combat.ts/World.ts),
   * just different sounds: `zap`/`jolt` instead of `rangedShot`/`slash`, so
   * the grid reads as electric rather than physical. `alarm` and `down` are
   * reused outright — the facility-alarm sting and "hostile went down" thud
   * mean the same thing on either layer.
   *
   * Torn down by `detachCyber()` (unlike the run-bus `#audioUnsubs`, which
   * live for the whole scene) so a stale layer's bus can never keep firing
   * sounds after jack-out.
   */
  #attachCyberAudioListeners(): void {
    for (const off of this.#cyberAudioUnsubs) off();
    this.#cyberAudioUnsubs = [];
    const run = this.#deps.getScene();
    const layer = cyberLayerOf(run);
    if (!layer) return;

    this.#cyberAudioUnsubs.push(
      layer.bus.on(EVENT.ALARM_CHANGED, payload => {
        const transition = (payload as { transition?: string } | undefined)?.transition;
        if (transition === 'raised') audioManager.play('alarm');
        // The cyber grid runs its own alarm cadence, so ICE closing in has to
        // drive the score too — otherwise jacking in during an alert plays a
        // calm bed over a firefight. Torn down by `detachCyber()` with the rest
        // of these, so a stale layer can never keep re-scoring after jack-out.
        const tension = tensionForAlarmTransition(transition);
        if (tension !== null) musicDirector.setTension(tension);
      }),
      layer.bus.on(EVENT.ENTITY_DAMAGED, payload => {
        const { source, killed, dodged, target } = (payload ?? {}) as EntityDamagedPayload;
        if (source === 'melee' && !dodged) audioManager.play('jolt');
        // ICE (Guardian/Probe/Spark) are all Hostile subclasses; the avatar is
        // a plain Entity, so this can't fire on the avatar's own RAM hitting 0.
        if (killed && target instanceof Hostile) audioManager.play('down');
      }),
      layer.bus.on(EVENT.NOISE, payload => {
        const { kind } = (payload ?? {}) as NoisePayload;
        if (kind === 'ranged') audioManager.play('zap');
      })
    );
  }
}
