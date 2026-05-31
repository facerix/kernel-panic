# Phase 2.7 Plan — Enemy roles & tier doctrine (pre–Phase 3)

Living plan for the post–Phase 2.6.5, pre–Phase 3 slice of Kernel Panic: turn the enemy roster from a single-verb stat block (skirmisher-only) into a **role taxonomy** with a **tier doctrine** that controls encounter composition and per-tier stat scaling. **Target release: `v0.2.7`.** See [phase-2.6-plan.md](phase-2.6-plan.md) for resilience/placement foundations, [phase-2.6.5-plan.md](phase-2.6.5-plan.md) for the pre–2.7 balance/help slice, [phase-2.5-plan.md](phase-2.5-plan.md) for the completed Meatspace-depth slice, [phase-3-plan.md](phase-3-plan.md) for the campaign arc + Cyberspace this feeds into, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision, and [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md) for the source inspiration that seeded this work.

## Why this phase exists

Playtesting after Phase 2.5 surfaced four problems. **The first three are symptoms of the fourth:**

1. **Drones close on the player.** `CorpDrone` only ever steps *toward* its target (to reach firing range); it has no notion of "too close." With no melee and no armor, standing at point-blank is tactically suicidal for it, but it does so anyway.
2. **Melee threats die on arrival.** A melee enemy that spends its whole turn closing on the *enemy* phase opens the *player* phase with a full 4 AP against an adjacent, undefended target — two melee swings drop it. "Scary on approach, free kill on arrival."
3. **Support roles have nothing to support.** A medic that heals or shields allies only matters when something on the board is durable enough for partial damage to persist a turn. Without durable patients, players just finish kills and the support role is dead weight.
4. **"Tier" is just a spawn multiplier.** `CONTRACT_DIFFICULTY` today only scales `threatCount` (2 → 3 → 4 drones). Higher tier = more of the same enemy, nothing else. No role progression, no per-tier stat scaling, no priority-target puzzle.

Every hostile currently has **one verb and no defensive identity**, so fights degenerate into "advance and trade HP." The cure is **tactical roles** hung off a redefined tier system where tier selects *who* spawns and *how tough* they are — not merely *how many*.

**Direction chosen:** tier = **role composition *and* per-tier stat scaling** (not stats-only, not roles-only).

---

## Enemy archetypes (the roster)

Eight buildable roles, grouped by the tier they belong to. Faction names from the C2077 list (Thug, Goon, Armored Enforcer, Field Techie…) are **flavor reskins** in Phase 2.8 — here we define behavior classes only.

### Tier 1 — Fodder

One verb each. Low HP, no armor, no force-multiplier behavior. Threat comes from **numbers and positioning**, not individual durability.

| Archetype | Class | Verb | Defensive identity | Status |
|-----------|-------|------|--------------------|--------|
| **Skirmisher** | `CorpDrone` | ranged plink, **maintain distance** | none — must kite or die at melee range | exists; needs kiting (M2.1) |
| **Guard** | `CorpGuard` | close + melee strike | none — trades HP openly | new (M2.2) |

Both archetypes share the patrol → investigate → engage state machine (`CorpDrone` is the reference). Guards are the melee counterpart to skirmishers: they close and swing, nothing more. They exist so T1 encounters can mix ranged and melee pressure without importing T3 defensive mechanics.

### Tier 2 — Specialists

Each T2 encounter adds **exactly one force-multiplier** on top of fodder. The specialist makes the fodder dangerous; killing the specialist defuses the encounter. This is where the **priority-target puzzle** begins.

| Archetype | Class | Verb | Force-multiplier effect | Status |
|-----------|-------|------|-------------------------|--------|
| **Sniper** | `CorpSniper` | **telegraphed** long-range burst | punishes open LOS; two-phase aim → fire | new (M3.1) |
| **Spotter** | `CorpSpotter` | mobile LOS + **per-turn target share** | re-targets hostiles every turn; never attacks | new (M3.2) |
| **Medic** | `CorpMedic` | ally-seeking shield / heal | changes fight math for durable allies | new (M3.3) |

Specialists are **killable** — they may have a defensive twist (sniper range, spotter evasiveness) but are not mini-bosses. A medic is **never spawned alone**; composition rules require at least one durable ally (a T3 elite or a tier-scaled bruiser) in the same encounter.

#### CorpCivilian vs CorpSpotter

