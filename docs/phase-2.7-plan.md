# Phase 2.7 Plan — Enemy roles & tier doctrine (pre–Phase 3)

Living plan for the post–Phase 2.6, pre–Phase 3 slice of Kernel Panic: turning the enemy roster from a set of single-verb stat blocks into a system of **tactical roles** organised under a **tier doctrine**, with the per-entity defensive identity (kiting, armor, knockback, support) the current prototypes are missing. **Target release: `v0.2.7`.** See [phase-2.6-plan.md](phase-2.6-plan.md) for the resilience/placement foundations this builds on, [phase-2.5-plan.md](phase-2.5-plan.md) for the completed Meatspace-depth slice, [phase-3-plan.md](phase-3-plan.md) for the campaign arc + Cyberspace this feeds into, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision, and [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md) for the source inspiration that seeded this work.

## Why this phase exists

We prototyped two new corp enemies after Phase 2.5 — `CorpEnforcer` (melee bruiser), `CorpRepairBot` (support medic). Playtesting surfaced four problems, and the key insight is that **the first three are symptoms of the fourth**:

1. **Drones close on the player.** The Phase 2.5 `CorpDrone` only ever steps *toward* its target (to get into firing range); it has no notion of "too close." With no melee and no armor, standing at point-blank is tactically suicidal for it, but it does so anyway.
2. **The Enforcer's trade is bad for the Enforcer.** It spends its whole turn closing on the *enemy* phase, so the *player* phase opens with a full 4 AP against an adjacent, undefended target — two melee swings drop it. "Scary on approach, free kill on arrival."
3. **The RepairBot has no patients.** The hurt-it-then-let-it-heal loop never triggers, because nothing on the board is durable enough for partial damage to persist a turn — players just finish kills. It's a solution to a problem the roster doesn't yet have.
4. **"Tier" is just a spawn multiplier.** Higher tier = more enemies, nothing else. There's no role progression, no per-tier stat scaling, no "priority target" puzzle.

Every enemy currently has **one verb and no defensive identity**, so they all degenerate into "advance and trade HP," and trades are decided by raw stats. The cure is to give enemies *tactical roles* and hang those roles — plus per-tier stat scaling — off a redefined tier system. The three symptoms then dissolve: drones get spacing behavior, the Enforcer gets armor + knockback tuned per tier, and the medic gets durable patients worth healing.

**Direction chosen:** tier = **role composition *and* per-tier stat scaling** (not stats-only, not roles-only).

## Current status

> **Depends on [Phase 2.6](phase-2.6-plan.md):** the placement consolidation (`nudgeIfOccupied`), `Entity.heal()`, and the error boundary land there. This phase assumes them.

| Milestone | Status |
|---|---|
| M1 — Tier doctrine & role taxonomy (foundations) | 🔲 Not started |
| M1.1 — `EnemyTier` model + per-tier stat scaling hook | 🔲 Not started |
| M1.2 — `damageReduction` (armor) stat on `Entity` | 🔲 Not started |
| M1.3 — Encounter composition by tier (roles, not just counts) | 🔲 Not started |
| M2 — Fix the existing three prototypes | 🔲 Not started |
| M2.1 — Drone kiting (preferred engagement band) | 🔲 Not started |
| M2.2 — Enforcer armor + knockback-on-hit | 🟡 Prototype exists, rebuild per plan |
| M2.3 — RepairBot: proactive shield + durable patients | 🟡 Prototype exists, rebuild per plan |
| M3 — New specialist roles (T2 force multipliers) | 🔲 Not started |
| M3.1 — Corp Sniper (telegraphed long-range burst) | 🔲 Not started |
| M3.2 — Corp Spotter (alarm/info force multiplier) | 🔲 Not started |
| M4 — New elite roles (T3) | 🔲 Not started |
| M4.1 — Corp Juggernaut (armor soak + suppression) | 🔲 Not started |
| M4.2 — Corp Flanker (positioning + backstab) | 🔲 Not started |
| M5 — Netrunner / disruption (status-effect groundwork) | 🔲 Deferred-candidate (feeds Phase 3) |

**Phase 2.7** is complete when:

