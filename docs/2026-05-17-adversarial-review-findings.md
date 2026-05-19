# Adversarial Code Review — 2026-05-17

Three independent reviewers examined the Kernel Panic codebase (~10k lines, ~70 source files) for **complexity**, **style/clarity**, and **potential bugs**. Findings are consolidated and ranked below. Where multiple reviewers flagged overlapping concerns, that's noted.

---

## TIER 1 — Real Bugs

### 1. ~~`advanceFromPlayerTurn` calls `queue.endTurn(world)` unconditionally after player exits~~
- **Source:** `combatTurnPipeline.ts:112` / `Run.ts:449-455`
- **Found by:** Bug reviewer
- **Status:** ✅ Fixed — `isTerminal()` guard now precedes `queue.endTurn(world)`.
- **What:** When the player steps onto the exit tile, `enterResult(EXIT)` fires synchronously and transitions the run to RESULT state, unwiring combat listeners. But `advanceFromPlayerTurn` still calls `queue.endTurn(world)` *before* the `isTerminal()` guard at line 114. This refreshes AP on all corp entities and bumps the turn counter on a dead run. Guards downstream prevent a crash, but it's a state mutation that shouldn't happen.
- **Trigger:** Player walks to exit tile during any run.

### 2. ~~`patrolIndex` restored from snapshot without bounds-checking~~
- **Source:** `persistence.ts:436-438`
- **Found by:** Bug reviewer; **reinforced by** complexity reviewer (who flagged `restoreEntity` as the most complex function in the codebase — 117 lines, 6 archetype branches)
- **Status:** ✅ Fixed — restore now bounds-checks against `patrolWaypoints.length` and throws `RangeError` if out of range.
- **What:** Restore sets `entity.patrolIndex = rec.drone.patrolIndex` after validating it's an integer, but never checks `patrolIndex < patrolWaypoints.length`. `CorpDrone.takeTurnSteps` then dereferences `this.patrolWaypoints[this.patrolIndex]` without a null check, producing `TypeError: Cannot read properties of undefined`.
- **Trigger:** Save data where waypoints array changed length between versions, or any data corruption.

### 3. ~~`NeutralCivilian.#flee` TOCTOU — two civilians can flee to the same tile~~
- **Source:** `entities/NeutralCivilian.ts:120-127`
- **Found by:** Bug reviewer
- **Status:** ✅ Fixed (2026-05-19) — `#flee` now uses `world.relocateEntity()` which validates bounds, passability, and occupancy atomically. No more direct `this.x`/`this.y` mutation.
- **What:** `#flee` checks `world.entityAt(nx, ny)` then directly mutates `this.x`/`this.y` without going through `world.moveEntity`. If two civilians both pick the same escape tile in the same aftermath pass, both move there — resulting in two entities on one tile.
- **Trigger:** Two neutral civilians adjacent to the player, both targeting the same open tile during the same aftermath step.

### 4. ~~`CorpDrone` range mismatch: `acquireTarget` uses `this.sightRange`, `canFireRanged` defaults to `SIGHT_RANGE`~~
- **Source:** `ai/CorpDrone.ts:203`
- **Found by:** Bug reviewer; **reinforced by** complexity reviewer (who flagged `takeTurnSteps` as having spread-out bookkeeping)
- **Status:** ✅ Fixed — `canFireRanged` and `resolveRanged` now pass `{ range: this.sightRange }`.
- **What:** A drone with custom `sightRange > SIGHT_RANGE` can *see* a target via `acquireTarget` but `canFireRanged` returns `out-of-range` using the default constant. The drone loops move-toward forever, never firing.
- **Trigger:** Any `CorpDrone` spawned with `sightRange` exceeding `SIGHT_RANGE` (8). Latent until custom-ranged sentries are used.

---

## TIER 2 — State Hygiene / Near-Bugs

### 5. ~~Module-level `corpNoiseForTurn` cache never cleared between runs~~
- **Source:** `corpTurnStatusCopy.ts:47`
- **Found by:** Style reviewer
- **Status:** ✅ Fixed (2026-05-19) — Map typed as `Map<number, string>`. Exported `resetCorpTurnStatusCache()` and wired it into `Run.#tearDownWorld()`.
- **What:** `Map` accumulates entries across runs. Turn 1 of a new campaign could return the cached status message from turn 1 of the *previous* campaign. Also untyped (`Map<any, any>`).

### 6. ~~Dead `CorpDrone`s stay subscribed to `EVENT.NOISE` and `EVENT.ALARM` for the full run~~
- **Source:** `ai/CorpDrone.ts:104-114`
- **Found by:** Bug reviewer
- **Status:** ✅ Fixed (2026-05-19) — `Run.#onEntityDamaged` now calls `target.unbind()` when a `CorpDrone` is killed, detaching listeners immediately.
- **What:** `unbind()` only runs at `#tearDownWorld`. Every noise/alarm event fires dead drones' handlers (guarded by `if (!this.alive) return`). Wastes cycles; subscriptions stack if `_reattachCombatListeners` is called mid-run.

