# Phase 2 Plan — Street Level

Living plan for Phase 2 of Kernel Panic. Source of truth for milestone scope, current progress, and decisions locked in during design. See [phase-1-plan.md](phase-1-plan.md) for Phase 1 history, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall design vision, and [game-overview.md](game-overview.md) for the elevator pitch.

## Current status

| Milestone | Status |
|---|---|
| M0 — Combat feedback animations | ✅ Done |
| M1 — Tech archetype + Deploy Turret | ✅ Done |
| M2 — Campaign layer + named crew roster | ✅ Done |
| M3 — Salvage + inventory + improvised turrets | ⬜ Pending |
| M4 — Finn's shop | ⬜ Pending |
| M5 — Vouch + NPC taxonomy | ⬜ Pending |
| M6 — Recruitment | ⬜ Pending |
| M7 — Combat depth + procgen | ⬜ Pending |
| M8 — Job board + contract tiers | ⬜ Pending |

**Phase 2 complete** when *all three* of:

1. Every milestone box ticked ✅ (above).
2. Full campaign loop playable offline on iOS Safari + Chrome desktop: Hub crew management → contract selection → job deployment → combat → extract or flatline → return to Hub, with Finn shop, Vouch meter, and recruitment visible.
3. `v0.2.0` tagged in git.

Test count at Phase 2 start: **409 passing** (end of Phase 1 / M8).

## Locked-in decisions

- **Phase 2 scope:** Deepening Meatspace — crew management, campaign layer, new archetype, salvage economy, social groundwork. Cyberspace (Matrix layer, Jack-in, ICE AI) deferred to Phase 3.
- **Campaign model:** A campaign is a series of jobs. `Campaign.js` is the outer container; `Run.js` is refactored to cover a single job (BRIEFING → COMBAT → RESULT). The Hub lives in Campaign, not Run. The campaign ends when the last crew member is flatlined.
- **Crew:** Three named individuals at campaign start — one Merc, one Razor, one Tech. Each has a callsign selected from a curated per-archetype list. Losing all three ends the campaign.
- **Class hierarchy:** `Entity → Crew → [Merc | Razor | Tech]`. `Crew` adds `callsign`, `flatlined`, `inventory`, `gear`. Merc and Razor are migrated to extend `Crew` in M1 alongside Tech; their existing behaviour is unchanged.
- **`flatlined` vs `alive`:** `Entity.alive` is job-scoped — it resets when a crew member is deployed on a new job. `Crew.flatlined` is campaign-permanent; a flatlined crew member is never deployed again.
- **Callsigns:** Each archetype file exports a `const CALLSIGNS` string array (10–15 curated entries). `buildCrewMember(archetypeId, spawn, rng)` replaces `buildPlayer` in `src/game/archetypes/index.js` and uses the campaign `Rng` to pick from the list. Snapshots store the chosen callsign explicitly so restore never re-rolls. Callsign deduplication excludes names already held by any living or flatlined crew member in the campaign's history.
- **Tech turret (free):** Tech starts each job with 1 pre-built turret — a starting resource, not a crafted item. Deploying costs AP (`AP_COST.DEPLOY = 2`). The turret persists as a placed grid entity until destroyed or the job ends.
- **Tech turret (improvised):** From M3, Tech can deploy additional turrets mid-job by spending salvage (`SALVAGE_PER_IMPROVISED_TURRET`, suggest 2 units). Trade-off: tactical advantage now vs. salvage to trade at Finn's later. Only Tech can convert salvage to turrets in the field.
- **Salvage:** Universal collectible — all archetypes can loot drone corpses. Generic units (no typed components) in Phase 2. All archetypes bring salvage back to Finn at job end via the extraction path.
- **Three persistence scopes:**
  - *Job-scoped* — consumables used, turrets placed; gone when the job ends.
  - *Campaign-scoped* — crew gear, campaign salvage pool, Vouch meter; survive across jobs, lost on campaign wipe.
  - *Meta-scoped* — Hub upgrades purchased from Finn; permanent, survive even a full campaign wipe.
