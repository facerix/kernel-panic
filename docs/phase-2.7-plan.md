# Phase 2.7 Plan — Enemy roles & tier doctrine (pre–Phase 3)

Living plan for the post–Phase 2.6, pre–Phase 3 slice of Kernel Panic: turn the enemy roster from a single-verb stat block (skirmisher-only) into a **role taxonomy** with a **tier doctrine** that controls encounter composition and per-tier stat scaling. **Target release: `v0.2.7`.** See [phase-2.6-plan.md](phase-2.6-plan.md) for resilience/placement foundations this builds on,[phase-2.5-plan.md](phase-2.5-plan.md) for the completed Meatspace-depth slice, [phase-3-plan.md](phase-3-plan.md) for the campaign arc + Cyberspace this feeds into, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision, and [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md) for the source inspiration that seeded this work.

## Why this phase exists

Playtesting after Phase 2.5 surfaced four problems. **The first three are symptoms of the fourth:**

1. **Skirmishers closed on the player (pre-M2.1).** `Skirmisher` only ever stepped *toward* its target (to reach firing range); it had no notion of "too close." With no melee and no armor, standing at point-blank was tactically suicidal for it, but it did so anyway. **Fixed in M2.1** (preferred engagement band + kiting).
2. **Melee threats die on arrival.** A melee enemy that spends its whole turn closing on the *enemy* phase opens the *player* phase with a full 4 AP against an adjacent, undefended target — two melee swings drop it. "Scary on approach, free kill on arrival."
3. **Support roles have nothing to support.** A medic that heals or shields allies only matters when something on the board is durable enough for partial damage to persist a turn. Without durable patients, players just finish kills and the support role is dead weight.
4. **"Tier" is just a spawn multiplier.** `CONTRACT_DIFFICULTY` today only scales `threatCount` (2 → 3 → 4 hostiles). Higher tier = more of the same enemy, nothing else. No role progression, no per-tier stat scaling, no priority-target puzzle.
5. **Every run shares one combat footprint.** `Run.enterCombat` hardcodes **24×16** for all contracts. Seed changes room *layout* inside that box, but traverse distance, leaf count, sniper lanes, and camera panning norms stay in the same band — so STANDARD and CRITICAL *feel* like the same arena size even when difficulty and composition differ.

Every hostile currently has **one verb and no defensive identity**, so fights degenerate into "advance and trade HP." The cure is **tactical roles** hung off a redefined tier system where tier selects *who* spawns and *how tough* they are — not merely *how many*. **Map scale** is a parallel knob: tier should also imply *how much space* the fight occupies, with seed jitter inside that band so two STANDARD gigs still differ in footprint.

**Direction chosen:** tier = **role composition *and* per-tier stat scaling** (not stats-only, not roles-only).

---

## Enemy archetypes (the roster)

Eight buildable roles, grouped by the tier they belong to. Faction names from the C2077 list (Thug, Goon, Armored Enforcer, Field Techie…) are **flavor reskins** in Phase 2.8 — here we define behavior classes only.

### Tier 1 — Fodder

One verb each. Low HP, no armor, no force-multiplier behavior. Threat comes from **numbers and positioning**, not individual durability.

| Archetype | Class | Verb | Defensive identity | Status |
|-----------|-------|------|--------------------|--------|
| **Skirmisher** | `Skirmisher` | ranged plink, **maintain distance** | none — must kite or die at melee range | exists; needs kiting (M2.1) |
| **Guard** | `Guard` | close + melee strike | none — trades HP openly | new (M2.2) |

Both archetypes share the patrol → investigate → engage state machine (`Skirmisher` is the reference). Guards are the melee counterpart to skirmishers: they close and swing, nothing more. They exist so T1 encounters can mix ranged and melee pressure without importing T3 defensive mechanics.

### Tier 2 — Specialists

Each T2 encounter adds **exactly one force-multiplier** on top of fodder. The specialist makes the fodder dangerous; killing the specialist defuses the encounter. This is where the **priority-target puzzle** begins.

| Archetype | Class | Verb | Force-multiplier effect | Status |
|-----------|-------|------|-------------------------|--------|
| **Sniper** | `Sniper` | **telegraphed** long-range burst | punishes open LOS; aim → fire; range conceal while aiming; `SNIPER_SIGHT_RANGE` 12, `SNIPER_DAMAGE` 3 | new (M3.2) |
| **Spotter** | `Spotter` | mobile LOS + **per-turn target share** | re-targets hostiles every turn; never attacks; `SPOTTER_SIGHT_RANGE` 10 | new (M3.1) |
| **Medic** | `Medic` | ally-seeking shield / heal | changes fight math for durable allies | new (M3.3) |

Specialists are **killable** — they may have a defensive twist (sniper range conceal while aiming, spotter evasiveness) but are not mini-bosses. A medic is **never spawned alone**; composition rules require at least one durable ally (a T3 elite or a tier-scaled bruiser) in the same encounter.

#### CorpCivilian vs Spotter

Both can appear on the same map, but they are **not the same role**. `CorpCivilian` already exists as ambient map pressure; `Spotter` is a T2 combat specialist. Do not merge them.

