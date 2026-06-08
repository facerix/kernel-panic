# Phase 2.9 Plan — Principal theming & allegiance plumbing

Living plan for the post–Phase 2.8 slice: turn the **archetype taxonomy** from Phase 2.7 into a **principal-facing theming layer** — diegetic enemy names per principal, and an **allegiance-aware faction model** so that hitting a gang reads as hitting a gang (rival hue + street labels) instead of a street crew wearing a `[Corp]` tag. **Target release: `v0.2.9`.** See [phase-2.7-plan.md](phase-2.7-plan.md) for the archetype classes and tier doctrine this builds on, [phase-2.8-plan.md](phase-2.8-plan.md) for the combat HUD polish that landed first, [phase-2.6-plan.md](phase-2.6-plan.md) for placement/persistence foundations, [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md) for naming inspiration, and [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall vision.

**Phase prefix:** `P2.9` — use `P2.9.MN` when referencing milestones from this phase in other documents.

> **Scope decision (June 2026):** **Mixed-allegiance encounters** (site security + a rival insert on the *same* map, with friction/cooperation rules) are **deferred** — see [kaizen.md](kaizen.md) "Inter-hostile friction". Phase 2.9 ships `RIVAL` as a faction *value* but keeps **exactly one hostile faction per run** (derived from the contract's own principal). The play value this phase delivers is *identity*, not three-body tactics. Revisit mixed encounters after Cyberspace (Phase 3), which is the higher-impact direction.

> **Dependencies met.** 2.7 (full archetype roster + `EnemyTier` composition roll) and 2.8 (combat HUD) are merged. **Terminology note:** the behavior taxonomy already ships as **`ENEMY_ARCHETYPE`** (`skirmisher`, `guard`, `sniper`, `lookout`, `medic`, `bruiser`, `juggernaut`, `flanker`) in `encounters.ts` — the alias table keys on *that*, **not** a new `EnemyRole` enum (the name `EnemyRole` is already taken in 2.7 code, meaning the composition slot `FODDER`/`SPECIALIST`/`ELITE`).

## Why this phase exists

Phase 2.7 fixes *how* enemies fight — roles, tiers, defensive identity. Phase 2.9 fixes *who they read as* on the job board, in combat log, and on the grid.

Today every hostile is `[Corp]Drone` / `[Corp]Guard` (from `kindFromId` on `drone-*` / `guard-*` entity ids), with glyphs hard-coded per class (`k` skirmisher, `g` guard, …). The Curator lexicon already tags every contract with a **principal** (`Matsuda`, `Kestrel Dynamics`, `Chrome Choir`, …) and a difficulty tier, but that identity stops at briefing text — it never reaches spawned entities. Three problems follow:

1. **Contracts feel interchangeable in combat.** A Matsuda finance gig and a Kestrel security gig both spawn identical `[Corp]Drone` / `[Corp]Guard` labels; the principal flavor is cosmetic-only.
2. **Non-corp principals are mislabeled.** A Chrome Choir / Redline / Null Saints contract spawns the *same* `[Corp]`-tagged, corp-hued hostiles as a megacorp job — a street gang reads as the establishment. Faction is doing identity duty it was never modeled for.

**Direction chosen (brainstorm May 2026, refined June 2026):**

- **Behavior classes stay stable; principal names are a theming layer** — same `Skirmisher` / `Guard` AI, different display alias per principal. The alias table keys on `(principalId, ENEMY_ARCHETYPE)`.
- **Labels move from `[Corp]Kind` to `[PrincipalTag]Alias`** — e.g. `[Matsuda]Auditor`, `[Choir]Racketeer`. Retire the generic `[Corp]` prefix for aliased hostiles.
- **Glyph encodes archetype (already done in 2.7); color encodes allegiance.** Each AI class already hard-codes a unique glyph (`k` skirmisher, `g` guard, `b` bruiser, `m` medic, `s` sniper, `l` lookout, `f` flanker, `j` juggernaut) — so the "role-keyed glyph" milestone is **already satisfied**. 2.9 only adds the **allegiance hue**.
- **Faction means *allegiance*, not employer.** `faction` is "whose side are you on in this fight" (player / site-establishment / rival / bystander), decoupled from *identity* (which principal employs you — that lives entirely in the display layer). One run = one hostile faction in 2.9.
- **Faction is derived from the contract's principal group:** group includes `rival` → `FACTION.RIVAL`; else (`corp` / `civic`) → `FACTION.CORP`. **Civic folds into `CORP`** — institutional security *is* the establishment, same hue (very cyberpunk).

## Current status

> **Depends on [Phase 2.7](phase-2.7-plan.md) (merged):** full archetype roster, `EnemyTier` model, tier-driven composition in `Run` / placement, armor/knockback/support behaviors. **[Phase 2.8](phase-2.8-plan.md) (merged):** combat HUD.

| Milestone | Status |
|---|---|
| M1 — Alias data model & spawn wiring | ✅ Done |
| M1.1 — `enemyAliases.ts`: `(principalId, archetype)` alias table + curated short tags | ✅ Done |
| M1.2 — `displayName` / `principalTag` on entities + persistence | ✅ Done |
| M1.3 — `entityLabel()` uses stored display metadata | ✅ Done |
| M2 — Faction / allegiance plumbing (slim) | ✅ Done |
| M2.1 — Remove `FACTION.CORP` hard-coding from AI classes | ✅ Done |
| M2.2 — `FACTION.RIVAL` + principal-group→faction mapping; `Run` sets hostile faction | ✅ Done |
| M2.3 — Allegiance hue (`FACTION_FG[RIVAL]`) in palette | ✅ Done |
| M2.4 — RIVAL hostile-turn shell integration (HUD, resume, status copy, restore) | ✅ Done (June 2026) |
| ~~M3 — Mixed hostile encounters~~ | ⏭️ **Deferred → [kaizen.md](kaizen.md)** (post–Phase 3) |
| ~~Per-principal glyph hue~~ | ⏭️ **Deferred** — see [Out of scope](#out-of-scope) |

Role-keyed glyph constants (an earlier draft's M2.1) are **already satisfied** — each AI class hard-codes a unique glyph since 2.7.

### Session log — June 2026 (M2.4)

M2 core plumbing landed (`FACTION.RIVAL`, `factionForPrincipalGroups`, `Run.hostileFaction`, AI constructor `faction` param, palette hue, `runFaction` / `hostileFaction` tests). First rival-contract playtest hit a **tier-1 fault** when the player exhausted AP and the queue advanced to the `RIVAL` slot:

- **Symptom:** `formatTurnLabel: unsupported faction "rival"` in `combatHud.ts` → error boundary degraded to Hub.
- **Root cause:** Renderer and shell paths still assumed the hostile turn was always `FACTION.CORP`; `RIVAL` was in the turn queue but not in HUD / status / restore paths.

**Fixes shipped this session:**

| Area | Change |
|------|--------|
| `combatHud.ts` | `formatTurnLabel` / `turnA11yText` treat `RIVAL` like `CORP` (`HOSTILES ACTIVE`) |
| `AsciiRenderer.ts` | Hostile-turn HUD color keys off `currentFaction !== PLAYER`, not `=== CORP` |
| `index.ts` | `resumePendingCombatSliceIfNeeded` resumes any non-player slice; status ephemeral keys off `run.hostileFaction` with dynamic faction tag |
| `corpTurnStatusCopy.ts` | `countVisibleCorpEntities` accepts optional `hostileFaction` (defaults `CORP`) |
| `persistence.ts` | `restoreEntity` reapplies `rec.faction` (rival hostiles were reverting to `CORP` on load) |

**Enemy-turn bucket (M2.2 open detail — resolved):** `corpTurnDriver` already filters by the `corpFaction` argument; the shell passes `run.hostileFaction`. No `TurnQueue` rename needed — one hostile slot per run, value is `CORP` or `RIVAL`.

**Remaining before `v0.2.9` tag:** offline playtest on iOS Safari + Chrome desktop (rival contract end-to-end); opportunistic copy pass (`CORP TURN — controls locked` flash still says "CORP" during rival turns — cosmetic).

**Phase 2.9** is complete when:

1. Every milestone above is ✅.
2. Hostiles spawned for a contract show principal-themed aliases in log, describe, and corp-turn copy — not generic `[Corp]Drone` / `[Corp]Guard`.
3. A rival-group contract (Chrome Choir / Redline / Null Saints) spawns `FACTION.RIVAL` hostiles with a distinct hue and street-flavored labels; corp/civic contracts spawn `FACTION.CORP` as today. One hostile faction per run.
4. Saves round-trip `displayName` / `principalTag`; pre-2.9 saves still load (fall back to `kindFromId`).
5. Full campaign loop remains playable offline on iOS Safari + Chrome desktop.
6. `v0.2.9` tagged in git.

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
| Lookout | Compliance Officer | Tactician | Lookout |
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

**Decided:** prefer `[PrincipalTag]Alias` over generic `[Corp]` for themed hostiles. Curated final short-tag list; prefer this over omitted even with pricipal in location banner.

### Grid glyphs & color

| Layer | Encodes | Mechanism |
|-------|---------|-----------|
| **Character** | Tactical **archetype** | One glyph per AI class — **already shipped in 2.7** (`k`/`g`/`b`/`m`/`s`/`l`/`f`/`j`), hard-coded in each class's `super()` call |
| **Foreground color** | **Allegiance** | `FACTION.CORP` (establishment: corp + civic) vs `FACTION.RIVAL` (gang/street) |

The renderer already paints `entity.glyph` with `FACTION_FG[entity.faction]` (`palette.ts` → `glyphForEntity`). So the only renderer-adjacent work is **one palette entry** for `FACTION.RIVAL`. The harder part is **un-hardcoding faction** — every AI class currently passes `faction: FACTION.CORP` in `super()` and `Omit`s `faction` from its props interface, so the constructor can't yet accept a rival.

**Decided:** archetype-readable glyphs (done); allegiance via color; civic shares the corp hue.

**Deferred — per-principal glyph hue:** A unique foreground colour per Curator principal (17 entries) was considered during M2 playtest. Technically small (~`principalHueFor(id)` in `enemyAliases.ts` + thread through `glyphForEntity`), but **out of scope for 2.9**:

- **Design:** Colour encodes *allegiance* (establishment vs gang), not employer — see locked decision below. Per-principal hues would muddy the corp/rival at-a-glance read unless constrained to hue *families* (rose band for corp, amber for rival, etc.).
- **Payoff:** One run = one principal today, so per-principal hue is indistinguishable from per-run tint until mixed encounters (M3 / [kaizen.md](kaizen.md)). Low ROI before contested-site maps.
- **Curation cost:** 17 perceptually distinct hues on a dark CRT palette is an art-direction problem, not a code problem.
- **Revisit trigger:** M3 mixed encounters, or a deliberate "contested site" contract that puts two principals' crews on one map. Smallest useful intermediate: **per-run principal tint** (one hue per contract) if we want more identity before M3.

### Mixed encounters — DEFERRED

> Mixed-allegiance maps (site security **and** a rival insert sharing a fight, with friction/cooperation rules) are **out of scope for 2.9** — see [kaizen.md](kaizen.md) "Inter-hostile friction". The slim faction work below is the foundation a future phase would build on, but 2.9 keeps **one hostile faction per run**: `RIVAL` appears only on rival-group contracts, never alongside `CORP`. This sidesteps the `isHostileTo` (`faction !== this.faction`) friction question entirely — there's no second hostile faction on the map to fight.

---

## Where this lands in code (anticipated)

| Area | Change | Milestone |
|------|--------|-----------|
| New `src/game/enemyAliases.ts` | `(principalId, archetype)` → `{ displayName, principalTag }` table + pure `aliasFor()` lookup + curated short-tag map. Imports principal ids from `CONTRACT_LEXICON`. | M1.1 |
| `Entity` + spawn path (`Run.enterCombat`) | Optional `displayName` / `principalTag` fields; spawn sets them from `aliasFor(contract.context.principal.id, entry.archetype)` | M1.2 |
| `Entity.entityLabel()` | Prefer stored display metadata (`[principalTag]displayName`); fall back to `factionTag + kindFromId` for un-aliased entities (old saves) | M1.3 |
| `Run.snapshotEntity` / `persistence` | Round-trip `displayName`, `principalTag`; missing on old saves → fallback path | M1.2 |
| AI classes (`src/game/ai/*.ts`) | Stop hard-coding `faction: FACTION.CORP`; un-`Omit` `faction` from props, accept via constructor (default may stay `CORP`) | M2.1 |
| `constants.ts` | Add `FACTION.RIVAL`; `factionForPrincipalGroup()` helper (group has `rival` → RIVAL, else CORP) | M2.2 |
| `Run.enterCombat` | Resolve run-wide hostile faction once from `contract.context.principal.groups`; pass to every hostile constructor | M2.2 |
| `palette.ts` | `FACTION_FG[FACTION.RIVAL]` hue (distinct from corp `#ff4d6d`); corpse-dim path preserves it | M2.3 |
| `combatHud.ts` / `AsciiRenderer.ts` | Hostile-turn label + styling for `RIVAL` (not only `CORP`) | M2.4 |
| `index.ts` | `resumePendingCombatSliceIfNeeded`, status ephemeral, faction tag via `run.hostileFaction` | M2.4 |
| `persistence.ts` | Restore `rec.faction` on entities; queue order from `run.hostileFaction` | M2.2 / M2.4 |

**No turn-system rename.** Because one run has a single hostile faction, `corpTurnDriver` / `TurnQueue` / `corpTurnStatusCopy` keep their names and reuse the existing enemy-turn bucket. The shell passes `run.hostileFaction` into `corpTurnDriver` (`corpFaction` param); filter is `e.faction === corpFaction`, not literal `=== FACTION.CORP`. (Generalizing the bucket to a hostile-faction *set* is the M3-deferred work.)

Class names (`Skirmisher`, `Guard`, `Sniper`, …) are stable implementation names; the display layer decouples player-facing identity. **Save-compat note:** persistence archetype ids (`'drone'`, `'guard'`) and entity id prefixes (`drone-*`, `guard-*`) stay until a deliberate migration — Phase 2.9 theming rides on `displayName` / `principalTag`, not save-key churn.

---

## Milestones — detail

### M1 — Alias data model & spawn wiring

**Goal:** Principal-themed names flow from contract → spawned entity → log/describe, with save compatibility.

#### M1.1 — `enemyAliases.ts`: `(principalId, archetype)` alias table

- **Reuse the existing `ENEMY_ARCHETYPE`** union (`encounters.ts`) as the role key — do **not** introduce a new `EnemyRole` (that name already means the composition slot in 2.7 code).
- New module `src/game/enemyAliases.ts`: curated table keyed by `(principalId, ENEMY_ARCHETYPE)` → `{ displayName, principalTag }`, plus a curated short-tag map (`sable-kline` → `Sable`, `district-water-board` → `DWB`, `matsuda` → `Matsuda`, …). Cover all principals in `CONTRACT_LEXICON.principals`; Kestrel is the baseline (C2077-literal), others domain-flavored (see design pillars table).
- Pure `aliasFor(principalId, archetype)` lookup.
- **Fallback policy (decided):** unknown pair → `console.warn` in dev, fall back to the generic archetype name (e.g. `"Skirmisher"`) at runtime so a save never breaks. *Loud in dev, graceful in prod.*
- **TDD:** lookup is pure and table-driven; a known pair returns its alias; an unknown pair returns the generic name **and** warns (assert the warn fires in dev).

#### M1.2 — `displayName` / `principalTag` on entities + persistence

- Add optional fields on `Entity` (or a small `DisplayIdentity` struct): `displayName`, `principalTag`.
- Spawn path sets them from alias table + `contract.context.principal`.
- Snapshot + restore round-trip; missing fields on old saves fall back to current `kindFromId` behavior (backward compatible).
- **TDD:** spawn → snapshot → restore preserves labels; pre-2.9 saves still load.

#### M1.3 — `entityLabel()` uses stored display metadata

- Format: `` `[${principalTag}]${displayName}` `` when both present; else `displayName` alone if tag omitted by policy.
- Update `resolveEntityLabel`, `describe.ts` spacing, combat log paths that assume `[Corp]`.
- **TDD:** aliased entity labels match table; un-aliased entities unchanged.

### M2 — Faction / allegiance plumbing (slim)

**Goal:** A hostile can carry a faction other than `CORP`; a run's hostile faction is derived from its principal; rivals read by hue. **No mixed maps — one hostile faction per run.**

#### M2.1 — Remove `FACTION.CORP` hard-coding from AI classes

- Each AI class (`src/game/ai/*.ts`) currently does `super({ ..., faction: FACTION.CORP, glyph: '…' })` and `Omit`s `faction` from its props interface. Un-`Omit` `faction` and accept it via the constructor (default may remain `CORP` to keep call sites green until M2.2 wires the real value).
- Glyph stays hard-coded per class (already correct — not principal-derived).
- **TDD:** a hostile constructed with an explicit `faction: FACTION.RIVAL` reports that faction (and survives snapshot/restore); default-constructed hostile is still `CORP`.

#### M2.2 — `FACTION.RIVAL` + principal-group → faction mapping

- Add `FACTION.RIVAL` to `constants.ts`. Add `factionForPrincipalGroup(groups)` (or `factionForPrincipal`): groups include `rival` → `RIVAL`; else (`corp` / `civic`) → `CORP`.
- `Run.enterCombat` resolves the run's hostile faction once from `contract.context.principal.groups` and passes it to every hostile constructor (fodder, specialists, elites).
- Confirm the enemy-turn filter (`corpTurnDriver` / `corpTurnStatusCopy`) treats `RIVAL` as an acting hostile — prefer keying on a hostile predicate over literal `=== FACTION.CORP` if that's the smaller change; otherwise reuse the corp bucket. (Full multi-faction bucket = deferred M3.)
- **TDD:** a Chrome Choir contract spawns `RIVAL` hostiles; a Matsuda *and* a District Water Board (civic) contract both spawn `CORP`; rival hostiles act on the enemy turn and refresh AP; faction round-trips through save/load.

#### M2.3 — Allegiance hue in palette

- Add `FACTION_FG[FACTION.RIVAL]` (distinct from corp `#ff4d6d`) in `palette.ts`.
- **TDD:** two skirmishers of different faction → same glyph, different `fg`; corpse-dim path preserves the rival hue.

#### M2.4 — RIVAL hostile-turn shell integration

Surfaced by playtest after M2.2 landed: the turn queue advanced to `RIVAL` but HUD / shell / restore paths still assumed `CORP` only.

- `formatTurnLabel` / `turnA11yText`: `RIVAL` → `HOSTILES ACTIVE` (same lockout copy as corp hostile phase).
- `AsciiRenderer`: hostile-turn HUD color when `currentFaction !== PLAYER`.
- `index.ts`: cold-resume corp slice when `currentFaction !== PLAYER`; status ephemeral uses `run.hostileFaction` + `countVisibleCorpEntities(..., hostileFaction)`.
- `persistence.restoreEntity`: reapply `rec.faction` (was validated but not assigned — rival hostiles loaded as `CORP`).
- **TDD:** `combatHud.test.ts`, `corpTurnStatusCopy.test.ts`, `runFaction.test.ts` (snapshot round-trip).

### M3 — Mixed hostile encounters — ⏭️ DEFERRED

> Out of scope for 2.9. Tracked in [kaizen.md](kaizen.md) "Inter-hostile friction" with the full design spectrum (cooperate / asymmetric-goals / three-way), the cost insight (target acquisition is already faction-general), and the tuning risk. Revisit after Cyberspace (Phase 3). The M2 faction work above is the foundation it would build on.

---

## Out of scope

- **Mixed-allegiance encounters / inter-hostile friction** — deferred to [kaizen.md](kaizen.md), post–Phase 3. One hostile faction per run in 2.9.
- **Per-principal glyph hue** — unique foreground colour per Curator principal (~17 curated hues, or hash-derived). Colour stays allegiance-encoded for 2.9 (`CORP` / `RIVAL` families). Per-principal tint has low payoff while one principal owns each run; revisit with M3 mixed maps or a per-run tint spike if playtest asks for more grid identity. See [Grid glyphs & color](#grid-glyphs--color) deferred note.
- New enemy **behavior** classes or AI (Phase 2.7 + Phase 3 netrunner).
- Cyberspace-side enemies and the Decker (Phase 3).
- Boss/named-encounter scripting with bespoke dialogue.
- Full principal-specific **composition bias** (e.g. Orchid Vector always rolls medic) — alias table only.
- A distinct **civic** hue — civic folds into `FACTION.CORP` for 2.9.
- Telemetry / analytics for which aliases players see.
- ~~Renaming implementation classes (`CorpDrone` → `Skirmisher`, `CorpGuard` → `Guard`)~~ — **done in Phase 2.7 closeout**; persistence keys intentionally unchanged.

## Decisions locked (June 2026)

- **Role key:** reuse `ENEMY_ARCHETYPE`; no new `EnemyRole`.
- **Alias table home:** dedicated `src/game/enemyAliases.ts` (not `Curator.ts`).
- **Short tags:** curated per-principal map (not derived from `principal.label`).
- **Fallback:** unknown `(principalId, archetype)` → generic archetype name; `console.warn` in dev, graceful in prod.
- **Faction = allegiance, not employer;** derived from principal group; civic → `CORP`; rival groups → `RIVAL`; one hostile faction per run.
- **Glyphs:** already role-keyed since 2.7 — no work.
- **Colour:** allegiance and per-principal terrain in 2.9; per-principal glyphs deferred (see Out of scope).

## Open questions / kaizen notes

### Sequencing

- ~~**Suggested first slice:** land **M1** (aliases + persistence, all principals) as its own reviewable merge and playtest before M2 faction plumbing.~~ ✅ Done.
- ~~**M2.4 lesson:** faction in the queue is not enough — grep shell/renderer for literal `FACTION.CORP` on `currentFaction` whenever a new hostile faction value lands.~~
- ~~**Netrunner aliases:** table slot reserved; implementation stays Phase 3 with the status-effect system.~~

---

## References

- Principal list: `CONTRACT_LEXICON.principals` in `src/game/hub/Curator.ts`
- Current label path: `entityLabel()` / `kindFromId()` in `src/game/Entity.ts`
- Current glyph path: `entity.glyph` → `glyphForEntity()` in `src/render/palette.ts`
- Enemy turn driver: `src/game/corpTurnDriver.ts` (`corpFaction` parameter is the extension seam)
- Naming inspiration: [cyberpunk-2077-enemy-list.md](cyberpunk-2077-enemy-list.md)
