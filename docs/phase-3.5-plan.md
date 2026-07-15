# Phase 3.5 Plan — Status Effects & Three New Archetypes

Living plan for the Phase 3.5 slice of Kernel Panic: a generic status-effect channel, a reworked Decker perk, three new player archetypes (Berserk, Adept, Chimera), and an inverted crew-generation model where core stats are rolled first and the archetype is derived from the result. Phase 3 (campaign arc, Cyberspace, the Decker, the Score) shipped as `v0.3.0`; this phase builds on top of it while the project is in balance/QoL patching (`3.3-inventory`). See [phase-3-plan.md](phase-3-plan.md) for the prior phase and [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall design vision.

**Phase prefix:** `P3.5` — use `P3.5.MN` (e.g. `P3.5.M2.1`) when referencing milestones from this phase in other documents.

## Design vision

The Decker's **Override** perk (hijack a corp drone's allegiance) reads oddly now that factions deliberately blur organic/mechanical enemy skins and most higher-tier hostiles are humanoid — hijacking a "drone" doesn't fit the fiction as well as it used to, and its actual mechanic (flip a hostile's allegiance for a few turns via an aim-sector target picker) is a much more natural fit for a mind-control specialist than a hacker. That observation is the seed of this phase:

1. **A generic status-effect channel** — today every timed effect (Razor's stealth, Override's countdown, shield HP) is a bespoke field with its own lifecycle idiom. Adding an EMP stun and a Berserk surge/crash pair on top of that is the point to de-duplicate instead of writing a third and fourth one-off.
2. **Decker: Override → EMP stun** — an AOE neural-shock/EMP blast, self-centered, hits everyone alive in radius (friend and foe, no faction filter), replacing Override as the Decker's Meatspace signature perk.
3. **Berserk** — a new archetype whose perk is a temporary self-buff (surge) that always chains into a matched self-debuff (crash) on expiry.
4. **Adept** — a new archetype that inherits Override's exact mechanic wholesale, reflavored as **Influence**: psychically dominating a hostile's will for a few turns instead of hacking a drone's firmware. Same targeting, same risk shape, same countdown-and-revert lifecycle — renamed and re-fictionalized, with a new archetype shell around it.
5. **Chimera** — a new sustain archetype (deliberately ambiguous fiction: nobody in-world knows for certain whether this is a human running a semi-sentient nanite swarm or an awakened AI in an android chassis; flavor text never resolves it) whose perk converts scrap into HP, mirroring Tech's improvised-turret resource-gate shape.
6. **Inverted crew generation** — roll core stats first (hit chance, dodge chance, armor), derive the archetype from the resulting profile, instead of picking an archetype and getting fixed stats. No weighted archetype pool — pure RNG at both campaign start and mid-campaign recruiting. The old "one of each starter kit" guarantee is dropped; duplicates are allowed. Decker is unaffected — still a forced, narrative-only mid-campaign recruit, never rolled.
7. **Archetype unlocks via Score rewards (M7, added 2026-07-13)** — Berserk/Adept/Chimera start locked for every meta-crew and join the existing `SCOREABLE_ITEMS` meta-progression pool (P3.M6 "Stolen Blueprints"): a clean Score win draws one reward, item or archetype, from whatever's still unacquired. A locked archetype's anchor is simply absent from M6's nearest-anchor derivation table, so rolls that would've landed there saturate to the nearest unlocked neighbor — same mechanism M6 already uses for rolls that overrun the anchor hull, no new logic required.

End state: **seven playable archetypes** (Merc, Razor, Tech, Decker, Berserk, Adept, Chimera) — Merc/Razor/Tech reachable via the roll from turn one, Decker via forced narrative recruit, and Berserk/Adept/Chimera progressively unlocked via Score rewards across a save's campaign history — a differentiated Decker perk, one shared effect-duration mechanism the roster can keep building on (e.g. a future control/support archetype), and less deterministic crew stats without breaking campaign-save compatibility.

## Dependency graph

```
M1 (status-effect channel) ──> M2 (Decker EMP stun)
                            └─> M3 (Berserk: surge/crash)

M4 (Adept: Influence)   ── independent of M1; sequenced after M2
                             (both touch the Override machinery — sequencing
                             avoids overlapping edits to the same file)

M5 (Chimera: scrap→HP)  ── fully independent (no duration effect at all)

M3 + M4 + M5 ──> M6 (stat-roll → archetype derivation, needs all 6 profiles)

M6 ──> M7 (archetype unlocks via Score rewards — needs M6's anchor table to gate)
```

## Current status

| Milestone | Status |
|---|---|
| P3.5.M1 — Generic status-effect subsystem | ✅ Complete |
| P3.5.M2 — Decker perk swap: Override → EMP AOE stun | ✅ Complete |
| P3.5.M3 — Berserk archetype (surge/crash) | ✅ Complete |
| P3.5.M4 — Adept archetype (Influence, renamed from Override) | ✅ Complete |
| P3.5.M5 — Chimera archetype (scrap-to-HP sustain) | ✅ Complete |
| P3.5.M6 — Inverted crew generation (roll stats, derive archetype) | ✅ Complete |
| P3.5.M7 — Archetype unlocks via Score rewards | ✅ Complete |

**Phase 3.5** is complete when:

1. Every milestone in the table above is ✅.
2. `npm test` passes with the new/updated coverage listed per milestone below.
3. A pre-P3.5 save loads without error and without silently regenerating stats it never had (legacy defaults kick in instead).

> **Note on "all seven archetypes in one campaign" (dropped as a phase-level gate, 2026-07-13):** M7 makes Berserk/Adept/Chimera Score-unlocked, and `THE SCORE` ends the campaign it's completed in — so no fresh save can ever be *mid-campaign, recruiting,* and *fully unlocked* at the same time. Each archetype (including the three gated ones) is instead validated end-to-end during its own milestone's playtest pass — see Verification below — and mixed-archetype recruiting is covered by a test fixture that pre-seeds `unlockedArchetypes`, not a blank-slate single-campaign requirement.

---

## P3.5.M1 — Generic status-effect subsystem

**Add to `src/game/Entity.ts`:**
```ts
effects: Map<string, number>;   // effect id -> turns of THIS entity's own refreshAp remaining

hasEffect(id: string): boolean
effectTurnsRemaining(id: string): number
applyEffect(id: string, duration: number): void   // positive-integer guard; overwrite, no stacking
clearEffect(id: string): void
protected tickEffects(): void   // decrement every entry, delete at 0
```
Duration counts in "how many times this entity's own `refreshAp()` fires" — the same semantics `stealthed` already has (a duration of 1 clears by the entity's next refresh). No stacking; reapplying overwrites, mirroring the existing "second Slide re-arms `stealthed`" behavior (`Razor.ts:50-52`).

**Critical ordering detail in `Entity.refreshAp()`** — check the effect *before* ticking it, so a duration of 1 covers the upcoming refresh, not the one that just happened:
```ts
refreshAp(): void {
  this.ap = this.hasEffect(STATUS_EFFECT.STUN) ? 0 : this.maxAp;
  this.shieldHp = 0;
  this.tickEffects();
}
```
Walk-through: Decker detonates EMP on the player's turn → `applyEffect('stun', 1)` on everyone in radius. Next corp `refreshAp()` sees the effect, sets `ap = 0` (that *is* the stun), then ticks it to 0/deletes it. The corp refresh after that is unaffected. **No separate skip-turn engine needed** — `PatrolHostile.takeTurnSteps` and `CorpTurret.ts:92` both loop on `while (alive && ap > 0/>= cost ...)` and already no-op cleanly at `ap === 0`.

**One real gap this exposes:** `applyIntent.ts`'s move/attack handlers call `Entity.spendAp`, which throws if `cost > ap` (`Entity.ts:177-185`). Today that never fires because `gateOnApExhausted` always ends the turn the instant AP hits exactly 0 — the player is never handed another intent at `ap === 0`. A stunned player-faction entity *starts* its turn at 0, so the very next intent would crash. Fix: at the top of `applyIntent()`, right after the faction guard, add an early return mirroring `gateOnApExhausted`'s existing `concludeTurn ?? advanceTurn` fallback:
```ts
if (player.ap === 0 && intent.type !== 'end-turn' && intent.type !== 'cancel') {
  log(`> ${entityLabel(player)} is STUNNED — no AP this turn.`);
  (ctx.concludeTurn ?? ctx.advanceTurn)();
  return;
}
```

**Migrate `stealthed` onto this channel now** (cheapest proof it works, and a net simplification):
- `Razor.slide()`: `this.stealthed = true` → `this.applyEffect('stealth', 1)`.
- `Entity.isSpottableBy()`: `if (!this.stealthed)` → `if (!this.hasEffect('stealth'))`.
- `Razor.ts`'s `override refreshAp()` (lines 101-104) **deletes entirely** — base `tickEffects()` now clears it. Existing Razor stealth tests should pass unmodified against the new channel; that's the regression check.

**Do NOT migrate:**
- `shieldHp` — a capacity, not a countdown; stays a dedicated numeric field.
- `frozen` — a state-machine flag driven by explicit jack-in/out logic in `Run.ts`, not a countdown; stays dedicated.
- Override/Influence's `overrideTurnsRemaining`/`factionBeforeOverride` (see M4) — stays on its own bespoke lifecycle. Its cadence (once per player-aftermath pass, coupled to a generator driving the influenced hostile's own actions) differs in kind from `refreshAp`'s cadence; migrating just the counter without the action-driving loop would desync it.

**Persistence:** none needed. `CampaignCrewSnapshot` (`persistence.ts:907-931`) only saves at the Hub between runs; every effect in scope is combat-run-scoped and will have long since ticked to zero by save time. (If a future phase adds mid-combat save/resume, `effects` would need to serialize into the run snapshot then.)

