# P3.M3 — Cyberspace Grid + ICE: Working Plan & Progress

Working document for the P3.M3 implementation effort on branch `3.0-cyberspace`.
Companion to [phase-3-plan.md](phase-3-plan.md) (the milestone spec); this file
tracks the approved slice plan, recorded scope decisions, and live progress so
the effort can be resumed cold.

## Scope decisions (recorded 2026-06-09, Rylee)

1. **First playable slice only** — slices M3.1–M3.6 (contract flag → jack-in
   terminal → cyber layer model → data node objective → Probe ICE → render
   swap). **Spark/Guardian ICE deferred** to follow-up slices; the milestone
   stays open in phase-3-plan.md until they land.
2. **Minimal voluntary jack-out pulled forward** from P3.M4.6 so the layer is
   playable end-to-end solo before the simstim flip exists. M4.6 then only adds
   forced jack-out + dual-deploy cleanup.
3. **Avatar death = flatline** — ICE destroying the avatar kills the Decker
   through the existing DEATH/flatline paths. Genre-honest (black ICE kills),
   zero new death machinery.
4. **Named cyber stats ship now with real effects**: RAM = avatar HP pool,
   intrusion strength = slice progress per interact, ICE resistance =
   `damageReduction` (existing min-1 mitigation in `Combat.ts`). Persisted and
   validated in both crew persistence paths.

TDD throughout; malformed persisted state throws (no silent fallbacks).
Commits land **per green slice** (user-approved).

## Progress

| Slice | Status | Commit |
|---|---|---|
| **S1 — P3.M3.1 Contract flag + gates** | ✅ Done | `f436330` |
| **S2 — P3.M3.2 Jack-in terminal** | ✅ Done | `05013f6` |
| **S3 — P3.M3.3 Cyber layer model + avatar + persistence** | 🔨 In progress (research done, no code yet) | — |
| **S4 — P3.M3.4 Data node objective** | 🔲 Planned | — |
| **S5 — Voluntary jack-out (M4.6 pull-forward)** | 🔲 Planned | — |
| **S6 — P3.M3.5 Probe ICE** | 🔲 Planned | — |
| **S7 — P3.M3.6 Render/input swap + shell ICE phase** | 🔲 Planned | — |
| **S8 — Docs + wrap-up** | 🔲 Planned | — |

### S1 implementation notes (shipped)

- `OBJECTIVES.DATA_NODE_SLICE = 'data-node-slice'` with cross-field validation
  in `normalizeObjective` (`Curator.ts`): the kind requires
  `params.requiresCyberspace === true` plus positive-integer `params.count`;
  the flag is forbidden on every other kind. Validates at generation,
  `Run.enterBriefing`, and snapshot restore (all call `normalizeObjective`).
- `contractRequiresCyberspace(contract)` exported from `Curator.ts` — single
  source of truth for "this contract has a Cyberspace component".
- New recipe `cyber-data-spike` (params `{requiresCyberspace: true, count: 1}`,
  no `targetParams` spread — placement is owned by the DATA_NODE_SLICE arm, and
  no turn-limit/door-routing machinery engages). Gated by the new
  `ContractRecipe.availableWhen?: (ctx) => boolean` hook: requires
  `arcStage ∈ {act-2, act-3} && hasLivingDecker === true`.
- `recipeIsAvailable` filter applies to **all three** generation paths (fresh
  `generateRecipeContract`, revisit, principal-biased). When no gated recipe
  qualifies the filtered pool is identical to the historic pool, so seeded
  generation for pre-P3.M3 contexts is unchanged (full suite stayed green).
- `ContractRecipeContext`/`ContractCampaign` gained `hasLivingDecker?`;
  `Campaign.get hasLivingDecker()` = some non-flatlined `archetype === 'Decker'`.
- Deploy gate in `Campaign.deployCrewMember`: throws
  `requires a living Decker to jack in` for cyber contracts unless the deployed
  member is a (non-flatlined) Decker.
- UX: `CrewList.setCrew(crew, rowGate?)` — `CrewRowGate` returns a disable tag
  or null; selection/keyboard nav skip gated rows. `RunBriefing` derives the
  gate from the contract (`NEEDS DECKER` on non-Decker rows), re-applies on
  contract swap, and `#commit`/jack-in button respect it.