Both can appear on the same map, but they are **not the same role**. `CorpCivilian` already exists as ambient map pressure; `CorpSpotter` is a T2 combat specialist. Do not merge them.

| | `CorpCivilian` (ambient) | `CorpSpotter` (T2 specialist) |
|---|---|---|
| **Placement** | Prefab-authored (`office` spawns) | Composition roll (`ELEVATED` contracts) |
| **Type** | `Entity` — non-combatant | `Hostile` — counts in threat budget |
| **Movement** | Stationary (desk clerk) | Mobile — seeks vantage tiles with LOS |
| **Alarm mechanism** | `world.raiseAlarm()` — **facility latch** (quiet → alert → cooldown) | Direct `ALARM` bus ping — **no facility state change** |
| **Cadence** | Once per alert window; suppressed while `alarmActive` | **Every corp turn** while alive and holding LOS |
| **Rep** | Triggers `REP.ALARM_PENALTY` on facility raise | No facility alarm; no Rep penalty from spotter pings alone |
| **Smoke / cover** | **COVER tiles fully block LOS** — sneak past cubicles/desks; walls still block | Standard LOS — cover does not block sight (same as combat); can **reposition** to a new angle |
| **Player puzzle** | Route behind cover to slip past desk clerks undetected | Kill the spotter or keep breaking its LOS while it hunts a new angle |

Civilians answer "the building noticed you." Spotters answer "this fireteam is coordinating on you right now." A T2 contract on an office map may have both — ambient desk clerks *and* a rolled spotter in the hostile roster.

**CorpCivilian cover-occluded LOS (M1.4):** Today `CorpCivilian` uses the shared `hasLineOfSight` helper, which treats COVER as transparent (cover only penalizes *fire* in `Combat`, not sight). Change the civilian alarm check to a **civilian-specific sight test** where any COVER tile strictly between observer and target breaks the line — same geometry as wall occlusion, scoped to this call site only. Global combat LOS stays unchanged. This gives players a stealth affordance: hug cover to slip past prefab desk clerks without tripping the facility alarm. **The same helper inverts for `CorpFlanker` (M4.3):** cover between player and flanker hides the flanker from rendering and player targeting. Spotters deliberately keep standard LOS so cover alone cannot permanently neutralize a T2 specialist.

### Tier 3 — Elites

Durable and/or multi-verb. Mini-boss feel. **Per-tier stat scaling** (HP, AP, armor) applies here — the same bruiser class at T3 is survivable; at T1 it doesn't exist (guards fill that slot instead).

| Archetype | Class | Verbs | Defensive identity | Status |
|-----------|-------|-------|--------------------|--------|
| **Bruiser** | `CorpBruiser` | close + melee, **punish disengage** | `damageReduction` + knockback-on-hit | new (M4.1) |
| **Juggernaut** | `CorpJuggernaut` | suppressing ranged fire, slow advance | high HP + armor, low AP | new (M4.2) |
| **Flanker** | `CorpFlanker` | stalk from cover → **SLIDE** → melee ambush | cover-occluded from player + post-slide vanish | new (M4.3) |

Elites are the canonical **durable patients** for medics and the **stat-scaling showcase** for the tier system.

### Deferred — Phase 3 on-ramp

| Archetype | Class | Verb | Blocker | Status |
|-----------|-------|------|---------|--------|
| **Netrunner** | `CorpNetrunner` | ranged disruption (AP drain, turret stun) | requires status-effect system | M5 (deferred) |

---

## Tier doctrine

A tier is **what kind of threat composition the encounter introduces**, with stats attached — not a head-count knob.

### Composition rules

| Tier | Contract difficulty | Encounter shape | Archetypes allowed | Stat posture |
|------|---------------------|-----------------|-------------------|--------------|
| **T1 — Fodder** | `STANDARD` | N× fodder (skirmishers and/or guards) | Skirmisher, Guard only | Baseline HP/AP, zero armor |
| **T2 — Specialist** | `ELEVATED` | fodder + **1 specialist** | Skirmisher, Guard + exactly one of {Sniper, Spotter, Medic} | Specialist at baseline; fodder count unchanged or +1 |
| **T3 — Elite** | `CRITICAL` | fodder + specialist + **1 elite**, *or* fodder + elite on lighter rolls | All T1/T2 + exactly one of {Bruiser, Juggernaut, Flanker} | Elite gets tier-scaled HP/AP/armor; fodder stays baseline |