- **Finn:** Hub NPC (a nod to Gibson's fence archetype). Accepts salvage; sells consumables (cheapest), crew gear (campaign-scoped), and Hub upgrades (meta-scoped). Placed in the Hub grid; interact to open shop.
- **NPC taxonomy on jobs:**
  - *Collective-aligned* — Curator, Finn; never hostile.
  - *Truly neutral* — civilians; Vouch-sensitive (behavior scales with meter level).
  - *Corp-aligned non-combatant* — office workers, desk security; do not fight but trigger an alarm (all drones in the map enter ENGAGE) if they spot the player.
- **Vouch:** Campaign-level meter (0–100, starting at 50). Raised by clean contract completion; lowered by civilian/neutral kills. Gates neutral NPC behavior and crew recruitment unlocks.
- **Recruitment:** New crew members unlock when Vouch reaches a threshold (suggest 65) or as a specific contract reward. Archetype and callsign generated on recruit; callsign deduplication applies.
- **Animations (M0):** Turn-blocking — input disabled for ~300ms during the longest active animation. Three effects: screen shake (CSS `@keyframes` translate on game container, ~150ms), damage reddening (CRT filter temporary red vignette, ~300ms), muzzle flash (1-frame canvas color override at shooter's tile, ~80ms). All wired to the existing event bus. No game-logic changes.
- **Unified special-action key (M1):** Vault, Slide, and Deploy collapse into a single `x` → `MODE.SPECIAL_AIM` → `{ type: 'special', dx, dy }` intent at the keymap layer; `applyIntent.doSpecial` dispatches to the archetype's perk by capability sniffing (`canDeploy` → Tech, `canVault` → Merc, `canSlide` → Razor). One key, one touch-pad button, one help row — no WASD collision (the original plan's `d` key clashed with WASD-right), and adding a future archetype only requires implementing its perk method.

## Architecture conventions

All Phase 1 conventions apply (pure/DOM split, relative imports inside `src/`, absolute from outside, DataStore + `h()` + Web Components, crash over silent fallback, tests must be able to fail). Additions for Phase 2:

- **Campaign layer.** `src/game/Campaign.js` is the new top-level game object. `index.js` mounts Campaign; Campaign mounts Run for each job. Run no longer owns the Hub state machine.
- **Three DataStore scopes.** Job scope existed implicitly in Phase 1. Campaign scope (`crew`, `salvage`, `vouch`) and meta scope (`upgrades`) are new; both are serialised as separate DataStore records and survive across jobs and campaign wipes respectively.
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

### M2 — Campaign layer + named crew roster ⬜

The biggest architectural seam in Phase 2. `Run.js` is refactored; Hub logic moves up.

- `src/game/Campaign.js` — top-level state machine. States: `HUB` → `COMBAT` (a Run episode) → back to `HUB`; terminal state `ENDED` (all crew flatlined).
- Owns: `crew[]` (array of `Crew` instances), `salvage` (number, campaign pool), `vouch` (number, stub `50` until M5), meta-upgrade state (stub `{}` until M4).
- `buildCrew(rng)` — creates one Merc, one Razor, one Tech via `buildCrewMember`; deduplicates callsigns.
- `deployCrewMember(id)` — validates member is not flatlined; instantiates a `Run` for the job.
- `onJobEnd(result)` — if crew member survived: adds extracted salvage to pool; if died: calls `flatlineMember(id)`, then checks `crew.every(m => m.flatlined)` → transition to `ENDED`.
- `flatlineMember(id)` — sets `crew[id].flatlined = true`. Irreversible within the campaign.
- `Run.js` refactored: `HUB` state removed. Run now covers `BRIEFING → COMBAT → RESULT` only. Hub panel rendering moves to Campaign's `HUB` handler in `index.js`.
- `index.js` (shell): mounts `Campaign` instead of `Run` directly. Campaign's `onPersist` callback writes to DataStore at campaign scope. Meta scope written separately on every Hub upgrade purchase.
- **Campaign wipe UX (shell):** When the last non-flatlined operator dies on a job, `<crash-dump>` shows campaign-terminal copy (`willEndCampaignOnThisDeath` → `campaignTerminal` on death telemetry — **CAMPAIGN TERMINATED**, last-fight trace, `[ NEW CAMPAIGN ]`). Resuming a save in `ENDED` uses `outcome: 'campaign-over'` (roster + salvage line). Same overlay component as per-job debrief (M8).
- DataStore: new `campaign` record `{ id, crew: CrewSnapshot[], salvage, vouch, meta }`. `persistence.js` gains `snapshotCampaign(campaign)` / `restoreCampaign(record)`. Corrupt campaign records throw with useful messages (same rule as job snapshots).
- Hub UI: `<crew-roster>` web component — shows all three crew members (callsign, archetype badge, HP indicator, `FLATLINED` flag). Crew member selection for next deployment. Mounts in place of the removed Hub-inside-Run panel.
- `buildPlayer` removed from `src/game/archetypes/index.js`; all callers updated.
- Tests: `Campaign.test.js` — crew creation (3 members, one per archetype, unique callsigns), deployment validation (not flatlined), flatline + campaign-end condition, `onJobEnd` salvage accumulation, snapshot/restore round-trip.

### M3 — Salvage + inventory + improvised turrets ⬜

Closes the **corpse memorisation** kaizen item (load-bearing for the salvage loop).

- **Corpse memorisation:** `VisionField` gains a `memorisedCorpses: Map<coordKey, GlyphRecord>` updated whenever a drone death (`entity:damaged` with lethal damage) occurs within the current LOS. Remembered corpse renders at `MEMORY_DIM` color when out of current LOS (same dim pass used for remembered tiles). Clears on job end. Closes kaizen item.
- **Loot drop:** On lethal damage, the drone entity gains `loot: { salvage: N }` where N is rolled from `Rng` in the range `[1, 3]`. Loot is not removed when LOS is lost — the memorised position is enough to navigate back.
- **`Crew.inventory` solidified:** `{ salvage: number, consumables: Item[] }` (consumables stub `[]` until M4). `collectSalvage(world, targetEntity)` — legal when crew member is Chebyshev-adjacent to the target corpse (not `alive`) and `targetEntity.loot.salvage > 0`; costs `AP_COST.INTERACT`; moves loot into `inventory.salvage`; zeroes `targetEntity.loot.salvage`. Throws on all illegal preconditions.
- **Salvage extraction:** On `Run` RESULT, `Campaign.onJobEnd` reads `deployedMember.inventory.salvage` and adds it to `campaign.salvage` before zeroing the member's inventory. Salvage is always extracted — it does not stay on the crew member between jobs.
- **Tech improvised turret:** `Tech.improviseTurret(world, tx, ty)` — identical to `deployTurret` in tile checks and AP cost, but also gates on `inventory.salvage >= SALVAGE_PER_IMPROVISED_TURRET` (suggest 2) and deducts that salvage on commit. The unified `x` special path routes to `deployTurret` if `turretReady`, otherwise to `improviseTurret` if inventory allows, otherwise throws a legibility error.
- `SALVAGE_PER_IMPROVISED_TURRET = 2` added to `src/game/constants.js`.
- Tests: loot roll distribution, corpse memorisation triggers and clears on job end, `collectSalvage` legality matrix (adjacency, alive check, loot present, AP gate), extraction into campaign pool, improvised turret legality (salvage gate, tile checks, AP debit + salvage debit).

### M4 — Finn's shop ⬜

- `src/game/hub/Finn.js` — NEUTRAL Hub NPC; `catalog(metaState)` returns an array of `Item` descriptors filtered by which meta-upgrades have been purchased. Placed at `(2, 2)` in the Hub (authored, no collision with Terminal at `(9, 2)` or Curator at their authored position).
- **Item catalog (Phase 2 initial set):**

  | Item | Scope | Cost (salvage) | Effect |
  |---|---|---|---|
  | Stim | Job-scoped | 2 | Restores 2 HP to the deployed crew member |
  | Smoke charge | Job-scoped | 3 | Blocks LOS in radius 2 for 1 turn (new `SMOKE` tile type, passable, blocks LOS) |
  | Armour plating | Campaign-scoped | 6 | +1 `maxHp` on target crew member |
  | Targeting chip | Campaign-scoped | 8 | +`TARGETING_BONUS` to `BASE_HIT_CHANCE` for that crew member |
  | Expanded catalog | Meta | 15 | Unlocks rare item tier in Finn's shop |

- `<finn-shop>` web component — Shadow DOM. Browse catalog (grouped by scope), shows campaign salvage balance, select target crew member for crew-gear purchases, confirm. Emits `purchase` CustomEvent `{ item, targetMemberId }`. Keyboard-navigable (↑/↓, Enter confirm, Esc close) for consistency with `<character-select>`.
- Hub panel: `<finn-shop>` mounts inside the Hub panel. Finn entity in Hub grid shows `F` glyph; interact (`i`) when adjacent opens the shop (same pattern as Terminal → character-select).
- `Campaign.js` handles `purchase` events: deducts salvage, applies item effect. Crew-gear effects are stored on `Crew.gear` (e.g. `{ maxHpBonus: 1, hitBonus: 0 }`). `Combat.resolveRanged` reads `attacker.gear?.hitBonus ?? 0`. Meta upgrades stored in `campaign.meta`.
- Tests: `Finn.test.js` — catalog generation with and without meta-upgrade, purchase validation (insufficient salvage throws), crew-gear application, meta-upgrade flag set; `persistence.test.js` — crew gear survives campaign snapshot round-trip.

### M5 — Vouch + NPC taxonomy ⬜

Closes the **NEUTRAL faction shootable** kaizen item.

- `Campaign.vouch` solidified (was stubbed at 50 in M2). `adjustVouch(delta)` clamps to `[0, 100]`. Events that adjust Vouch: +10 on clean contract completion (no civilian harm), −20 on neutral/civilian kill, −5 on corp non-combatant alarm triggered (complicity). All adjustments logged to the event bus as `vouch:changed { delta, reason }` for the UI feed.
- **`CorpCivilian`** (`src/game/entities/CorpCivilian.js`) — extends `Entity`. Faction = CORP. No weapons. On each corp turn, checks `hasLineOfSight` to the deployed crew member (using shared `withinRange` + `blockerKeys`); if visible, emits `alarm` event. All `CorpDrone` instances subscribed to `alarm` immediately transition to ENGAGE with the crew member as target. Placed by `mapBuild.js` at authored spawn points in prefabs (at least one per `office` prefab).
- **`NeutralCivilian`** (`src/game/entities/NeutralCivilian.js`) — extends `Entity`. Faction = NEUTRAL. Behavior on corp turn varies by `campaign.vouch`: ≥70 → idle; 30–69 → moves one tile away from player (uses `Pathfinding` to flee); <30 → emits `noise` event (triggers drone investigate). Does not fight under any condition.
- **Neutral kill consequence:** `canFireRanged` already permits cross-faction shots on NEUTRAL. Now a `resolveRanged` hit on a NEUTRAL entity additionally emits `civilian:harmed { source }` — Campaign adjusts Vouch and logs to the feed. Closes kaizen item.
- Hub Vouch indicator: a `VOUCH` readout added to the Hub crew panel (numeric + qualitative label: TRUSTED / KNOWN / UNKNOWN / BURNED).
- `mapBuild.js`: CorpCivilian and NeutralCivilian spawns added to prefab schema. `office` and `server-room` prefabs updated with at least one civilian spawn each.
- Tests: Vouch adjust/clamp, CorpCivilian alarm emission + drone ENGAGE transition, NeutralCivilian idle/flee/noise at each Vouch tier, neutral kill emits `civilian:harmed`, Vouch adjustment applied from event.

### M6 — Recruitment ⬜

- `Campaign` gains `availableRecruits: CrewRecord[]` — refreshed on each Hub visit. `generateRecruits(rng, campaign)` rolls 1–2 candidates; archetype weighted (Merc 40%, Razor 40%, Tech 20%); callsign picked from archetype list excluding all names ever used in this campaign (living + flatlined history).
- **Unlock conditions** checked in `generateRecruits`: Vouch ≥ 65 (at least one recruit appears) OR a completed contract carried a `reward.recruit: true` flag (M8 adds this to high-tier contracts).
- `Campaign.recruit(recruitId)` — validates unlock condition still holds; pushes recruit onto `campaign.crew`; updates DataStore. Crew can exceed 3 members after recruitment.
- Hub UI: `<crew-roster>` extended with a "Available Recruits" section (visible when `availableRecruits.length > 0`). Confirm button triggers `recruit` event on Campaign.
- Tests: recruit generation (archetype weights over many seeds, callsign deduplication), Vouch gate enforcement (below threshold → no recruits), recruit persistence in campaign snapshot.

### M7 — Combat depth + procgen ⬜

Closes the **melee always hits**, **drone patrol anchor**, and **corridor procgen** kaizen items.

- **Melee dodge** (`Combat.js`): `resolveMelee` gains a dodge roll. Defender has `DODGE_CHANCE` (suggest 0.2) base; cover between attacker and defender adds `COVER_DODGE_BONUS` (suggest 0.1). On a miss, emits `entity:damaged` with `{ damage: 0, dodged: true }` (listeners see the event; no HP changes). `MELEE_DAMAGE` raised from 2 to 3 to compensate for miss chance. `canMelee` unchanged — the pre-check is still adjacency + AP + faction only. Closes kaizen item.
- **Drone patrol anchors** (`mapBuild.js` + prefabs): Prefab schema gains an optional `patrolPaths: [{x,y}[]]` array of waypoint lists. `mapBuild.js` assigns the nearest authored path to each drone spawn (Euclidean distance to first waypoint). Fallback for drones that can't be assigned a path: synthesise a 2-point patrol from spawn + the nearest floor tile in a cardinal direction. Closes kaizen item.
- **New prefab — `lab`:** 10×6 room. Central cover cluster (3 tiles), two drone anchors with a cross-shaped patrol path, one CorpCivilian spawn, one NeutralCivilian spawn. Exercises the M5 alarm system in generated maps.
- **Cover hit modifier clarification:** `resolveRanged` applies `COVER_HIT_PENALTY` when `hasCoverBetween(attacker.position, target.position)` is true — i.e. when the *target* has intervening cover. This was the intent from Phase 1 locked-in decisions ("cover grants a defender hit-modifier"). Verify implementation matches intent; document in `Combat.js` if it was previously ambiguous.
- Tests: dodge roll at DODGE_CHANCE, cover dodge bonus, miss event emitted with `dodged: true`, HP unchanged on miss; patrol path assignment (authored path wins, fallback synthesised), `lab` prefab parses without error and places anchors correctly.

### M8 — Job board + contract tiers ⬜

- `Curator.generateContracts(rng, campaign)` replaces `generateContract` — returns an array of 3 contracts per Hub visit. Contract shape gains `difficulty: 'standard' | 'elevated' | 'critical'` and `reward: { salvage: N, vouchDelta: N, recruit?: true }`.
- **Difficulty effects:** `standard` → existing threat count + no civilians. `elevated` → +1 drone, CorpCivilian present. `critical` → +2 drones, CorpCivilian + NeutralCivilian present, harder drone patrol paths (shorter gaps between waypoints).
- **Hub meta-upgrade — `better-contracts`** (available from Finn in M4): shifts `generateContracts` pool weight toward elevated/critical tiers and raises salvage reward floors. Campaign's `meta.betterContracts` flag gates this.
- **`<contract-select>` web component** replaces `<run-briefing>` — displays all 3 contracts with difficulty badge, reward summary, and a TAKE THE JOB button. Keyboard-navigable (↑/↓, Enter, Esc). The selected contract is passed into `Campaign.deployCrewMember(memberId, contract)` and from there into `Run` → `mapBuild`.
- `mapBuild.js`: accepts `threatCount` and `difficulty` from the contract; scales drone count and civilian spawns accordingly.
- `Campaign.onJobEnd` applies `contract.reward`: salvage added to pool, `adjustVouch(vouchDelta)`, recruit flag sets a pending recruit for next Hub visit.
- **Invert job acceptance flow:** Currently, when talking with the Curator, player selects the crew member to deploy, then accepts the job. Once job options land, player should first be presented with the job list, then once they take a job, they can choose the crew member best suited to that mission. Phase 3 will further enrich this paradigm when we add more complexity to job completion goals beyond "find the exit."
- Tests: `Curator.test.js` — pool of 3, difficulty distribution, reward scaling, `better-contracts` shifts pool; `Campaign.test.js` — contract reward applied correctly (salvage, Vouch, recruit flag), `mapBuild` receives correct threat config from contract.

## Recorded problems (deferred)

Open items from Phase 2 design are tracked in [`docs/kaizen.md`](./kaizen.md) under the Phase 3 candidates and Monitored sections.