**Implementation note (as-built):** `stealthed` turned out to be read/written in ~8 files beyond `Entity`/`Razor` (Combat stealth-break, `Run` snapshot/reset, `persistence` save/restore, HUD snapshot+render). Rather than fan the migration across all of them, `Entity.stealthed` became a getter/setter alias backed by `STATUS_EFFECT.STEALTH` on the effects Map — one source of truth, zero changes to those call sites or their tests. `Razor.slide()` still assigns `this.stealthed = true` (now routed through the setter), and Razor's `refreshAp` override was deleted as planned.

**Critical files:** `src/game/Entity.ts`, `src/game/archetypes/Razor.ts`, `src/input/applyIntent.ts`, `src/game/TurnQueue.ts`.

**Tests:** `tests/unit/game/Entity.test.ts` (apply/has/clear/duration-1-clears-next-refresh/overwrite-not-stack/invalid-duration throws), `tests/unit/game/Razor.test.ts` (stealth via `hasEffect`, slide→wait→slide re-cloak regression), `tests/unit/game/TurnQueue.test.ts` (synthetic stunned entity: 0 AP on the stunned refresh, full AP the one after), `tests/unit/input/applyIntent.test.ts` (player at 0 AP with no legal action sends an intent, no throw, turn concludes).

---

## P3.5.M2 — Decker perk swap: Override → EMP AOE stun

**Depends on M1.**

Self-centered blast (no aim/UI plumbing — matches `Smoke.ts`'s `placeSmoke(grid, cx, cy, radius)` radius-loop template); hits *everyone* alive in radius, friend and foe, no faction filter (matches `breachBlast.ts`'s existing "blast hits everyone, no faction check" precedent) and no organic/mechanical branching (uniform stun, matching the deliberate blurred-faction theming).

**New module `src/game/empBlast.ts`** (pure functions, mirrors `breachBlast.ts` + `Smoke.ts`):
```ts
export type EmpCheck = { ok: true } | { ok: false; reason: 'dead' | 'insufficient-ap' };
export function canEmp(decker: Entity): EmpCheck { ... }
export function isInEmpBlast(cx, cy, x, y): boolean {
  return chebyshev(cx, cy, x, y) <= EMP_RADIUS;   // reuse Pathfinding.chebyshev, as breachBlast.ts does
}
export function detonateEmp(world: World, decker: Entity): { stunned: Entity[] } {
  const check = canEmp(decker);
  if (!check.ok) throw new Error(...);
  decker.spendAp(AP_COST.EMP);
  const stunned: Entity[] = [];
  for (const entity of world.entities.values()) {
    if (!entity.alive) continue;
    if (!isInEmpBlast(decker.x, decker.y, entity.x, entity.y)) continue;
    entity.applyEffect(STATUS_EFFECT.STUN, EMP_STUN_DURATION);
    stunned.push(entity);
  }
  return { stunned };
}
```

**`Decker.ts`:** remove `canOverride`/`overrideDrone` delegators and the `droneOverride.js` import; add `canEmp`/`detonateEmp` thin delegators to `empBlast.ts`, same shape as the perk it replaces. **Do not touch `droneOverride.ts` in this milestone** — M4 is what renames and rehomes it to Adept. Keeping M2 scoped to "remove Decker's delegation, add EMP" avoids two milestones editing the same file in overlapping ways.

**`constants.ts`** — new block, following the existing one-line-justification-per-number convention (see `OVERRIDE_*`, `constants.ts:93-108`):
```ts
export const EMP_RADIUS = SMOKE_RADIUS;      // matches SMOKE_RADIUS (2) — "clears a room" footprint
export const EMP_STUN_DURATION = 1;          // one skipped activation per hostile
```
`AP_COST` gains a new `EMP: 2` key (matches every other perk). `AP_COST.OVERRIDE` and `OVERRIDE_RANGE`/`OVERRIDE_DURATION`/`OVERRIDE_SUCCESS_CHANCE` are left in place for now — M4 renames them.

**`applyIntent.ts`:** swap the `doSpecial` dispatch branch from `canOverride`/`doOverride` to `canEmp`/`doEmp`. **Do NOT delete `pickOverrideTarget`/`isInAimSector`** — M4's Adept perk claims them (Adept uses the same aim-sector single-target picker Override always used). Leave them in place with a short comment noting they're about to be repointed at Adept in M4.

**`archetypes/index.ts`:** update the Decker's `perkName`/`perkLabel` copy to describe EMP.