### 7. ~~`Merc.vault` knockback bypasses `world.moveEntity` — no noise, no double-occupancy check~~
- **Source:** `archetypes/Merc.ts:138-145`
- **Found by:** Bug reviewer
- **Status:** ✅ Fixed (2026-05-19) — both the knockback and the Merc's own landing now use `world.relocateEntity()`, which validates bounds/passability/occupancy and emits `ENTITY_MOVED`.
- **What:** Direct `occupant.x`/`occupant.y` mutation skips the noise event for the landing tile and doesn't check if two knockbacks target the same tile. Sentries adjacent to the landing tile won't react.

---

## TIER 3 — Style & Clarity

### 8. `_busUnsubs` / `_reattachCombatListeners` — mixed visibility conventions in `Run.ts`
- **Source:** `Run.ts:183, 351`
- **Found by:** Style reviewer; **reinforced by** complexity reviewer (who flagged `#onEntityDamaged` in the same class)
- **Status:** 🟡 Documented-intentional — JSDoc now explains *why* (cross-module restore needs callable members).
- **What:** Uses underscore-prefix "fake internal" on two members, while the same class uses `#private` everywhere else. The *why* is documented (cross-module restore), but two competing conventions on one class confuses contributors.

### 9. Detached JSDoc comment in `constants.ts`
- **Source:** `constants.ts:110-127`
- **Found by:** Style reviewer
- **Status:** ✅ Fixed (2026-05-19)
- **What:** `NOISE_RADIUS` doc block appears at line 110, but the constant is at line 147 — separated by 27 lines. Tooling attaches the doc to `SALVAGE_DROP_MIN` instead.

### 10. ~~`NeutralCivilian.act()` vs everything else's `takeTurnSteps()`~~
- **Source:** `entities/NeutralCivilian.ts:59`
- **Found by:** Style reviewer
- **Status:** ✅ Fixed (2026-05-19) — renamed to `takeAftermathStep()`. Can't be `takeTurnSteps` (different arity + return type vs base `Entity`), but the new name clearly signals it's the turn method for the aftermath phase.
- **What:** Every other entity uses `takeTurnSteps` for its turn method. `NeutralCivilian` uses `act()` with a different signature. The naming break is explained by the aftermath-phase difference, but a contributor wiring a new aftermath actor would look for `takeTurnSteps` and find nothing.

### 11. ~~`advanceTurn` destructured but never used in 5 functions~~
- **Source:** `applyIntent.ts:238, 267, 311, 328, 370`
- **Found by:** Style reviewer
- **Status:** ✅ Fixed — dead destructurings removed.
- **What:** `doDeploy`, `doVault`, `doSlide`, `doMelee`, `doFire` all destructure `advanceTurn` from ctx but never call it (they go through `gateOnApExhausted` instead). Dead bindings imply direct usage that doesn't exist.

### 12. `Crew.archetype` defaults to `'CrewMember'` — not a valid `CrewArchetypeId`
- **Source:** `Crew.ts:80`
- **Status:** 🟡 Documented-intentional
- **Found by:** Style reviewer

### 13. `Tech._improvisedTurretCount` — underscore + `private` keyword simultaneously
- **Source:** `archetypes/Tech.ts:52`
- **Found by:** Style reviewer

---

## TIER 4 — Complexity (refactor when touching these files)

### 14. `restoreEntity` — 117 lines, 6 archetype branches, 3 mixed concerns
- **Source:** `persistence.ts:328-444`
- **Found by:** Complexity reviewer
- **Suggestion:** Per-archetype hydrate functions (`hydrateDrone`, `hydrateTurret`, etc.) with `restoreEntity` as thin dispatcher.

### 15. `ServiceWorkerManager` — `#setupUpdateListeners` (4 layers of callback nesting) and `skipWaiting` (shared `resolved` flag in 5 locations)
- **Source:** `ServiceWorkerManager.ts:106-178, 292-376`
- **Found by:** Complexity reviewer
- **Suggestion:** `Promise.race` over well-defined signals instead of manual flag management.

---

## What the reviewers didn't find

All three reviewers independently noted:
- **Import conventions** (`.js` extensions, relative vs absolute) are consistently followed
- **`h()` DOM helper** is used uniformly — no `createElement` leaks
- **Magic numbers** are nearly absent — tunables live in `constants.ts`
- **Type safety** is strong with deliberate, commented `as` casts
- **Test coverage is extensive** (~45 test files) — no catastrophic gaps
- **No silent data corruption** bugs exist — failures are loud

The codebase is in solid shape for a Phase 2 project. The top 4 items are the ones worth prioritizing.

---

## Resolution log

| Date | Findings | Notes |
|------|----------|-------|
| pre-review | #1, #2, #4, #11 | Fixed before audit doc was written |
| pre-review | #8 | Documented-intentional (JSDoc added) |
| 2026-05-19 | #3, #5, #6, #7, #10 | New `World.relocateEntity` for #3/#7; cache reset for #5; unbind-on-death for #6; `act()` → `takeAftermathStep()` for #10 |

**Still open:** #8 (accepted), #9, #12, #13, #14, #15.