| | `CorpCivilian` (ambient) | `Spotter` (T2 specialist) |
|---|---|---|
| **Placement** | Prefab-authored (`office` spawns) | Composition roll (`ELEVATED` contracts) |
| **Type** | `Entity` — non-combatant | `Hostile` — counts in threat budget |
| **Movement** | Stationary (desk clerk) | Mobile — seeks vantage tiles with LOS |
| **Alarm mechanism** | `world.raiseAlarm()` → `ALARM` with `kind: 'facility'` — **facility latch** (quiet → alert → cooldown) | Direct `ALARM` bus ping with `kind: 'spotter'` — **no facility state change** |
| **Cadence** | Once per alert window; suppressed while `alarmActive` | **Every corp turn** while alive and holding LOS |
| **Rep** | Triggers `REP.ALARM_PENALTY` on facility raise | No facility alarm; no Rep penalty from spotter pings alone |
| **Smoke / cover** | **COVER tiles fully block LOS** — sneak past cubicles/desks; walls still block | Standard LOS — cover does not block sight (same as combat); can **reposition** to a new angle |
| **Player puzzle** | Route behind cover to slip past desk clerks undetected | Kill the spotter or keep breaking its LOS while it hunts a new angle |

Civilians answer "the building noticed you." Spotters answer "this fireteam is coordinating on you right now." A T2 contract on an office map may have both — ambient desk clerks *and* a rolled spotter in the hostile roster.

**CorpCivilian cover-occluded LOS (M1.4):** Today `CorpCivilian` uses the shared `hasLineOfSight` helper, which treats COVER as transparent (cover only penalizes *fire* in `Combat`, not sight). Change the civilian alarm check to a **civilian-specific sight test** where any COVER tile strictly between observer and target breaks the line — same geometry as wall occlusion, scoped to this call site only. Global combat LOS stays unchanged. This gives players a stealth affordance: hug cover to slip past prefab desk clerks without tripping the facility alarm. **The same helper inverts for `Flanker` (M4.3):** cover between player and flanker hides the flanker from rendering and player targeting. Spotters deliberately keep standard LOS so cover alone cannot permanently neutralize a T2 specialist.

### Tier 3 — Elites

Durable and/or multi-verb. Mini-boss feel. **Per-tier stat scaling** (HP, AP, armor) applies here — the same bruiser class at T3 is survivable; at T1 it doesn't exist (guards fill that slot instead).

| Archetype | Class | Verbs | Defensive identity | Status |
|-----------|-------|-------|--------------------|--------|
| **Bruiser** | `Bruiser` | close + melee, **punish disengage** | `damageReduction` + knockback-on-hit | new (M4.1) |
| **Juggernaut** | `Juggernaut` | suppressing ranged fire, slow advance | high HP + armor, low AP | new (M4.2) |
| **Flanker** | `Flanker` | stalk from cover → **SLIDE** → melee ambush | cover-occluded from player + post-slide vanish | new (M4.3) |

Elites are the canonical **durable patients** for medics and the **stat-scaling showcase** for the tier system.

### Deferred — Phase 3 on-ramp

| Archetype | Class | Verb | Blocker | Status |
|-----------|-------|------|---------|--------|
| **Netrunner** | `Netrunner` | ranged disruption (AP drain, turret stun) | requires status-effect system | M5 (deferred) |

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

Fodder stays at baseline across all tiers — tier difficulty comes from *who else is in the room*, not inflated fodder HP.

### Encounter examples

| Difficulty | Seed-driven roll | Result |
|------------|------------------|--------|
| STANDARD | 2 skirmishers | `[Skirmisher, Skirmisher]` — learn ranged spacing |
| STANDARD | 1 skirmisher + 2 guards | `[Skirmisher, Guard, Guard]` — ranged + melee pressure |
| ELEVATED | 3 fodder + sniper | `[Skirmisher, Guard, Guard, Sniper]` — break LOS or close to reveal; Tech turret zones approach (cannot break a long-range lock) |
| ELEVATED | 2 fodder + spotter | `[Skirmisher, Guard, Spotter]` — kill spotter or keep breaking its LOS as it repositions |
| CRITICAL | 2 fodder + medic + juggernaut | `[Skirmisher, Guard, Medic, Juggernaut]` — priority puzzle: medic + soak |
| CRITICAL | 3 fodder + bruiser | `[Skirmisher, Skirmisher, Guard, Bruiser]` — knockback tax on melee approach |
| CRITICAL | 3 fodder + flanker | `[Skirmisher, Skirmisher, Guard, Flanker]` — watch the cubicles; closes from cover you can't see into |

All rolls derive from the contract seed (deterministic, save-compatible).

---

## Current status

> **Depends on [Phase 2.6](phase-2.6-plan.md):** placement consolidation (`nudgeIfOccupied`), `Entity.heal()`, and the error boundary land there. This phase assumes them.