1. Every milestone above is ✅ except M5 (a deliberate Phase 3 on-ramp — see that section).
2. Tier is expressed as role composition + stat scaling: a tier-1 encounter is fodder, tier-2 introduces a force-multiplier specialist, tier-3 introduces a durable/multi-verb elite — and the *same* archetype is tunably fragile at low tier, survivable at high tier.
3. The three original prototypes each have a distinct tactical identity: drones want you far, Enforcers want you close and punish disengage, the medic meaningfully changes a fight that contains durable allies.
4. Full campaign loop from Phase 2.6 remains playable offline on iOS Safari + Chrome desktop, with the new enemy behaviors integrated into contract spawning.
5. `v0.2.7` tagged in git.

---

## Design pillars

### Tier doctrine

A tier is **what kind of threat composition the encounter introduces**, with stats attached — not a head-count knob.

| Tier | Identity | Composition | Stat posture |
|------|----------|-------------|--------------|
| **T1 — Fodder** | One verb, no role, low HP. Threat = numbers. | Drones, guards. | Baseline. The current roster lives here. |
| **T2 — Specialists** | Each encounter adds **one force-multiplier role**. The role makes the fodder dangerous; killing the specialist defuses the encounter. The "priority target" puzzle is born here. | Fodder + 1 of {Spotter, Sniper, Medic, Netrunner}. | Specialist may have a defensive twist (e.g. Sniper's range, Spotter's evasiveness) but is still killable. |
| **T3 — Elites** | Durable and/or multi-verb. Mini-boss feel. | Fodder + specialist + 1 of {Juggernaut, Flanker, armored Enforcer}. | Per-tier scaling turns on: armor, extra AP/HP. The lever that fixes the Enforcer's fragility. |

The crucial property: **stat scaling is keyed to tier**, so a `CorpEnforcer` is fragile at T1 and survivable at T3 using the same class — fixing symptom #2 without globally inflating numbers.

### Role taxonomy

Mapping the [C2077 source list](cyberpunk-2077-enemy-list.md) onto buildable behavior classes. Most gang/corp names (Thug, Goon, Matón, Toro, Jonin…) are **flavor reskins of the same few profiles** — we treat faction names as a theming layer over a small set of behavior classes, not as separate AI.

| Role | C2077 analogues | Core verb | Engine primitives | Status |
|------|-----------------|-----------|-------------------|--------|
| Ranged skirmisher | Robot, Triggerman, Rapid | plink, **maintain distance** | ranged combat, LOS, pathfinding | `CorpDrone` (needs kiting) |
| Bruiser | Bruiser, Armored Enforcer | close + melee, **punish disengage** | melee, pathfinding, knockback | `CorpEnforcer` (needs armor/knockback) |
| Medic | Field Techie, Trauma Medic | ally-seeking heal / shield | heal, noise bus | `CorpRepairBot` (needs patients) |
| Sniper | Sniper, Netrunner overwatch | **telegraphed** long-range burst | ranged combat, two-phase aim, NOISE tell | new (M3.1) |
| Spotter | Tactician, Recon Support | raise alarm / share target | ALARM bus, LOS | new (M3.2) |
| Juggernaut | Ogre, Heavy Gunner, Juggernaut | armor soak + suppressing fire | `damageReduction`, ranged, slow movement | new (M4.1) |
| Flanker | Blitzer, Assassin, Tyger | reach a flank tile + backstab bonus | pathfinding target selection, conditional damage | new (M4.2) |
| Netrunner | Voodoo Boys, Codefreak | ranged **disruption** (AP drain, turret stun) | NEW status-effect system | M5 (Phase 3 on-ramp) |

---

## Where the local prototype work lands

We already prototyped `CorpDrone`'s two siblings — `CorpEnforcer` and `CorpRepairBot` — plus the map-population and persistence plumbing to support them. That work splits cleanly along the merge line:

| Local change | Mergeable now? | Lands in |
|---|---|---|
| `placement.ts`: `nearestEmptyFloorTile` + `nudgeIfOccupied` (consolidates `Run`'s `resolveEntitySpawnTile` and `persistence`'s `NUDGE_OFFSETS` into one authoritative helper) | ✅ entity-agnostic | **[Phase 2.6](phase-2.6-plan.md) M1.1** |
| `World.addEntity`: nudge an occupied tile instead of throwing | ✅ entity-agnostic | **[Phase 2.6](phase-2.6-plan.md) M1.2** |
| `Entity.heal()`: clamped, crash-on-negative, refuses to revive a corpse | ✅ entity-agnostic | **[Phase 2.6](phase-2.6-plan.md) M1.3** |
| `Run.#placeAmbientCorpReinforcements`: difficulty-gated ambient spawns (ELEVATED → enforcer, CRITICAL → + repair bot) | ⛔ instantiates the new classes | **M1.3** (the precursor to rework into tier-driven role composition) |
| `CorpEnforcer.ts` (+ test, `ENFORCER_*` constants) | ⛔ not ready | **M2.2** (rebuild with armor + knockback) |
| `CorpRepairBot.ts` (+ test, `REPAIR_BOT_*` constants, `AP_COST_REPAIR`) | ⛔ not ready | **M2.3** (rebuild with proactive shield + patient-gated spawning) |
| Plumbing that imports the new classes — `types.ts` step unions, `persistence` factory/restore, `Run` snapshot + `#rollLoot` + `archetypeOf`, `corpTurnStatusCopy` melee/repair lines, `Entity.kindFromId` | ⛔ rides with its entity | **M2.2 / M2.3** (land alongside the rebuilt classes) |

The key opportunity: because the two new hostiles **aren't merged yet**, we get to rebuild them *with the tier/role model in mind* rather than retrofitting. Treat the existing prototype code as a reference implementation of the state machine + plumbing, not as the spec. In particular, the difficulty gate (`ELEVATED`/`CRITICAL`) should be reconciled with the new `EnemyTier` model (M1.1) rather than living as a parallel notion.

## Milestones — detail

### M1 — Tier doctrine & role taxonomy (foundations)

**Goal:** Establish the data model that lets encounters be composed by tier-as-role-composition, and the per-tier stat-scaling hook everything else depends on. No new enemy behavior here — just the scaffolding M2–M4 build on.

#### M1.1 — `EnemyTier` model + per-tier stat scaling hook

- Introduce an `EnemyTier` notion (T1/T2/T3) in `constants.ts`, with a per-tier scaling profile (HP multiplier/bonus, AP bonus, armor floor). Keep it deterministic and seed-driven to preserve save compatibility (mirrors how `contract.difficulty` already flows).
- Enemy constructors accept a tier (or a resolved stat profile) so the *same* class can be spawned fragile or durable.
- **TDD:** tests assert that a given class spawned at T1 vs T3 produces the expected HP/AP/armor, and that the mapping is pure given (class, tier).

#### M1.2 — `damageReduction` (armor) stat on `Entity`

- Add a `damageReduction` field on `Entity` (sibling to the existing `baseDodgeChance`), default `0`, applied in the damage-resolution path in `Combat.ts` (both `resolveRanged` and `resolveMelee`).
- Decide and document the floor rule: armor reduces incoming damage but **a hit always does ≥1** (no fully-immune chip-lock) — record as the standard so we don't silently regress it.
- **TDD:** armored entity takes reduced damage; the ≥1 floor holds; zero-armor entities are unchanged (regression guard against altering existing combat math).

#### M1.3 — Encounter composition by tier (roles, not just counts)

- Change the spawn/placement path so a tier selects a **role composition** (T1: fodder×N; T2: fodder + 1 specialist; T3: fodder + specialist + 1 elite), not merely a larger count.
- Keep it data-driven so contract generation (`Run.ts` / placement) can roll compositions deterministically from the contract seed.
- **Reuses local work:** `Run.#placeAmbientCorpReinforcements` already does difficulty-gated ambient spawning (`ELEVATED` → enforcer, `CRITICAL` → + repair bot). Rework it from a difficulty `if`-ladder into the `EnemyTier` composition roll — reconciling `CONTRACT_DIFFICULTY` with the tier model rather than running two parallel notions. The patient-gating rule (M2.3: never a lone medic) lives here.
- **TDD:** a T2 contract always contains exactly one specialist-role entity; a T3 contains an elite; compositions are deterministic per seed; a medic is never spawned without a durable patient.