**Implementation notes (as-built):**
- **No self-stun (revised after review).** The blast now exempts the firing Decker (`entity === decker` skip). Self-stun read as a pure negative-play footgun. EMP costs 2 AP and stuns everyone *else* in radius; the caster is shielded from their own discharge.
- **EMP (Meatspace) + Override (Cyberspace) split — already true.** The CyberAvatar (the jacked-in Decker's form) always kept its own `canOverride`/`overrideDrone` for the cyber grid. So the Decker fires EMP in Meatspace and Override on the cyber grid with no extra code — `doSpecial` gained a `canEmp` branch and *kept* the `canOverride` branch (now reaching only the CyberAvatar); `OverrideActor` retyped to `CyberAvatar`.
- **Directionless perks (new infra).** `keymap.PerkAim` (`'directional' | 'self'`) threads through `dispatch` → `KeyboardController.getSpecialAim` / `TouchPad.setSpecialAim`, resolved from the live archetype via `perkAimForArchetype` (new, in `archetypes/index.ts`) and `ARCHETYPES[*].perkAim`. A `'self'` perk fires the `special` intent immediately (no aim step); EMP is the first, and **Berserk / Chimera self-buffs will reuse it in M3/M5**. The CyberAvatar (Override) resolves to `'directional'`.
- **Stun visuals (new).** (a) Stunned entities render **electric cyan** (`STUNNED_FG`), overriding faction hue, in `frame.glyphForEntityCell`. (b) `detonateEmp` emits `EVENT.EMP_DETONATED`; `sceneListeners` fires `triggerEmpFlash` — a cyan full-screen discharge pulse (reuses the parametrized colored-vignette primitive). (c) `formatIdentityHud` appends `[STUNNED]` (parallels `[CLOAKED]`); it triggers when you flip to a partner caught in your own EMP.
- **Override module coverage relocated, not dropped.** The Override *module* tests (previously reachable only through `Decker.test.ts`) moved to a standalone `tests/unit/game/droneOverride.test.ts` exercising the pure functions against a generic PLAYER operator. M4 renames that file to `mindInfluence.test.ts`.

**Critical files:** `src/game/empBlast.ts` (new), `src/game/archetypes/Decker.ts`, `src/input/applyIntent.ts`, `src/game/constants.ts`.

**Tests:** `tests/unit/game/empBlast.test.ts` (legality, radius geometry — mirror `breach.test.ts`'s `isInBlast` cases, mixed-faction stun, AP debited once, dead entities skipped), `tests/unit/game/Decker.test.ts` (Override assertions replaced with EMP assertions — Override's own test coverage moves wholesale to M4, not duplicated here), `tests/unit/input/applyIntent.test.ts` (`doSpecial` → EMP for a Decker; a same-faction crew member caught in radius ends up at 0 AP next refresh).

---

## P3.5.M3 — Berserk archetype: surge then crash

**Depends on M1. Independent of M2/M4/M5.**

**File structure**, mirroring the four existing archetypes exactly: `src/game/archetypes/Berserk.ts` (thin `Crew` subclass + `CALLSIGNS` pool, modeled on `Razor.ts`), `src/game/surge.ts` (pure `canSurge`/`doSurge`, modeled on `slide.ts`; tested through `Berserk.test.ts`, not standalone — matches how `slide.ts` has no dedicated test file today).

**Proposed callsigns** (aggressive/feral tone, checked against existing pools for collisions): `Fury, Havoc, Grit, Maul, Wrath, Torque, Riptide, Ember, Thresh, Brawn, Ronin, Ashwalker`. (Avoid `Bruiser`/`Juggernaut` — those are corp enemy-class labels in `Entity.ts`'s `kindFromId`; a crew callsign matching an enemy kind would be confusing in the log.)

**Surge→crash chain lives in `Berserk.refreshAp()`**, layering on the generic channel the same way `Razor.refreshAp()` layers stealth-clearing on `super.refreshAp()`:
```ts
override refreshAp(): void {
  const wasSurging = this.hasEffect(STATUS_EFFECT.SURGE);
  super.refreshAp();   // stun-gate, shield clear, tickEffects (decrements surge/crash too)
  if (wasSurging && !this.hasEffect(STATUS_EFFECT.SURGE)) {
    this.applyEffect(STATUS_EFFECT.CRASH, CRASH_DURATION);
    // apply crash's hit-chance penalty
  } else if (/* crash's own tick just expired */) {
    // restore hit chance
  }
}
```
Guard against double-apply the same way `Crew.applyGear`'s clamps do (a small private "crash currently applied" flag).

Where each number is read:
- **Damage bonus** — `Berserk` overrides `meleeAttackDamage()`/`rangedAttackDamage()` to add `SURGE_DAMAGE_BONUS` while `hasEffect('surge')`, same pattern as `Razor.ts` overriding `meleeDamage`.
- **AP bonus/penalty** — applied inside the `refreshAp()` override (surge: `+SURGE_AP_BONUS`; crash: `-CRASH_AP_PENALTY`), same shape as `Crew.refreshAp()` layering gear regen after `super.refreshAp()`.
- **Accuracy penalty** — mutate the instance's `baseHitChance` directly and restore it on crash-expiry, the same "mutate the live stat, `Combat.ts` reads it raw" idiom `Crew.applyGear`'s `ADRENAL_SPIKE`/`SUBDERMAL_PLATING` cases already use (`Crew.ts:346-363`) — zero `Combat.ts` changes needed.

**Proposed constants** (`constants.ts`, same "flat 1-2-3, tie to an existing constant" convention):
```ts
export const SURGE_DURATION = 2;          // shorter than OVERRIDE_DURATION(3): costs only AP, no roll/alarm risk
export const SURGE_DAMAGE_BONUS = 1;      // mirrors MELEE_DAMAGE_BONUS/RANGED_DAMAGE_BONUS
export const SURGE_AP_BONUS = 1;          // mirrors AP_BONUS, capped at 1 for the same turn-economy reason
export const CRASH_DURATION = 2;          // symmetric payback window
export const CRASH_AP_PENALTY = 1;        // symmetric with SURGE_AP_BONUS — nets to roughly even
export const CRASH_HIT_PENALTY = 0.1;     // mirrors the existing 0.1-per-tier TARGETING_BONUS/DODGE_BONUS step
// AP_COST.SURGE: 2, matches the "every perk costs 2 AP" convention
```
> **Retuned in the M3 enrichment pass (see as-built notes):** playtest showed the "roughly even" Crash was too soft to make Surge a real gamble. Shipped values are `CRASH_DURATION = 3`, `CRASH_AP_PENALTY = 2`, `CRASH_HIT_PENALTY = 0.2`, and a new `SURGE_ARMOR_BONUS = 1` — the payback now outlasts and outweighs the spike it pays for.
**Base stats: `baseHitChance = 0.78`, `baseDodgeChance = 0.36`** — the fast, high-melee frenzy identity (respecced from an initial `0.75/0.20` generic-baseline placeholder once M6 gave Berserk its high-dodge anchor); the surge/crash swing layers on top. **~~Armor note for M6:~~ (Superseded by M6.)** An earlier draft had Berserk share Tech's exact `(0.75, 0.20)` centroid and resolved the collision via the armor axis (`armor === 0 → Tech`, `armor > 0 → Berserk`). That made Berserk only ~1% rollable (gated behind the rare armor roll), so M6 instead gives Berserk its own high-dodge classification anchor `(0.78, 0.36)` and drops armor as a classifier entirely. Berserk's default base stats above were respecced to match that anchor exactly (`0.78/0.36`).

**Wiring surface** (every place a `CrewArchetypeId` fans out — this exact list is reused verbatim for M4 and M5, so it's spelled out once here):
- `src/game/archetypes/index.ts` — `BUILDERS`, `ARCHETYPES`, `CALLSIGNS_BY_ARCHETYPE`, `ARCHETYPE_IDS`.
- `src/game/Campaign.ts` — no manual pool-weight entry needed; M6 retires `RECRUIT_ARCHETYPE_POOL` entirely.
- `src/game/Run.ts` — `CrewArchetypeId` type (~line 158), `archetypeOf`/`archetypeOfCrew`, `SNAPSHOT_EXTRACTORS`, `freshTelemetry`.
- `src/game/persistence.ts` — `ARCHETYPE_FACTORY`, `KNOWN_ARCHETYPES_SET`, `archetypeOfCrew`.
- `src/input/applyIntent.ts` — `doSpecial` dispatch gains a branch for the new perk, appended to the existing fixed order.

Berserk is recruit-pool only — moot as a distinct decision once M6 lands, since M6 drops pool weighting and the starter-variety guarantee entirely (every non-Decker archetype, Berserk included, is reachable at campaign start or via recruiting purely through the stat roll).

**Critical files:** `src/game/archetypes/Berserk.ts` (new), `src/game/surge.ts` (new), plus the wiring-surface files above.

**Tests:** `tests/unit/game/Berserk.test.ts` (new — mirrors `Razor.test.ts`: legality/AP debit, damage+AP bonus while surging, crash auto-applies on surge expiry, hit-chance penalty applied/restored, base stats), `tests/unit/game/persistence.test.ts`, `tests/unit/game/Run.test.ts`, `tests/unit/input/applyIntent.test.ts` (each extended per the wiring-surface list).

**Implementation notes (as-built):**
- `Berserk` and the pure `surge.ts` legality/commit module shipped with the proposed tuning and callsign pool. Surge is self-targeted, costs 2 AP, adds +1 ranged/melee damage while active, and grants +1 AP on an active Surge refresh. It cannot be re-armed during Surge or Crash, so the mandatory payback cannot be postponed indefinitely.
- Surge expiry immediately arms a Crash. Accuracy is derived directly from `STATUS_EFFECT.CRASH` rather than tracked in a second mutable flag, so expiry and restore cannot over-/under-correct the stat. *(Crash duration and penalties were retuned in the enrichment pass below — originally a two-refresh, -1 AP / -0.1 hit window.)*
- **Run persistence correction:** the earlier phase-level assumption that timed effects never meet persistence was false for mid-combat autosaves. `RunEntitySnapshot.effects` now stores validated non-stealth timed effects (legacy `stealthed` stays byte-compatible), so Surge/Crash cannot be cleared by reload. Restore accepts Berserk's legitimate `maxAp + SURGE_AP_BONUS` snapshot only while Surge is present and fails loud on unknown/reserved/malformed effects.
- Full archetype fan-out landed: registry/factory/callsigns/perk metadata, recruit pool, Run classification/telemetry/snapshot, campaign/run restore, capability-based input dispatch, and self-targeting keyboard/touch behavior. The interim weighted pool is now `2 Merc / 2 Razor / 1 Tech / 1 Berserk`; its tests include Berserk in the denominator instead of silently ignoring a new class. M6 still replaces this pool with stat-first derivation.
- Player-facing state is explicit: combat HUD appends `[SURGING]` / `[CRASH]`, the log announces Surge/denials, and Key Help no longer tells self-targeted perks to pick a direction. Offline precache includes Berserk/Surge plus the previously omitted Decker/EMP modules; service-worker/release version is `0.3.4b`.
- **Smoketest correction (`0.3.4b`):** the combat HUD now treats active Surge as a real `maxAp + 1` five-pip capacity, fixing the tier-1 `ap must be <= 4, got 5` paint fault and preserving the spent fifth pip. Berserk's refresh override also respects the base stun gate, so overlapping Stun cannot leak one AP back into a deliberately zero-AP activation.
- Verification: focused Berserk/wiring/persistence tests, `npm run format`, `npm run lint`, and full `npm test` pass. Browser smoke at `http://localhost:8099/` resumed combat without console warnings/errors and installed the new service worker successfully.

**M3 enrichment pass (playtest feedback, as-built):** three follow-ups from playing the Berserk — the surge/crash swing read as too weak and too invisible.
- **+1 armor while surging (`SURGE_ARMOR_BONUS = 1`).** Deliberately *not* modelled by mutating `damageReduction` the way gear (Subdermal Plating) does: `run.player` **is** the campaign crew object, and `damageReduction` is a persisted stat, so a stored buff would leak permanently if a run ends mid-Surge (e.g. surge, then step onto the exit the same turn — the crew returns to the Hub carrying `base+1` with no effect left to remove it). Instead the buff is **computed, never stored**: a new `Entity.effectiveDamageReduction` getter defaults to `damageReduction`; `Berserk` overrides it to add the bonus while `hasEffect('surge')`. `Combat.applyDamageReduction` and the HUD defense pane read `effectiveDamageReduction`; every snapshot keeps reading the pristine `damageReduction`. Structurally impossible to leak — the persistence round-trip test asserts the record stores base armor mid-Surge and re-derives the buff from the restored effect.
- **Harsher, longer Crash.** `CRASH_DURATION` 2→3, `CRASH_AP_PENALTY` 1→2, `CRASH_HIT_PENALTY` 0.1→0.2. Crash tests are duration-driven (loop over `CRASH_DURATION`) so a future retune can't rot them.
- **Renderer pulses beyond the HUD tag.** New presentation-only bus events `BERSERK_SURGED` (emitted from `applyIntent.doSurge`, where `world` is in scope) and `BERSERK_CRASHED` (emitted from `TurnQueue.endTurn` on the exact surge→crash refresh edge, exactly once). `triggerSurgeFlash` (blaze orange) / `triggerCrashFlash` (ashen violet-grey) reuse the same colored-vignette primitive the Decker EMP flash drives, wired in `sceneListeners` beside the EMP listener. Palette tints live in `palette.ts` (`SURGE_FLASH_FG` / `CRASH_FLASH_FG`).
- Verification: full `npm test` (2012 pass), `npm run lint`, `npm run format`. Visual pulse confirmation is a live-playtest observation (no node-testable surface); the flash triggers and both event emissions are unit-covered.

---

## P3.5.M4 — Adept archetype: Influence (Override, renamed and rehomed)

**Independent of M1/M3/M5. Sequenced after M2** (both M2 and M4 touch the Override machinery; doing M2 first means Decker's delegation is already gone before this milestone renames the file, avoiding overlapping edits).

The Adept inherits Override's mechanic **wholesale, unchanged in behavior** — same aim-sector target picker, same range/duration/success-chance/alarm-on-fail risk shape, same countdown-and-revert lifecycle via its own bespoke generator (deliberately *not* migrated onto M1's channel — see M1's "do not migrate" list). Only the name and fictional framing change, because it now has a permanent owner instead of being reserved for later.

**Rename:**
| Old | New |
|---|---|
| `src/game/droneOverride.ts` | `src/game/mindInfluence.ts` |
| `canOverride` | `canInfluence` |
| `overrideDrone` | `influenceTarget` |
| `stepOverriddenDrones` | `stepInfluencedHostiles` |
| `OverrideResult` (type) | `InfluenceResult` |
| `OVERRIDE_RANGE` | `INFLUENCE_RANGE` |
| `OVERRIDE_DURATION` | `INFLUENCE_DURATION` |
| `OVERRIDE_SUCCESS_CHANCE` | `INFLUENCE_SUCCESS_CHANCE` |
| `AP_COST.OVERRIDE` | `AP_COST.INFLUENCE` |
| `pickOverrideTarget` / `isInAimSector` (`applyIntent.ts`) | `pickInfluenceTarget` / `isInAimSector` (kept, still generic) |
| `doOverride` (`applyIntent.ts`) | `doInfluence` |

Doc comments reflavor from "hijack a corp drone's allegiance" to "psychically dominate a hostile's will for a few turns" throughout `mindInfluence.ts` and the constants block. Target eligibility (alive, `Hostile` instance, different faction, in range, LOS) stays exactly as-is — it was already faction-agnostic re: organic/mechanical, which is exactly what makes it transplant cleanly onto a psychic fiction.

**New `src/game/archetypes/Adept.ts`:** thin `Crew` subclass, archetype `'Adept'`, `canInfluence`/`influenceTarget` delegators to `mindInfluence.ts` (same shape `Decker.ts` used to have). **Base stats: `baseHitChance = 0.70`, `baseDodgeChance = 0.20`** — a deliberately weaker combatant; you bring an Adept for Influence, not for their aim.

**Proposed callsigns** (mentalist/psychic tone, checked against existing pools): `Oracle, Mirage, Sibyl, Whisper, Halo, Delphi, Thrall, Mendel, Wisp, Seer, Aura, Puppet`.

**`applyIntent.ts`:** `doSpecial` dispatch gains a branch for Adept using `canInfluence`/`doInfluence`, reusing the renamed `pickInfluenceTarget`/`isInAimSector` that M2 deliberately left in place.

**`stepInfluencedHostiles`** (renamed generator) keeps its exact existing call site and cadence (once per player-aftermath pass) — only the name changes.

**Critical files:** `src/game/mindInfluence.ts` (renamed from `droneOverride.ts`), `src/game/archetypes/Adept.ts` (new), `src/game/constants.ts`, `src/input/applyIntent.ts`, plus the wiring-surface list from M3.

**Tests:** rename the Override-specific coverage currently embedded in `Decker.test.ts` into a new standalone `tests/unit/game/mindInfluence.test.ts`, exercising the renamed pure functions directly against a generic `Hostile` fixture — this is the module's only coverage today (only reachable via `Decker.test.ts`), so it must move deliberately, not get silently dropped when `Decker.ts` stops calling it (M2) or renamed out from under it (M4). Add `tests/unit/game/Adept.test.ts` (mirrors `Decker.test.ts`'s old Override-legality assertions, now via `canInfluence`/`influenceTarget`). Extend `applyIntent.test.ts`, `Run.test.ts`, `persistence.test.ts` per the wiring-surface list.

**Implementation notes (as-built):**
- **`doOverride`/`doInfluence` split (deviation from the literal rename table).** The plan's rename table lists `doOverride (applyIntent.ts) → doInfluence`, but by the time M4 landed `doOverride` was *already* the CyberAvatar-only cyber-grid dispatch handler (M2 left it that way — "OverrideActor retyped to CyberAvatar"). Renaming it outright would have repointed the CyberAvatar's own `canOverride`/`overrideDrone` capability check at a function carrying Adept-flavored log copy, which contradicts M2's explicit "Override stays the cyber grid's own fiction" decision. Landed instead: `doOverride` is untouched (still serves only the CyberAvatar, still logs "OVERRIDES"/"OVERRIDE DENIED"/"OVERRIDE FAILED"), and a new sibling `doInfluence` was added for the Adept's `canInfluence` branch with its own copy ("DOMINATES"/"INFLUENCE DENIED"/"INFLUENCE FAILED"). Both share the renamed `pickInfluenceTarget` (was `pickOverrideTarget`) and unchanged `isInAimSector` — the picker itself has zero archetype-specific behavior, exactly as the plan intended.
- **Hostile bookkeeping field names, deny-reason strings, and `applyOverride`/`revertOverride` function names are unchanged**, per M1's explicit "do not migrate" carve-out for `overrideTurnsRemaining`/`factionBeforeOverride`. Since those fields (and the `isOverridden` getter) are shared bookkeeping between the CyberAvatar's cyber-grid Override *and* the Adept's Meatspace Influence, the `InfluenceDenyReason` strings (`'not-overridable'`, `'already-overridden'`) and the `Illegal override for …` throw message were left as-is rather than partially reflavored — renaming only the deny strings while the backing field stays `isOverridden` would have been more inconsistent, not less.
- **`AP_COST.INFLUENCE` is a single renamed constant**, not a new Adept-only cost — the CyberAvatar's cyber-grid Override now costs `AP_COST.INFLUENCE` too (same numeric value, `2`, as `AP_COST.OVERRIDE` before the rename). No behavior change, only the identifier.
- `combatTurnPipeline.ts`'s `stepOverriddenDrones` → `stepInfluencedHostiles` rename (and its `OverriddenDroneAction` → `InfluencedHostileAction` type) was carried through as planned; the pipeline's own local step type (`OverriddenDroneAftermathStep`) and its aftermath log copy ("shakes off the override…") were deliberately left alone — that copy already covered both fictions (cyber ICE and the old Decker override) before this milestone and isn't part of the module being renamed.
- Full archetype fan-out landed: registry/factory/callsigns/perk metadata (`perkAim: 'directional'`, matching the old aim-sector picker), recruit pool (interim weighted pool is now `2 Merc / 2 Razor / 1 Tech / 1 Berserk / 1 Adept`), Run classification/telemetry/snapshot, campaign/run restore, and capability-based input dispatch.
- Verification: `npm test` (2025 pass, 0 fail), `npm run lint`, `npm run format` all clean. A stale compiled `dist/tests/unit/game/droneOverride.test.js` (and `dist/src/game/droneOverride.js`) left over from before the source rename had to be removed by hand — `tsc`'s incremental test build doesn't delete outputs for deleted sources.

---

## P3.5.M5 — Chimera archetype: scrap-to-HP sustain

**Fully independent** — no duration effect, no dependency on M1.

Fiction is deliberately unresolved: Chimera is a sustain operative built around a semi-sentient nanite swarm, or an awakened AI in an android chassis — the game (and possibly the character) never confirms which. Flavor/log text should preserve that ambiguity rather than pick a side.

**New `src/game/archetypes/Chimera.ts`:** thin `Crew` subclass, archetype `'Chimera'`. **Base stats: `baseHitChance = 0.75`, `baseDodgeChance = 0.25`** — its own identity point on the hit/dodge plane, distinct from Tech/Berserk's `(0.75, 0.20)`. (These are the *default* stats / old-save fallback; M6 classifies rolled crew against a separate tuned anchor table — Chimera's classification anchor is `(0.79, 0.20)` — and no longer uses any armor tie-break. See M6.)

**New pure module `src/game/nanoRepair.ts`** (mirrors Tech's `improviseTurret` shape exactly — resource-gated, repeatable, no per-job cap):
```ts
export function canConvertScrap(chimera: Crew): CanCheck {
  // alive, ap >= AP_COST.NANITE_HEAL, inventory.salvage.scrap >= SALVAGE_PER_NANITE_HEAL
}
export function convertScrapToHp(chimera: Crew): number {
  const check = canConvertScrap(chimera);
  if (!check.ok) throw new Error(...);
  chimera.spendAp(AP_COST.NANITE_HEAL);
  chimera.inventory!.salvage.scrap -= SALVAGE_PER_NANITE_HEAL;
  return chimera.heal(NANITE_HEAL_AMOUNT);   // Entity.heal() already exists, already maxHp-clamped
}
```

**New constants** (`constants.ts`, reusing the existing scrap-price convention rather than inventing a new number):
```ts
export const NANITE_HEAL_AMOUNT = 1;                              // +1 HP per activation
export const SALVAGE_PER_NANITE_HEAL = SALVAGE_PER_IMPROVISED_TURRET; // same scrap price as an improvised turret
// AP_COST.NANITE_HEAL: 2, matches the "every perk costs 2 AP" convention
```
Repeatable every turn as long as the shared scrap pool allows — same resource-gating shape as Tech's improvised turret, not a once-per-job cap like Tech's initial free turret.

**Proposed callsigns** (deliberately unplaceable, human-or-machine): `Vessel, Husk, Chrysalis, Relic, Doll, Ghost, Null, Sigil, Mesh, Splice, Cocoon, Effigy`.

**`applyIntent.ts`:** `doSpecial` dispatch gains a `canConvertScrap`/`doConvertScrap` branch.

**Critical files:** `src/game/archetypes/Chimera.ts` (new), `src/game/nanoRepair.ts` (new), `src/game/constants.ts`, `src/input/applyIntent.ts`, plus the wiring-surface list from M3.

**Tests:** `tests/unit/game/Chimera.test.ts` (new — mirrors `Tech.test.ts`'s improvised-turret cases: legality with/without sufficient scrap, AP + scrap debited, HP clamps at maxHp, repeatable across turns), extend `applyIntent.test.ts`/`Run.test.ts`/`persistence.test.ts` per the wiring-surface list.

**Implementation notes (as-built):**
- Shipped with the proposed tuning verbatim: `NANITE_HEAL_AMOUNT = 1`, `SALVAGE_PER_NANITE_HEAL = SALVAGE_PER_IMPROVISED_TURRET`, `AP_COST.NANITE_HEAL = 2`, base stats `(0.75, 0.25)`.
- **No "already at full HP" gate**, deliberately — mirrors the existing `ITEM_ID.STIM` precedent in `Crew.useConsumable` (`Math.min(STIM_HEAL, maxHp - hp)`), which also lets a player burn a heal at full health rather than crash or silently no-op. Wasting your own scrap is a player mistake, not a state the engine needs to police. `canConvertScrap`'s `NaniteHealCheck` reasons are `'dead' | 'insufficient-ap' | 'no-inventory' | 'insufficient-salvage'` — no `'already-full'` branch.
- **`perkAim: 'self'`** — Nanite Repair has no target or direction, same self-fire shape as Decker's EMP and Berserk's Surge; `doSpecial` gained a `canConvertScrap` branch dispatching to a new `doConvertScrap`, appended after Adept's `canInfluence` check and before the CyberAvatar's `canOverride` fallback.
- Full archetype fan-out landed per the M3 wiring-surface list: registry/factory/callsigns/perk metadata (`archetypes/index.ts`), recruit pool (interim weighted pool is now `2 Merc / 2 Razor / 1 Tech / 1 Berserk / 1 Adept / 1 Chimera`), `Run.ts` classification/telemetry/snapshot (`crewSnapshotExtra` reused as-is — Chimera carries no extra per-job state beyond the shared `inventory`/`gear` slice), `persistence.ts` factory/restore/classification, and capability-based input dispatch.
- Log copy stays deliberately ambiguous ("converts scrap into tissue") rather than confirming nanite swarm vs. android self-repair, per the archetype's unresolved fiction.
- Offline precache (`sw-core.js`) gained `Chimera.js` and `nanoRepair.js`; release metadata (`sw.js`/`sw-dev.js`/`sw-release.js`) bumped `0.3.4b → 0.3.5`. **Noted gap, not fixed here:** `sw-core.js` never gained `Adept.js`/`mindInfluence.js` (or anything under `src/game/cyber/`) when M4 shipped — a pre-existing precache omission from before this milestone, out of scope for M5 but worth a follow-up pass.
- Verification: full `npm test` (2040 pass, 0 fail), `npm run lint`, `npm run format` all clean.

---

## P3.5.M6 — Inverted crew generation: roll stats, derive archetype

**Depends on M3 + M4 + M5** (the derivation table needs all six non-Decker profiles registered). **Independent of M2.**

- **Decker stays exempt** — `#assignDecker()`/`#needsReplacementDecker()` keep calling `buildCrewMember('decker', ...)` directly with fixed stats; never part of the roll/derive path.
- **No weighted pool, no starter-variety guarantee** — every non-Decker crew member (campaign-start trio *and* mid-campaign recruits) goes through the same roll-then-derive pipeline. `RECRUIT_ARCHETYPE_POOL`'s hand-weighted array is retired outright. Duplicates are allowed at campaign start (e.g. two Merc-flavored operatives is a legal, if unlucky, roll).

**Mechanical refactor: `baseHitChance`/`baseDodgeChance` getter → field.** Convert each archetype's `override get baseHitChance(): number { return X; }` into a constructor-settable instance field:
- Extract each literal into a named constant in `constants.ts` (`MERC_DEFAULT_HIT_CHANCE = 0.8`, `RAZOR_DEFAULT_HIT_CHANCE = 0.7` / `RAZOR_DEFAULT_DODGE_CHANCE = 0.35`, `TECH_DEFAULT_HIT_CHANCE = 0.75`, `DECKER_DEFAULT_HIT_CHANCE = 0.7`, `BERSERK_DEFAULT_HIT_CHANCE = 0.78` / `BERSERK_DEFAULT_DODGE_CHANCE = 0.36`, `ADEPT_DEFAULT_HIT_CHANCE = 0.7`, `CHIMERA_DEFAULT_HIT_CHANCE = 0.75` / `CHIMERA_DEFAULT_DODGE_CHANCE = 0.25`).
- `CrewInit` gains optional `baseHitChance?`/`baseDodgeChance?`; each constructor does `this.baseHitChance = baseHitChance ?? <ARCHETYPE>_DEFAULT_HIT_CHANCE;`, deleting the `override get` block.
- **Explicit regression requirement:** `new Merc({...})` with no override must still yield `0.8`, etc. — keeps `tests/unit/game/Crew.test.ts:404-497`'s existing assertions passing *unmodified*, proving the refactor alone changes nothing.
- `damageReduction`/HP/AP need no change — already constructor-settable instance fields.

**Derivation rule — nearest-anchor** (`src/game/crewStatRoll.ts`, new pure module). Six classification anchors on the `(hitChance, dodgeChance)` plane, tuned for an even partition (`CREW_STAT_ANCHORS`). **Armor plays no role in classification** — it's rolled purely as a combat stat (`damageReduction`). Agility is the primary spread axis: the "fast" pair (Berserk, Razor) owns the high-dodge region, Merc sits mid-dodge, and the "slow" trio (Chimera, Tech, Adept) fills the low-dodge band separated along the hit axis:

| Archetype | anchor hit | anchor dodge | fiction |
|---|---|---|---|
| Merc | 0.83 | 0.27 | ace shot, some mobility |
| Berserk | 0.78 | 0.36 | fast, high-melee frenzy |
| Razor | 0.68 | 0.36 | evasive melee/stealth |
| Chimera | 0.79 | 0.20 | accurate, slow sustain |
| Tech | 0.73 | 0.19 | slow generalist |
| Adept | 0.67 | 0.20 | slow, weak shot (bring for Influence) |

Classification is squared Euclidean distance from the rolled `(hitChance, dodgeChance)` to each anchor; minimum wins; break any exact boundary tie by fixed priority `merc > razor > adept > tech > berserk > chimera` for determinism.

**Resulting spawn distribution** (verified by the exhaustive sweep below, uniform roll over the widened ranges): Merc ~15%, Razor ~21%, Adept ~14%, Tech ~13%, Berserk ~21%, Chimera ~16% — every archetype lands in 13–21%. This replaces an earlier "anchors = each archetype's default stats + armor tie-break for Berserk" design that computed out to **Razor ~35% / Berserk ~1%** — Berserk was near-unrollable because it shared Tech's exact centroid and only won on the rare (15%) armor roll, contradicting the phase's "all seven archetypes reachable via the roll" completion criterion.

**Why the anchors are a *separate table* from the archetype default stats (old-save safety):** the discarded design doubled the classification centroids as the archetype default base stats. But those defaults are also the pre-P3.5 old-save fallback (`DEFAULT_*_BY_ARCHETYPE`, below) — retuning them to fix the distribution would silently restore legacy saved crew (Merc/Razor/Tech) to stats they never had (violates completion criterion #4). So `CREW_STAT_ANCHORS` is its own table tuned only for the partition, while the fallback default constants for the three legacy archetypes stay **frozen** at their shipped values (`Merc 0.80/0.20`, `Razor 0.70/0.35`, `Tech 0.75/0.20`). The three P3.5-new archetypes (Berserk/Adept/Chimera) have no pre-P3.5 saves, so their defaults are free — but the anchor table above is what `deriveArchetype` reads regardless. The derived crew member always gets its *rolled* stats, not the anchor.

```ts
export function rollCrewStats(rng: Rng): { hitChance: number; dodgeChance: number; armor: number }
//   ^ hitChance/dodgeChance rolled as uniform floats then rounded to 0.01 inside this fn;
//     deriveArchetype receives the already-rounded tuple.
export function deriveArchetype(stats): CrewArchetypeId   // reads hitChance/dodgeChance only; armor is not a classifier
```
> **Amended by M7:** `deriveArchetype` gains an optional third `anchors: readonly CrewStatAnchor[] = CREW_STAT_ANCHORS` parameter so M7 can pass a lock-filtered subset without M6 needing any awareness of the unlock system. Implement the parameter now (even though nothing supplies a non-default value until M7 lands) so M6's own signature doesn't need a follow-up edit.
Roll ranges — continuous and **deliberately wider than today's discrete spread** (P3.5 refinement: the old `{0.70,0.75,0.80}` / `{0.20,0.25,0.30,0.35}` buckets clustered crew onto a handful of identical stat lines; continuous rolls over a widened range give every operative a distinct feel). Roll a uniform float, then **round to 0.01** so the HUD reads clean whole-percents and the derivation domain stays finite/enumerable:
- `hitChance`: uniform in `[0.65, 0.85]`, rounded to 0.01 → 21 discrete values.
- `dodgeChance`: uniform in `[0.15, 0.40]`, rounded to 0.01 → 26 discrete values.
- `armor`: `rng.chance(0.15) → 1, else 0` — unchanged; conservative, since armor is a wholly new variance axis with no prior balance data.

**These ranges overrun the anchor hull on purpose** (anchor hit spans 0.67–0.83, dodge 0.19–0.36). Rolls in the outer margins — e.g. hit 0.85 / dodge 0.15 → Chimera, hit 0.85 / dodge 0.40 → Berserk, hit 0.65 / dodge 0.40 → Razor, hit 0.65 / dodge 0.15 → Adept — have no anchor of their own and saturate to the nearest corner archetype, so the widened tails read as "an unusually sharp/evasive operative of an existing archetype," not a new class. **Balance caveat:** this widening is a deliberate difficulty change — genuine stat extremes (a 0.65-hit or 0.40-dodge crew member) now occur that the old buckets never produced. Needs a fresh playtest eyeball, not just green tests.

**Test requirement, exhaustive by design:** classification reads only `(hitChance, dodgeChance)`, and rounding to 0.01 keeps that domain finite (`21 × 26 = 546` tuples) — sweep `deriveArchetype` across **every hit/dodge tuple on the rounded grid** and assert each resolves to a registered `CrewArchetypeId` (no dead zones, no throw) *and* that all six archetypes appear (no starved anchor). Layer targeted assertions on top of the sweep: (a) each of the six anchors maps to its own archetype; (b) Voronoi-boundary points equidistant between two anchors resolve deterministically via the fixed priority tie-break; (c) the four widened corners saturate as tabled above (0.85/0.15→Chimera, 0.85/0.40→Berserk, 0.65/0.40→Razor, 0.65/0.15→Adept); (d) the measured distribution over the full grid stays within the ~13–21% spread above — a guard so a future anchor edit can't silently re-skew back toward the discarded 35/1.

**RNG determinism:** every stat roll goes through `rng.fork('crew-stats')` (per `rng.ts:106-121`'s documented "add a mechanic without perturbing other rolls" use case), not the raw campaign `this.rng`. New wrapper, additive (doesn't touch `buildCrewMember`'s existing archetype-first signature, still used by `#assignDecker`/tests):
```ts
export function buildCrewMemberFromRoll(spawn, rng: Rng, options): Crew {
  const statsRng = rng.fork('crew-stats');
  const stats = rollCrewStats(statsRng);
  const archetypeId = deriveArchetype(stats);
  return buildCrewMember(archetypeId, spawn, rng, { ...options, baseHitChance: stats.hitChance, baseDodgeChance: stats.dodgeChance });
  // armor applied post-construction via the already-settable `damageReduction` field
}
```
`Campaign.buildCrew()`/`generateRecruits()`/`generateInitialCandidates()` switch to calling this instead of `buildCrewMember(archetypeId, ...)` directly, dropping their `rng.pick(RECRUIT_ARCHETYPE_POOL)` calls entirely.

**`CampaignCrewSnapshot` schema addition** (`persistence.ts:907-931`), following the exact existing `damageReduction?` optional-field pattern (no version system in this repo):
```ts
/**
 * P3.5.M6: rolled base stats. Absent on pre-P3.5 saves — restore to that
 * archetype's historical fixed value so old saves keep their original
 * balance instead of silently regenerating a new roll.
 */
baseHitChance?: number;
baseDodgeChance?: number;
```
Restore: `baseHitChance: rec.baseHitChance ?? DEFAULT_HIT_CHANCE_BY_ARCHETYPE[rec.archetype]`.

**Critical files:** `src/game/Crew.ts`, `src/game/crewStatRoll.ts` (new), `src/game/Campaign.ts`, `src/game/persistence.ts`.

**Tests:** `tests/unit/game/Crew.test.ts` (extend, don't break, existing getter-value assertions; add constructor-override cases for all six archetypes), `tests/unit/game/crewStatRoll.test.ts` (new — the exhaustive 546-tuple hit/dodge grid sweep above, the anchor/boundary/corner-saturation + distribution-spread assertions, tie-break determinism, and a property check that `rollCrewStats` only ever emits values on the 0.01 grid within `[0.65,0.85]`/`[0.15,0.40]`), `tests/unit/game/Campaign.test.ts` (`buildCrew`/`generateRecruits` produce rolled stats; `rng.fork('crew-stats')` doesn't perturb existing callsign/combat rolls), `tests/unit/game/persistence.test.ts` (`CampaignCrewSnapshot` round-trip with/without the new optional fields; legacy-save defaults to old fixed constant).

**Implementation notes (as-built):**
- Shipped with the proposed anchor table, tie-break order, and roll ranges verbatim — the exhaustive 546-tuple sweep and the 13–21%-ish distribution guard both passed on the first real run against the code, confirming the plan's hand-computed partition.
- **`baseHitChance`/`baseDodgeChance` stayed getters, not raw fields** (a refinement of the "getter → field" framing): `Crew` now holds them in private `#baseHitChance`/`#baseDodgeChance` fields set from `CrewInit`, with `get baseHitChance()`/`get baseDodgeChance()` reading them straight through. This was necessary, not cosmetic — Berserk's Crash penalty is a *live* modifier layered on top of a constructor-set pristine value, and TS/JS won't let a subclass define `get baseHitChance()` over a plain inherited data property (assigning to an accessor-shadowed field throws). Berserk's getter now reads `super.baseHitChance` and subtracts the Crash penalty, exactly reproducing its pre-M6 behavior; every other archetype simply doesn't override the getter at all and passes its own default through `super()`.
- **New `Crew.pristineBaseHitChance` getter (not in the original plan).** Discovered while wiring persistence: `snapshotCrewMember` was about to serialize `member.baseHitChance` — for a Berserk mid-Crash, that's the *live*, penalty-adjusted value, and baking a transient -0.2 into a `CampaignCrewSnapshot` would have permanently corrupted the restored baseline on any save taken between Crash triggering and its natural expiry. Added a `pristineBaseHitChance` getter (unaffected by Berserk's override) and pointed the snapshot at that instead — mirrors the existing `damageReduction` (pristine, persisted) vs `effectiveDamageReduction` (live, combat/HUD-facing) split from the M3 enrichment pass. Covered by a dedicated persistence test (Crash active at snapshot time → restored member's live `baseHitChance` reads the pristine value, no baked-in penalty).
- **`RECRUIT_ARCHETYPE_POOL` removed outright** (not deprecated in place) — `archetypes/index.ts` no longer exports it. `Campaign.buildCrew`'s `STARTER_ARCHETYPES` fixed triple was replaced by a `STARTER_CREW_COUNT = 3` loop calling `buildCrewMemberFromRoll` per slot; starter crew ids changed from `crew-<archetypeId>` (collision-prone once duplicates are legal) to `crew-<index>`.
- Three pre-existing tests asserted the retired behavior directly (`buildCrew`'s fixed `[Merc, Razor, Tech]` triple, and the two weighted-pool distribution tests for `generateRecruits`/`generateInitialCandidates`) and were rewritten to assert structure (three unique callsigns, every member a registered non-Decker archetype, rolled stats in range) and the new roll-derived distribution instead.
- `buildCrewMember`'s `BuildCrewMemberOptions`/`BuildCrewMemberSpawn` types were exported (previously module-private) and `BuildCrewMemberOptions` gained `baseHitChance?`/`baseDodgeChance?` so `crewStatRoll.ts` could thread rolled stats through the existing factory without duplicating its callsign-pick/validation logic.
- Verification: full `npm test` (2075 pass, 0 fail), `npm run lint`, `npm run format` all clean.

---

## P3.5.M7 — Archetype unlocks via Score rewards

**Depends on M6** (needs `CREW_STAT_ANCHORS` to gate). **Also depends on the already-shipped P3.M6 "Stolen Blueprints"** meta-progression system (`phase-3-plan.md`) — this milestone extends that system rather than building a new one.

**Design decisions locked in by discussion (2026-07-13):** Berserk/Adept/Chimera join `SCOREABLE_ITEMS` in a single **merged draw pool** — a completed Score nets *either* a new item *or* a new archetype, drawn uniformly from whatever's still unacquired (not a separate/additive reward track, not a fixed unlock order). This means early campaigns (12 candidates: 9 items + 3 archetypes) have roughly a 25% chance per clean Score of drawing an archetype instead of gear, rising as items deplete first. All three new archetypes start **locked** for every meta-crew, including saves that already unlocked every item under the pre-M7 system — `unlockedArchetypes` is a wholly new, independently-empty store key; nothing grandfathers in from item-unlock history.

**New module `src/game/archetypeUnlocks.ts`** (mirrors `scoreableUnlocks.ts` exactly — same validation contract, same "absent → `[]`, malformed → throw, idempotent archive" shape):
```ts
export function normalizeUnlockedArchetypes(value: unknown): string[]
export function archiveUnlockedArchetype(list: readonly string[], id: string): { list: string[]; added: boolean }
```

**New descriptor table `src/game/archetypeRewards.ts`** (sibling to `items.ts`'s `SCOREABLE_ITEMS`, not folded into it — an archetype reward has no `cost`/`scope`/`needsTarget`, it isn't a shop purchase):
```ts
export type ArchetypeReward = { id: CrewArchetypeId; label: string; flavor: string };
export const SCOREABLE_ARCHETYPES: readonly ArchetypeReward[] = Object.freeze([
  { id: 'berserk', label: 'Combat-Stim Rig', flavor: '<proposed — refine>' },
  { id: 'adept',   label: 'Psychic Interface Cradle', flavor: '<proposed — refine>' },
  { id: 'chimera', label: 'Nanite Culture Sample', flavor: '<proposed — refine, keep ambiguous per Chimera fiction>' },
]);
export const SCOREABLE_ARCHETYPE_IDS: ReadonlySet<CrewArchetypeId> = Object.freeze(new Set(SCOREABLE_ARCHETYPES.map(r => r.id)));
```
Flavor lines are placeholders for the as-built pass — should read as "what got reverse-engineered," matching the `SCOREABLE_ITEMS` convention (e.g. Monoblade's "a monomolecular blade schematic"), not as a description of the archetype's kit.

**`DataStore.ts`:** add `unlockedArchetypes: string[]` following the exact `unlockedScoreableItems` pattern at every site that field touches (`KPData`, private field + default, `save`/`restore`, `get unlockedArchetypes()`, `archiveUnlockedArchetype(id)` → emits a change event). Same file, same shape, new key — no shared plumbing beyond copy-paste-adapt.

**`Campaign.ts` — merged payload draw.** `pickScorePayload` (`Campaign.ts:140-146`) becomes payload-kind-aware:
```ts
export type ScorePayload =
  | { kind: 'item'; item: Item }
  | { kind: 'archetype'; reward: ArchetypeReward };

function pickScorePayload(
  seed: number,
  acquiredItemIds: readonly string[],
  acquiredArchetypeIds: readonly string[]
): ScorePayload | null {
  const items = SCOREABLE_ITEMS.filter(i => !acquiredItemIds.includes(i.id))
    .map((item): ScorePayload => ({ kind: 'item', item }));
  const archetypes = SCOREABLE_ARCHETYPES.filter(r => !acquiredArchetypeIds.includes(r.id))
    .map((reward): ScorePayload => ({ kind: 'archetype', reward }));
  const pool = [...items, ...archetypes];
  if (pool.length === 0) return null;   // exhausted — both catalogs fully acquired
  const rng = new Rng(((seed >>> 0) ^ SCORE_PAYLOAD_SALT) >>> 0);
  return pool[Math.floor(rng.next() * pool.length)] ?? null;
}
```
Pool exhaustion (→ `ABSTRACT_SCORE_TARGETS` fallback, `Campaign.ts:148-` ) now requires **both** catalogs fully acquired, not just items.

`buildScoreContract` (`Campaign.ts:899`) gains a second parameter `unlockedArchetypeIds: readonly string[] = []` alongside the existing `unlockedScoreableIds`, threaded into `pickScorePayload`. Briefing/objective copy composition needs an archetype-flavored branch (frame the heist around reverse-engineering an operative-class technology, not a specific weapon/implant) alongside the existing item-flavored copy.

**Settlement (`Campaign.ts:847-860`):** the `completedScoreRun` branch currently does `this.meta.scoreUnlockedItemId = payloadId`. Rework to read the drawn `ScorePayload`'s kind and set exactly one of `this.meta.scoreUnlockedItemId` / `this.meta.scoreUnlockedArchetypeId` (never both — one Score, one reward). New getter `scoreUnlockedArchetypeId` mirrors `scoreUnlockedItemId` (`Campaign.ts:872-875`): validates against `SCOREABLE_ARCHETYPE_IDS`, returns `null` for stale/foreign/absent.

**`shellRuntime.ts` (mirror every `unlockedScoreableItems`/`archiveScoreableItem` site — `shellRuntime.ts:764,784,820,897,1271-1272`):** each `dataStore.unlockedScoreableItems` read that feeds `buildScoreContract` also reads `dataStore.unlockedArchetypes` and passes it through; the settlement block (`shellRuntime.ts:1271-1272`) grows a parallel `if (unlockedArchetypeId) dataStore.archiveUnlockedArchetype(unlockedArchetypeId)`.

**`campaignSummary.ts` (`:49,88`):** `scoreUnlockedItemId?: string | null` gains a sibling `scoreUnlockedArchetypeId?: string | null`; `resolveScoreReward` grows an archetype-reward branch for the chronicle/history view.

**Gating the derivation table (the M6 tie-in).** `crewStatRoll.ts`'s `deriveArchetype` gains an optional anchor-subset parameter rather than M6 needing any awareness of locks:
```ts
export function deriveArchetype(
  stats: { hitChance: number; dodgeChance: number },
  anchors: readonly CrewStatAnchor[] = CREW_STAT_ANCHORS
): CrewArchetypeId
```
M7 supplies a filtered table — `CREW_STAT_ANCHORS.filter(a => !SCOREABLE_ARCHETYPE_IDS.has(a.archetype) || unlockedArchetypes.has(a.archetype))` — so a locked archetype's anchor is simply absent from the nearest-anchor search and every roll that would've landed there saturates to its nearest *unlocked* neighbor, exactly the same mechanism M6 already uses for rolls that overrun the anchor hull (documented corner-saturation behavior, M6). No new derivation logic — a locked Berserk/Adept/Chimera is structurally identical to "outside the widened roll range."

**Threading unlock state into crew generation.** Because a completed Score both grants exactly one reward *and* ends the campaign in the same step, `unlockedArchetypeIds` **cannot change mid-campaign** — unlike `unlockedScoreableIds` (read live from `DataStore` at each of several call sites via `shellRuntime.ts`), it's safe and simpler to capture once as **Campaign construction-time state** rather than threading it as a parameter through every `buildCrew`/`generateRecruits`/`generateInitialCandidates` call site (some of which are called from inside `Campaign` itself, not just from `shellRuntime` — `Campaign.ts:451,608,629`). Proposed: `Campaign`'s constructor/restore path accepts `unlockedArchetypeIds: readonly string[]` (from `dataStore.unlockedArchetypes` at Campaign creation, same lifecycle moment `rng` is set), stores it as a readonly instance field, and `buildCrew`/`generateRecruits`/`generateInitialCandidates` read that field when calling `buildCrewMemberFromRoll`. **Flag for implementer confirmation:** this assumes Campaign construction is the only place unlock state needs to enter — verify no code path calls these three generation methods before Campaign is fully constructed from a fresh `DataStore` read.

**Critical files:** `src/game/archetypeUnlocks.ts` (new), `src/game/archetypeRewards.ts` (new), `src/game/crewStatRoll.ts` (amend M6's `deriveArchetype` signature), `src/game/Campaign.ts`, `src/DataStore.ts`, `src/shell/shellRuntime.ts`, `src/game/campaignSummary.ts`.

**Tests:** `tests/unit/game/archetypeUnlocks.test.ts` (new, mirrors `scoreableUnlocks.test.ts`), extend `tests/unit/game/crewStatRoll.test.ts` (locked-anchor sweep: with only `{merc, razor, tech}` unlocked, every one of the 546 tuples still resolves to a registered *unlocked* archetype, no dead zones, no throw; each locked archetype's own anchor point resolves to a different, unlocked archetype), extend `tests/unit/game/Campaign.test.ts` (`pickScorePayload` draws from the merged pool; exhaustion requires both catalogs empty; settlement sets exactly one of the two meta fields, never both), extend `tests/unit/game/persistence.test.ts`/`DataStore.test.ts` (`unlockedArchetypes` round-trip, legacy-absent → `[]`, malformed → throw, idempotent archive), extend `tests/unit/game/campaignSummary.test.ts` (archetype-reward chronicle line).

**Implementation notes (as-built):**
- **Gating polarity: "omitted → ungated" at the engine level, not "locked."** `CampaignOptions.unlockedArchetypeIds` is `unknown`, validated, and stored as `readonly string[] | null` — `null` (the option genuinely omitted) means `#crewStatAnchors()` returns the full unfiltered `CREW_STAT_ANCHORS`, matching every pre-M7 test's assumption that a bare `new Campaign({ seed })` reaches all six archetypes. A real array (including `[]`) gates. This was a deliberate resolution of a tension the plan's own M6 Verification note flagged ("M7 will otherwise have shrunk the live anchor table to `{merc, razor, tech}`"): defaulting the *shell's* production behavior to locked (every real construction site explicitly threads `dataStore.unlockedArchetypes`) while keeping the *engine's* bare default permissive, so none of M6's already-shipped "all six reachable" tests needed rewriting. `buildCrew` picked up the same amendment shape M6 already gave `deriveArchetype`: an optional `anchors: readonly CrewStatAnchor[] = CREW_STAT_ANCHORS` parameter.
- **`Campaign.#crewStatAnchors()`** is the single gating chokepoint `buildCrew` (via the constructor), `generateRecruits`, and `generateInitialCandidates` all read from — computed via `CREW_STAT_ANCHORS.filter(a => !SCOREABLE_ARCHETYPE_IDS.has(a.archetype) || unlocked.includes(a.archetype))`, exactly the formula the plan specified.
- **Real construction sites updated in `shellRuntime.ts`:** `startFreshCampaign` and the live-resume branch of `resumeCampaign` (`restoreCampaign(record, { unlockedArchetypeIds: dataStore.unlockedArchetypes, ... })`) both thread live meta-store state. The validation-only round-trip in `persistValidatedCampaignForRestart` (constructs and immediately discards a throwaway `Campaign` to confirm a snapshot deserializes) was deliberately left ungated — nothing gating-dependent is ever called on that instance.
- **`ScorePayload` discriminated union** (`{ kind: 'item'; item: Item } | { kind: 'archetype'; reward: ArchetypeReward }`) shipped exactly as drafted; `scorePayloadArchetypeId` was added as `scorePayloadItemId`'s sibling, reading `objective.params.scoreArchetypeId`. `Campaign.#scoreRewardSummary` (the campaign's own internal chronicle-line helper, distinct from `campaignSummary.ts`) also gained an archetype branch — not explicitly called out in the plan's file list, but it reads the same contract params and would have silently gone blank on an archetype win otherwise.
- **`campaignSummary.ts`'s `resolveScoreReward` takes both ids** (`itemId`, `archetypeId`) rather than being duplicated into a second function — `CampaignSummaryScoreReward` stays a single non-discriminated `{id, label, flavor}` shape shared by both reward kinds (the win screen/Chronicle render them identically), matching the plan's "no new type" implication.
- **Pre-existing test fallout, not a design change:** `scoreFinal.test.ts`'s item-exclusivity tests (P3.M6.4/M6.5) predate the merged pool and hardcode seed→item mappings; every `buildScoreContract(...)` call there now also passes `ALL_ARCHETYPES_ACQUIRED = ['berserk','adept','chimera']` as the second argument so the pool stays item-only and every existing assertion keeps its original meaning. `campaignSummary.test.ts`'s one end-to-end win-summary test broadened its assertion to accept either reward catalog (it was never pinned to a specific draw).
- **Offline precache (`sw-core.js`) gap closed, broader than just this milestone's new files.** Beyond the three new M6/M7 modules (`crewStatRoll.js`, `archetypeUnlocks.js`, `archetypeRewards.js`), the already-flagged pre-existing gap (`Adept.js`/`mindInfluence.js` and all of `src/game/cyber/` missing since before P3.5.M5 — see auto-memory `sw-precache-adept-gap`) was fixed in the same pass, plus `scoreableUnlocks.js` (P3.M6, directly adjacent to the new `archetypeUnlocks.js`) and `entities/JackInPoint.js` (the Cyberspace entry point — none of the cyber/ files work offline without it). **Deliberately left alone as a separate, unrelated gap:** `CombatInventory.js`/`CrewInventory.js`/`InventoryOverlay.js`/`visionSync.js` (pre-existing omissions from the 3.3-inventory phase, out of scope here).
- **Found and fixed a live production break, unrelated to this milestone's design but discovered while touching `sw-core.js`.** The prior commit on this branch (`d87fb2c`, "Chimera...") bumped `sw-release.js`'s `version` to `'0.3.5'` but left `sw.js`/`sw-dev.js`'s `VERSION` const at `'0.3.5b'` — `sw.js` has a strict `self.KernelPanicRelease.version !== VERSION` throw on install, so the production service worker as last committed would have thrown on load. Fixed by aligning all three to `'0.3.6'` (no `'b'` suffix) as part of this milestone's version bump; `shellEpoch` stayed at `2` (no runtime module was removed/renamed, only added — same posture M3/M5 took).
- Verification: full `npm test` (2109 pass, 0 fail), `npm run lint`, `npm run format` all clean.

---

## P3.5.M7.1 — Showcase slot for newly-unlocked archetypes (follow-up, added 2026-07-14)

**User request:** "the first new campaign after unlocking a new archetype, we should make sure that the first of the three open crew candidate slots is reserved for an instance of that archetype." A clean Score win unlocking Berserk/Adept/Chimera is otherwise no guarantee the player ever actually sees it — the ordinary roll-then-derive pipeline (M6) only gives it the same ~13–21% shot as everything else. This closes that gap: a win is immediately followed by a guaranteed chance to try what was just unlocked.

**Design:**
- **`DataStore.pendingArchetypeShowcase: string | null`** (new module `src/game/archetypeShowcase.ts`, `normalizePendingArchetypeShowcase` — mirrors the `scoreableUnlocks.ts`/`archetypeUnlocks.ts` validation shape but scalar, not a list: at most one showcase can ever be pending, since the only way to unlock an archetype — winning a Score — always ends the campaign in the same step, so there's always a "next campaign start" between any two unlocks in normal play). `DataStore.archiveUnlockedArchetype(id)` arms it atomically alongside the unlock itself on a genuinely new add (a duplicate/no-op archive leaves an already-pending showcase untouched — re-unlocking something already unlocked can't happen, but re-*archiving* the same id idempotently must not re-arm a showcase the player already saw). A new `DataStore.clearPendingArchetypeShowcase()` clears it.
- **`Campaign` gains `showcaseArchetypeId`** (constructor option + readonly instance field, same construction-time-capture lifecycle as `unlockedArchetypeIds`), accepting `undefined`, `null`, or a non-empty string (both `undefined` and `null` mean "no showcase" — `DataStore`'s getter naturally yields `null`, not `undefined`, so both had to be accepted or every real call site would need an `?? undefined` dance).
- **`generateInitialCandidates()`** reserves slot 0 via a new private `#buildShowcaseCandidate()`: if `showcaseArchetypeId` is set *and* still reachable under the campaign's own gating (`#crewStatAnchors()` — defensive; should always hold in the live shell since the DataStore write is atomic, but a stale/hand-edited save must not be able to crash campaign-start recruitment or leak a locked archetype into the pool over a cosmetic nicety), it fills slot 0 and the remaining two slots roll normally. `buildCrew` (the fixed always-3-member path, not reachable from the live shell — `startFreshCampaign` always passes `crew: []` and drives the actual 3-candidate/pick-2 flow through `generateInitialCandidates`/`recruitInitial`) was deliberately left untouched — the user's ask was specifically about "the three open crew candidate slots," which is that pool.
- **New `crewStatRoll.ts` export `buildCrewMemberFromRollForArchetype`**: rejection-sampling roll — repeatedly `rollCrewStats` on a forked substream until `deriveArchetype` classifies to the requested archetype, then builds via the normal `buildCrewMember` path. Chosen over just pinning the archetype's exact anchor point so the showcased operator still has natural roll variance like every other candidate, rather than standing out as a fixed stat line every time. Bounded by a generous `maxAttempts` (2000) — a crash-over-hang backstop, not a tuned budget; expected attempts are in the single digits given M6's ~13–21%-per-archetype partition. Throws if the archetype has no anchor in the supplied table at all (an unconditional contract violation, not something to silently ignore) or if attempts are exhausted (astronomically unlikely).
- **Consumption timing:** `startFreshCampaign()` *peeks* `dataStore.pendingArchetypeShowcase` (doesn't consume) when constructing the new `Campaign`. The flag is only cleared in `onInitialRecruited()`, once `campaign.recruitInitial(memberIds)` actually commits — regardless of which two of the three candidates were picked, the showcase's job (guaranteeing the player *saw* the option) is done at that point. This ordering matters: the pre-recruitment phase of a fresh campaign is never persisted to `DataStore` (`Campaign.crew.length === 0` — no world/hub built yet), so a browser reload or an abandoned attempt at the initial-recruit screen would otherwise permanently burn the showcase before the player ever laid eyes on it, since `startFreshCampaign()` reruns from scratch on next load.

**Critical files:** `src/game/archetypeShowcase.ts` (new), `src/DataStore.ts`, `src/game/crewStatRoll.ts`, `src/game/Campaign.ts`, `src/shell/shellRuntime.ts`.

**Tests:** `tests/unit/game/archetypeShowcase.test.ts` (new), extend `tests/unit/DataStore.test.ts` (absent → `null`; atomic arm on new unlock; untouched on a duplicate archive; idempotent clear; corrupt-value throw), extend `tests/unit/game/crewStatRoll.test.ts` (`buildCrewMemberFromRollForArchetype` always yields the forced archetype with varying stats across seeds, works for all six non-Decker archetypes, throws when the archetype has no anchor in the supplied table, applies rolled armor, doesn't desync from `buildCrewMemberFromRoll`'s fork-then-build determinism shape), extend `tests/unit/game/Campaign.test.ts` (slot 0 reserved across seeds; remaining slots still vary; unique callsigns/ids preserved; ordinary no-showcase path unchanged; defensive no-op when the showcased archetype isn't actually gated-unlocked; constructor validation for malformed/`null`/omitted `showcaseArchetypeId`).

Verification: full `npm test` (2131 pass, 0 fail), `npm run lint`, `npm run format` all clean. `shellRuntime.ts`'s wiring itself has no dedicated unit tests (consistent with existing project practice — see auto-memory `shell-runtime-untestable`); the model-level contract it drives (`Campaign.showcaseArchetypeId` → `generateInitialCandidates` → `DataStore.clearPendingArchetypeShowcase`) is what's covered above.

---

## Out of scope, parked

- Multi-floor maps, faction rep/NPC social, neural backups — existing Phase 4 deferrals per [phase-3-plan.md](phase-3-plan.md), unaffected by any of this.

## Verification

Per milestone: `npm test` (typecheck + build tests + `node --test`) must pass, including the new/updated unit tests listed above. Additional end-to-end checks:

- **M1:** drive a combat run where a Razor slides, confirm stealth clears on schedule (regression); construct a synthetic stunned entity and confirm it takes 0 AP that turn via the actual `TurnQueue.endTurn` path, not just the unit-level `refreshAp` call.
- **M2:** play a Decker to EMP with a teammate adjacent — confirm the ally is stunned too (0 AP next refresh) and a corp unit in radius is stunned.
- **M3:** play a Berserk through a full surge→crash cycle — confirm damage/AP bonus **and +1 armor** during surge (the armor pane shows in the HUD), confirm the **surge and crash screen pulses** fire, confirm crash auto-applies on expiry with the accuracy penalty visible in the HUD hit-chance display, confirm crash itself expires cleanly back to baseline after its (now longer) window.
- **M4:** play an Adept, confirm Influence behaves identically to the old Override (aim-sector targeting, success roll, alarm on failure, countdown-and-revert) end to end; confirm `mindInfluence.test.ts` covers the mechanic independent of any archetype wiring.
- **M5:** play a Chimera, kill a hostile, collect its scrap drop, convert it to HP — confirm repeatable across turns as long as scrap lasts and HP clamps at max.
- **M6:** start several fresh campaigns (different seeds) and confirm crew stats vary run-to-run, land on the 0.01 grid within the widened `[0.65,0.85]`/`[0.15,0.40]` ranges (no clustering onto a few repeated values like the old discrete buckets), and archetypes span all six non-Decker options across enough campaigns; save mid-campaign, reload, confirm rolled stats round-trip; load a pre-P3.5 save fixture (or a save snapshot lacking `baseHitChance`) and confirm it restores to the old fixed per-archetype constant rather than crashing or silently rerolling. **Run this check against a fixture with all three M7 archetypes pre-unlocked** (M7 will otherwise have shrunk the live anchor table to `{merc, razor, tech}` by the time M7 ships) so M6's own "all six reachable" claim stays independently verifiable.
- **M7:** play a fresh meta-crew (empty `unlockedArchetypes`) through a full campaign to a clean Score win and confirm the reward is drawn from the merged pool (item or archetype, never both, matches what settlement recorded); confirm a won archetype reward persists in `DataStore` across a new campaign and that a subsequent crew roll can now land the newly-unlocked archetype (a fixture forcing a roll onto its exact anchor point is the deterministic way to prove this, rather than replaying rolls until one lands); confirm a **locked** archetype's anchor point saturates to its documented nearest unlocked neighbor instead of dead-zoning or throwing; confirm a `score-partial` outcome writes nothing to either meta-store key.
- Full regression: `npm test` at the end of the phase, plus a manual playthrough covering all seven archetypes (Merc/Razor/Tech/Decker/Berserk/Adept/Chimera) in one run **using a save fixture with `unlockedArchetypes` pre-seeded to all three** (per the dropped single-campaign gate above, a truly blank-slate save can't reach this state) to catch any wiring gaps in the fan-out surfaces (`Run.ts`, `persistence.ts`, `applyIntent.ts`).