| Milestone | Status |
|---|---|
| M1 — Tier doctrine foundations | 🟡 In progress |
| M1.1 — `EnemyTier` model + per-tier stat scaling hook | ✅ Complete |
| M1.2 — `damageReduction` (armor) stat on `Entity` | ✅ Complete |
| M1.3 — Encounter composition by tier (roles, not just counts) | 🟡 In progress — resolver landed; **fodder slice wired** (M2 spawns skirmisher/guard mix); **specialist slice wired** (M3.1 spawns Spotter on ELEVATED/CRITICAL via the `available` allowlist + mapgen specialist anchors); elite anchors+classes still pending (M4) |
| M1.4 — CorpCivilian cover-occluded LOS | ✅ Complete |
| M1.5 — Variable combat map dimensions (tier + seed) | ✅ Complete |
| M2 — Tier 1 fodder roster | ✅ Complete |
| M2.1 — Skirmisher kiting (preferred engagement band) | ✅ Complete |
| M2.2 — Guard (melee fodder) | ✅ Complete |
| M2.3 — Combat damage tuning + skirmisher glyph | ✅ Complete |
| M3 — Tier 2 specialists | 🟡 In progress |
| M3.1 — Spotter (mobile per-turn target share; not CorpCivilian) | ✅ Complete |
| M3.2 — Sniper (telegraphed long-range burst) | 🔲 Not started |
| M3.3 — Medic (proactive shield + heal; patient-gated spawn) | 🔲 Not started |
| M4 — Tier 3 elites | 🔲 Not started |
| M4.1 — Bruiser (armor + knockback-on-hit) | 🔲 Not started |
| M4.2 — Juggernaut (armor soak + suppression) | 🔲 Not started |
| M4.3 — Flanker (cover concealment + Razor-mirror SLIDE) | 🔲 Not started |
| M5 — Netrunner / disruption (status-effect groundwork) | 🔲 Deferred-candidate (feeds Phase 3) |

**Phase 2.7** is complete when:

1. Every milestone above is ✅ except M5 (deliberate Phase 3 on-ramp).
2. T1/T2/T3 composition rules are live: STANDARD = fodder only, ELEVATED = fodder + 1 specialist, CRITICAL = fodder + specialist + elite (or fodder + elite).
3. Combat map width/height vary by contract difficulty and seed (M1.5); revisits and run snapshots reproduce the same footprint.
4. Each archetype in the roster table has a distinct tactical identity verified by tests and playtest — including sharp separation of `CorpCivilian` (ambient facility alarm, cover-occluded LOS) from `Spotter` (mobile T2 specialist, extended LOS).
5. Full campaign loop from Phase 2.6 remains playable offline on iOS Safari + Chrome desktop.
6. `v0.2.7` tagged in git.

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

**Implementation note:** `src/game/encounters.ts` now owns the deterministic role-composition resolver and enforces the medic patient gate. Full Run/map wiring is intentionally still pending until M3/M4 role classes exist, so the game does not silently reskin unimplemented specialists/elites as skirmishers/guards.

#### M1.4 — CorpCivilian cover-occluded LOS

**Problem:** desk clerks see through cubicles. `CorpCivilian.#findPlayerTarget` calls `hasLineOfSight`, which ignores COVER — so cover tiles in office prefabs don't help the player sneak past ambient civilians.

- Add a civilian-scoped sight helper (e.g. `hasConcealedLineOfSight` in `LineOfSight.ts`, or an opt-in flag on the existing function) where **COVER tiles on the Bresenham line block sight** the same way walls do. Smoke should block LOS globally — confirm that it does and modify otherwise, alongside this change.
- Wire `CorpCivilian` alarm checks to the new helper only. **Do not** change `Combat`, patrol-hostile acquisition, or spotter LOS — combat cover semantics (`COVER_HIT_PENALTY`, `COVER_DODGE_BONUS`) stay as-is. **Reuse the same helper in M4.3** for player → flanker concealment (inverted observer/target).
- **TDD:** civilian does not alarm when COVER lies between clerk and player; civilian still alarms on open LOS; wall block unchanged; combat `canFireRanged` through cover unchanged (regression guard).

**Implementation note:** `LineOfSight.hasConcealedLineOfSight` now treats COVER as an occluder while preserving normal combat LOS semantics. `CorpCivilian` alarm checks use the concealed helper; ranged combat retains fire through cover with the existing hit/dodge modifiers. Smoke already blocks standard LOS and is now covered by regression tests.

#### M1.5 — Variable combat map dimensions (tier + seed)

**Problem:** `buildMap` already accepts `width`/`height`, but `Run.enterCombat` passes fixed `COMBAT_MAP_WIDTH` / `COMBAT_MAP_HEIGHT` (24×16). Difficulty only changes `threatCount` and civilian caps inside the same footprint — seed reshuffles prefabs, not arena scale. That undercuts tier identity (CRITICAL should feel *bigger* as well as *meaner*) and makes back-to-back STANDARD contracts feel same-y.

**What already works (no renderer rewrite):**

