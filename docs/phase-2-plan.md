# Phase 2 Plan — Street Level

Living plan for Phase 2 of Kernel Panic. Source of truth for milestone scope, current progress, and decisions locked in during design. See [phase-1-plan.md](phase-1-plan.md) for Phase 1 history, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall design vision, and [game-overview.md](game-overview.md) for the elevator pitch. Post–M8 Meatspace depth (M1–M6) lives in [phase-2.5-plan.md](phase-2.5-plan.md) (**target `v0.2.5`**).

**Phase prefix:** `P2` — use `P2.MN` when referencing milestones from this phase in other documents.

## Current status

| Milestone | Status |
|---|---|
| M0 — Combat feedback animations | ✅ Done |
| M1 — Tech archetype + Deploy Turret | ✅ Done |
| M2 — Campaign layer + named crew roster | ✅ Done |
| M3 — Salvage + inventory + improvised turrets | ✅ Done |
| M4 — Finn's shop | ✅ Done |
| M5 — Rep + NPC taxonomy | ✅ Done |
| M6 — Recruitment | ✅ Done |
| M7 — Combat depth + procgen | ✅ Done |
| M8 — Job board + contract tiers | ✅ Done |

**Phase 2 complete** when *all three* of:

1. Every milestone box ticked ✅ (above) — **M0 through M8**.
2. Full campaign loop playable offline on iOS Safari + Chrome desktop: Hub crew management → contract selection → job deployment → combat → extract or flatline → return to Hub, with Finn shop, Rep meter, and recruitment visible.
3. `v0.2.0` tagged in git (M8 / major Phase 2 slice: job board, contract tiers, full loop).

**Release tagging:** Phase 2 closes at **`v0.2.0`**. Phase 2.5 (contract objectives through breaching / location memory) — see [phase-2.5-plan.md](phase-2.5-plan.md), target **`v0.2.5`**.

Test count at Phase 2 start: **409 passing** (end of Phase 1 / M8).

## Locked-in decisions

- **Phase 2 scope:** Deepening Meatspace — crew management, campaign layer, new archetype, salvage economy, social groundwork. Cyberspace (Matrix layer, Jack-in, ICE AI) deferred to Phase 3.
- **Campaign model:** A campaign is a series of jobs. `Campaign.js` is the outer container; `Run.js` is refactored to cover a single job (BRIEFING → COMBAT → RESULT). The Hub lives in Campaign, not Run. The campaign ends when the last crew member is flatlined.
- **Crew:** Three named individuals at campaign start — one Merc, one Razor, one Tech. Each has a callsign selected from a curated per-archetype list. Losing all three ends the campaign.
- **Class hierarchy:** `Entity → Crew → [Merc | Razor | Tech]`. `Crew` adds `callsign`, `flatlined`, `inventory`, `gear`. Merc and Razor are migrated to extend `Crew` in M1 alongside Tech; their existing behaviour is unchanged.
- **`flatlined` vs `alive`:** `Entity.alive` is job-scoped — it resets when a crew member is deployed on a new job. `Crew.flatlined` is campaign-permanent; a flatlined crew member is never deployed again.
- **Callsigns:** Each archetype file exports a `const CALLSIGNS` string array (10–15 curated entries). `buildCrewMember(archetypeId, spawn, rng)` replaces `buildPlayer` in `src/game/archetypes/index.js` and uses the campaign `Rng` to pick from the list. Snapshots store the chosen callsign explicitly so restore never re-rolls. Callsign deduplication excludes names already held by any living or flatlined crew member in the campaign's history.
- **Tech turret (free):** Tech starts each job with 1 pre-built turret — a starting resource, not a crafted item. Deploying costs AP (`AP_COST.DEPLOY = 2`). The turret persists as a placed grid entity until destroyed or the job ends.
- **Tech turret (improvised):** From M3, Tech can deploy additional turrets mid-job by spending carried salvage (`SALVAGE_PER_IMPROVISED_TURRET`, suggest 2 units). Trade-off: tactical advantage now vs. extracting salvage to sell to Finn later. Only Tech can convert salvage to turrets in the field.
- **Salvage:** Universal collectible — all archetypes can loot drone corpses. Generic units (no typed components) in Phase 2. Extracted salvage becomes a campaign material pool that Finn buys manually at 10 Cr per salvage.
- **Three persistence scopes:**
  - *Job-scoped* — consumables used, turrets placed; gone when the job ends.
  - *Campaign-scoped* — crew gear, campaign salvage pool, Creds, Rep meter; survive across jobs, lost on campaign wipe.
  - *Meta-scoped* — Hub upgrades purchased from Finn; permanent, survive even a full campaign wipe.