### M2 — Fix the existing three prototypes

#### M2.1 — Drone kiting (preferred engagement band)

**Problem:** `CorpDrone` only `#stepToward`s its target (to reach firing range) and never retreats; it fights at point-blank with no melee/armor.

- Add a **preferred engagement band** (`preferredMin`..`sightRange`). In ENGAGE: if the target is closer than `preferredMin` *and* a further tile exists that still has LOS + range, step toward the distance-maximising tile instead of firing/holding.
- **Caveats to handle explicitly:** don't kite into a dead-end/wall (fall back to firing if no retreat tile improves spacing); a drone that already fired may lack AP to retreat — that's an intended tradeoff, not a bug.
- **TDD:** drone adjacent to target with retreat room steps away while keeping LOS; cornered drone fires rather than thrashing; drone at ideal range still fires.

#### M2.2 — Enforcer armor + knockback-on-hit

**Problem:** closes on the enemy phase → player opens their phase with full 4 AP vs an adjacent undefended target → trivial burst. Bigger HP numbers don't fix the structural issue.

**Starting point:** the local `CorpEnforcer.ts` prototype (three-mode patrol→investigate→engage state machine, `bindToBus` noise/alarm, melee close-and-strike, step-yield paint) is the reference implementation. Rebuild *on top of it* — keep the state machine, add the defensive identity below, and land its plumbing (types, persistence factory, snapshot/restore, `#rollLoot` scrap drop, `corpTurnStatusCopy` melee lines, `kindFromId` "Enforcer") in the same merge.

- Give the Enforcer **armor** (`damageReduction` from M1.2, scaled by tier per M1.1) so chip damage doesn't melt it. (Drop the current flat `ENFORCER_HP = 4` reliance in favor of tier-scaled HP + armor.)
- Add **knockback-on-hit** (reuse the vault knockback primitive): a connected swing shoves the player back one tile, forcing them to **spend AP re-closing** instead of dumping all 4 AP into the Enforcer. Converts "free burst turn" into "you pay to fight back."
- Keep it fast and scary — the goal is to make *reaching you cost the player something*, not to make it spongy.
- **TDD:** Enforcer hit applies knockback in the away direction (blocked if the destination tile is occupied/solid — document the rule); armored Enforcer survives two 1-damage hits that previously killed it at its tier.

#### M2.3 — RepairBot: proactive shield + durable patients

**Problem:** no durable allies means the heal loop never matters.

**Starting point:** the local `CorpRepairBot.ts` prototype (ally-seeking `#findDamagedAlly`, adjacency weld using the new `Entity.heal()`, welding-spark NOISE tell, `baseDodgeChance = 0`) is the reference. Rebuild on top of it; land its plumbing (types, persistence factory, snapshot/restore, chips loot drop, `corpTurnStatusCopy` repair lines, `kindFromId` "Repair Bot") alongside.