**Mapping note:** `CONTRACT_DIFFICULTY` (`STANDARD` / `ELEVATED` / `CRITICAL`) maps 1:1 to enemy tier (T1 / T2 / T3). The Curator's existing `threatCount` per difficulty becomes the **fodder count** within the composition, not the total hostile count — a T2 contract with `threatCount: 3` means 3 fodder *plus* 1 specialist.

### Stat scaling

Per-tier scaling is keyed to **(role, tier)** so the same class can be fragile or durable without globally inflating numbers:

| Stat | T1 | T2 | T3 |
|------|----|----|-----|
| HP multiplier | 1.0× | 1.0× (fodder) / 1.0× (specialist) | 1.0× (fodder) / 1.25× (specialist) / **1.5×+ (elite)** |
| AP bonus | 0 | 0 | 0–1 (elite only) |
| Armor floor (`damageReduction`) | 0 | 0 (specialist may have role-specific defense) | **≥1 for bruiser/juggernaut** |

Fodder stays at baseline across all tiers — tier difficulty comes from *who else is in the room*, not inflated drone HP.

### Encounter examples

| Difficulty | Seed-driven roll | Result |
|------------|------------------|--------|
| STANDARD | 2 skirmishers | `[Drone, Drone]` — learn ranged spacing |
| STANDARD | 1 skirmisher + 2 guards | `[Drone, Guard, Guard]` — ranged + melee pressure |
| ELEVATED | 3 fodder + sniper | `[Drone, Guard, Guard, Sniper]` — break LOS or eat the burst |
| ELEVATED | 2 fodder + spotter | `[Drone, Guard, Spotter]` — kill spotter or keep breaking its LOS as it repositions |
| CRITICAL | 2 fodder + medic + juggernaut | `[Drone, Guard, Medic, Juggernaut]` — priority puzzle: medic + soak |
| CRITICAL | 3 fodder + bruiser | `[Drone, Drone, Guard, Bruiser]` — knockback tax on melee approach |
| CRITICAL | 3 fodder + flanker | `[Drone, Drone, Guard, Flanker]` — watch the cubicles; closes from cover you can't see into |

All rolls derive from the contract seed (deterministic, save-compatible).

---

## Current status

> **Depends on [Phase 2.6](phase-2.6-plan.md):** placement consolidation (`nudgeIfOccupied`), `Entity.heal()`, and the error boundary land there. This phase assumes them.

| Milestone | Status |
|---|---|
| M1 — Tier doctrine foundations | 🟡 In progress |
| M1.1 — `EnemyTier` model + per-tier stat scaling hook | ✅ Complete |
| M1.2 — `damageReduction` (armor) stat on `Entity` | ✅ Complete |
| M1.3 — Encounter composition by tier (roles, not just counts) | 🟡 In progress — deterministic resolver landed; Run/map role-anchor wiring pending role classes |
| M1.4 — CorpCivilian cover-occluded LOS | ✅ Complete |
| M2 — Tier 1 fodder roster | 🔲 Not started |
| M2.1 — Skirmisher kiting (`CorpDrone` preferred engagement band) | 🔲 Not started |
| M2.2 — Guard (`CorpGuard` — melee fodder) | 🔲 Not started |
| M3 — Tier 2 specialists | 🔲 Not started |
| M3.1 — Sniper (telegraphed long-range burst) | 🔲 Not started |
| M3.2 — Spotter (mobile per-turn target share; not CorpCivilian) | 🔲 Not started |
| M3.3 — Medic (proactive shield + heal; patient-gated spawn) | 🔲 Not started |
| M4 — Tier 3 elites | 🔲 Not started |
| M4.1 — Bruiser (armor + knockback-on-hit) | 🔲 Not started |
| M4.2 — Juggernaut (armor soak + suppression) | 🔲 Not started |
| M4.3 — Flanker (cover concealment + Razor-mirror SLIDE) | 🔲 Not started |
| M5 — Netrunner / disruption (status-effect groundwork) | 🔲 Deferred-candidate (feeds Phase 3) |

**Phase 2.7** is complete when:

1. Every milestone above is ✅ except M5 (deliberate Phase 3 on-ramp).
2. T1/T2/T3 composition rules are live: STANDARD = fodder only, ELEVATED = fodder + 1 specialist, CRITICAL = fodder + specialist + elite (or fodder + elite).
3. Each archetype in the roster table has a distinct tactical identity verified by tests and playtest — including sharp separation of `CorpCivilian` (ambient facility alarm, cover-occluded LOS) from `CorpSpotter` (mobile T2 specialist, standard LOS).
4. Full campaign loop from Phase 2.6 remains playable offline on iOS Safari + Chrome desktop.
5. `v0.2.7` tagged in git.