- `Run.isObjectiveFamilySatisfied` has a `DATA_NODE_SLICE` case returning
  `false` (honestly unsatisfiable until S4 wires sliced-node counting). The
  exhaustive `never` default caught the new kind at typecheck.
- Tests: `tests/unit/game/hub/cyberContract.test.ts` (14 tests — validation
  throws, generation gating over 40 seeded boards, determinism, deploy gates).

### S2 implementation notes (shipped)

- `src/game/entities/JackInPoint.ts` — `JackInPoint extends Interactable`,
  glyph `Ω` (`JACK_IN_GLYPH` in constants), default label `Jack-in port`,
  id `jack-in-0` (deliberately **not** matching `/^terminal-\d+$/`, which
  TERMINAL_SLICE counts — regression-tested). `interact`: linked → logged
  `already-linked` refusal (never throws); capability sniff
  `actor.canJackIn !== true` → `no-cyberdeck` refusal; success spends interact
  AP, latches `linked`, emits `EVENT.JACK_IN` `{point, actor}` exactly once.
- `Decker.canJackIn = true` (readonly capability, P3.M2 sniffing pattern).
- `events.ts`: `JACK_IN: 'cyber:jack-in'`, `JACK_OUT: 'cyber:jack-out'`
  registered (known-types-only bus).
- Placement: `Run.#placeObjectiveInteractables` gained the DATA_NODE_SLICE arm —
  one port via `findInteractableAnchor`, deterministic per contract seed.
- `Run.cyberspace: CyberspaceState | null` latched in `enterBriefing` from
  `contractRequiresCyberspace` (`{phase:'dormant'}` or `null`). S2's
  `CyberspaceState` is dormant-only; S3 extends the union.
- Persistence: `RunSnapshot.cyberspace?: RunCyberspaceSnapshot`;
  `snapshotCyberspace` in Run.ts; `restoreCyberspace` in persistence.ts
  enforcing **block ⇔ cyber-contract both directions**, unknown phase throws,
  dormant payload smuggling throws. Entity plumbing: `'jack-in-point'` in
  `EntityArchetypeId`, `archetypeOf`, `SNAPSHOT_EXTRACTORS`,
  `ARCHETYPE_FACTORY`, `ENTITY_RESTORE` (+ `readJackInPoint` throwing on
  missing label/linked).
- Tests: `tests/unit/game/jackInPoint.test.ts` (12 tests — interact behavior,
  placement determinism, round-trip, adversarial restore throws).

## Architecture decisions (approved plan)

### Cyber layer model — `CyberspaceLayer` owned by `Run`, single `TurnQueue`, both worlds tick

New `src/game/cyber/CyberspaceLayer.ts`: owns its own `EventBus`, `World`
(own `Grid`), `CyberAvatar`, `entryTile`, `mapSeen`. NOT a nested Run.

```ts
type CyberspaceState =
  | { phase: 'dormant' }                                // shipped (S2)
  | { phase: 'active'; layer: CyberspaceLayer }         // S3
  | { phase: 'resolved'; objectiveComplete: boolean };  // S3/S5
Run.cyberspace: CyberspaceState | null;                 // null ⇔ no cyber component
```