- The **dependency fix**: the medic only earns its slot once M2.2/M4 ship durable allies (armored Enforcer, Juggernaut) worth healing. Encode this in M1.3 composition rules (don't spawn a medic without a durable patient in the encounter). Until then, the RepairBot stays unmerged — this is *why* the current `CRITICAL`-tier lone-ish medic feels useless.
- **Behavioral upgrade:** add **proactive shielding** (temporary HP applied to an ally *before* it's damaged) so the medic changes the math *during* the fight, not in the lull after. Optionally explore a **reconstruction** variant (reactivate downed robots / rebuild killed turrets) as a stretch — creates real "kill the medic first" urgency.
- **TDD:** medic prefers shielding a durable ally about to be focused; composition rule never spawns a lone medic; shield absorbs damage then expires.

### M3 — New specialist roles (T2 force multipliers)

#### M3.1 — Corp Sniper (telegraphed long-range burst)

- Long range (`SIGHT_RANGE` + bonus), high damage, but a **two-phase aim → fire**: it spends a turn acquiring (emitting a tell — a NOISE ping or new `aim` step) before the shot lands next turn. Punishes standing in open LOS; rewards breaking sightlines. Reuses ranged combat + the step-yield paint pattern.
- **TDD:** sniper telegraphs on turn 1 and fires on turn 2; breaking LOS during the telegraph cancels the shot.

#### M3.2 — Corp Spotter (alarm/info force multiplier)

- Never attacks. Seeks LOS to the player and **raises the alarm / shares last-known-target** with allies via the `ALARM` event — an offensive-information sibling of the RepairBot. Almost entirely reuses the noise/alarm bus. Creates a kill-the-spotter priority puzzle mirroring the medic.
- **TDD:** spotter with LOS emits ALARM carrying the target; allies transition to engage on receipt; spotter without LOS does not.

### M4 — New elite roles (T3)

#### M4.1 — Corp Juggernaut (armor soak + suppression)

- High HP, meaningful `damageReduction`, **slow** (low AP or extra move cost), with suppressing ranged fire. A tempo/attrition check and the canonical durable patient for the medic.
- **TDD:** Juggernaut survives a sustained focus that kills a drone; movement is slower than baseline; armor + ≥1 floor both hold.

#### M4.2 — Corp Flanker (positioning + backstab)

- Like the Enforcer but pathfinds to a tile *beside/behind* the target rather than the nearest adjacent tile, with a backstab damage bonus. Forces the player to mind facing/cover. Pure target-selection change + conditional damage multiplier.
- **TDD:** flanker prefers a flank tile when one is reachable; backstab bonus applies only from the flank/rear; falls back to a normal adjacent strike when no flank tile is reachable.

### M5 — Netrunner / disruption (status-effect groundwork) — Phase 3 on-ramp

- The most on-brand C2077 enemy and the one with **zero** current analogue: a ranged **disruptor** that applies a debuff via LOS (AP-drain "ICE spike," or stun a deployed turret) instead of HP damage.
- Requires a **new status-effect system** (a status field on `Entity`, application/expiry, UI surfacing) — which Phase 3 (Cyberspace, the Decker) wants anyway. Prototyping it here de-risks that work, but the surface area is large.
- **Recommendation:** scope the status-effect *primitive* design here (so M1–M4 don't accidentally preclude it), but **defer implementation to Phase 3** unless M1–M4 land with room to spare. Marked deferred-candidate in the status table.

---

## Out of scope

- Cyberspace-side enemies and the Decker (Phase 3).
- Boss/named-encounter scripting beyond the T3 "mini-boss feel."
- Faction-specific reskins as distinct AI — faction is a theming layer over the role classes above, not new behavior (implementation: [phase-2.8-plan.md](phase-2.8-plan.md)).
- Full status-effect system implementation (see M5 / Phase 3).

## Open questions / kaizen notes

- **Corp civilian harm from player-placed breaching charges:** M5 Rep only tracks `FACTION.NEUTRAL` via `civilian:harmed`; killing a `CorpCivilian` (`c` glyph) in a breach blast does not cost Rep or block the clean-extraction bonus, even though the charge is player-planted and the log reads `Blast killed [Corp]Civilian.` Player-planted breach attribution now passes the deployed crew member as `attacker` on `entity:damaged` (so neutral bystanders count). Revisit whether corp-aligned non-combatants should also count toward civilian-casualty Rep / the "no civilian casualties" clean bonus, and whether the flash copy should distinguish corp staff vs neutral bystanders.
- **Knockback into hazards:** should an Enforcer's shove be able to push the player into a hazard tile? Powerful, possibly unfair — decide during M2.2 and record the rule.
- **Armor vs. dodge interaction:** `damageReduction` and `baseDodgeChance` now coexist; confirm ordering (dodge first, then armor on a connected hit) and document it in `Combat.ts`.
- **Sniper telegraph readability:** the aim tell must be unmissable on the ASCII/CRT canvas — coordinate with the renderer so a charging sniper is visually distinct.
- **Composition determinism:** all tier/role rolls must derive from the contract seed so saves stay reproducible (the standard set in Phase 2.5).