- `buildMap` is pure over `(rng fork 'mapgen', width, height, threatCount, difficulty)` — same seed + dimensions → identical grid.
- Run snapshots persist `grid.w` / `grid.h`; restore validates entity coords against the saved grid.
- `AsciiRenderer` + `cameraFor` pan a fixed viewport over arbitrary world size (640×400 canvas, ~32×20 cells visible).
- `debug/map.ts` already exercises arbitrary dimensions.

**Direction (locked for planning; sizes are playtest knobs):**

| Knob | Rule |
|------|------|
| **Tier band** | `STANDARD` → compact footprint; `ELEVATED` → medium; `CRITICAL` → large. Higher tier = more BSP leaves, longer routes, more room for sniper/spotter lanes. |
| **Seed jitter** | Within the band, pick from a **small discrete allowlist** of `(w, h)` pairs via a dedicated RNG fork (e.g. `resolveMapDimensions` forks `contract.seed` with label `'map-size'`, separate from `'mapgen'` inside `buildMap`). Same contract seed → same dimensions; different seeds at the same tier can differ. |
| **Persistence** | Store `mapWidth` / `mapHeight` on `Contract` at Curator generation (and on `LocationSite` when a site is pinned). `Run.enterCombat` reads the contract fields — do not re-roll on revisit. Mid-run saves already carry grid size; old contracts without fields default to 24×16 for save compat. |
| **Bounds** | Respect `EDGE_INSET` + `BSP_TUNABLES.MIN_LEAF` (playable inner rect must be ≥ 6×6). Prefer even widths/heights so leaf splits stay symmetric. Cap outer size for tablet perf (proposal: max **32×20** until playtest says otherwise). |
| **Anchor budget** | Larger maps must still satisfy `threatCount` fodder anchors today and **specialist/elite anchors** once M1.3 placement lands — if `buildMap` throws on anchor shortage, that size is illegal for that tier/threat combo (fail loud, shrink allowlist). |

**Proposed size bands (starting point — tune in playtest):**

| Difficulty | Allowlist examples (outer w×h) |
|------------|--------------------------------|
| `STANDARD` | 22×14, 24×16 (current baseline), 26×16 |
| `ELEVATED` | 24×16, 26×18, 28×18 |
| `CRITICAL` | 28×18, 30×20, 32×20 |

**Implementation sketch:**

- `resolveMapDimensions({ seed, difficulty })` in `src/game/procgen/` (or `constants.ts` table + resolver) → `{ width, height }`.
- Extend `Contract` + Curator board generation to set `mapWidth`/`mapHeight` once per contract.
- `Run.enterCombat`: pass contract dimensions into `buildMap`; remove module-level `COMBAT_MAP_*` as the sole source of truth.
- M7.2 `LocationSite`: persist `mapWidth`/`mapHeight` beside `seed` so revisit geometry stays byte-identical when difficulty/objective are re-rolled.
- **Score-target sites** (Phase 3): always use roster-stored dimensions; contract `difficulty` scales encounter composition only, not footprint.
- **TDD:** same `(seed, difficulty)` → same dimensions; different seeds at same tier can differ; `buildMap` + `composeEncounter` both deterministic; restore/revisit uses stored dimensions; allowlist rejects playable area below `MIN_LEAF`.

**Implementation note:** `src/game/procgen/mapDimensions.ts` owns the per-difficulty allowlists and pure `resolveMapDimensions({ seed, difficulty })` resolver using the dedicated `'map-size'` RNG fork. Curator-generated contracts now store `mapWidth`/`mapHeight`; revisits copy dimensions from the pinned `LocationSite`; `Run.enterCombat` builds from the stored contract fields. Legacy contracts and roster sites with both fields missing normalize to 24×16, while partial dimension records throw. The new runtime module is precached and the service-worker cache version is bumped for offline clients.

**Schedule:** Land **before M3** specialist placement (anchor budget) and ideally alongside the remainder of **M1.3** (composition + non-fodder anchors). Low risk if allowlists stay conservative — does not block M2 fodder work.

### M2 — Tier 1 fodder roster

#### M2.1 — Skirmisher kiting (preferred engagement band)

**Problem (pre-M2.1):** skirmisher only stepped toward its target and never retreated; fought at point-blank with no melee.

- Add **preferred engagement band** (`preferredMin`..`sightRange`). In ENGAGE: if target is closer than `preferredMin` and a further tile exists with LOS + range, step toward the distance-maximising tile instead of firing.
- **Caveats:** don't kite into a dead-end (fall back to firing); a skirmisher that already fired may lack AP to retreat — intended tradeoff.
- **TDD:** adjacent skirmisher with retreat room steps away; cornered skirmisher fires; skirmisher at ideal range fires.