---

## Milestones — detail

### M1 — Tier doctrine foundations

**Goal:** Data model and combat primitive that M2–M4 build on. No new enemy behavior here.

#### M1.1 — `EnemyTier` model + per-tier stat scaling hook

- Introduce `EnemyTier` (T1/T2/T3) in `constants.ts`, mapped from `CONTRACT_DIFFICULTY`, with a per-tier scaling profile (HP multiplier, AP bonus, armor floor).
- Enemy constructors accept a tier (or a resolved stat profile) so the same class can be spawned at different durability levels.
- Keep deterministic and seed-driven (mirrors how `contract.difficulty` already flows).
- **TDD:** a given class at T1 vs T3 produces expected HP/AP/armor; mapping is pure given `(class, tier)`.

#### M1.2 — `damageReduction` (armor) stat on `Entity`

- Add `damageReduction` on `Entity` (sibling to `baseDodgeChance`), default `0`, applied in `Combat.ts` (`resolveRanged` and `resolveMelee`).
- **Floor rule:** armor reduces incoming damage but **a hit always does ≥1** (no fully-immune chip-lock).
- **TDD:** armored entity takes reduced damage; ≥1 floor holds; zero-armor entities unchanged.

#### M1.3 — Encounter composition by tier

- Replace difficulty-as-head-count with difficulty-as-composition: tier selects role mix, `threatCount` becomes fodder count.
- Data-driven roll from contract seed in `Run.ts` / placement.
- Composition constraints: T2 always has exactly one specialist; T3 always has exactly one elite; medic never spawns without a durable patient in the encounter.
- **TDD:** composition deterministic per seed; constraint violations impossible.

**Implementation note:** `src/game/encounters.ts` now owns the deterministic role-composition resolver and enforces the medic patient gate. Full Run/map wiring is intentionally still pending until M2/M3/M4 role classes exist, so the game does not silently reskin unimplemented specialists/elites as drones.

#### M1.4 — CorpCivilian cover-occluded LOS

**Problem:** desk clerks see through cubicles. `CorpCivilian.#findPlayerTarget` calls `hasLineOfSight`, which ignores COVER — so cover tiles in office prefabs don't help the player sneak past ambient civilians.

- Add a civilian-scoped sight helper (e.g. `hasConcealedLineOfSight` in `LineOfSight.ts`, or an opt-in flag on the existing function) where **COVER tiles on the Bresenham line block sight** the same way walls do. Smoke should block LOS globally — confirm that it does and modify otherwise, alongside this change.
- Wire `CorpCivilian` alarm checks to the new helper only. **Do not** change `Combat`, drone acquisition, or spotter LOS — combat cover semantics (`COVER_HIT_PENALTY`, `COVER_DODGE_BONUS`) stay as-is. **Reuse the same helper in M4.3** for player → flanker concealment (inverted observer/target).
- **TDD:** civilian does not alarm when COVER lies between clerk and player; civilian still alarms on open LOS; wall block unchanged; combat `canFireRanged` through cover unchanged (regression guard).

**Implementation note:** `LineOfSight.hasConcealedLineOfSight` now treats COVER as an occluder while preserving normal combat LOS semantics. `CorpCivilian` alarm checks use the concealed helper; ranged combat retains fire through cover with the existing hit/dodge modifiers. Smoke already blocks standard LOS and is now covered by regression tests.

### M2 — Tier 1 fodder roster

#### M2.1 — Skirmisher kiting (`CorpDrone`)

**Problem:** drone only `#stepToward`s and never retreats; fights at point-blank with no melee.

- Add **preferred engagement band** (`preferredMin`..`sightRange`). In ENGAGE: if target is closer than `preferredMin` and a further tile exists with LOS + range, step toward the distance-maximising tile instead of firing.
- **Caveats:** don't kite into a dead-end (fall back to firing); drone that already fired may lack AP to retreat — intended tradeoff.
- **TDD:** adjacent drone with retreat room steps away; cornered drone fires; drone at ideal range fires.

#### M2.2 — Guard (`CorpGuard`)

**Goal:** melee fodder counterpart to the skirmisher. Simple close-and-strike, no armor, no knockback.