Turn integration: keep the one existing `TurnQueue`. `TurnQueue.endTurn(world)`
(verified: emits `TURN_ENDED {previous, next, turn}`, refreshes incoming-faction
AP in the world it is handed, ticks that world's alarm on round advance) runs on
the meat world as today. `Run`'s existing `TURN_ENDED` listener
(`_reattachCombatListeners`, Run.ts ~887) consumes the payload and, when cyber
is active, calls `layer.onTurnEnded(next)`: refresh incoming-faction AP in the
cyber world + tick the cyber alarm on round advance. The shell's corp phase
(S7) chains two `corpTurnDriver.runCorpTurn` passes: meat hostiles, then ICE
(`ctx.run = {state, world: layer.world, rng: run.rng}`). **Meatspace keeps
ticking during jack-in** — the Decker body stands at the port as `run.player`,
targetable; body death hits the existing player-death path
(`#onEntityDamaged`, Run.ts ~938). M4.2 vulnerability falls out for free.

### Avatar + cyber stats

`src/game/cyber/CyberAvatar.ts` — `CyberAvatar extends Entity`: faction PLAYER,
glyph `@`, maxAp 4, `maxHp = decker.ram`,
`damageReduction = decker.iceResistance`, carries `intrusionStrength` +
`callsign`, `baseHitChance` 0.8 (the grid is home turf; `Combat.resolveRanged`
capability-sniffs `'baseHitChance' in attacker`, so a non-Crew avatar fights
with zero combat changes).

Stats live on `Decker` as validated fields with constants
`DECKER_BASE_RAM = 8`, `DECKER_BASE_INTRUSION = 2`,
`DECKER_BASE_ICE_RESISTANCE = 1` (`src/game/constants.ts`); ctor throws on
non-positive-integer overrides. Persist in **both** crew paths:

1. `CampaignCrewSnapshot` (persistence.ts ~743) gains optional
   `cyber?: { ram; intrusion; iceResistance }` written by `snapshotCrewMember`
   for deckers only; `restoreCrewMember` (~1326) applies for
   `archetype === 'decker'`. Absent → defaults (legacy normalization);
   present-but-malformed or half-populated → throw.
2. Run-entity `decker` extra becomes
   `DeckerSnapshot = CrewSnapshot & {ram; intrusion; iceResistance}` —
   extractor in Run.ts `SNAPSHOT_EXTRACTORS.decker` (~1698), matching
   `ENTITY_RESTORE.decker` apply hook.

Avatar **current** RAM rides the base entity record (`hp`/`maxHp`/
`damageReduction`) inside the cyber snapshot block; `intrusionStrength` +
`callsign` ride its `extra`.

Avatar death: cyber-bus `ENTITY_DAMAGED` listener wired at jack-in (and on
restore via `_reattachCombatListeners` — the single seam both `enterCombat` and
`persistence.restore` already call) → set `telemetry.cause` →
`enterResult({outcome: OUTCOME.DEATH})` → `Campaign.onJobEnd` flatlines the
Decker through existing machinery.

### Generation — dedicated generator, reuse TILE values, contract-seed determinism

`src/game/cyber/cyberMapBuild.ts`: `buildCyberMap({rng, difficulty})` →
rooms-as-nodes lattice (5–8 square nodes), 1-tile corridors (data lines),
`TILE.WALL` fill (firewall). **Only FLOOR/WALL tile ids** — Grid
passability/LOS, A*, VisionField, World all work unchanged. Node count scales
with difficulty. Returns `{grid, entryTile, nodeTiles, patrolRings}`.
Connectivity validated from `entryTile` via `mapConnectivity.ts`
`explorationReachableKeys` (verified signature: `(world, start, options)` —
needs a throwaway `World` wrap or a grid-level flood; throws on unreachable
node tiles). ~150 lines; do NOT reuse the BSP/prefab `buildMap`.

Seed: `new Rng(contract.seed).fork('cyberspace')` — layout independent of
jack-in turn, trivially restorable.

Distinct visuals via a **tileset axis** (S7), not new TILE ids: `palette.ts`
gains `TilesetId = 'meat' | 'cyber'` + `CYBER_TILE_GLYPH` (FLOOR `·` deep cyan,
WALL `▒` magenta — tune in browser); `glyphForTile(tile, principalId?,
tileset?)` throws on unknown tileset. Thread through
`BuildFrameOptions`/`buildFrame`/`AsciiRenderer.draw`.

### Data node objective semantics (S4)

`src/game/cyber/DataNode.ts` — `DataNode extends Interactable` (Terminal
pattern): `sliceProgress`, `sliceDifficulty` (2/3/4 by contract difficulty).
`interact` capability-sniffs `intrusionStrength` (non-avatars refused), spends
interact AP, adds intrusion to progress; sliced at threshold. Glyph `◈`
(`◆` is DenyTarget's).

Satisfaction: `ObjectiveState` gains `cyber?: {sliced, required}`;
`isObjectiveFamilySatisfied` DATA_NODE_SLICE case reads it;
`#refreshObjectiveTimerState` computes — `active` → count sliced nodes in the
layer world; `resolved` → `objectiveComplete ? required : 0`; `dormant` → 0.
**Jack-out before slicing = objective permanently unsatisfiable** → reaching
the meat exit hits the existing `onAbortRequested` confirm flow (incomplete
blocks *clean* extraction; zero new extraction code). `objectiveProgress.ts`
gains a `NODES` progress chip. Grep `describe.ts`/`combatHud.ts` for
kind-keyed copy in this slice.

### Jack-in / jack-out (S3 core, S5 finalization)

- `Run.jackIn(point)` via meat-bus `EVENT.JACK_IN` subscription (registered in
  `_reattachCombatListeners`): `state === COMBAT` else throw;
  `cyberspace.phase === 'dormant'` else **throw** (corrupt latch); build layer,
  wire cyber listeners, autosave (`onPersist` explicitly — the latch transition
  must never be lost).
- Jack-out: `EntryPort extends Interactable` at `entryTile` in the cyber world
  (glyph `▼`, avatar-only capability sniff); interact emits `EVENT.JACK_OUT` on
  the cyber bus → `Run.jackOut()`: throw unless active; latch
  `objectiveComplete`, `layer.teardown()` (unbind ICE bus subs), phase
  `resolved`, autosave. Re-jack-in after resolve refused (`LINK BURNED`
  flavor — `JackInPoint.linked` is already latched).

### Probe ICE (S6)

`src/game/cyber/ProbeIce.ts` — `ProbeIce extends PatrolHostile`, faction CORP,
glyph `¶`, displayName `Probe`, explicit small stats (maxHp 3, dmg 1,
sightRange 6 — ICE scaling is its own axis, skip `resolveEnemyStats`).
`engageSteps`: on acquisition raise the cyber alarm
(`world.raiseAlarm({repPenalty: false, ...})`) then weak attack; Probe
**listens** for alarms (unlike Lookout) so packs converge. Add `'probe-ice'`
to `PATROL_ARCHETYPE_IDS` so `PatrolSnapshot` machinery applies. Patrol
waypoint rings around node tiles from `buildCyberMap`. Run's cyber
`ENTITY_DAMAGED` listener also unbinds killed patrol hostiles (mirror of the
meat path). Verify no rep listener attaches to the cyber bus.

### Render/input swap (S7)

`Run` accessors keep the shell mechanical: `get cyberActive`,
`get activeWorld`, `get activeActor`. Shell (`index.ts`): module-level
`cyberVision = new VisionField()`; swap `recomputeVision`, `paint`
(+`tileset`), `applyIntent` ctx (`world: run.activeWorld,
player: run.activeActor`), look/describe, `buildCombatHudSnapshot` (identity
`AVATAR`, HP pane labeled RAM), statusLine, location label (`// THE GRID //`),
chained ICE corp pass. `ApplyIntentContext.player: Archetype` widens to accept
`CyberAvatar` (it exposes none of the perk capabilities, so `doSpecial`
sniffing is safe). No keymap/keyHelp changes — jack-in/out are interactions.
PIP deferred to M4.5. **Grep `run.world` / `run.player` / `scene.world` /
`scene.player` exhaustively** — look/describe, touch path, corpse-memory
vision are the known stragglers.

## Persistence (consolidated; S2 shipped the dormant scaffolding)

`RunSnapshot.cyberspace` (S3 extends the S2 shape):

```ts
cyberspace?: {
  phase: 'dormant' | 'active' | 'resolved';
  // 'active' only — all required together:
  seed?, grid?: {w,h,tiles}, entities?: RunEntitySnapshot[],  // avatar, entry-port, data-nodes, probe-ice
  entryTile?, alarm?: AlarmState, mapMemory?: {seen: string[]},
  // 'resolved' only:
  objectiveComplete?: boolean;
};
```

Restore rules (`restoreCyberspace` in persistence.ts — S2 shipped the dormant
subset; all throws, `restoreOverrideState` style):

- `contractRequiresCyberspace(contract)` ⇔ block present (both directions). ✅ shipped
- Unknown phase throws. ✅ shipped
- `dormant` carrying payload throws. ✅ shipped
- S3: `active` missing any required field throws; exactly one alive
  `cyber-avatar` (0 or 2+ throws); entities bounds-checked against the
  **cyber** grid (reuse `restoreEntity(rec, cyberGrid)`); seen keys
  bounds-checked.
- S3: `resolved` without boolean `objectiveComplete`, or carrying active-only
  fields, throws.
- S3: Decker `cyber` stat blocks (campaign crew + run entity extra): absent →
  defaults (legacy normalization); present-but-malformed or half-populated →
  throw.
- After rebuild: probes `bindToBus(layer.bus)`; cyber listeners re-wired in
  `_reattachCombatListeners`.
- Autosave cadence unchanged (meat-bus `TURN_ENDED` still fires every end-turn
  while jacked in — single queue); `jackIn`/`jackOut` call `onPersist`
  explicitly.

## S3 detailed worklist (next up — research complete, no code yet)

**Create:**
- `src/game/cyber/cyberMapBuild.ts` — `buildCyberMap({rng, difficulty})` per
  above; throws on connectivity failure.
- `src/game/cyber/CyberAvatar.ts` — per above.
- `src/game/cyber/EntryPort.ts` — `EntryPort extends Interactable` (glyph `▼`,
  label `Exit port`); interact by avatar emits `EVENT.JACK_OUT` (charge
  `AP_COST.INTERACT`).
- `src/game/cyber/CyberspaceLayer.ts` — class +
  `static build({contractSeed, difficulty, decker})` (forks
  `new Rng(contractSeed).fork('cyberspace')`, builds map, spawns avatar at
  `entryTile`, `EntryPort`, data nodes (S4 fills in), ICE (S6));
  `onTurnEnded(next: FactionId)`; `recordSeen(keys)` (bounds-validated,
  throws); `snapshot(): CyberspaceLayerSnapshot`; `teardown()`.

**Modify:**
- `src/game/archetypes/Decker.ts` + `constants.ts` — `ram`/`intrusionStrength`/
  `iceResistance` fields, `DECKER_BASE_*` constants, ctor validation.
- `src/game/Run.ts` — extend `CyberspaceState` union + `RunCyberspaceSnapshot`;
  `get cyberActive / activeWorld / activeActor`; `jackIn(point)` (driven by
  `EVENT.JACK_IN` subscription added to `_reattachCombatListeners`);
  `jackOut()` core; `#onTurnEnded` consumes the `{next}` payload (currently
  ignores it — Run.ts ~927) for the cyber AP/alarm tick; `snapshotCyberspace`
  extended; `SNAPSHOT_EXTRACTORS` entries `'cyber-avatar'`/`'entry-port'`;
  `archetypeOf` instanceof arms; `DeckerSnapshot` extra extension.
- `src/game/persistence.ts` — extend `restoreCyberspace` (active/resolved
  rules above); `ARCHETYPE_FACTORY`/`ENTITY_RESTORE` for
  `'cyber-avatar'`/`'entry-port'`; `ENTITY_RESTORE.decker` apply for cyber
  stats; `CampaignCrewSnapshot.cyber?` in `snapshotCrewMember` (~1309) +
  `restoreCrewMember` (~1326).

**Tests (failing first):**
- `tests/unit/game/cyber/cyberMapBuild.test.ts`: equal-seed determinism;
  different-seed divergence; every node tile reachable from entry; only
  FLOOR/WALL ids; difficulty scales node count.
- `tests/unit/game/cyber/CyberspaceLayer.test.ts`: `build` spawns avatar at
  entry with `maxHp === decker.ram`,
  `damageReduction === decker.iceResistance`; `onTurnEnded(FACTION.PLAYER)`
  refreshes avatar AP only.
- `tests/unit/game/cyber/runJackIn.test.ts`: golden path — seeded cyber run,
  walk Decker to port, interact → `phase === 'active'`; layer grid equals a
  fresh build from the same contract seed (jack-in-turn independence);
  `jackIn` while already active throws; `JACK_IN` on a non-cyber contract
  throws.
- `tests/unit/game/cyber/cyberPersistence.test.ts` (the heart): mid-jack-in
  snapshot → restore → grids/entities/avatar hp/ap/seen equal; full
  adversarial throw matrix (active missing grid/avatar; avatar OOB; multiple
  avatars; resolved missing latch; decker cyber stats half-populated in both
  paths).

## S3 research notes (verified against the tree, 2026-06-09)

- `TurnQueue.endTurn(world)` emits `TURN_ENDED {previous, next, turn}` and
  refreshes AP only for entities in the world it is handed; alarm ticks on
  round advance (TurnQueue.ts:34-55). `Run.#onTurnEnded()` currently takes no
  payload (Run.ts ~927) — S3 threads `{next}` through for the cyber tick.
- `_reattachCombatListeners` (Run.ts ~887) is the single seam used by both
  `enterCombat` and `persistence.restore` — register the `EVENT.JACK_IN`
  subscription and (re)wire cyber-layer listeners there.
- `#onEntityDamaged` (Run.ts ~938) is the player-death template: avatar-death
  listener mirrors `target === avatar && killed` → telemetry.cause →
  `enterResult({outcome: OUTCOME.DEATH})`. It also unbinds killed
  `PatrolHostile`s — the cyber listener needs the same for probes (S6).
- `persistence.restore` (persistence.ts ~872) rebuilds grid → entities →
  Run → world → queue, then calls `_reattachCombatListeners` for COMBAT
  snapshots. `restoreEntity(rec, grid)` bounds-checks against the grid it is
  given — reuse with the cyber grid for cyber entities.
- `CampaignCrewSnapshot` (~743) and `snapshotCrewMember`/`restoreCrewMember`
  (~1309/~1326) are the campaign crew path; run-entity crew state flows through
  `crewSnapshotExtra` (Run.ts ~1675) + `ENTITY_RESTORE` crew handling. Decker
  cyber stats must round-trip through **both**.
- `Entity` ctor validates `damageReduction` as a non-negative integer
  (Entity.ts ~110) — avatar can pass `iceResistance` straight through.
- `explorationReachableKeys(world, start, options)` (mapConnectivity.ts) is the
  flood-fill for cyber connectivity validation; it needs a `World`, so
  `buildCyberMap` should wrap its fresh grid in a throwaway `World` (no
  entities yet → entity blockers moot).
- `World` ctor: `new World(grid, { events: bus })`; alarm API:
  `raiseAlarm(ctx)`, `tickAlarm()`, `snapshotAlarm()`, `restoreAlarm(state)`.
- `Crew.archetype` is the class-name string (`'Decker'`, capital D) for live
  checks; persistence archetype ids are lowercase (`'decker'`).

## Verification (per slice + end-to-end)

1. Per slice: `npm test` (typecheck + test build + `node --test`), `npm run lint`.
2. Determinism: equal-seed trace assertions in S3/S6 tests.
3. Browser smoke after S7 (`npm start`, port 8099): Act-2 save with Decker →
   cyber contract on board → non-Decker rows disabled → deploy Decker → jack
   in → cyber tileset + RAM HUD + probe attacks → slice node → jack out → meat
   renders → clean extract. Plus: Merc bump refusal copy, redundant jack-in
   message, mid-cyber reload resumes in the grid, avatar death → flatline
   screen, jack-out-early → abort-confirm extraction. Console clean on iOS
   Safari sim + Chrome.
4. Persistence adversarial: hand-mutate a save in devtools (delete
   `cyberspace.grid`, flip phase) → restore throws to the error boundary, not
   a silent fallback.

## Risks

- **S7 shell breadth** is the highest-risk surface (~2300-line index.ts reads
  `run.world`/`run.player` widely). Mitigation: accessors + exhaustive grep +
  the smoke script above.
- **`ApplyIntentContext.player` widening** may ripple into
  `doSpecial`/`doUseItem` narrowing; the avatar exposes no perk capabilities,
  and `collectTileLoot` guards on `player.inventory`.
- **Shared-rng turn order**: meat pass then ICE pass consumes `run.rng` in a
  fixed order; lock with the S7 dual-phase test.
- **Cyber alarm/rep**: Probe passes `repPenalty: false`; confirm no rep
  listeners attach to the cyber bus (S6 test).