**Implementation note:** The patrol → investigate → engage machinery was extracted into an abstract `src/game/ai/PatrolHostile.ts` (bus binding, the AP loop + safety/spin guards, `stepToward`); `Skirmisher` and `Guard` are **siblings** that differ only by an abstract `engageSteps` generator (returns `'continue' | 'break'`). Kiting lives in `Skirmisher.engageSteps`: `PREFERRED_MIN = 3` (per-instance override via `preferredMin`), retreat to the distance-maximising legal neighbour that still holds LOS + range. **Extra gate:** the retreat tile must keep the target *spottable* (`isSpottableBy`) — so a skirmisher never kites itself blind off an adjacent **stealthed** target (it stands and fires instead). Shared patrol states live in `PATROL_STATE` on `PatrolHostile`; turn-step types are `PatrolHostileTurnStep` / `PatrolHostileMoveStep` in `types.ts`. **Class rename:** implementation class is `Skirmisher` (was `CorpDrone`); persistence still uses archetype `'drone'` and snapshot key `drone?` for save compatibility.

#### M2.2 — Guard

**Goal:** melee fodder counterpart to the skirmisher. Simple close-and-strike, no armor, no knockback.

- Reuse patrol → investigate → engage state machine from `Skirmisher`.
- ENGAGE: step toward target, melee when adjacent and AP allows. No defensive mechanics — trades HP openly.
- Land full plumbing: types, persistence factory, snapshot/restore, loot, `corpTurnStatusCopy`, `kindFromId`.
- **TDD:** guard closes and melees; dies in two player-phase swings at T1 stats; patrol/investigate transitions match skirmisher patterns.

**Implementation note:** `Guard` (glyph `g`, `ENEMY_ROLE.FODDER`) extends `PatrolHostile`; melee `engageSteps` strikes when adjacent (`canMelee`/`resolveMelee`) else closes. Plumbing: `melee` turn-step in `types.ts` (shared by patrol hostiles) + `formatCorpTurnStep`/player-visibility in `corpTurnStatusCopy.ts`; `'guard'` archetype id + parallel `guard?` snapshot block in `Run.ts`; factory + waypoint/state restore (generalised over `drone`/`guard` persistence keys) and `bindToBus`/death-unbind broadened to `instanceof PatrolHostile` in `persistence.ts`/`Run.ts`; `kindFromId` → `Guard` for `guard-*` ids (skirmishers still label as `Drone` from `drone-*` ids until Phase 2.8 theming). **Mapgen:** prefab `anchors.fodder` (was `drones`) feed `map.fodder` spawn slots. **Spawn wiring (fodder slice of M1.3):** `Run.enterCombat` resolves `composeEncounter` from the contract seed and maps each fodder anchor to a skirmisher or guard; specialists/elites are deliberately *not* spawned (no classes/anchors yet). **Objective:** `drone-all` sweep counts `Skirmisher || Guard` (objective id unchanged for save compat). **UI copy:** contract briefing and KeyHelp use role-neutral "hostiles" / grouped glyph key (`c g k`).

#### M2.3 — Combat damage tuning + skirmisher glyph

Playtest pass on T1 fodder pacing:

- **Ranged:** default `RANGED_DAMAGE` stays **1** (Tech, Razor, skirmisher plink). **Merc** overrides via `MERC_RANGED_DAMAGE` (**2**); player and corp turrets use `TURRET_DAMAGE` / `CORP_TURRET_DAMAGE` (**2**).
- **Melee:** default `MELEE_DAMAGE` is **2** (Merc, Tech). **Razor** and **Guard** override with `HEAVY_MELEE_DAMAGE` (**3**). `Combat.resolveMelee` / `resolveRanged` read crew `meleeDamage` / `rangedDamage` getters when present; Guard passes `HEAVY_MELEE_DAMAGE` explicitly.
- **Glyph:** `Skirmisher` renders as **`k`** (frees `d` for other roster use).

**TDD:** Guard melee applies `HEAVY_MELEE_DAMAGE`; skirmisher glyph `k`; Merc `rangedDamage` / Razor `meleeDamage` getters; turret constants at 2.

### M3 — Tier 2 specialists

**Implementation order:** Spotter (M3.1) before Sniper (M3.2). Roster table above keeps Sniper before Spotter narratively; Spotter ships first because it reuses `PatrolHostile`, lands `ALARM` `kind` plumbing, and unlocks the T2 priority-target puzzle with existing fodder — Sniper's cross-turn telegraph is the higher-risk stretch.

#### M3.1 — Spotter