- Reuse patrol → investigate → engage state machine from `CorpDrone`.
- ENGAGE: step toward target, melee when adjacent and AP allows. No defensive mechanics — trades HP openly.
- Land full plumbing: types, persistence factory, snapshot/restore, loot, `corpTurnStatusCopy`, `kindFromId`.
- **TDD:** guard closes and melees; dies in two player-phase swings at T1 stats; patrol/investigate transitions match drone patterns.

### M3 — Tier 2 specialists

#### M3.1 — Sniper (`CorpSniper`)

- Long range (`SIGHT_RANGE` + bonus), high damage, **two-phase aim → fire**: spends a turn acquiring (NOISE or `aim` step tell) before the shot lands next turn.
- **TDD:** telegraphs turn 1, fires turn 2; breaking LOS during telegraph cancels shot.

#### M3.2 — Spotter (`CorpSpotter`)

**Not `CorpCivilian`.** See [CorpCivilian vs CorpSpotter](#corpcivilian-vs-corpspotter) — civilians stay ambient; spotters are mobile combat specialists.

- Extends `Hostile`. Never attacks. **Mobile** patrol → investigate → spot state machine (reuse drone pathing).
- **Spot mode:** each corp turn, if player is in LOS, emit a direct `ALARM` bus ping with `{ source, target, origin }` — **do not** call `world.raiseAlarm()`. Hostiles subscribed to `ALARM` (drones, guards, …) force-ENGAGE on the shared target, same as today, but the ping repeats every turn the spotter holds sight.
- **No LOS:** path toward last-known position or a vantage tile that restores LOS (prefer tiles with range + sight to player). Smoke blocks LOS like any ranged check — spotter must move to a new angle, unlike a stationary civilian.
- **Rep / facility alarm:** spotter pings do not trip facility latch or stack `REP.ALARM_PENALTY`. Facility alarm remains the civilian/terminal domain.
- Land full plumbing: types, persistence, snapshot/restore, loot, `corpTurnStatusCopy`, `kindFromId`.
- **TDD:** spotter with LOS emits ALARM every turn without calling `raiseAlarm`; allies re-engage on fresh target coords; spotter without LOS moves toward vantage; killing spotter stops pings; civilian `raiseAlarm` behavior unchanged (regression guard).

#### M3.3 — Medic (`CorpMedic`)

- **Ally-seeking shield/heal** using `Entity.heal()` (Phase 2.6). Proactive shielding (temp HP *before* damage) so the medic changes math *during* the fight.
- **Spawn rule (M1.3):** never without a durable patient (bruiser or juggernaut) in the same encounter.
- **TDD:** prefers shielding durable ally about to be focused; lone medic impossible; shield absorbs then expires.

### M4 — Tier 3 elites

#### M4.1 — Bruiser (`CorpBruiser`)

**Problem:** melee that closes on enemy phase dies to a free player burst (symptom #2).

- **Armor** (`damageReduction`, tier-scaled) so chip damage doesn't melt it.
- **Knockback-on-hit** (reuse vault knockback primitive): connected swing shoves player back one tile, forcing AP to re-close.
- Fast and scary — goal is *reaching you costs something*, not sponge HP.
- **TDD:** knockback in away direction (blocked if destination occupied/solid); survives two 1-damage hits that would kill a guard.

#### M4.2 — Juggernaut (`CorpJuggernaut`)

- High HP, meaningful `damageReduction`, **slow** (low AP), suppressing ranged fire. Tempo/attrition check; canonical medic patient.
- **TDD:** survives sustained focus that kills a drone; movement slower than baseline; armor + ≥1 floor hold.

#### M4.3 — Flanker (`CorpFlanker`)

**No facing/backstab.** Top-down ASCII has no orientation today; the elite identity is **cover-concealed stalking** plus a Razor-mirrored **SLIDE** — the inverse of M1.4 civilian sight and the player's own stealth perk.

**Two concealment layers (player perception only):**

1. **Cover occlusion (passive):** When any COVER tile lies strictly between player and flanker, the flanker is hidden — reuse M1.4 `hasConcealedLineOfSight` with `(observer=player, target=flanker)`. No cover on the line → visible unless layer 2 is active.
2. **Slide vanish (active):** A 2 AP **SLIDE** (same geometry as Razor: 2-tile cardinal/diagonal dash, both intermediate and landing tiles passable, silent — no `NOISE` event). On commit, set a `slideConcealed` flag that keeps the flanker **hidden from the player regardless of cover/adjacency** until cleared.

**Slide lifecycle (mirror Razor, inverted faction):**

| | Razor SLIDE | Flanker SLIDE |
|---|---|---|
| Costs | 2 AP | 2 AP |
| Movement | 2-tile silent dash | same |
| Concealment | `stealthed` — drones need adjacency | `slideConcealed` — player cannot see/target |
| Clears on | Player `refreshAp` (start of player's next turn) | Corp `refreshAp` (start of corp's next turn) |
| Persists through | Corp turn | **Player turn** |

So a flanker that SLIDEs on corp turn N vanishes for the player's entire turn N+1, then reappears (subject to cover rules) when corp acts again — "something moved but you didn't see what."

**Locked — same-turn constraint:** SLIDE is **reposition-only** — no melee on the same activation while `slideConcealed` is set. Prevents invisible same-turn hitches (HP loss with no glyph). The beat is: vanish now, emerge and strike next corp turn. With `maxAp: 4`, a typical sequence is SLIDE (2 AP) + step toward cover (1 AP), then melee next corp turn.

- **AI:** prefer cover-occluded paths; SLIDE when it closes distance while maintaining or exiting into a threatening position; melee when adjacent and not `slideConcealed`.
- **Presentation:** hidden flankers omitted from `buildFrame` and player targeting; corp-turn log lines suppressed while concealed. Optional stretch: silent SLIDE still emits a faint NOISE ping (footsteps without a glyph) — decide at implementation.
- **Reuse:** extract or share Razor's two-tile dash validation from `Razor.canSlide` / `slide` rather than duplicating geometry.
- **TDD:** cover hides flanker; SLIDE sets `slideConcealed` and hides even on open LOS/adjacent; flag clears on corp `refreshAp`; no melee same turn as SLIDE; slide silent (no NOISE); guard/bruiser unchanged; civilian M1.4 regression guard holds.

### M5 — Netrunner / disruption — Phase 3 on-ramp

- Ranged **disruptor** applying debuff via LOS (AP-drain, turret stun) instead of HP damage.
- Requires **status-effect system** (`Entity` status field, application/expiry, UI) — Phase 3 wants this for Cyberspace/Decker anyway.
- **Recommendation:** design the primitive here so M1–M4 don't preclude it; **defer implementation to Phase 3** unless M1–M4 land with room. Marked deferred-candidate.

---

## Out of scope

- Cyberspace-side enemies and the Decker (Phase 3).
- Boss/named-encounter scripting beyond T3 mini-boss feel.
- Faction-specific reskins as distinct AI — faction is a theming layer ([phase-2.8-plan.md](phase-2.8-plan.md)).
- Full status-effect system implementation (see M5 / Phase 3).

## Open questions / kaizen notes

- **Corp civilian harm from player-placed breaching charges:** M5 Rep only tracks `FACTION.NEUTRAL` via `civilian:harmed`; killing a `CorpCivilian` (`c` glyph) in a breach blast does not cost Rep or block the clean-extraction bonus, even though the charge is player-planted and the log reads `Blast killed [Corp]Civilian.` Player-planted breach attribution now passes the deployed crew member as `attacker` on `entity:damaged` (so neutral bystanders count). Revisit whether corp-aligned non-combatants should also count toward civilian-casualty Rep / the "no civilian casualties" clean bonus, and whether the flash copy should distinguish corp staff vs neutral bystanders.
- **Knockback into hazards:** should a bruiser's shove push the player into a hazard tile? Decide during M4.1.
- **Armor vs. dodge interaction:** resolved in M1.2 — dodge/miss resolves first; `damageReduction` applies only on a connected hit, with a 1-damage floor. Documented in `Combat.ts`.
- **Sniper telegraph readability:** aim tell must be unmissable on the ASCII/CRT canvas — coordinate with renderer.
- **Flanker SLIDE noise tell:** M4.3 optional footstep NOISE without glyph — lean silent for v0.2.7, add tell if playtests feel unfair.
- **Composition determinism:** all tier/role rolls derive from contract seed (Phase 2.5 standard).
- **UI copy:** contract briefing currently says "N drones" — update to reflect role composition once M1.3 lands.
- **Spotter + civilian coexistence:** office prefabs may spawn ambient civilians on ELEVATED/CRITICAL maps that also roll a spotter specialist — confirm briefing/log copy distinguishes `[Corp]Civilian` from the spotter alias once Phase 2.8 theming lands.