- **Finn:** Hub NPC (a nod to Gibson's fence archetype). Buys extracted salvage at a fixed 10 Cr rate; sells consumables (cheapest), crew gear (campaign-scoped), and Hub upgrades (meta-scoped) for Creds. Placed in the Hub grid; interact to open shop.
- **NPC taxonomy on jobs:**
  - *Collective-aligned* — Curator, Finn; never hostile.
  - *Truly neutral* — civilians; Rep-sensitive (behavior scales with meter level).
  - *Corp-aligned non-combatant* — office workers, desk security; do not fight but trigger an alarm (all drones in the map enter ENGAGE) if they spot the player.
- **Rep:** Campaign-level meter (0–100, starting at 50). Raised by clean contract completion; lowered by civilian/neutral kills. Gates neutral NPC behavior and crew recruitment unlocks.
- **Recruitment:** New crew members unlock when Rep reaches the KNOWN tier floor (`REP.RECRUIT_THRESHOLD`, 50) or as a specific contract reward. Archetype and callsign generated on recruit; callsign deduplication applies.
- **Animations (M0):** Turn-blocking — input disabled for ~300ms during the longest active animation. Three effects: screen shake (CSS `@keyframes` translate on game container, ~150ms), damage reddening (CRT filter temporary red vignette, ~300ms), muzzle flash (1-frame canvas color override at shooter's tile, ~80ms). All wired to the existing event bus. No game-logic changes.
- **Unified special-action key (M1):** Vault, Slide, and Deploy collapse into a single `x` → `MODE.SPECIAL_AIM` → `{ type: 'special', dx, dy }` intent at the keymap layer; `applyIntent.doSpecial` dispatches to the archetype's perk by capability sniffing (`canDeploy` → Tech, `canVault` → Merc, `canSlide` → Razor). One key, one touch-pad button, one help row — no WASD collision (the original plan's `d` key clashed with WASD-right), and adding a future archetype only requires implementing its perk method.
- **Interact key rebound to Space (M3):** `i` → Space (`' '`). Roguelike players associate `i` with inventory (which M4's Finn shop will want). Space is the universal "activate" key in modern games — accessible, no directional collision (qezc diagonals, WASD, arrows all occupied). Keymap, touchpad, key-help rows, and proximity hints all updated. `i` is now unbound, reserved for inventory in M4.
- **Changed keyboard mapping to case-sensitive (M3):** In order to free up keyboard space for more commands, and taking inspiration from classic Roguelikes, key bindings are now case-sensitive.
- **Universal Quit key:** `Q` is now how a player quits / deletes their current campaign to start a new one.
- **Finn placement (M4):** Finn spawns at `(5, 2)` in the Hub — top row center, forming a row of NPCs (Curator at (2,2), Finn at (5,2), Terminal at (9,2)). Interact with Space (same key as all Hub NPCs). The plan's `(2, 2)` was a collision with the Curator.
- **Inventory key (M4):** `i` opens the consumable inventory during combat. Space remains the interact key for Hub NPCs (Finn, Curator, Terminal) and combat loot. `i` is combat-only; in the Hub it's a no-op.
- **Consumables fully usable (M4):** Both Stim and Smoke Charge are fully implemented in M4. Stim heals `STIM_HEAL` HP (capped at maxHp), costs `AP_COST.INTERACT`. Smoke Charge places `TILE.SMOKE` tiles in Chebyshev radius `SMOKE_RADIUS` around the player — passable but blocks LOS. Smoke clears at the start of the player's next turn (protects through one corp turn).
- **Expanded Catalog gate stubbed (M4):** The `expandedCatalog` meta-upgrade flag is stored and the catalog respects it (hides the item once purchased), but no rare items exist behind the gate yet. Future milestones can add gated items with `metaGate: 'expandedCatalog'`.
- **Gear schema (M4):** `Crew.gear = { maxHpBonus: number, hitBonus: number, dodgeBonus: number }`. Armour Plating increments `maxHpBonus` and `maxHp`/`hp` directly. Targeting Chip increments `hitBonus` by `TARGETING_BONUS` (0.1), capped at `maxHitBonus = 1 − baseHitChance`. Reflex Weave (M7) increments `dodgeBonus` by `DODGE_BONUS` (0.1), capped at `maxDodgeBonus = 1 − baseDodgeChance`. `Combat.resolveRanged` reads `attacker.gear?.hitBonus ?? 0` and adds it to the attacker's `baseHitChance` before cover penalty. `Combat.resolveMelee` reads `target.gear?.dodgeBonus ?? 0` and adds it to the defender's `baseDodgeChance` before cover bonus. Gear persists in campaign snapshots; restore clamps over-capped bonuses.
- **Archetype combat stats (M7):** Each archetype overrides `baseHitChance` on its class (`Merc` 0.8, `Tech` 0.75, `Razor` 0.7; bare `Crew` falls back to `BASE_HIT_CHANCE`). `baseDodgeChance` defaults to `DODGE_CHANCE` (0.2) on `Crew`; `Razor` overrides to 0.35 on the class (archetype-tuned values live on the archetype file, not in `constants.js`). Crew UI surfaces **AIM** and **DODGE** as core stats in `<crew-roster>`, `<initial-recruit>`, and recruit detail panes (gear bonuses included in displayed totals).
- **Campaign-scoped consumable lifecycle (M4):** Consumables are purchased in the Hub (stored in `Crew.inventory.consumables`) and persist as a permanent part of the crew member's loadout until used in combat. They are *not* cleared on job end. `Crew.inventory.salvage` is still zeroed on job end (extracted to the campaign pool or forfeited on death).
- **HP persists across jobs (M4):** Crew members are *not* healed to full when deployed on a new job. Damage carries between runs. The only Hub-side HP recovery is Armour Plating (+1 maxHp and +1 current hp on purchase). Stims are combat-only. Hub inventory use (e.g. using a Stim outside combat) is deferred — revisit after the Terminal crew-detail view lands.
- **Vault rework (M4):** Merc's Vault is now a repeatable breach-and-clear slam (no one-shot `vaultReady` gate). AP cost stays at 3. The old free directional shot is removed. New mechanic: if a hostile occupies the landing tile, the Merc body-checks them for `VAULT_DAMAGE` (2, matching melee) and knocks them back 1 tile in the vault direction. Knockback resolves through `World.moveEntity`. Vault is denied when the knockback destination is blocked (wall, entity, OOB) — the Merc needs a clear lane. Landing on an empty tile is pure repositioning (no shot). Landing on a friendly entity is denied. `Merc.canVault` gains hostile-on-landing + knockback-lane checks; `applyIntent.doVault` no longer calls `pickFireTarget` / `resolveRanged`.

- **Crew UI refactor (M4):** Three components replace the old monolithic `<crew-roster>`:
  - `<crew-list>` — extracted navigable row list (callsign, archetype, HP, status). Pure reusable list, no modal chrome. Emits `select` when the highlighted row changes.
  - `<crew-roster>` — Terminal view only (no deploy mode). Two-pane layout: `<crew-list>` on the left, detail pane on the right showing the selected member's stats, gear, and consumables. No `mode` parameter.
  - `<run-briefing>` — Curator job flow. Single modal combining contract details + embedded `<crew-list>` for operative selection. Replaces the old two-step flow (pick crew in roster → show briefing → JACK IN) with a one-step modal. Emits `deploy` with `{ memberId, contract }`.

- **Campaign-start recruitment (M6):** New campaigns start with an empty crew (`crew: []`). The shell shows `<system-start>`, then presents `<initial-recruit>` — a full-screen overlay with 3 randomly-generated candidates (weighted 40/40/20 Merc/Razor/Tech). Player picks 2 of 3; the unchosen candidate is discarded. `Campaign.recruitInitial(memberIds)` commits the picks, then the shell calls `enterHub()` to build the hub world and persist. No Rep gate for initial recruitment — this is the campaign-start exception.
- **`<initial-recruit>` component (M6):** New Web Component (`components/InitialRecruit.ts`). Card-based layout (3-column grid, responsive to 1-column on mobile). Cards show callsign, archetype, HP, AIM%, DODGE%, and a short blurb. Toggle selection with Enter/Space or click; ←/→ or A/D navigate. Confirm when exactly 2 are selected. Emits `recruited` CustomEvent with `{ memberIds: string[] }`.
- **Mid-campaign recruitment (M6):** `Campaign.generateRecruits()` called on every `enterHub()`. Returns 1–2 candidates (weighted archetype pool) when `rep ≥ REP.RECRUIT_THRESHOLD` (50 — KNOWN tier floor), empty array otherwise. `<crew-roster>` extended with an "Available Recruits" section below the crew list — recruit rows with keyboard nav (ArrowDown from last crew row transitions into recruit section). One recruit per hub visit (`recruitedThisVisit` flag, reset on `enterHub()`). `Campaign.recruit(recruitId)` validates Rep gate still holds, moves the recruit from `availableRecruits` into `crew`, persists.
- **Recruit constants (M6):** `RECRUIT.POOL_MIN = 1`, `POOL_MAX = 2`, `INITIAL_CANDIDATES = 3`, `INITIAL_PICKS = 2`. `REP.RECRUIT_THRESHOLD = 50` (lowered from the original 65 in Phase 3 so recruitment opens at KNOWN while Act 2 waits on a higher bar). `RECRUIT_ARCHETYPE_POOL = ['merc','merc','razor','razor','tech']` (flat array for `rng.pick()` weighted distribution).
- **Entity display labels (M6):** `entityLabel(entity)` and `resolveEntityLabel(id, entities)` in `Entity.ts`. Crew members display by callsign; other entities display as `[Faction]Kind` (e.g. `[Corp]Drone`, `[Neutral]Civilian`, `Turret`). All log messages in `applyIntent`, `combatTurnPipeline`, `corpTurnStatusCopy`, and `debug/index` switched from raw entity IDs to display labels.
- **`CharacterSelect` removed (M6):** The `<character-select>` component is deleted — campaign-start archetype selection is replaced by the recruitment flow. The debug harness retains its own archetype selection via URL params.
- **Status bar two-row activity (M6):** The status bar's lower section now has two activity rows instead of a dedicated hint row + action row. When a proximity hint is active, it takes the upper slot (pushing previous action line out); otherwise both rows show rolling action logs (`prevActionLine` / `lastActionLine`). Corp turn status messages also take the upper slot ephemerally. Geometry remains constant (CSS reserved heights).
- **Rep adjustment order fix (M6):** Clean completion bonus (`adjustRep(+10)`) is now applied *before* `Campaign.onJobEnd()`, so that `enterHub()` → `generateRecruits()` sees the updated Rep value. Previously the bonus ran after `onJobEnd`, meaning a player at Rep 55 who completed a clean job would not see recruits until the *next* hub visit.
- **Archetype metadata cleanup (M6):** `ARCHETYPES` entries gain `perkName` (e.g. `'VAULT'`) replacing the old `perkKey` field. Blurbs rewritten to be punchier. `<key-help>` now resolves `{perkLabel}` placeholder in the special-action row to the deployed archetype's perk label, and the intro paragraph mentions the specific perk name.

## Architecture conventions

All Phase 1 conventions apply (pure/DOM split, relative imports inside `src/`, absolute from outside, DataStore + `h()` + Web Components, crash over silent fallback, tests must be able to fail). Additions for Phase 2:

- **Campaign layer.** `src/game/Campaign.js` is the new top-level game object. `index.js` mounts Campaign; Campaign mounts Run for each job. Run no longer owns the Hub state machine.
- **Three DataStore scopes.** Job scope existed implicitly in Phase 1. Campaign scope (`crew`, `salvage`, `credits`, `rep`) and meta scope (`upgrades`) are new; both are serialised as separate DataStore records and survive across jobs and campaign wipes respectively.
- **`Crew` sits between `Entity` and archetypes.** All player-controlled entities extend `Crew`. Crew-specific fields (`callsign`, `flatlined`, `inventory`, `gear`) must not leak into `Entity`; pure-logic tests for non-crew entities must not need them.
- **Turret is a placed grid entity, not an archetype.** Lives in `src/game/Turret.js` (peer of `Entity.js`). Faction = PLAYER. Has HP; can be destroyed. `autoFire(world, rng)` is driven by the player-aftermath phase in `combatTurnPipeline.js` after the player yields, before corp AI begins.
- **Combat turn pipeline.** Player → player aftermath → corp → player handoff lives in `src/game/combatTurnPipeline.js`, not in page-specific shells. Shells inject rendering, logging, animation locks, and timers; the module remains pure JS and unit-testable. Player aftermath is step-driven (`runPlayerAftermathSteps` / `drivePlayerAftermath`) so turret autofire, future allied NPC actions, hazards, and neutral movement can each render discretely before corp AI begins.
- **New entity types live in `src/game/entities/`.** `CorpCivilian.js` and `NeutralCivilian.js` are non-archetype, non-hub entities placed by `mapBuild.js`. This is a new directory; hub-specific entities stay in `src/game/hub/`.
- **Salvage is a plain number in Phase 2.** `Crew.inventory.salvage` is an integer count. No item types, no typed components yet. The encoding is local to `Crew.js` and `persistence.js` and can evolve in Phase 3 without touching the rest of the system.
- **Animation system.** CSS effects (shake, reddening) are driven by class names on the `#game` container element. The canvas muzzle flash runs as a short `requestAnimationFrame` sequence inside `AsciiRenderer`. No dirty-cell tracking is introduced in M0; if it lands later, the animation frame sequencing should be revisited alongside it.

## Milestones — detail

### M0 — Combat feedback animations ✅

Pure renderer/DOM work. No game-logic changes. Visual effects verified via the debug harness.

- **Screen shake:** CSS `@keyframes` translate on the `#game` container, ~150ms, easing out. Triggered by `entity:damaged` where the target is the currently deployed crew member.
- **Damage reddening:** Temporary red vignette injected as a short-lived overlay above the CRT layer (or a color-shift class on the existing `CrtFilter` canvas), ~300ms. Same trigger as shake.
- **Muzzle flash:** On a committed `resolveRanged` or `resolveMelee`, override the shooter's canvas cell color for ~80ms via a `requestAnimationFrame` sequence in `AsciiRenderer`. One frame is enough; the following full redraw restores normal rendering.
- **Input lockout:** Game shell sets an `animating` flag; `KeyboardController` and `<touch-pad>` early-return while it is set. Flag clears after the longest active animation (~300ms). Animations triggered in the same turn (e.g. player fires, hits, damage animation plays) are queued or overlapped, not stacked in duration.
- **Event wiring:** Subscriptions live in `index.js` (the shell), not inside game-logic modules, keeping the pure/DOM split intact.
- **CORP turn status** We now display status messages while CORP entities are acting

### M1 — Tech archetype + Deploy Turret ✅

Introduces `Crew`, migrates existing archetypes, and delivers the third playable class.

- `src/game/Crew.js` — extends `Entity`. Adds: `callsign` (string, constructor arg), `flatlined` (bool, default `false`), `inventory` (stub `null` until M3), `gear` (stub `null` until M4). No new AP or combat logic.
- **Merc and Razor migrated** to extend `Crew` (trivial change: swap `extends Entity` → `extends Crew`, pass callsign to `super`). All existing tests must still pass; new tests cover `callsign` and `flatlined` defaults on each archetype.
- `src/game/archetypes/Tech.js` — extends `Crew`. Exports `const CALLSIGNS` (10–15 curated entries). `canDeploy(world, tx, ty)` / `deployTurret(world, tx, ty)` — places a `Turret` on an adjacent passable, unoccupied tile for `AP_COST.DEPLOY` (2 AP); Tech starts each job with `turretReady = true`, cleared on deploy. Throws on all illegal preconditions before debiting AP.
- `src/game/Turret.js` — extends `Entity`. Faction = PLAYER. `maxHp = 3`. `autoFire(world, rng)` — scans for the nearest hostile entity within `TURRET_RANGE` (new constant, suggest 4) with LOS; fires via `Combat.resolveRanged` with `{ freeShot: true }` (no AP gate). Damage = `TURRET_DAMAGE` (suggest 1). Uses `withinRange` + `blockerKeys` so it shares the same visibility contract as the player.
- `buildCrewMember(archetypeId, spawn, rng)` added to `src/game/archetypes/index.js`. Picks callsign from the archetype's `CALLSIGNS` list using `rng.pick()`. `buildPlayer` is deprecated but kept for backward-compat in the debug harness; removed in M2.
- `AP_COST.DEPLOY = 2` added to `src/game/constants.js`.
- Input: unified `x` + direction → `SPECIAL_AIM` mode → `{ type: 'special', dx, dy }` intent. `applyIntent` dispatches the intent by archetype capability (`canDeploy` → Tech, `canVault` → Merc, `canSlide` → Razor). Added to `keymap.js`, `touchpad.js`, and `<key-help>` rows (COMBAT scope).
- Debug harness: Tech selectable via `3` key (/ `?archetype=tech` URL param). Turret autofire logged to the feed. Status line shows `[TURRET READY]` / `[TURRET DEPLOYED]`.
- Tests: `Crew.test.js` — callsign set, flatlined default; `Tech.test.js` — deploy legality matrix (adjacent, passable, unoccupied, turretReady, AP ≥ cost), deploy commit + AP debit, second deploy blocked until M3; `Turret.test.js` — autofire target selection, LOS check, out-of-range pass, damage + event emission; keymap/touchpad/applyIntent tests assert the unified special path dispatches Tech deploy.

**Delivered expansion (discovered during M1): turn-order consolidation.** Turrets made the old page-local turn handoff awkward, so M1 also introduced `src/game/combatTurnPipeline.js` as the single owner of turn phase order. The current order is:

1. Player yields via `applyIntent` / AP exhaustion / explicit end-turn.
2. `advanceFromPlayerTurn` advances the queue to Corp.
3. `drivePlayerAftermath` resolves player-side automatic steps one at a time. Today this is turret autofire; future allied NPCs, map hazards, and neutral reactions should join here as ordered `PlayerAftermathStep` entries.
4. Corp turn driver runs after aftermath `onFinish`.
5. Pipeline advances the queue back to Player and lets the shell refresh presentation state.

The main shell uses paced aftermath so each step can paint and hold the animation lock before the next step. The debug harness uses the same pipeline with synchronous aftermath for compact logging. This deliberately preserves the pure/DOM split: game modules own ordering and mutations; shells own canvas, status text, timers, and animation effects.

### M2 — Campaign layer + named crew roster ✅

The biggest architectural seam in Phase 2. `Run.js` is refactored; Hub logic moves up.

- `src/game/Campaign.js` — top-level state machine. States: `HUB` → `COMBAT` (a Run episode) → back to `HUB`; terminal state `ENDED` (all crew flatlined).
- Owns: `crew[]` (array of `Crew` instances), `salvage` (number, campaign pool), `credits` (campaign money), `vouch`/`rep` (number, stub `50` until M5), meta-upgrade state (stub `{}` until M4).
- `buildCrew(rng)` — creates one Merc, one Razor, one Tech via `buildCrewMember`; deduplicates callsigns.
- `deployCrewMember(id)` — validates member is not flatlined; instantiates a `Run` for the job.
- `onJobEnd(result)` — if crew member survived: adds extracted salvage to pool; if died: calls `flatlineMember(id)`, then checks `crew.every(m => m.flatlined)` → transition to `ENDED`.
- `flatlineMember(id)` — sets `crew[id].flatlined = true`. Irreversible within the campaign.
- `Run.js` refactored: `HUB` state removed. Run now covers `BRIEFING → COMBAT → RESULT` only. Hub panel rendering moves to Campaign's `HUB` handler in `index.js`.
- `index.js` (shell): mounts `Campaign` instead of `Run` directly. Campaign's `onPersist` callback writes to DataStore at campaign scope. Meta scope written separately on every Hub upgrade purchase.
- **Campaign start UX:** On the start of a new campaign, a new `<system-start>` overlay shows a basic terminal-styled welcome message in the Curator's voice.
- **Campaign wipe UX (shell, superseded by P3.M6):** Phase 2 originally routed the last-operator death through `<crash-dump>`. The Chronicle end-summary slice now settles terminal results immediately and presents the summary-backed `<game-over>` overlay; `<crash-dump>` is restricted to recoverable job debriefs.
- DataStore: new `campaign` record `{ id, crew: CrewSnapshot[], salvage, credits, vouch, meta }`. `persistence.js` gains `snapshotCampaign(campaign)` / `restoreCampaign(record)`. Corrupt campaign records throw with useful messages (same rule as job snapshots).
- Hub UI: `<crew-roster>` web component — shows all three crew members (callsign, archetype badge, HP indicator, `FLATLINED` flag). Crew member selection for next deployment. Mounts in place of the removed Hub-inside-Run panel.
- `buildPlayer` removed from `src/game/archetypes/index.js`; all callers updated.
- Tests: `Campaign.test.js` — crew creation (3 members, one per archetype, unique callsigns), deployment validation (not flatlined), flatline + campaign-end condition, `onJobEnd` salvage accumulation, snapshot/restore round-trip.

### M3 — Salvage + inventory + improvised turrets ✅

Closes the **corpse memorisation** kaizen item (load-bearing for the salvage loop).

- **Corpse memorisation:** `VisionField` gains a `memorisedCorpses: Map<coordKey, GlyphRecord>` updated whenever a drone death (`entity:damaged` with lethal damage) occurs within the current LOS. Remembered corpse renders at `MEMORY_DIM` color when out of current LOS (same dim pass used for remembered tiles). Clears on job end. Closes kaizen item.
- **Loot drop:** On lethal damage, the drone entity gains `loot: { salvage: N }` where N is rolled from `Rng` in the range `[1, 3]`. Loot is not removed when LOS is lost — the memorised position is enough to navigate back. Loot roll lives in `Run.#onEntityDamaged` (not Combat.js) to keep combat resolvers pure.
- **`Crew.inventory` solidified:** `{ salvage: number, consumables: Item[] }` (consumables stub `[]` until M4). `initInventory()` is idempotent; called by `Run.#makePlayer` at deploy time. `collectSalvage(world, targetEntity)` — legal when crew member is Chebyshev-adjacent to the target corpse (not `alive`) and `targetEntity.loot.salvage > 0`; costs `AP_COST.INTERACT`; moves loot into `inventory.salvage`; zeroes `targetEntity.loot.salvage`. Throws on all illegal preconditions.
- **Salvage extraction:** On `Run` RESULT with EXIT, the shell reads `deployedMember.inventory.salvage` and passes it to `Campaign.onJobEnd({ outcome, salvage })`. Death forfeits all carried salvage.
- **Tech improvised turret:** `Tech.canImproviseTurret(world, dx, dy)` / `Tech.improviseTurret(world, dx, dy)` — identical to `deployTurret` in tile checks and AP cost, but gates on `inventory.salvage >= SALVAGE_PER_IMPROVISED_TURRET` (2) instead of `turretReady`. Uses `_improvisedTurretCount` for unique turret ids. The unified `x` special path in `applyIntent.doDeploy` routes to `deployTurret` if `turretReady`, falls back to `improviseTurret` if `canImproviseTurret` passes, otherwise surfaces the most helpful denial reason.
- `SALVAGE_DROP_MIN = 1`, `SALVAGE_DROP_MAX = 3`, `SALVAGE_PER_IMPROVISED_TURRET = 2` added to `src/game/constants.js`.
- **Interact key rebound:** `i` → Space (`' '`). `i` freed for inventory in M4. Keymap, touchpad, key-help, and all tests updated. Proximity hints updated with `[Space]` labels.
- Status lines: combat HUD shows `SAL:N` for carried salvage; Hub shows `CREDS N SALVAGE N` for campaign balances. Debug harness shows salvage count for Tech.
- Tests (33 new, 555 total): `Crew.initInventory` + idempotency, `collectSalvage` full legality matrix (adjacency, alive, loot present, AP, inventory init), loot assignment on kill (deterministic, turret kills, non-lethal no-op), inventory initialisation at deploy, corpse memorisation + clear, memorised corpse rendering in frame builder, improvised turret full legality matrix + commit + unique ids, applyIntent routing to improvised turret, campaign persistence round-trip with inventory, keymap/touchpad/keyHelp rebind.

### M4 — Finn's shop ✅

- `src/game/hub/Finn.js` — NEUTRAL Hub NPC; `catalog(metaState)` returns an array of `Item` descriptors filtered by which meta-upgrades have been purchased. Placed at `(2, 2)` in the Hub (authored, no collision with Terminal at `(9, 2)` or Curator at their authored position).
- **Item catalog (Phase 2 initial set):**

  | Item | Scope | Cred cost | Effect |
  |---|---|---|---|
  | Stim | Job-scoped | 20 Cr | Restores 2 HP to the deployed crew member |
  | Smoke charge | Job-scoped | 30 Cr | Blocks LOS in radius 2 for 1 turn (new `SMOKE` tile type, passable, blocks LOS) |
  | Armour plating | Campaign-scoped | 60 Cr | +1 `maxHp` on target crew member |
  | Targeting chip | Campaign-scoped | 80 Cr | +`TARGETING_BONUS` (10%) ranged hit chance for target crew member (capped at 100% AIM) |
  | Reflex weave | Campaign-scoped | 80 Cr | +`DODGE_BONUS` (10%) melee dodge chance for target crew member (capped at 100% DODGE) |
  | Expanded catalog | Meta | 150 Cr | Unlocks rare item tier in Finn's shop |
  | Better Contracts | Meta | 180 Cr | Raises contract difficulty weighting and Cred reward floors |

- `<finn-shop>` web component — Shadow DOM. Browse catalog (grouped by scope), shows campaign Creds and salvage balances, sells campaign salvage via `SELL 1` / `SELL 5` / `SELL ALL`, select target crew member for crew-gear purchases, confirm. Emits `purchase` CustomEvent `{ item, targetMemberId }` and `sell-salvage` CustomEvent `{ quantity }`. Keyboard-navigable (↑/↓, Enter confirm, Esc close) for consistency with `<character-select>`.
- Hub panel: `<finn-shop>` mounts inside the Hub panel. Finn entity in Hub grid shows `F` glyph; interact (`i`) when adjacent opens the shop (same pattern as Terminal → character-select).
- `Campaign.js` handles `purchase` events: deducts Creds, applies item effect. Crew-gear effects are stored on `Crew.gear` (e.g. `{ maxHpBonus: 1, hitBonus: 0.1, dodgeBonus: 0 }`). `Combat.resolveRanged` reads `attacker.gear?.hitBonus ?? 0`; `Combat.resolveMelee` reads defender `gear?.dodgeBonus ?? 0`. Meta upgrades stored in `campaign.meta`. `<finn-shop>` disables crew at max AIM when buying Targeting Chip and at max DODGE when buying Reflex Weave.
- Tests: `Finn.test.js` — catalog generation with and without meta-upgrade, purchase validation (insufficient Creds throws), crew-gear application, meta-upgrade flag set; `persistence.test.js` — crew gear survives campaign snapshot round-trip.

**Delivered expansion (M4 tweaks):**

- **HP persists across jobs.** `Run.#makePlayer` no longer resets `hp` to `maxHp`. Damage carries between runs. Armour Plating is the only Hub-side HP recovery. Stims are combat-only for now.
- **Consumables persist until used.** `Campaign.onJobEnd` no longer clears `inventory.consumables`. Consumables are a permanent part of the crew member's loadout until consumed in combat. Only `inventory.salvage` is zeroed on job end.
- **Vault rework.** Merc's Vault is now a repeatable breach-and-clear slam. If a hostile occupies the landing tile, the Merc body-checks for `VAULT_DAMAGE` (2) and knocks them back 1 tile in the vault direction. The old directional free shot is removed. Vault is denied when the knockback lane is blocked. See locked-in decisions for the full spec.
- **Crew UI refactor.** `<crew-list>` extracted as a reusable navigable row list. `<crew-roster>` is now a two-pane Terminal readout (crew list left, stats/gear/consumables detail right). `<run-briefing>` is now a single-modal Curator flow: contract details + crew list + JACK IN button. The old two-step deploy flow (pick crew → briefing → jack in) is collapsed to one step.
- Tests (614 total): HP persistence across jobs, consumable persistence, Vault body-check + knockback legality matrix (8 tests), applyIntent vault rework (4 tests), Finn glyph fix.

### Intermezzo — TypeScript conversion ✅

Full conversion of the codebase from vanilla JavaScript to TypeScript, completed between M4 and M5. No game-logic changes — purely a type-safety and tooling upgrade.

- **Scope:** 110 files renamed `.js` → `.ts` across `src/`, `components/`, `debug/`, `tests/`, and the two entry points (`index.ts`, `about.ts`). Service workers (`sw.js`, `sw-dev.js`, `sw-core.js`) remain classic-worker JS — they use `importScripts` / global scope and are copied as static assets.
- **Build pipeline (bundler-free):** `tsc` compiles into `dist/`; a `scripts/copy-assets.mjs` script copies static assets (HTML, CSS, manifest, fonts, icons, images, SW scripts) alongside the compiled JS. Dev mode runs `tsc --watch` + chokidar asset copy + live-server via `concurrently`. No bundler — the browser loads ES modules from `dist/` directly, same as before.
- **tsconfig layout:** Three configs.
  - `tsconfig.json` — main build. `strict: true`, `ES2022` target, `ESNext` module, `bundler` resolution, `verbatimModuleSyntax`. Covers `src/`, `components/`, `debug/`, and entries.
  - `tsconfig.tests.json` — extends main, adds `tests/**/*`. Used by `npm run typecheck:tests` (currently has residual type errors — deferred to a future kaizen loop).
  - `tsconfig.test-build.json` — extends test config with `noCheck: true` + `noEmit: false`. Transpiles tests to JS for `node --test` without blocking on type errors. This is the path `npm test` takes: `typecheck` (main only) → `build:tests` (transpile-only) → `node --test`.
- **Shared types:** `src/types.ts` — homeless structural contracts (`GridPoint`, `RangedAttackResult`, `CorpDroneTurnStep`, `TurnActionStep`, `Telemetry`, etc.) that don't belong to a single class. Class-backed types stay in their own files; consumers use `import type` to avoid circular runtime imports.
- **Type annotations added throughout:** `EntityInit` interface, `TileId` / `FactionId` helper types exported from constants, `EventBus` listener map typing, `Glyph` type in palette, full method signatures on `Grid`, `World`, `Combat`, `Campaign`, `Run`, all archetypes, all components. `strict: true` enforced from the start — no `any` escape hatches in production code.
- **Test suite intact:** 616 tests passing (up from 614 at end of M4 — two new tests added during conversion for `Hostile` and `Crew` edge cases). All tests run via `npm test` (`typecheck` + transpile + `node --test`). `typecheck:tests` still has ~10 residual errors (tests that use intentionally loose stubs, e.g. partial entity shapes) — these are non-blocking and tracked for a future kaizen pass.
- **Net diff:** +3654 / −1191 lines across 120 files. The bulk is type annotations, interface declarations, and the build scaffolding. No behavioural changes to game logic, rendering, or persistence.

### M5 — Rep + NPC taxonomy ✅

Closes the **NEUTRAL faction shootable** kaizen item.

- `Campaign.rep` solidified (renamed from `vouch`, which was stubbed at 50 in M2). `adjustRep(delta)` clamps to `[0, 100]`, returns actual delta applied. Save state migration: legacy `vouch` key auto-migrates to `rep` on restore.
- **Rep constants:** `REP.MIN=0, MAX=100, START=20, NEUTRAL_IDLE_THRESHOLD=70, NEUTRAL_FLEE_THRESHOLD=30, CLEAN_COMPLETION_BONUS=+10, CIVILIAN_KILL_PENALTY=-20, ALARM_PENALTY=-5`. `START` was lowered from 50 to 20 post-M8 — a fresh crew should begin BURNED/UNKNOWN and earn their reputation, and start below the neutral flee threshold. `REP_LABEL` brackets: TRUSTED (≥80), KNOWN (≥50), UNKNOWN (≥20), BURNED (≥0).
- **Events:** Three new event types — `alarm`, `civilian:harmed`, `rep:changed`.
- **`CorpCivilian`** (`src/game/entities/CorpCivilian.ts`) — extends `Entity`. Faction = CORP. No weapons, no movement. On each corp turn, checks LOS to the player; if visible, emits `alarm` event. Alarm is a **map-wide latch** on `world.alarmActive` — once any CorpCivilian triggers it, the facility stays on alert for the rest of the run (no stacking Rep penalties). All `CorpDrone` instances subscribed to `alarm` immediately transition to ENGAGE with the crew member as target. Placed by `mapBuild` at authored spawn points in prefabs.
- **`NeutralCivilian`** (`src/game/entities/NeutralCivilian.ts`) — extends `Entity`. Faction = NEUTRAL. Acts during the **player aftermath** phase (between turret autofire and corp AI), not during the corp turn. Behavior varies by `campaign.rep` passed as context: ≥70 → idle; 30–69 → flees one tile away from player (greedy Chebyshev maximise); <30 → emits `noise` event (draws drone investigation). Does not fight under any condition.
- **Neutral kill consequence:** `Run.#onEntityDamaged` emits `civilian:harmed` when a NEUTRAL entity is damaged by the player or player's turret. Shell subscribes: kill → `adjustRep(CIVILIAN_KILL_PENALTY)`, alarm → `adjustRep(ALARM_PENALTY)`. Closes kaizen item.
- **Clean completion bonus:** On EXIT with zero `civilianHarmsThisJob`, shell applies `+10 Rep`.
- **Hostile targeting fix:** `Hostile.isHostileTo()` and `Turret.findTarget()` now exclude NEUTRAL entities — drones and turrets no longer target bystanders.
- **Civilian caps:** `mapBuild` gains `maxCorpCivilians` (default 1) and `maxNeutralCivilians` (default 1) to control difficulty scaling.
- **Alert visuals:** Combat status bar shows a red `[ALERT]` tag when `world.alarmActive`. CRT filter applies a faint red wash (`alertTint`) over the canvas, shifting the mood of the whole screen.
- Hub Rep indicator: `REP N (LABEL)` in the Hub status line.
- `combatTurnPipeline.ts`: `PlayerAftermathStep` expanded to include `NeutralCivilianAftermathStep`. `runPlayerAftermathSteps` accepts optional `{ rep }` context. Log formatting covers flee, cornered, and panic steps.
- Persistence: `alarmActive` saved in run snapshots (defaults to `false` for pre-M5 saves). CorpCivilian and NeutralCivilian added to `ARCHETYPE_FACTORY` and `archetypeOf()`.
- Prefab schema: `corpCivilians` and `neutralCivilians` anchor arrays added. `office` gets a corpCivilian anchor; `server-room` gets a neutralCivilian anchor.
- Tests (671 total, up from 631 at M5 start): Rep adjust/clamp (5), CorpCivilian alarm + latch + suppression (9), NeutralCivilian idle/flee/panic at each Rep tier (9), neutral kill emits `civilian:harmed` (2), drone alarm subscription (3), civilian in aftermath pipeline (6), mapBuild civilian caps (3), turret/drone NEUTRAL targeting exclusion (2), persistence round-trip (1), vouch→rep migration (1).

### M6 — Recruitment ✅

- `Campaign` gains `availableRecruits: Crew[]` and `recruitedThisVisit: boolean` — refreshed on each `enterHub()`. `generateRecruits()` rolls 1–2 candidates; archetype weighted via `RECRUIT_ARCHETYPE_POOL` (Merc 40%, Razor 40%, Tech 20%); callsign picked from archetype list excluding all names ever used in this campaign (living + flatlined + current recruit candidates).
- **Unlock conditions** checked in `generateRecruits`: Rep ≥ `REP.RECRUIT_THRESHOLD` (50). Returns empty array below threshold. Contract `reward.recruit` flag type-stubbed on `Contract` for M8's high-tier contract rewards.
- `Campaign.recruit(recruitId)` — validates Rep gate still holds, `recruitedThisVisit` not set, recruit exists in pool; splices recruit from `availableRecruits` into `crew`; sets `recruitedThisVisit = true`; persists. Crew can exceed 3 members after recruitment. Throws on all illegal preconditions.
- `Campaign.backfillRecruitsIfEligible()` — safety net called by the shell before opening `<crew-roster>`. Fills an empty pool when Rep meets threshold but recruits weren't generated (edge case from restore order or Rep changes between enterHub and roster open).
- Hub UI: `<crew-roster>` extended with an "Available Recruits" section below the crew list (visible when `availableRecruits.length > 0` and `!recruitedThisVisit`). Recruit rows are keyboard-navigable — ArrowDown from the last crew row transitions into the recruit section; ArrowUp from the first recruit row returns to crew. Selected recruit shows stats in the detail pane. RECRUIT button commits via `recruit` CustomEvent.
- One recruit per hub visit (`recruitedThisVisit` flag, reset on `enterHub()`).
- **Campaign-start rework:** New campaigns start with `crew: []`. The constructor skips `enterHub()` when crew is empty. Shell flow: `<system-start>` → `<initial-recruit>` (pick 2 of 3 candidates) → `Campaign.recruitInitial(memberIds)` → `Campaign.enterHub()`. `<initial-recruit>` is a new full-screen Web Component with card-based candidate display. `generateInitialCandidates()` produces `RECRUIT.INITIAL_CANDIDATES` (3) candidates using the weighted archetype pool; `recruitInitial()` validates exactly `RECRUIT.INITIAL_PICKS` (2) IDs and moves them into crew. No Rep gate for initial recruitment. `<character-select>` component deleted — archetype selection is replaced by recruitment.
- **`archetype` field:** Merc, Razor, and Tech classes gain an `override archetype` string property (e.g. `'Merc'`). Used by `<initial-recruit>` and `<crew-roster>` for display when `constructor.name` is unavailable (minified builds).

**Delivered expansion (M6 tweaks):**

- **Entity display labels.** `entityLabel()` / `resolveEntityLabel()` in `Entity.ts` produce human-readable names for log messages — callsign for crew, `[Faction]Kind` for everything else. All log producers (`applyIntent`, `combatTurnPipeline`, `corpTurnStatusCopy`, `debug/index`) migrated from raw IDs to labels. The `@` placeholder in action lines replaced with crew callsigns.
- **Status bar two-row activity.** The hint/action split replaced with two rolling activity rows. Proximity hints and corp mood take the upper slot ephemerally; otherwise both show action history.
- **Key help archetype context.** `<key-help>` receives the deployed archetype ID and resolves `{perkLabel}` in the special-action row. Intro paragraph mentions the specific perk name.
- **Rep adjustment order fix.** Clean completion bonus now runs before `onJobEnd` so `enterHub()` → `generateRecruits()` sees updated Rep.
- **Archetype metadata cleanup.** `perkKey` → `perkName`, blurbs rewritten. Old `perkKey` tests removed.
- **AP exhaustion message removed.** The redundant "AP EXHAUSTED — auto-ending turn" flash removed from `applyIntent` and `onUseItem` — the auto-advance is self-evident.
- Tests (699 total, up from 671 at M6 start): `generateRecruits` pool size + archetype weights over 1000 seeds (3), callsign deduplication against flatlined crew + within batch (2), `recruit()` move/flag/gate/unknown (4), `recruitedThisVisit` reset on enterHub (1), persistence round-trip for recruits + pre-M6 compat (2), `backfillRecruitsIfEligible` fill/no-op/guard (3), empty-crew campaign skips enterHub (1), `generateInitialCandidates` count + uniqueness + weights (3), `recruitInitial` validation + commit + unknown + no-rep-gate (4).

### M7 — Combat depth + procgen ✅

Closes the **melee always hits**, **drone patrol anchor**, and **corridor procgen** kaizen items.

- **Melee dodge** (`Combat.ts`): `resolveMelee` now requires the run RNG (no `Math.random` fallback) and rolls defender dodge. Defender dodge threshold = `baseDodgeChance` (from `Crew` / archetype override, else `DODGE_CHANCE = 0.2` for non-crew) + `gear.dodgeBonus` + `COVER_DODGE_BONUS` (0.1) when diagonal corner cover applies. `Razor.baseDodgeChance` is **0.35** (defined on the archetype class, not in `constants.ts`). On a dodge, emits `entity:damaged` with `{ damage: 0, dodged: true }` (listeners see the event; no HP changes). `MELEE_DAMAGE` raised from 2 to 3 to compensate for miss chance. `canMelee` unchanged — the pre-check is still adjacency + AP + faction only. Run telemetry and hit-flash animation ignore zero-damage dodge events. Log line reports roll vs threshold when dodged.
- **Reflex Weave** (`items.ts`, `Crew.applyGear`): Campaign-scoped Finn shop item (80 Cr). Stacks +10% (`DODGE_BONUS`) melee dodge per purchase on a target crew member, capped so `baseDodgeChance + dodgeBonus ≤ 1`. Mirrors Targeting Chip for AIM. Listed in `<finn-shop>` catalog; shown in `<crew-roster>` gear lines when owned.
- **Crew stat surfacing:** `<crew-roster>` detail pane and recruit preview show **AIM** and **DODGE** percentages (base + gear, capped at 100%). `<initial-recruit>` candidate cards show `HP · AIM · DODGE` on each card.
- **Drone patrol anchors** (`mapBuild.js` + prefabs): Prefab schema gains optional `patrolPaths: [{x,y}[]]` waypoint lists. `mapBuild.js` assigns the nearest authored path to each drone spawn (Euclidean distance to first waypoint). Fallback drones now synthesise a 2-point patrol from spawn + nearest cardinal FLOOR tile instead of patrolling in place.
- **New prefab — `lab`:** 10×6 room. Central cover cluster (3 tiles), two drone anchors with cross-lane patrol paths, one CorpCivilian spawn, one NeutralCivilian spawn. Exercises the M5 alarm system in generated maps.
- **Cover hit modifier clarification:** `resolveRanged` applies `COVER_HIT_PENALTY` when `hasCoverBetween(attacker.position, target.position)` is true — i.e. when the *target* has intervening cover. This was the intent from Phase 1 locked-in decisions ("cover grants a defender hit-modifier"). Verify implementation matches intent; document in `Combat.js` if it was previously ambiguous.
- Tests: dodge roll at `DODGE_CHANCE`, Razor defender uses `baseDodgeChance` (0.35), gear `dodgeBonus` in `resolveMelee` threshold, Reflex Weave `applyGear` + purchase + persistence cap repair, cover dodge bonus, miss event emitted with `dodged: true`, HP unchanged on miss, no RNG fallback; patrol path assignment, fallback synthesis, and moving waypoint validation; `lab` prefab parses without error and places anchors correctly.

### M8 — Job board + contract tiers ✅

- `Curator.generateContracts(rng, campaign)` returns 3 deterministic contracts per Hub visit. `generateContract()` remains as a backward-compatible wrapper for older debug/tests. Contract shape now includes `difficulty: 'standard' | 'elevated' | 'critical'` and required `reward: { credits, repDelta, recruit?: true }`.
- **Difficulty effects:** `standard` → 2 drones, no civilians. `elevated` → 3 drones, CorpCivilian cap enabled. `critical` → 4 drones, CorpCivilian + NeutralCivilian caps enabled, and patrol paths are tightened where safe to create shorter gaps between waypoints.
- **Hub meta-upgrade — `better-contracts`:** Finn now sells the unique Better Contracts meta upgrade. `campaign.meta.betterContracts` shifts Curator's pool toward elevated/critical tiers and raises all generated Cred reward floors by 20 Cr.
- **`<contract-select>` web component:** New job-board modal displays all 3 contracts with difficulty badge, threat count, reward summary, and a TAKE THE JOB action. Keyboard-navigable (↑/↓, W/S, Enter, Esc). The shell now shows job board first, then reuses `<run-briefing>` for operative selection, preserving the M4 crew-list deploy pane while inverting acceptance flow.
- `Run.enterCombat()` passes contract `threatCount` and `difficulty` into `mapBuild`; `mapBuild` validates difficulty loudly and derives default civilian caps from the tier.
- `Campaign.onJobEnd` applies extraction rewards on EXIT: carried salvage enters the campaign salvage pool, contract Creds are added to `campaign.credits`, `adjustRep(repDelta)` applies Rep, and `reward.recruit` creates a one-recruit lead for the next Hub visit that bypasses the Rep gate. Reward recruit ids persist across save/restore.
- Tests (727 total): Curator contract board determinism + tier/reward shape + Better Contracts weighting; Campaign contract reward Cred/Rep/recruit flow + Better Contracts purchase; Run contract threat handoff; mapBuild difficulty caps + validation; Finn catalog updated for the new meta item.

## Recorded problems (deferred)

Open items from Phase 2 design are tracked in [`docs/kaizen.md`](./kaizen.md) under the Phase 3 candidates and Monitored sections.