**Not `CorpCivilian`.** See [CorpCivilian vs Spotter](#corpcivilian-vs-spotter) — civilians stay ambient; spotters are mobile combat specialists.

**Locked design (pre-implementation):**

| Axis | Decision |
|------|----------|
| Event plumbing | **`ALARM` with `kind` discriminator** — `World.raiseAlarm()` emits `kind: 'facility'`; spotter emits `kind: 'spotter'` directly (no `raiseAlarm()`). Patrol hostiles react to both kinds; spotter does not subscribe to `ALARM` (no self-wake / no civilian latch coupling). |
| Target share | **Pure refresh** — every corp turn with LOS → ping, even if allies already ENGAGE. Refreshes coords for kiting players; primary force-multiplier value. |
| Class shape | **`Spotter extends PatrolHostile`** — reuse patrol → investigate → engage pathing; override `bindToBus` to skip the alarm subscription (axis 3). `engageSteps` is spot-only (never attacks). |
| Vantage AI | **LOS + max Chebyshev distance** — when repositioning, prefer legal neighbour tiles that restore LOS while maximising distance to the target (skirmisher kiting inverted). **`SPOTTER_SIGHT_RANGE = 10`** (baseline `SIGHT_RANGE` is 8; 12 is the playtest ceiling if 10 feels too short). |
| Cover / LOS | **Standard combat LOS** — cover does not block spotter sight (same as skirmisher acquisition). Cover alone cannot permanently neutralise a T2 specialist. |
| Stealth | **Hostile rules** — `acquireTarget` / `isSpottableBy`: stealthed targets visible only at Chebyshev ≤ 1. SLIDE remains a viable counter; spotter is not a range-stealth hard-counter like civilians. |
| Durability | **Skirmisher-like** — `DEFAULT_HP` (3) via `resolveEnemyStats(..., ENEMY_ROLE.SPECIALIST, tier)`; no armor; evasiveness comes from vantage AI, not dodge RNG. |

**Behaviour:**

- **`Spotter extends PatrolHostile`.** Never attacks. ENGAGE branch = spot-only via `engageSteps`.
- **Spot mode:** each corp turn, if a hostile target is acquired (LOS + range + stealth rules), emit `EVENT.ALARM` with `{ kind: 'spotter', source, target, origin }`. Hostiles subscribed to `ALARM` force-ENGAGE on the shared target (both `facility` and `spotter` kinds); ping repeats every turn sight holds.
- **No LOS:** path toward last-known position or a vantage tile that restores LOS, scoring candidates by distance-maximising among tiles that hold sight. Smoke blocks LOS like any ranged check — spotter must move to a new angle.
- **Rep / facility alarm:** `kind: 'spotter'` pings do not trip facility latch or stack `REP.ALARM_PENALTY`. Facility alarm remains the civilian/terminal domain (`kind: 'facility'` only).
- **`World.raiseAlarm()`:** add `kind: 'facility'` to its existing `ALARM` emit payload (backward-compatible default for tests that omit `kind`).
- Land full plumbing: types, persistence, snapshot/restore, loot, `corpTurnStatusCopy`, `kindFromId`.
- **TDD:** spotter with LOS emits `ALARM` `{ kind: 'spotter' }` every turn without calling `raiseAlarm`; allies re-engage on fresh target coords on both kinds; spotter without LOS moves toward max-distance vantage; killing spotter stops pings; spotter ignores incoming `ALARM`; civilian `raiseAlarm` emits `kind: 'facility'` and behaviour unchanged (regression guard); stealthed player beyond Chebyshev 1 not spotted.

**Implementation note:** `ALARM_KIND` (`events.ts`) discriminates `facility` vs `spotter`; `World.raiseAlarm()` now stamps `kind: 'facility'` (back-compat default). `PatrolHostile` gained two overridable hooks: `listensForAlarm()` (default `true`; `Spotter` returns `false` so it never consumes pings) and `investigateStep()` (default `stepToward`; `Spotter` overrides to seek a distance-maximising LOS vantage, falling back to closing in). `src/game/ai/Spotter.ts` (glyph `s`, `SPOTTER_SIGHT_RANGE = 10`, `ENEMY_ROLE.SPECIALIST` stats) emits the `spotter`-kind ping + a `spot` turn-step (`types.ts`) each engage turn, then evasively repositions. **Spawn wiring (specialist slice of M1.3):** `composeEncounter` gained an `available: { specialists, elites }` allowlist (defaults to the full roster) so it only composes *buildable* archetypes — never a reskin or silent drop; `Run.enterCombat` passes `{ specialists: [SPOTTER], elites: [] }`. `buildMap` budgets one **specialist anchor** for ELEVATED/CRITICAL (fails loud if the footprint can't fit it). Full plumbing: `spotter` archetype/snapshot block + `PatrolHostile` restore (`persistence.ts`/`Run.ts`), `kindFromId → Spotter`, `formatCorpTurnStep`/visibility for `spot` (a mark on the player surfaces even when the spotter tile is unseen), precache + SW cache bump (`0.2.7b`). **Note:** `drone-all` sweep still counts only Skirmisher/Guard — a spotter does not gate the sweep objective (kaizen below).

#### M3.2 — Sniper

**Contrast with Spotter:** Spotter coordinates fodder (`ALARM` pings); sniper is a **self-contained personal threat** — break LOS or eat the burst. No ally force-multiplier.

**Locked design (pre-implementation):**

| Axis | Decision |
|------|----------|
| Class shape | **`Sniper extends PatrolHostile`** — patrol/investigate/engage shell shared with skirmisher. Cross-turn aim via `aimTargetId` + a **`takeTurnSteps` preamble** that resolves pending aim *before* `acquireTarget` (must fire-or-cancel even when live LOS is gone). |
| Timing | **Corp N aim → player turn → Corp N+1 fire/cancel.** Full counterplay window between phases. While `aimTargetId` is set, sniper is **stationary** (holding aim across the player turn). |
| Aim AP | **`AP_COST.RANGED_ATTACK` (2)** to commit aim. Preconditions match `canFireRanged` at `SNIPER_SIGHT_RANGE` + `isSpottableBy` (Hostile stealth rules). **Same corp turn:** sniper may **move/kite first, then aim** — e.g. move (1 AP) + aim (2 AP) under default 4 AP; up to two move steps + aim at 4 AP. Once aim commits, **no further actions that corp turn** (`engageSteps` returns `'break'`). |
| Fire | **Guaranteed hit** on a committed shot (`baseHit: 1.0` via `resolveRanged` override). **`SNIPER_DAMAGE = 3`**. Cancel (clear `aimTargetId`, yield `{ type: 'aim-cancelled', reason }`) if target dead, out of range, no LOS, or not `isSpottableBy` at fire time. Leftover AP after fire → reposition (kite/close). |
| Range | **`SNIPER_SIGHT_RANGE = 12`** (baseline `SIGHT_RANGE` 8; spotter 10). |
| Reposition | **Skirmisher kiting mirror** when not holding aim — `preferredMin = 3`, distance-maximising retreat; close when out of range. Never melees. |
| Telegraph | **`{ type: 'aim', target }` turn-step** + corp log line + **crosshair overlay on target tile** in renderer during the aim window. **No `NOISE` on aim** (fire still emits normal ranged noise via `resolveRanged`). |
| Damage during aim | **Any damage to sniper while `aimTargetId` set clears pending aim** — rewards focus-firing during the telegraph window (close to Chebyshev ≤ 5 to reveal, or chip damage if the sniper entered turret range). |
| Range conceal | **Player perception only** (Razor/Flanker mirror at distance). While `aimTargetId` set **and** Chebyshev distance to deployed player ≥ **`SNIPER_CONCEAL_MIN_RANGE` (6)**: sniper omitted from `buildFrame`, **not player-direct-targetable** (crew ranged/melee), corp aim log uses anonymous copy (*"A targeting laser settles on you."*). **Reveal** at Chebyshev ≤ 5 (glyph + targeting restore). **Not active** before aim commits — sniper is visible during patrol for pre-emptive picks. Crosshair overlay on **target tile** remains the primary tell (red-dot action-film beat). Extract `isConcealedFromPlayer(entity, player)` helper — reuse pattern for Flanker (M4.3). |
| Turret interaction | **`TURRET_RANGE` is 4** — a player turret **cannot** reach a sniper holding a long-range aim lock (conceal at Chebyshev ≥ 6, sniper fires from up to 12). Turrets are **area denial**, not a mid-lock counter: a deployed turret zones a 4-tile bubble so the sniper must avoid that LOS when **positioning to acquire aim** (Tech value = prevention, not rescue). When a sniper **does** enter turret LOS + range, turrets use normal hostile acquisition and **ignore player range conceal** (can engage a player-hidden sniper inside the bubble). Sniper pathing when seeking aim/kite should treat turret threat tiles as high cost or forbidden. |
| Cover / LOS / stealth | **Standard combat LOS** for acquisition and fire validation. **Hostile stealth rules** — cannot start aim on a stealthed target beyond Chebyshev 1; pending aim cancels if target breaks stealth before fire. No `ALARM` involvement. |
| Durability | **Skirmisher-like** — `DEFAULT_HP` (3) via `resolveEnemyStats(..., ENEMY_ROLE.SPECIALIST, tier)`; no armor. |

**Behaviour:**

- **`Sniper extends PatrolHostile`.** Override `takeTurnSteps`: if `aimTargetId` set, run fire-or-cancel preamble first; then delegate to super.
- **Engage loop (no pending aim):** kite if inside `preferredMin`; else if in range + LOS → commit aim (2 AP, set `aimTargetId`, yield `aim`, break turn); else close one step.
- **Range conceal:** `isConcealedFromPlayer(sniper, player)` when `aimTargetId` set and Chebyshev ≥ `SNIPER_CONCEAL_MIN_RANGE` (6). Wire into renderer, player crew target resolution, and `formatCorpTurnStep` for `aim`. **Turrets bypass conceal** but are range-limited (`TURRET_RANGE` 4) — see turret interaction row.
- **Fire turn:** validate target; on success `resolveRanged` with `{ range: SNIPER_SIGHT_RANGE, damage: SNIPER_DAMAGE, baseHit: 1.0 }`; on fail `aim-cancelled`.
- **Persistence:** snapshot block `sniper?` with `{ state, lastKnownTarget, patrolWaypoints, patrolIndex, aimTargetId }`.
- Land full plumbing: types (`aim` / `aim-cancelled` turn-steps), persistence, snapshot/restore, loot, `corpTurnStatusCopy`, `kindFromId`, renderer crosshair + concealment omit.
- **TDD:** corp N in range → `aim` step + `aimTargetId` set; corp N+1 intact LOS → guaranteed 3 damage; corp N+1 after player broke LOS → `aim-cancelled`, no damage; SLIDE/stealth breaks pending aim; sniper damage during aim window clears `aimTargetId`; move+kite then aim same corp turn; kiting inside `preferredMin`; snapshot round-trips `aimTargetId`; no aim NOISE; fire emits ranged NOISE as today; **concealed at aim + Chebyshev ≥ 6** (no glyph, not crew-targetable, anonymous aim log); **revealed at Chebyshev ≤ 5**; visible before aim; **turret cannot acquire sniper at typical aim distance** (range 4 vs conceal ≥ 6); **turret engages sniper inside turret range regardless of player conceal**; sniper pathing avoids turret threat zone when seeking aim vantage.

#### M3.3 — Medic

- **Ally-seeking shield/heal** using `Entity.heal()` (Phase 2.6). Proactive shielding (temp HP *before* damage) so the medic changes math *during* the fight.
- **Spawn rule (M1.3):** never without a durable patient (bruiser or juggernaut) in the same encounter.
- **TDD:** prefers shielding durable ally about to be focused; lone medic impossible; shield absorbs then expires.

### M4 — Tier 3 elites

#### M4.1 — Bruiser

**Problem:** melee that closes on enemy phase dies to a free player burst (symptom #2).

- **Armor** (`damageReduction`, tier-scaled) so chip damage doesn't melt it.
- **Knockback-on-hit** (reuse vault knockback primitive): connected swing shoves player back one tile, forcing AP to re-close.
- Fast and scary — goal is *reaching you costs something*, not sponge HP.
- **TDD:** knockback in away direction (blocked if destination occupied/solid); survives two 1-damage hits that would kill a guard.

#### M4.2 — Juggernaut

- High HP, meaningful `damageReduction`, **slow** (low AP), suppressing ranged fire. Tempo/attrition check; canonical medic patient.
- **TDD:** survives sustained focus that kills a skirmisher; movement slower than baseline; armor + ≥1 floor hold.

#### M4.3 — Flanker

**No facing/backstab.** Top-down ASCII has no orientation today; the elite identity is **cover-concealed stalking** plus a Razor-mirrored **SLIDE** — the inverse of M1.4 civilian sight and the player's own stealth perk.

**Two concealment layers (player perception only):**

1. **Cover occlusion (passive):** When any COVER tile lies strictly between player and flanker, the flanker is hidden — reuse M1.4 `hasConcealedLineOfSight` with `(observer=player, target=flanker)`. No cover on the line → visible unless layer 2 is active. Wire via the shared **`isConcealedFromPlayer`** pattern introduced in M3.2 (sniper range conceal).
2. **Slide vanish (active):** A 2 AP **SLIDE** (same geometry as Razor: 2-tile cardinal/diagonal dash, both intermediate and landing tiles passable, silent — no `NOISE` event). On commit, set a `slideConcealed` flag that keeps the flanker **hidden from the player regardless of cover/adjacency** until cleared.

**Slide lifecycle (mirror Razor, inverted faction):**

| | Razor SLIDE | Flanker SLIDE |
|---|---|---|
| Costs | 2 AP | 2 AP |
| Movement | 2-tile silent dash | same |
| Concealment | `stealthed` — skirmishers need adjacency | `slideConcealed` — player cannot see/target |
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
- **Recommendation:** design the primitive here so M1–M4 don't preclude it.

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
- **Sniper telegraph readability:** locked — `aim` turn-step + corp log + **crosshair overlay** on target tile during aim window; range conceal at Chebyshev ≥ 6 while aiming (M3.2).
- **`SNIPER_CONCEAL_MIN_RANGE` tuning:** locked at 6; playtest ceiling 5–7 if reveal band feels too narrow/wide.
- **Flanker SLIDE noise tell:** M4.3 optional footstep NOISE without glyph — lean silent for v0.2.7, add tell if playtests feel unfair.
- **Composition determinism:** all tier/role rolls derive from contract seed (Phase 2.5 standard).
- **Map size allowlists (M1.5):** starting bands above are proposals — playtest whether STANDARD should ever dip below 24×16, whether CRITICAL needs 32×20, and whether aspect ratio should stay ~3:2 or allow taller “tower” maps for sniper verticality.
- **Map size vs. objective timer:** longer maps may need objective-timer review (Phase 2.5) so retrieve/sweep gigs don’t feel padded on large footprints — defer tuning until sizes land.
- **UI copy:** contract briefing uses "N hostiles" (not "N drones"); role-specific aliases land in Phase 2.8.
- **Spotter + civilian coexistence:** office prefabs may spawn ambient civilians on ELEVATED/CRITICAL maps that also roll a spotter specialist — confirm briefing/log copy distinguishes `[Corp]Civilian` from the spotter alias once Phase 2.8 theming lands.
- **Specialist and sweep objectives (M3.1):** the `drone-all` sweep counts only Skirmisher/Guard (T1 fodder), so an ELEVATED sweep can complete with the Spotter still alive. Matches the plan's fodder-only definition, but revisit whether a `sweep` on a specialist/elite tier should require clearing the force-multiplier too (or add a distinct objective variant) once Sniper/elites land.
- **Specialist loot (M3.1):** the Spotter falls through `Run.#rollLoot` to the scrap default like any non-turret Hostile. Revisit whether T2/T3 specialists/elites should drop richer typed salvage (chips/data) when the loot table is reworked.
