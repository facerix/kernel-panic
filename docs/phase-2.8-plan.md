# Phase 2.8 Plan — Principal theming & mixed hostile encounters

Living plan for the post–Phase 2.7 slice: turn the **role taxonomy** from Phase 2.7 into a **principal-facing theming layer** — diegetic enemy names, grid presentation, and (at higher tiers) **mixed allegiance encounters** where site-aligned security and rival operators share a fight. **Target release: `v0.2.8`.** See [phase-2.7-plan.md](phase-2.7-plan.md) for the role classes and tier doctrine this builds on (must land first), [phase-2.6-plan.md](phase-2.6-plan.md) for placement/persistence foundations, [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md) for naming inspiration, and [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision.

> **Do not start implementation until Phase 2.7 is complete.** Alias tables, glyph policy, and mixed-encounter composition all assume the full hostile roster (skirmisher, bruiser, medic, sniper, spotter, juggernaut, flanker) and the `EnemyTier` composition roll from 2.7 M1.3. Revisit this doc once those classes merge.

## Why this phase exists

Phase 2.7 fixes *how* enemies fight — roles, tiers, defensive identity. Phase 2.8 fixes *who they read as* on the job board, in combat log, and on the grid.

Today every hostile is `[Corp]Drone` / `[Corp]Guard` (from `kindFromId` on `drone-*` / `guard-*` entity ids), with glyphs hard-coded per class (`k` skirmisher, `g` guard, …). The Curator lexicon already tags every contract with a **principal** (`Matsuda`, `Kestrel Dynamics`, `Chrome Choir`, …) and a difficulty tier, but that identity stops at briefing text — it never reaches spawned entities. Three problems follow:

1. **Contracts feel interchangeable in combat.** A Matsuda finance gig and a Kestrel security gig both spawn identical `[Corp]Drone` / `[Corp]Guard` labels; the principal flavor is cosmetic-only.
2. **The grid under-communicates role.** Glyph encodes class today (good), but once multiple specialists land in 2.7, players need at-a-glance role reading *and* (when we mix allegiances) who belongs to whom.
3. **Higher tiers lack compositional surprise.** Tier doctrine in 2.7 adds role variety within one security force; 2.8 adds **cross-principal pressure** — site security plus a rival insert — without new AI classes.

**Direction chosen (brainstorm, May 2026):**

- **Behavior classes stay stable; principal names are a theming layer** — same `Skirmisher` / `Guard` AI, different display alias per principal (Phase 2.7 landed the role classes; 2.8 implements the alias layer).
- **Labels move from `[Corp]Kind` to `[PrincipalTag]Alias`** — e.g. `[Matsuda]Auditor`, `[Choir]Racketeer`. Retire the generic `[Corp]` prefix for aliased hostiles.
- **Glyphs encode role; color encodes allegiance** — keep one glyph per role class globally (`k` skirmisher, `g` guard, `e` bruiser, …); differentiate site security vs rivals via faction hue when both appear on-map. *Not* per-principal glyph chars (e.g. Auditor=`a`, Guard=`g`) — flavor belongs in the label, role belongs on the grid.
- **T2+ may spawn site-aligned hostiles plus a rival insert** — seed-driven, tier-gated; both act during the enemy turn bucket; medics heal same-faction allies only (cross-faction friction by default).

## Current status

> **Depends on [Phase 2.7](phase-2.7-plan.md):** full role roster, `EnemyTier` model, tier-driven composition in `Run` / placement, armor/knockback/support behaviors.

| Milestone | Status |
|---|---|
| M1 — Alias data model & spawn wiring | 🔲 Not started |
| M1.1 — `EnemyRole` + principal alias table | 🔲 Not started |
| M1.2 — `displayName` / `principalTag` on entities + persistence | 🔲 Not started |
| M1.3 — `entityLabel()` uses stored display metadata | 🔲 Not started |
| M2 — Grid presentation | 🔲 Not started |
| M2.1 — Role-keyed glyph constants (all 2.7 classes) | 🔲 Not started |
| M2.2 — Allegiance hue (site vs rival) in palette | 🔲 Not started |
| M3 — Mixed hostile encounters | 🔲 Not started |
| M3.1 — `FACTION.RIVAL` (or equivalent) + turn-system generalization | 🔲 Not started |
| M3.2 — Tier-gated rival insert in composition roll | 🔲 Not started |
| M3.3 — Cross-faction alarm/noise cooperation rules | 🔲 Not started |

**Phase 2.8** is complete when:

1. Every milestone above is ✅.
2. Hostiles spawned for a contract show principal-themed aliases in log, describe, and corp turn copy — not generic `[Corp]Drone` / `[Corp]Guard`.
3. Grid glyphs distinguish role at a glance; when rivals appear, allegiance is readable by color without extra chars.
4. T2+ contracts can deterministically roll a rival insert alongside site-aligned hostiles; saves round-trip alias + faction metadata.
5. Full campaign loop from Phase 2.7 remains playable offline on iOS Safari + Chrome desktop.
6. `v0.2.8` tagged in git.

---

## Design pillars

### Principal alias layer

Map each **behavior role** (from 2.7 taxonomy) to a **display alias** per Curator principal. Principals live in `CONTRACT_LEXICON.principals` (`Curator.ts`); rivals (`Chrome Choir`, `Redline Union`, `Null Saints`) use the same table — gang/street naming where appropriate.

| Role (2.7) | Example: Matsuda (finance) | Example: Kestrel (security) | Example: Chrome Choir (rival) |
|------------|---------------------------|------------------------------|--------------------------------|
| Skirmisher | Auditor, Compliance Drone | Sentry Bot, Patrol Unit | Racketeer, Thug |
| Guard | Floor Security, Process Server | Contract Guard, Enforcer | Thug, Bouncer |
| Bruiser | Collections Agent | Armored Enforcer | Bouncer, Toro |
| Medic | Forensic Tech | Trauma Tech | Street Doc |
| Sniper | Marksman | Sniper | Francotirador |
| Spotter | Compliance Officer | Tactician | Lookout |
| Juggernaut | Senior Auditor | Juggernaut | Heavyweight |
| Flanker | Process Server | Assassin | Blitzer, Sicario |

Kestrel Dynamics is the **baseline merc roster** — names can mirror C2077 corp security literally. Other principals diverge by domain (finance, data, logistics, medical, civic). Full alias brainstorming lives in the May 2026 design thread; **implementation owns a curated table**, not ad-hoc string assembly in spawn code.

**Lookup key:** `(principalId, enemyRole)` → `{ displayName, principalTag?, glyph? }`. `contract.context.principal.id` is available at spawn time and in save snapshots.

### Display labels

Replace `entityLabel()`'s `factionTag + kindFromId(id)` for aliased hostiles:

| Field | Purpose |
|-------|---------|
| `displayName` | `"Auditor"` — combat log, describe, status copy |
| `principalTag` | Short bracket prefix, e.g. `"Matsuda"` → `[Matsuda]Auditor` |

**Decided:** prefer `[PrincipalTag]Alias` over generic `[Corp]` for themed hostiles.

**Open:** exact short-tag curation (`[Vuong]` vs `[Vuong Holdings]`, `[DWB]` vs `[Water Board]`); whether prefix is omitted when the contract header already states the owner and no mixed allegiance is present.

### Grid glyphs & color

| Layer | Encodes | Mechanism |
|-------|---------|-----------|
| **Character** | Tactical **role** | One glyph per role class globally (extend 2.7 constants) |
| **Foreground color** | **Allegiance** | `FACTION.CORP` (site security) vs `FACTION.RIVAL` (insert) — or principal-scoped hue if two corp principals ever share a map |

The renderer already paints `entity.glyph` with `FACTION_FG[entity.faction]` (`palette.ts` → `glyphForEntity`). Alias landing is mostly **spawn-time metadata + palette extension**, not renderer logic.

**Decided:** role-readable glyphs; allegiance via color when mixing factions.

**Open:** final glyph alphabet (reserve collisions with `@`, `A`, `T`, `$`, `~`, `c`, `n`, …); whether T3 armored Enforcer shares bruiser glyph `e` or gets a distinct elite char.

### Mixed encounters (T2+)

At elevated tiers, composition roll may add:

```
sitePrincipal → corp/civic role bundle (from 2.7 tier doctrine)
+ rivalInsert   → 1 rival specialist or elite (seed-driven, tier-gated)
```

Example (T3): `[Matsuda]` Compliance drones + `[Matsuda]` Senior Auditor + `[Choir]` Lookout sharing alarm via the event bus. Matsuda medic patches Matsuda allies only; Choir Lookout is a separate priority target.

**Decided:** mixed fights are desirable at T2+; rival insert is composition, not a new AI class.

**Open:** tier thresholds (T2 only specialist rival? T3 elite rival?); which principals can appear as rivals vs site owners on the same map; whether rivals and site security **cooperate** (shared alarm, no friendly fire — current lean) or **compete** (separate objectives — probably out of scope).

---

## Where this lands in code (anticipated)

| Area | Change |
|------|--------|
| `src/game/hub/Curator.ts` or new `enemyAliases.ts` | Principal × role alias table + short `principalTag` map |
| `Entity` / spawn path (`Run`, placement) | Set `displayName`, `principalTag`, `glyph`, `faction` from contract context + composition slot |
| `Entity.entityLabel()` | Prefer stored display metadata; fall back to `kindFromId` for un-aliased entities |
| `Run.snapshotEntity` / `persistence` | Round-trip `displayName`, `principalTag` (glyph already persisted) |
| `palette.ts` | `FACTION.RIVAL` color; optional `glyphForEntity` extension if hue overrides needed |
| `TurnQueue` / `corpTurnDriver` | Enemy turn acts on **all hostile factions** (or renamed hostile bucket), AP refresh matches |
| `corpTurnStatusCopy` | Stop hardcoding `FACTION.CORP` filter; use hostile-faction set |
| `Hostile` subclasses | No new behavior required if reskin-only; medic already heals `this.faction` |

Class names (`Skirmisher`, `Guard`, `Sniper`, …) are stable implementation names; display layer decouples player-facing identity. **Save-compat note:** persistence archetype ids (`'drone'`, `'guard'`) and entity id prefixes (`drone-*`, `guard-*`) stay until a deliberate migration — Phase 2.8 theming rides on `displayName` / `principalTag`, not save-key churn.

---

## Milestones — detail

### M1 — Alias data model & spawn wiring

**Goal:** Principal-themed names flow from contract → spawned entity → log/describe, with save compatibility.

#### M1.1 — `EnemyRole` + principal alias table

- Introduce a stable `EnemyRole` enum/union aligned with 2.7 taxonomy (skirmisher, bruiser, medic, sniper, spotter, juggernaut, flanker; netrunner deferred to Phase 3).
- Curated alias table keyed by `(principalId, role)` — start with all principals in `CONTRACT_LEXICON.principals`; document Kestrel as baseline, others domain-flavored (see design pillars table).
- **TDD:** lookup is pure; unknown pair fails loud in dev (or falls back to role default with `console.warn` — pick one and record).

#### M1.2 — `displayName` / `principalTag` on entities + persistence

- Add optional fields on `Entity` (or a small `DisplayIdentity` struct): `displayName`, `principalTag`.
- Spawn path sets them from alias table + `contract.context.principal`.
- Snapshot + restore round-trip; missing fields on old saves fall back to current `kindFromId` behavior (backward compatible).
- **TDD:** spawn → snapshot → restore preserves labels; pre-2.8 saves still load.

#### M1.3 — `entityLabel()` uses stored display metadata

- Format: `` `[${principalTag}]${displayName}` `` when both present; else `displayName` alone if tag omitted by policy.
- Update `resolveEntityLabel`, `describe.ts` spacing, combat log paths that assume `[Corp]`.
- **TDD:** aliased entity labels match table; un-aliased entities unchanged.

### M2 — Grid presentation

**Goal:** Role-readable glyphs; allegiance-readable color when rivals present.

#### M2.1 — Role-keyed glyph constants (all 2.7 classes)

- Centralize glyph per `EnemyRole` (extend existing skirmisher `k`, guard `g`, plus sniper/spotter/medic/bruiser/juggernaut/flanker).
- Spawn sets `entity.glyph` from role, not from principal.
- **TDD:** each role class spawns with expected char; glyph persisted across save/load.

#### M2.2 — Allegiance hue (site vs rival) in palette

- Add `FACTION.RIVAL` (or equivalent) to `constants.ts` + `FACTION_FG` in `palette.ts`.
- Site-aligned hostiles remain `FACTION.CORP`; rival inserts use `FACTION.RIVAL`.
- **TDD:** two skirmishers different faction → same char, different `fg`; corpse dimming preserves faction hue.

### M3 — Mixed hostile encounters

**Goal:** Tier-gated rival inserts; both allegiances act on the enemy turn; cross-faction rules documented.

#### M3.1 — `FACTION.RIVAL` + turn-system generalization

- Generalize enemy turn beyond single `FACTION.CORP`: `corpTurnDriver` steps all hostile factions (parameter becomes hostile set or predicate); `TurnQueue.endTurn` refreshes AP for every faction in that set.
- Audit call sites that assume exactly `[player, corp]` (`persistence`, `index.ts` shell, tests).
- **TDD:** rival with `takeTurnSteps` acts on enemy turn; player/neutral entities skipped; AP refreshes for corp and rival.

#### M3.2 — Tier-gated rival insert in composition roll

- Extend 2.7 M1.3 composition roll: at T2+, optionally add one rival-role entity from a principal tagged `rival` in the lexicon (deterministic from contract seed).
- Rival principal pick may be independent of contract principal (e.g. Matsuda job + Chrome Choir insert) — rules TBD in open questions.
- **TDD:** seed determinism; T1 never spawns rival; T2+ may; rival never spawns without at least one site-aligned hostile.

#### M3.3 — Cross-faction alarm/noise cooperation rules

- Document and test: alarm/noise bus behavior when source and listener differ in faction but both are hostile to player.
- **Default (lean):** rivals and site security share alarm targeting (spotter buffs everyone hostile to player); medics heal same faction only; no friendly fire between hostile factions unless explicitly added later.
- **TDD:** spotter alarm causes patrol hostiles (skirmishers, guards) to engage; corp medic does not heal rival; rival medic does not heal corp.

---

## Out of scope

- New enemy **behavior** classes or AI (Phase 2.7 + Phase 3 netrunner).
- Cyberspace-side enemies and the Decker (Phase 3).
- Boss/named-encounter scripting with bespoke dialogue.
- Full principal-specific **composition bias** (e.g. Orchid Vector always rolls medic) — alias table only unless open questions resolve toward bias.
- Telemetry / analytics for which aliases players see.
- ~~Renaming implementation classes (`CorpDrone` → `Skirmisher`, `CorpGuard` → `Guard`)~~ — **done in Phase 2.7 closeout**; persistence keys intentionally unchanged.

## Open questions / kaizen notes

Revisit after 2.7 hostile entities land and we have playtest surface for all roles.

### Labels & aliases

- **Principal short tags:** curated map vs derived from `principal.label` (truncation rules for tablet log width).
- **No-prefix mode:** drop `[Tag]` when contract header is sufficient and encounter is single-allegiance?
- **Fallback policy:** unknown `(principalId, role)` → role generic name (`Skirmisher`, `Guard`, …) vs dev throw vs `[Corp]` legacy tag.
- **Alias table ownership:** live in `Curator.ts` next to lexicon vs dedicated module imported by spawn code.

### Glyphs & palette

- **Final role alphabet:** assign chars for sniper, spotter, juggernaut, flanker without colliding with map/objective glyphs.
- **Elite bruiser vs bruiser:** same `e` or distinct glyph for T3 armored Enforcer?
- **Two corp principals on one map:** ever needed? If yes, hue-by-principal vs shared corp pink.

### Mixed encounters

- **Tier gates:** rival insert at T2 only, T3 only, or both with different role weights?
- **Rival principal selection:** fixed pool vs seed-picked from `rival`-group lexicon entries vs story-weighted (Clock / rep — Phase 3 adjacency).
- **Cooperation model:** confirm shared alarm + no cross-heal (current lean) vs rivals as chaotic third party.
- **Contract principal as rival:** can the job poster's rivals show up defending a *different* principal's site, or only "intruder" inserts?
- **Turn queue naming:** rename corp slot to `hostile` in UI/docs while keeping save compat?

### Sequencing & vertical slice

- **Suggested first slice after 2.7:** M1 for one principal (e.g. Matsuda) on the three original prototypes only — proves label + persistence path before M2/M3.
- **Netrunner aliases:** table slot reserved; implementation stays Phase 3 with status-effect system.

---

## References

- Principal list: `CONTRACT_LEXICON.principals` in `src/game/hub/Curator.ts`
- Current label path: `entityLabel()` / `kindFromId()` in `src/game/Entity.ts`
- Current glyph path: `entity.glyph` → `glyphForEntity()` in `src/render/palette.ts`
- Enemy turn driver: `src/game/corpTurnDriver.ts` (`corpFaction` parameter is the extension seam)
- Naming inspiration: [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md)
