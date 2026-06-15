# Phase 3 Plan — Ghost in the Machine

Living plan for the Phase 3 slice of Kernel Panic: **campaign arc**, **Cyberspace**, **the Decker**, and **the Score** — the narrative and mechanical layer that gives the Meatspace foundations (Phase 2 / 2.5) a purpose. **Target release: `v0.3.0`.** See [phase-2.5-plan.md](phase-2.5-plan.md) for the Meatspace depth milestones that Phase 3 builds on, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall design vision, and [game-overview.md](game-overview.md) for the elevator pitch.

**Phase prefix:** `P3` — use `P3.MN` (e.g. `P3.M1.2`) when referencing milestones from this phase in other documents.

## Design vision

The campaign is a **Neuromancer-shaped arc**: a crew of operators assembles over a series of street-level gigs, recruits a specialist who can open the digital layer, and builds toward a climactic multi-layer infiltration — **the Score**. Two interlocking pressures drive the player forward:

- **The Score** (the big job) — a multi-phase target that requires physical site knowledge, crew capability, and digital penetration. The player can't attempt it until they've built enough rep, gear, and intel. Every contract run is preparation.
- **The Clock** (mounting pressure) — something that makes delay costly. Each run the player takes, the world gets harder: corp security tightens, a rival crew closes in, or the operational window narrows. There's a soft optimum: prep enough to survive the Score, but don't over-prep or the world outpaces you.

### Campaign shape

| Stage | Runs | What happens | Systems |
|-------|------|-------------|---------|
| **Stage 1: Street level** | 1–5 | Build rep, learn combat, recruit crew. Pure Meatspace gigs. Unconnected contracts from P2.5.M2.10 recipes. | P2.5.M2 objectives, P2.5.M5 economy, P2.5.M7 site roster begins |
| **Turning point** | ~5 | Reach KNOWN rep tier. Curator reveals the Score and assigns the Decker in one beat. | Decker joins crew; Score target synthesized (always new, CRITICAL-tier) |
| **Stage 2: Casing** | 6–10 | Prep runs targeting the Score principal's org + resource building. Cyberspace available on some contracts. Learning the flip. Curator biases toward same-principal contracts. | P2.5.M7 persistence (casing), Cyberspace, simstim flip |
| **The Clock starts** | Act 2+ | After a grace period of Act 2/3 **deploys** (not completed jobs), corp heat mounts — more hostiles, tighter alarms, visible deadline pressure. | Clock mechanic + `clock-reveal` Hub beat |
| **Stage 3: Final prep** | ~9+ jobs | Casing gates satisfied; Curator `act-3-reveal` beat; prep board + player-initiated **THE SCORE**. | Everything converges toward the climax |

### The simstim flip

On contracts with a Cyberspace component, the player **dual-deploys**: a Meatspace operator and the Decker. Each has their own grid. The **flip** switches which operator the player actively controls — both are player-controlled, no AI autopilot. The inactive operator waits while hostiles in *both* layers advance every turn end.

- Reuses the existing single-operator control model twice (no squad tactics required).
- Tension is purely **attention allocation**: every turn spent in Cyberspace is a turn the Meatspace operator isn't moving, while corp drones keep closing in — and vice versa.
- The flip is a **free action** (resolved 2026-06-15; AP cost may be revisited after playtest). The PIP / CCTV window from the blueprint shows the inactive layer in miniature.

### The Decker

A new **player archetype** recruited mid-campaign (late Act 1 / start of Act 2), not available at campaign start.

- **Cyberspace specialist:** Primary value is digital — jacking in at terminals, fighting ICE, opening digital locks, slicing data.
- **Meatspace capable:** Viable as a solo deploy on non-Cyberspace contracts, but not their strength. Signature ability: **drone override hack** (turn a corp drone to your side temporarily — thematically perfect, reuses existing drone AI with faction flip).
- **Recruitment:** Gated by rep tier (top tier from P2.5.M5). Narrative beat — the Decker seeks you out, or a fixer introduces them. Not a menu selection.

## Current status

| Milestone | Status |
|---|---|
| P3.M1 — Campaign arc structure | ✅ Done |
| P3.M2 — The Decker archetype | ✅ Done |
| P3.M3 — Cyberspace grid + ICE | ✅ Done (full ICE roster: Probe, Spark, Guardian) |
| P3.M4 — Simstim flip (dual-deploy) | 🟡 In progress (M4.1 dual-deploy reservation done) |
| P3.M5 — The Score (climactic mission) | 🔲 Planned |
| P3.M6 — Chronicle (campaign narrative memory) | 🟡 End-summary foundation shipped |

**Phase 3** is complete when:

1. Every milestone in the table above is ✅.
2. Full campaign arc playable from Act 1 through the Score: Meatspace-only early game → Decker recruitment → Cyberspace contracts → dual-layer Score → win or flatline → chronicle summary.
3. Offline on iOS Safari + Chrome desktop throughout.
4. `v0.3.0` tagged in git.

### Implemented hooks already in the tree

Phase 3 should start from the shipped Phase 2.5 surface, not rebuild it:

- `Campaign` already persists `completedJobs`, `rep`, `hubReveals`, `keyItems`, and the P2.5.M7 `siteRoster`.
- `LocationSite` already reserves `tier: 'score'` and `scoreTarget`; P2.5.M7 never sets them, so P3.M1 owns designation.
- `Curator.generateContracts(rng, campaign)` already accepts `arcStage` and stores it into `contract.context.arcStage`; P3.M1 owns deriving the stage from campaign state and using it for real recipe weighting / Score targeting.
- P2.7.M6.2 landed: entity snapshot `extra` property bags and campaign-scoped key items are available for Decker / Cyberspace state instead of expanding the old top-level snapshot union.
- Hub reveal plumbing already exists (`applyFirstHubReveal`, Finn, Clinic, Terminal). Phase 3 arc beats use deferred Curator briefings: `score-reveal` (Score + Decker), `clock-reveal` (heat + deadline), and `act-3-reveal` (THE SCORE available). Flags commit on briefing dismiss, not on queue.

## Phase 2.5 foundations (prerequisites)

Phase 3 depends on specific hooks built into Phase 2.5 milestones:

| 2.5 Milestone | Phase 3 hook | Notes |
|---|---|---|
| **P2.5.M2.10** (recipes) | Recipe context accepts **arc stage** input | Phase 3 uses this to bias contract generation toward Score-adjacent objectives in Acts 2–3 |
| **P2.5.M5** (economy/rep) | KNOWN rep tier defined and reachable | Terminal recruitment opens at `rep >= 50` (KNOWN floor). Act 2 (Score reveal + Decker) gates at `rep >= 65` plus job count |
| **P2.5.M7** (persistence) | Location schema includes `scoreTarget` flag; site roster + mutation deltas | Phase 3 synthesizes a new CRITICAL-tier Score target; player "cases" it across visits. Roster sites for the same principal provide recon value |

### Score target identification

The Score target is always a newly synthesized CRITICAL-tier site, never promoted from the roster. This ensures the map is large enough to support escalated hostile placement as heat grows. Act 2 Curator bias weights toward the same principal (same corp, different sites) so the player learns the organization before the climax. The synthesized site uses roster-stored dimensions (P2.7.M1.5: `mapWidth`, `mapHeight`, `seed`, mutation deltas from visits); contract `difficulty` scales encounter composition only, not footprint.

## Milestones — detail

### P3.M1 — Campaign arc structure ✅

**Depends on:** Phase 2.5 complete (P2.5.M2.10 recipe hooks, P2.5.M5 rep tiers, P2.5.M7 site roster).

**Goal:** The campaign has a **three-act structure** with a defined beginning, middle, and end. The player progresses through acts based on rep, run count, and narrative triggers. The Curator is arc-aware — it generates contracts appropriate to the current act.

**Scope:**

- **Arc state:** Campaign save tracks `arcStage` (`act-1` / `act-2` / `act-3` / `score`), `completedJobs`, `clockJobsTaken` (Act 2/3 deploys that drive the Clock — incremented on deploy, not on extract), and arc-specific flags (`deckerRecruited`, `scoreRevealed`, `clockStarted`, `scoreAttempted`, `scoreCompleted`). Hub reveal flags (`scoreBriefingPresented`, `clockBriefingPresented`, `act3BriefingPresented`) persist separately. Prefer a typed `Campaign.arc` record over stuffing more opaque keys into `Campaign.meta`; legacy saves can normalize from absent `arc` into Act 1.
- **Act transitions:** Define triggers for act boundaries:
  - Act 1 → Act 2: `rep >= 65` (proven-operator bar) + minimum successful job count (recommended: `completedJobs >= 4`). Triggers Score reveal and Decker recruitment (same beat). Terminal recruitment for Merc/Razor/Tech opens earlier at KNOWN (`rep >= 50`).
  - Act 2 → Act 3: `completedJobs >= 9` + at least 4 **living** (non-flatlined) crew + at least 3 visited sites sharing the Score target's principal (including the Score target itself). The Decker gate is gone — the Decker is always assigned at Act 2 entry. The crew gate rewards keeping people alive; the principal-sites gate is the "casing" payoff — you've hit enough of the org's facilities to know how they operate. Triggers "final prep" phase and the `act-3-reveal` Hub beat on first qualifying Hub entry.
  - Score available: Act 3 + player-initiated (choose **THE SCORE** from the Hub job board after the Act 3 briefing).
- **Score target designation:** At Act 2 entry, always synthesize a new CRITICAL-tier `LocationSite` from Curator lexicon as the Score target. The Score is a location the player hasn't seen — Act 2 contracts bias toward the same principal so the player learns about the organization before hitting the crown jewel. Existing roster sites are never promoted; they serve as intel and casing prep. Multiple persisted score targets, or score-tier sites missing `scoreTarget`, throw during Hub-entry arc evaluation.
- **Decker recruitment:** Same narrative beat as the Score reveal. The Curator assigns a named Decker — no player choice modal. The crew gains a specialist as part of the Score pitch ("here's the job, and here's the person who can open it"). Future phases may differentiate Decker stats and offer a choice; for now the assignment is the narrative.
- **Arc-aware Curator:** Current code already passes through `arcStage`; P3.M1 must make it behaviorally meaningful:
  - Act 1 = broad pool, unconnected gigs, no Score-target pinning.
  - Act 2 = at least one board slot biased toward the Score target's principal (same corp, different sites) so the player learns the org before the climax.
  - Act 3 = board mostly prep contracts at or near the Score target, plus a separate player-initiated Score action instead of a random roll.
  - Score = special contract build path; not part of the normal three-card job board.
- **Hub surface:** Hub status / Terminal shows current stage and Score target label once revealed. Clock HUD (`CLOCK: HEAT X / Y JOBS LEFT`) appears **only after** the player dismisses the `clock-reveal` briefing and heat has actually started — no "dormant" or countdown-to-heat lines before then. User-facing labels use "Stage" (STAGE 1, STAGE 2, etc.) — code and persistence keep `arc`/`arcStage` naming. Arc beats use progressive Hub reveal plumbing (`score-reveal`, `clock-reveal`, `act-3-reveal`); see P3.M1.4–M1.5 notes.
- **Win/loss conditions:**
  - **Win:** Complete the Score (extract with objective satisfied from the final mission). Terminal campaign overlay: `SCORE COMPLETE`.
  - **Loss (flatline):** Entire crew wiped during any run (existing behavior, but now with arc context for the chronicle).
  - **Loss (Score Decker):** If the Decker flatlines during THE SCORE, the campaign ends immediately with explicit Game Over copy. Before the Score, a flatlined Decker instead opens one free replacement lead through the Terminal; THE SCORE remains gated until a living Decker is recruited.
  - **Loss (clock):** `clockJobsTaken >= CLOCK_ACT2_DEADLINE_JOBS` (8) before `scoreAttempted`. Terminal campaign overlay: `GAME OVER` with explicit window-closed copy — not a status-line footnote. Attempted Score keeps the deadline from retroactively killing the save.

**The Clock mechanic:**

The Clock creates mounting pressure that discourages indefinite grinding in Act 2/3. **Shipped implementation:** Act 2/3 **deploys taken** (successful or not) drive heat and the hard deadline — not global `completedJobs`, so entering Act 2 with a high job count from Stage 1 does not immediately start the Clock.

- `CLOCK_ACT2_GRACE_JOBS = 3` — first three Act 2/3 deploys are grace (no heat, no `clockStarted`)
- `CLOCK_HEAT_WINDOW_JOBS = 5` — deploys after grace before the window closes **in Act 3**
- `CLOCK_ACT2_DEADLINE_JOBS = 8` — total Act 2/3 deploys (`grace + window`) counted against the Act 3 deadline
- `CLOCK_ACT3_MIN_JOBS_REMAINING = 3` — on Act 2 → Act 3 transition, over-budget `clockJobsTaken` is clamped so final prep always has at least this many deploys left
- `clockJobsTaken` increments on `deployCrewMember` while `arcStage` is `act-2` or `act-3` (Score deploy excluded — it sets `scoreAttempted`)
- `clockStarted` when `scoreRevealed && clockJobsTaken >= CLOCK_ACT2_GRACE_JOBS`
- `clockHeat = max(0, clockJobsTaken - CLOCK_ACT2_GRACE_JOBS)` once started
- **Act 2 casing:** heat mounts and HUD shows `CLOCK: HEAT N`, but the deadline cannot end the campaign — failed deploys must not stillborn the path to Act 3
- **Act 3 final prep:** HUD adds `/ Y JOBS LEFT`; returning to Hub at the deadline without `scoreAttempted` sets `Campaign.state` to `ENDED` with `endReason: 'clock-expired'`

**Hub narrative beats (priority order on `enterHub`):** `score-reveal` → `clock-reveal` → `act-3-reveal`. Each defers its `hubReveals` flag until the player dismisses the Curator briefing modal.

Other Clock variants remain useful later, but should not block P3.M1:

- **Escalating global difficulty:** Each run after a threshold (e.g. run 8), corp security tier increases globally — more drones, tougher spawns, higher alarm sensitivity. Soft pressure: you *can* keep running, but it gets harder.
- **Rival crew:** A competing team is after the same Score. Abstract progress bar: each run you take, they advance. If they reach the Score first, you lose (or the Score becomes dramatically harder — they've tripped every alarm).
- **Operational window:** The Score target has a time-limited vulnerability (maintenance cycle, personnel rotation, satellite blind spot). After N total runs, the window closes permanently. Hard deadline.
- **Neural degradation:** The Decker's implants degrade with each jack-in. After N Cyberspace runs, they can no longer jack in — and the Score requires Cyberspace. Biological clock on the crew, not the world.

Neural degradation is deferred until Cyberspace is fun enough to deserve a jack-in-specific cost. Rival crew pressure is best saved for the inter-hostile friction work in kaizen unless a Score narrative beat specifically needs it.

**Implementation slices:**

| Slice | Status | Change | Tests |
|---|---|---|---|
| **P3.M1.1 Arc record** | ✅ Done | Add `Campaign.arc`, derive `arcStage`, persist/restore, normalize old saves to Act 1 | constructor validation, snapshot round-trip, invalid stage throws |
| **P3.M1.2 Transitions** | ✅ Done | Advance acts from `rep`, `completedJobs`, Decker flag, Score-site visit | boundary tests around job counts; rep floor (incl. TRUSTED) |
| **P3.M1.3 Score target** | ✅ Done | Always synthesize a new CRITICAL-tier Score target; preserve through eviction | exactly-one target, no eviction at roster cap, always synthesized (never promoted) |
| **P3.M1.4 Hub arc surface** | ✅ Done | Curator arc briefings; Hub / Terminal stage + Score target; `<contract-select>` CASING + SCORE SITE badges | deferred-commit reveals, resume briefing, casing tag |
| **P3.M1.5 Clock** | ✅ Done | Act 2/3 deploy-driven heat + deadline; `clock-reveal`; HUD gated on briefing; clock loss game-over screen | heat math, grace deploys, deadline loss, endReason |
| **P3.M1.6 Curator bias** | ✅ Done | Pass campaign-derived arc context; bias board slots by act and score target's principal | seeded boards show expected `arcStage` and same-principal frequency in Act 2+ |
| **P3.M1.7 Score entry** | ✅ Done | Hub action creates the special Score contract in Act 3 only | availability gates, deployment path, attempted flag |
| **P3.M1.8 Game Over component** | ✅ Done | Dedicated component, separate from CrashDump, to be shown when Score window closes or crew are all flatlined |

**P3.M1.1 implementation note:** `Campaign` now owns a typed `arc` record (`arcStage`, `deckerRecruited`, `scoreRevealed`, `clockStarted`, `scoreAttempted`, `scoreCompleted`) plus an `arcStage` getter for Curator context. New snapshots serialize the record; pre-P3 snapshots normalize to Act 1; malformed persisted arc data throws during restore instead of being silently repaired.

**P3.M1.2 implementation note:** Hub entry now runs a monotonic arc transition evaluator. Act 1 advances to Act 2 at `rep >= ARC_ACT_2_MIN_REP` (65 — proven-operator bar, above the KNOWN recruitment floor) plus `completedJobs >= 4`, sets `scoreRevealed`, and auto-assigns a Decker to the crew. Higher rep tiers qualify too: a save that overshoots the rep floor before the job gate is crossed must not stall in Act 1. Terminal recruitment (`REP.RECRUIT_THRESHOLD = 50`) was inverted relative to the original M6 design so Stage 1 crew growth precedes the Score pitch. Act 2 advances to Act 3 once `completedJobs >= 9`, at least 4 non-flatlined crew, and at least 3 visited roster sites sharing the Score target's principal (including the target itself). The crew gate counts living members only — attrition blocks advancement. Successful extractions increment `completedJobs`, abort extractions do not. M1.2 does not synthesize the Score target — that remains P3.M1.3.

**P3.M1.3 implementation note:** Score reveal always synthesizes a new CRITICAL-tier site from Curator lexicon `corp` principal and `corp/data/security/infrastructure/hidden` site tokens. Existing roster sites are never promoted — the Score is always a location the player hasn't visited yet. The synthesized site gets `scoreTarget: true`, `tier: 'score'`, and CRITICAL-footprint dimensions to support escalated hostile placement. Multiple persisted score targets, or score-tier sites missing `scoreTarget`, throw during Hub-entry arc evaluation.

**P3.M1.4 implementation note:** Score reveal is player-visible. A one-shot `score-reveal` Hub reveal lets the Curator name the target, introduce the Decker, and teach the **CASING** job-board badge (same-principal org jobs during Act 2+). **SCORE SITE** still marks contracts whose `locationSiteId` matches the synthesized Score target. Arc briefings (`score-reveal`, `clock-reveal`, `act-3-reveal`) are priority Hub reveals: they are evaluated before lower-priority intros (Finn, clinic, terminal-recruit) so a mid-save act transition is not crowded out on the same visit. Their `hubReveals` flags commit on Curator briefing **dismiss** (`commitHubReveal` in the shell), not when `enterHub` queues the copy — so a missed modal can retry on the next Hub entry, and pre-P3 saves that qualify for Act 2 on first load under 3.0 are not silently bumped without the narrative beat. The shell resume path presents any pending `lastHubReveal` when restoring a HUB save. The Hub status row and Terminal crew roster show the current stage label (user-facing "STAGE N") plus Score target once revealed. Shared `arcSurface` helpers own the copy and invariant checks so multiple Score targets, or revealed Score state without a target, fail loud instead of rendering misleading UI.

**P3.M1.5 implementation note:** The Clock is driven by `clockJobsTaken` (Act 2/3 deploys), not `completedJobs` — entering Act 2 with many Stage 1 extractions does not start heat immediately. Grace: `CLOCK_ACT2_GRACE_JOBS` (3) deploys; then `clockStarted` and heat accrue until `CLOCK_ACT2_DEADLINE_JOBS` (8). A `clock-reveal` Hub briefing explains heat, the operational window, and what happens when it closes (copy in `clockRevealLines`). Clock HUD text appears only after `clockBriefingPresented` **and** `clockStarted`: `CLOCK: HEAT X / Y JOBS LEFT` on the canvas HUD, Terminal roster, and status bar. No "dormant" or "N jobs to heat" lines before the player has seen the briefing. Heat raises Curator threat counts without changing difficulty tier, capped per tier. Deadline loss sets `Campaign.endReason` to `clock-expired`; terminal outcomes now bypass `<crash-dump>` and use the summary-backed `<game-over>` overlay. An attempted Score keeps the deadline from retroactively killing the save.

**P3.M1.6 implementation note:** `Curator.generateContracts` now uses campaign-derived arc context behaviorally. Act 2 guarantees at least one fresh same-principal casing job for the Score target's organization. Act 3 guarantees a mostly same-principal prep board. The normal board avoids rolling the Score target itself so the finale stays a deliberate Hub action.

**P3.M1.7 implementation note:** Act 3 exposes a special `THE SCORE` contract through `Campaign.buildScoreContract()`, appended to the Hub job choices only when `Campaign.canAttemptScore()` passes. The first qualifying Hub visit also fires `act-3-reveal` ("You're ready… grab THE SCORE from the board while you can") before the player sees the fourth board slot. Deploying THE SCORE marks `scoreAttempted`, moves `arcStage` to `score`, uses the persisted Score target dimensions/memory, and completing it awards the campaign-ending `1,000 Cr` payoff, marks `scoreCompleted`, and ends the campaign in a win state.

**Acceptance:**

- Arc state persists in campaign save; restore round-trip.
- Act transitions fire at correct thresholds; tests for boundary conditions.
- Score reveal is player-visible: Curator presents the target once (including on legacy-save restore when Act 2 opens for the first time), Hub / Terminal displays the current act and target label, and contract selection marks **CASING** (same principal) and **SCORE SITE** (target location) jobs.
- Curator generates arc-appropriate contracts per act (testable via seeded generation with arc context).
- Clock: `clock-reveal` briefing, deploy-driven heat, HUD visible only post-briefing, clock loss reaches terminal game-over screen.
- Exactly one Score target exists after Score reveal; it survives roster eviction and keeps its P2.5.M7 terrain memory.
- Win/loss conditions reachable in golden-path test.

---

### P3.M2 — The Decker archetype ✅

**Depends on:** P3.M1 (arc structure for recruitment gating). Can develop archetype mechanics in parallel, but recruitment integration requires arc state.

**Goal:** Fourth player archetype — the **Decker** (working name; alternatives: Jockey, Slicer, Cowboy, Spike). Recruited mid-campaign as a narrative beat, not available at campaign start.

**Scope:**

- **Archetype definition:** Stats, AP costs, base loadout. Comparable to Merc/Razor/Tech in Meatspace capability but not optimized for it.
- **Signature ability — Drone Override Hack:** Target a corp drone within range; spend AP to attempt override. On success, drone switches to PLAYER faction for N turns (or until destroyed). Reuses existing drone AI with faction flip. Failure may trigger alarm (P2.5.M2.1 cadence).
- **Cyberspace stats:** The Decker has Cyberspace-specific attributes (e.g. RAM, intrusion strength, ICE resistance) used in P3.M3. Other archetypes cannot jack in (or can with severe penalties — TBD).
- **Recruitment flow:** Same narrative beat as the Score reveal — triggered at Act 1 → Act 2 transition. The Curator assigns a named Decker (no player choice modal); the `score-reveal` Hub reveal introduces both the Score target and the Decker in one moment. Same progressive Hub reveal pattern as Finn's introduction and Terminal explanation — the Hub grows with the campaign. Future phases may differentiate Decker stats and offer a choice; for now the assignment is the narrative.
- **Deployment:** The Decker is deployable as a solo operator on any contract (Meatspace only on non-Cyberspace contracts). On Cyberspace contracts, the Decker is one of the dual-deploy pair (see P3.M4).
- **Roster rule:** The Decker is a named crew member, not a temporary ability unlock. Recruitment should add them to `Campaign.crew` through the existing recruit/callsign machinery or a deliberately separate `recruitDecker()` path with the same validation guarantees. Do not let normal random recruitment roll a Decker before Act 2.
- **Jack-in authority:** Only a living Decker can start P3.M3 jack-in. If a contract has a Cyberspace requirement and no living Decker is available, deployment should fail loudly at the Hub selection layer rather than starting an unwinnable run.

**Acceptance:**

- ✅ Decker archetype playable in Meatspace: move, attack, interact — comparable to other archetypes (`Decker` extends `Crew`, `baseHitChance` 0.7, `@` glyph).
- ✅ Drone Override Hack: golden-path test — target drone, override succeeds, drone attacks corp allies for N turns, reverts or is destroyed (`droneOverride.ts`, `Decker.test.ts`). Failed roll burns AP and trips the alarm.
- ✅ Recruitment: same beat as Score reveal (Act 1 → Act 2 transition); Curator assigns a named Decker, no choice modal. Not available in Act 1; golden-path test for recruitment flow. Decker is registered but excluded from `ARCHETYPE_IDS` and `RECRUIT_ARCHETYPE_POOL` so random recruitment can't roll one early.
- ✅ Snapshot: Decker state persists (campaign + run round-trip); live drone-override state round-trips through the patrol snapshot. Cyberspace attributes deferred to P3.M3.
- ✅ Key help: Decker glyph (`@`) and OVERRIDE ability description via shared `ARCHETYPES[id].perkLabel`.

**P3.M2 implementation note:** The Decker's signature **Override** reuses the unified `special` perk key — the intent layer's `doSpecial` sniffs `canOverride` and resolves a drone along the aim ray (`OVERRIDE_RANGE`, LOS-gated, like fire). A successful hijack flips the drone to `FACTION.PLAYER` for `OVERRIDE_DURATION` turns; the existing hostile AI then fights corp for free (it targets by faction difference). Override state lives on `Hostile` (`overrideTurnsRemaining`, `factionBeforeOverride`) and is driven each player turn by `stepOverriddenDrones`, a new combat-aftermath phase that steps the hijacked drone and reverts it when the countdown lapses. Mid-override saves round-trip through the patrol snapshot; half-populated override state throws on restore.

---

### P3.M3 — Cyberspace grid + ICE ✅

**Status (2026-06-14):** Complete. The first playable slice (M3.1–M3.6, plus voluntary jack-out pulled forward from M4.6 and an early-jack-out confirmation) shipped end-to-end, and the **full ICE roster** — Probe (detector), Spark (fast/fragile swarm), and Guardian (heavy node guard) — now lands at every jack-in.

**Depends on:** P3.M2 (Decker as the Cyberspace avatar). Can prototype grid mechanics independently.

**Goal:** The second tactical layer — a **Cyberspace grid** with its own geometry, traversal rules, and hostile AI (**ICE** — Intrusion Countermeasure Electronics). Generated fresh per jack-in (not persistent across runs).

**Scope decisions (recorded):**

1. **First playable slice only** — slices M3.1–M3.6 (contract flag → jack-in terminal → cyber layer model → data node objective → Probe ICE → render swap). **Spark/Guardian ICE deferred** to follow-up slices; the milestone stays open until they land.
2. **Minimal voluntary jack-out pulled forward** from P3.M4.6 so the layer is playable end-to-end solo before the simstim flip exists. M4.6 then only adds forced jack-out + dual-deploy cleanup.
3. **Avatar death = flatline** — ICE destroying the avatar kills the Decker through the existing DEATH/flatline paths. Genre-honest (black ICE kills), zero new death machinery.
4. **Named cyber stats ship now with real effects:** RAM = avatar HP pool, intrusion strength = slice progress per interact, ICE resistance = `damageReduction` (existing min-1 mitigation in `Combat.ts`). Persisted and validated in both crew persistence paths.
5. **The Score is always a cyber run** (2026-06-11): `buildScoreContract` emits `DATA_NODE_SLICE` with `{requiresCyberspace: true, count: 1}` — for now; revisit if a meat-only Score variant is ever wanted. Deploy goes through the living-Decker gate; objective shape locked in the P3.M1.7 tests.

TDD throughout; malformed persisted state throws (no silent fallbacks).

**Scope:**

- **Cyberspace grid:** Separate `Grid` / `World` instance for the digital layer. **First implementation reuses the existing square grid engine** with a distinct tileset and generation rules; reserve a graph-topology refactor only if the square grid fails the feel test.
- **Cyberspace tileset / aesthetic:** Distinct from Meatspace — FLOOR `·` deep cyan, WALL `▒` magenta; location label `// THE GRID //`; vitals pane labeled RAM.
- **ICE hostiles:** Three types per blueprint:
  - **Probe:** Sentry / patrol. Detects the Decker, raises alert (Cyberspace alarm analog). ✅ Shipped. 2 HP / 2 AP / 1 dmg / **sight 7** (longest — it's the detector).
  - **Spark:** Fast, fragile attacker. Swarm behavior. ✅ Shipped. 1 HP / **4 AP** / 1 dmg / sight 6 — rides the trace flare, never raises one.
  - **Guardian:** Heavy. Guards critical nodes. High HP, high damage, limited mobility. ✅ Shipped. 6 HP / 2 AP / **3 dmg** / sight 5 — parks on a data node (no patrol), flares on contact.
- **ICE AI:** A* pathfinding (reuse Meatspace drone infrastructure). Alarm/alert model adapted from P2.5.M2.1 for the digital layer.
- **Cyberspace objectives:** Slice data nodes (shipped); disable firewalls, open digital locks — future.
- **Generation:** Procedural per jack-in. Seeded from contract (`new Rng(contract.seed).fork('cyberspace')`). Not persistent. Complexity scales with contract difficulty.
- **Jack-in trigger:** Decker interacts with a Meatspace `JackInPoint` (Ω glyph). Spawns the Cyberspace grid; dual-deploy flip deferred to P3.M4.

**Architecture:**

- **`CyberspaceLayer` owned by `Run`, single `TurnQueue`, both worlds tick.** New `src/game/cyber/CyberspaceLayer.ts` owns its own `EventBus`, `World`, `CyberAvatar`, `entryTile`, `mapSeen` — not a nested Run.
- **`CyberspaceState` union:** `{phase: 'dormant'}` | `{phase: 'active'; layer: CyberspaceLayer}` | `{phase: 'resolved'; objectiveComplete: boolean}`. `Run.cyberspace: CyberspaceState | null` — null ⇔ no cyber component.
- **Turn integration:** One existing `TurnQueue`. Meat `TURN_ENDED` listener forwards `{next}` to `layer.onTurnEnded(next)` when cyber is active. Shell corp phase chains two `corpTurnDriver` passes — meat hostiles, then ICE — consuming shared `run.rng` in fixed order. **Meatspace keeps ticking during jack-in** — Decker body stands at the port as `run.player`, targetable; body death hits existing player-death path (M4.2 vulnerability falls out for free).
- **`CyberAvatar`:** `Entity` subclass; `maxHp = decker.ram`, `damageReduction = decker.iceResistance`, `intrusionStrength`, `readonly isCyberAvatar = true` (capability sniff — Decker body also carries `intrusionStrength`). Stats on `Decker` with `DECKER_BASE_RAM/INTRUSION/ICE_RESISTANCE` constants; round-trip through both crew persistence paths.
- **Generation:** `buildCyberMap({rng, difficulty})` — rooms-as-nodes lattice, FLOOR/WALL only, connectivity validated via `explorationReachableKeys`. Distinct visuals via tileset axis in `palette.ts`, not new TILE ids.

**Entering Cyberspace — first playable slice:**

1. `requiresCyberspace` contract param for Act 2+ jobs, generated only when a living Decker exists.
2. Meatspace `JackInPoint` placed via `findInteractableAnchor`, deterministic per contract seed.
3. Jack-in creates active cyber layer: generated grid, `CyberAvatar`, data nodes, Probe ICE per patrol ring.
4. Repeated jack-in against linked port → deterministic `already-linked` refusal; corrupt state throws.
5. Mid-jack-in save restores both layers; absent/malformed cyber snapshot for active jack-in is tier-1 corrupt state.

**Implementation slices:**

| Slice | Status | Change | Tests |
|---|---|---|---|
| **P3.M3.1 Contract flag** | ✅ Done | Cyberspace-capable contract metadata and validation | generated only Act 2+, invalid flag/params throw |
| **P3.M3.2 Jack-in terminal** | ✅ Done | `JackInPoint` placement and interact flow | deterministic placement, no collision with objective props |
| **P3.M3.3 Cyber layer model** | ✅ Done | Serializable `Run.cyberspace` layer with grid/world/avatar | snapshot round-trip, active-layer invariants |
| **P3.M3.4 Data node objective** | ✅ Done | Slice data nodes and feed objective satisfaction | incomplete blocks clean extraction, complete allows it |
| **P3.M3.5 Probe ICE** | ✅ Done | ICE patrol/detect/attack loop | seeded movement, detection/alarm, damage/death |
| **P3.M3.6 Render swap** | ✅ Done | Render Cyberspace when active; dual-phase corp turn | browser smoke, dualPhaseTurn determinism |
| **P3.M3.7 Body CCTV PIP** | ✅ Done | Meatspace overlay while jacked in; body-damage feedback | pip viewport/chrome unit tests, browser smoke |
| **M4.6 pull-forward — voluntary jack-out** | ✅ Done | `JackInPoint.burned` latch; `Run.jackOut()`; early jack-out confirmation | LINK BURNED latch, defer/confirm matrix, round-trip |
| **Playtest stabilization** | ✅ Done | Probe 2 HP / 2 AP; Cyber Override against ICE; pre-Score replacement Decker; Score Decker death Game Over | action budget, override/revert + persistence, replacement/Score gates |
| **Spark ICE** | ✅ Done | Fast, fragile attacker; swarm behavior (rides the flare) | stats, listens-for-flare swarm, difficulty-scaled count, round-trip |
| **Guardian ICE** | ✅ Done | Heavy guard of critical nodes; high HP/damage, parks on the node | stats, one-per-data-node placement, heavy strike vs resistance, round-trip |
| **ProbeIce rebalance** | ✅ Done | Sight 6→7 (the detector); roster split off the data-node rings | sight, non-data-ring patrol count |

**P3.M3.1 implementation note:** `OBJECTIVES.DATA_NODE_SLICE = 'data-node-slice'` with cross-field validation in `normalizeObjective`: kind requires `params.requiresCyberspace === true` plus positive-integer `params.count`; flag forbidden on every other kind. `contractRequiresCyberspace(contract)` exported from `Curator.ts`. Recipe `cyber-data-spike` gated by `ContractRecipe.availableWhen`: `arcStage ∈ {act-2, act-3} && hasLivingDecker`. Deploy gate in `Campaign.deployCrewMember` throws for cyber contracts unless deployed member is a living Decker. UX: `CrewList.setCrew(crew, rowGate?)` — `NEEDS DECKER` on non-Decker rows.

**P3.M3.2 implementation note:** `JackInPoint extends Interactable`, glyph `Ω`, id `jack-in-0` (not matching `/^terminal-\d+$/`). Interact: linked → `already-linked` refusal; `actor.canJackIn !== true` → `no-cyberdeck`; success latches `linked`, emits `EVENT.JACK_IN`. `Run.cyberspace` latched in `enterBriefing` from `contractRequiresCyberspace`. Persistence: `RunSnapshot.cyberspace?`; dormant-only in S2, extended in S3.

**P3.M3.3 implementation note:** `buildCyberMap` — 4×2 cell lattice, L-corridors, patrol rings; node count by difficulty (standard 5 / elevated 6 / critical 8); returns `portTile` (Chebyshev-1 from entry). `CyberspaceLayer.build` forks `new Rng(contractSeed).fork('cyberspace')`. Serialization lives in Run's `snapshotCyberspace`, not `layer.snapshot()`. `Run.jackIn(point)` / `jackOut()` with explicit autosave. Cyber `ENTITY_DAMAGED` listener mirrors meat player-death → flatline. Decker cyber stats: absent → defaults (legacy), half-populated → throw.

**P3.M3.4 implementation note:** `DataNode extends Interactable`, glyph `◈`, avatar-only via `isCyberAvatar` sniff. `sliceDifficultyFor`: standard 2 / elevated 3 / critical 4. `ObjectiveState.cyber?: {sliced, required}`; `DATA_NODE_SLICE` satisfaction reads live tally while active, resolved latch after jack-out. Early jack-out latches `objectiveComplete: false` → existing abort-confirm extraction flow. Active snapshot requires exactly the contract's node count.

**P3.M3.5 (Probe ICE) implementation note:** `ProbeIce extends PatrolHostile`, glyph `¶`. Trace flare: `engageSteps` raises cyber alarm (`repPenalty: false`) before striking; pack convergence via default `listensForAlarm()`. `'probe-ice'` in `PATROL_ARCHETYPE_IDS` for snapshot machinery. **Follow-up:** probes default `FACTION.CORP`; future rival-principal cyber recipe needs ICE faction stamping at `jackIn`.

**Spark + Guardian ICE implementation note (2026-06-14):** The roster is now three distinct silhouettes that share the patrol state machine but split by role and map geometry, assembled in one pass in `CyberspaceLayer.build`:

- **Guardian** (`GuardianIce`, glyph `Ψ`) spawns on **every data-node ring** (`dataNodeIndices`) — one heavy per critical node. 6 HP / 2 AP / 3 dmg (`HEAVY_MELEE_DAMAGE`) / sight 5, **no patrol waypoints** so it holds station on the prize until the avatar enters its short sight, then flares (like the Probe) and closes. ICE resistance only files its strike to 2.
- **Probe** (`ProbeIce`, glyph `¶`) patrols **every non-data ring**. Rebalanced to **sight 7** — the longest of the three — because its job is to *see* you first and trip the flare that wakes the pack; it stays the weakest in a fight (2 HP / 2 AP / 1 dmg).
- **Spark** (`SparkIce`, glyph `×`) is the **difficulty-scaled swarm** (`SPARK_COUNT`: standard 1 / elevated 2 / critical 3), seeded onto random rings. 1 HP / 4 AP / 1 dmg / sight 6 — it **rides** the Probe/Guardian flare via `listensForAlarm()` but never raises one itself, closing three tiles and biting in a single activation.

Placement is collision-safe (`pickFreeRingTile` consumes one rng draw then scans the ring, throwing rather than stacking ICE) and remains a pure function of the contract seed. All three share the `PatrolSnapshot` `extra` block via `PATROL_ARCHETYPE_IDS` (`spark-ice`, `guardian-ice` added alongside `probe-ice`); both round-trip through the active-cyber restore path with bus re-binding. **Follow-ups:** ICE faction stamping for rival-principal recipes (unchanged from M3.5); a leashing option if Guardians chasing a lost lead across the lattice ever reads wrong; live playtest tuning of `SPARK_COUNT` / Guardian HP.

**P3.M3.6 implementation note:** `TilesetId = 'meat' | 'cyber'` in `palette.ts`. Shell active-view seam via `run.activeWorld`/`run.activeActor` through vision, paint, look/describe, touch, statusLine. `ApplyIntentContext.player` widened to `Archetype | CyberAvatar`. Dual-phase corp turn while jacked in.

**P3.M3.7 implementation note (2026-06-14):** Partial pull-forward of M4.5 PIP. While `cyberspace.active`, a read-only `#pip-canvas` overlay (bottom-right on `.game-stage`) paints meatspace via a second `AsciiRenderer` (`pip.ts` helpers: `pipCameraFor`, `pipChrome`, `shouldShowPip`). Meat `vision` stays live; the silent meat corp pass now refreshes the PIP each step and flashes visible corp lines. Body hits while jacked in emit `BODY HIT` status text, pulse the PIP border, and route muzzle flashes to the PIP renderer (not the cyber canvas). Playtest finding: Score flatline from silent meat damage motivated this slice. M4.5 will generalize to the *inactive* layer after simstim flip.

**M4.6 pull-forward (jack-out) implementation note:** `JackInPoint.burned` set by `Run.jackOut()` — real latch, distinct `link-burned` refusal flavor. `burn()` on unlinked port throws (burned ⇒ linked invariant). Persistence: `extra.burned`; absent on pre-S5 records → unburned.

**Early jack-out confirmation implementation note:** `Run.onJackOutRequested` defers incomplete jack-out to confirmation modal (LINK BURNED is irreversible). `run.confirmJackOut()` finalizes; throws on illegal states. `wireRunConfirmations(run)` extracted — called at deploy **and** campaign resume (fixes latent abort-confirm loss on mid-run reload).

**Persistence (consolidated):** `RunSnapshot.cyberspace` with phase `dormant | active | resolved`. Restore rules in `restoreCyberspace`: `contractRequiresCyberspace` ⇔ block present (both directions); unknown phase throws; dormant carrying payload throws; active validates grid dims, exactly one avatar + one port, entities bounds-checked against cyber grid; resolved requires boolean `objectiveComplete`; decker cyber stat blocks half-populated → throw. Autosave on meat `TURN_ENDED` while jacked in; `jackIn`/`jackOut` call `onPersist` explicitly.

**Risks / follow-ups:**

- S7 shell breadth — `index.ts` reads `run.world`/`run.player` widely; kaizen tracks cleanup (ShellScene casts, statusLine extraction, listener rewire dedupe, listener-order coupling).
- Spark/Guardian ICE shipped; ICE faction stamping for non-corp principals remains open.

**Acceptance:**

- Cyberspace grid renders distinctly from Meatspace.
- All three ICE types functional: patrol, attack, guard behaviors (Probe ✅; Spark ✅; Guardian ✅).
- At least one Cyberspace objective type (data node slice) with `isObjectiveSatisfied` integration.
- Cyberspace grid generated deterministically from seed; snapshot round-trip for mid-run save/restore.
- Jack-in from Meatspace terminal spawns Cyberspace grid.

**P3.M3 playtest stabilization note (2026-06-14):** Probe tuned from 3 HP / 4 AP to 2 HP / 2 AP — burst pressure came from action economy, not nominal one-damage strike. `CyberAvatar` exposes Override against ICE (2 AP / 60% / 3-turn contract, cyber aftermath pass, patrol snapshot round-trip). Pre-Score Decker flatline → one free Terminal replacement lead; THE SCORE gated until living Decker. Decker flatline during THE SCORE → `decker-flatlined-score` campaign Game Over. **P3.M3.7** adds meatspace CCTV PIP so jacked-in body vulnerability is visible (silent meat corp damage was the Score death vector in first playtest).

---

### P3.M4 — Simstim flip (dual-deploy) 🟡

**Depends on:** P3.M2 (Decker), P3.M3 (Cyberspace grid). This is the integration milestone.

**Goal:** The **simstim flip** — dual-deploy two operators (Meatspace + Decker in Cyberspace) with a flip mechanic that switches active control between layers. The PIP/CCTV window shows the inactive layer.

**Resolved design decisions (2026-06-15):**

- **Partner spawns at jack-in, not at mission start.** A Cyberspace contract is selected as a dual-deploy (Decker + meat partner), but pre-jack-in the run is the existing solo-Decker mission — the partner is *reserved* at deploy and only spawns onto the meat grid (a random safe cell, behind cover, out of immediate danger) the moment the Decker jacks in.
- **Control stays in Meatspace after jack-in until the first flip.** On jack-in the freshly-spawned partner is the active operator; the player enters Cyberspace only on the first explicit flip.
- **Deploy UX:** the Decker is auto-included as the jack-in operator; the player picks the living meat partner. If no living non-Decker is available, the run falls back to a solo Decker deploy (the P3.M3 path).
- **Flip is a free action** that swaps the active operator among the live operators: pre-jack `{Decker}` (no-op), jacked `{partner(meat), avatar(cyber)}` (layer swap; Decker body frozen), post-jack-out `{Decker(meat), partner(meat)}` (meat↔meat).
- **Forced jack-out at 1 HP:** the Decker's body cannot die while jacked in — a killing/critical hit clamps the body to 1 HP and ejects the Decker (alive) back to Meatspace. Cyber-side death (ICE depleting RAM) still flatlines. This retires the silent-meat-damage Score death vector from M3.7.
- **Independent AP pools, decoupled turn-end (2026-06-15, from playtest).** Each dual-deploy operator keeps its own 4-AP pool — moving the avatar spends only avatar AP, the partner only partner AP. The mutual turn (which drives *both* hostile phases) ends only when **every controllable** operator is spent, or on an explicit Wait — **not** when whichever one you're driving hits 0. Exhausting the active operator while the other still has AP **auto-flips** control to it (free, like the manual flip) rather than ending the turn. Rationale: the partner is a separate living crew member, so two operators ⇒ two full turns of action, matched by the two hostile phases already ticking each round (meat drones *and* ICE) — the economy stays symmetric. The earlier behaviour (turn ended on the *active* operator's exhaustion, refreshing both) wasted the other's unspent AP and rewarded tedious flip-drain micro. *Sub-decision:* auto-flip over a passive "operator spent" nudge — keeps the player's hands moving; the view-snap is covered by a loud flash. *Refinement (2026-06-15, playtest):* **Wait (`.`) passes *this* operator and always hands control to the other operator when one exists** — forfeit this operator's remaining AP, then flip to the other *regardless of whether it still has AP*; the mutual turn (and the hostile phases) fires only once both operators are spent/passed (on a flip-and-end, next turn opens on the operator we flipped to). Distinct from AP-exhaustion, which auto-flips only *while* the other can still act and ends *in place* when the last operator runs dry — flipping back to an already-spent operator at exhaustion would be an unwanted view-snap, whereas Wait is an explicit pass/switch gesture so it always switches. (An earlier pass mid-implementation flipped on Wait only when the other had AP and otherwise stayed put — that two-faced Wait read as confusing in playtest.) This gives a clean split — **Tab** switches attention keeping both pools, **`.`** commits one operator to inaction and rotates to the other — matching the reach-for-`.`-when-this-operator-has-nothing-to-do intuition. Trade-off: no single-press "end the whole round"; ending while both hold AP is two passes (`.` then `.`). No dedicated hard-end binding for now; revisit if the two-tap end proves annoying. *Possible follow-up:* exhaustion could be made to round-robin too if the Wait/exhaustion end-position difference reads as inconsistent in play.

**Scope:**

- **Dual-deploy:** On contracts with a Cyberspace component, the player selects two operators: the Decker (auto-included, the eventual Cyberspace avatar) and a meat partner. Only the Decker is placed at mission start — the partner is *reserved* (see the resolved decisions above) and spawns at jack-in.
  - **Pre–jack-in phase:** The Decker starts solo in Meatspace, where they move and act normally. The player must reach a terminal and jack in (P2.5.M2.2 interact) to activate Cyberspace. Until jack-in, this is a normal single-grid mission.
  - **Post–jack-in:** Cyberspace grid spawns; the reserved partner spawns into Meatspace at a safe cell and **becomes the active operator** (control stays in Meatspace until the first flip). The Decker's Meatspace body remains at the terminal — frozen, immobile, and targetable by corp hostiles (blueprint: "your physical body is a vegetable").
- **The flip:** Switch active control between Meatspace operator and Decker. Active operator receives player input (move, attack, interact). Inactive operator holds position.
  - Cost: **free action** for the first implementation. AP cost can be revisited after playtesting, but the first version should make the new mental model easy to explore.
  - Can flip at any point during the active operator's turn (before or after spending AP).
- **Turn structure:** Player turn → flip as desired → end turn → **both layers' hostile phases resolve** (corp drones move in Meatspace, ICE moves in Cyberspace). Both layers tick simultaneously.
- **PIP / CCTV window:** The inactive layer renders in a small overlay (bottom right corner of the screen). Shows grid state, hostile positions, the other operator's status. Read-only — no input accepted in the PIP. The blueprint's "real-time CCTV showing your physical body's status" becomes this.
- **Vulnerability:** While the Decker is jacked in, their Meatspace body is a valid target for corp hostiles. The body **cannot die while jacked in** — a killing/critical hit clamps it to 1 HP and forces a jack-out (resolved decision); only ICE depleting RAM flatlines the Decker outright. The Meatspace partner's explicit job is to **protect the Decker's body** — or at least keep hostiles away from the terminal.
- **Jack-out:** The Decker can voluntarily jack out (returns control to single-grid Meatspace). Or is forced out when their body is driven to 1 HP. Jack-out despawns the Cyberspace grid (any unsatisfied Cyberspace objectives fail).
- **Contracts without Cyberspace:** Single-deploy as today. The Decker deploys solo in Meatspace (no flip, no Cyberspace grid). Their drone override hack is their primary value. A pre-Score flatline opens one replacement Decker lead through the Terminal; a flatline during THE SCORE is campaign-terminal.
- **Save invariant:** A run may be single-layer, pre-jack dual-deploy, or active dual-layer. Those states must be explicit. A save with `cyberspace.active = true` but no cyber grid/avatar, or with a Decker marked jacked-in but no Meatspace body anchor, is corrupt and must throw.

**Integration slices:**

| Slice | Status | Change | Tests |
|---|---|---|---|
| **P3.M4.1 Dual deploy** | ✅ Done | Reserve the meat partner alongside the Decker on a Cyberspace deploy; `Run.partnerMember`, deploy gates, persistence | deploy gates, partner shape, campaign + standalone round-trip |
| **P3.M4.2 Jacked body anchor + partner spawn** | ✅ Done (model) | Decker body freezes at port; partner spawns at a safe meat cell; `activeLayer`/`meatActor`/`deckerBody` on `Run` | body frozen+targetable, movement rejected, partner placement, determinism, round-trip |
| **P3.M4.3 Flip command** | ✅ Done | Tab → free-action flip; `activeView` keys on `activeLayer`; `Run.flip()`/`canFlip()` | flip toggles layer/actor, solo+pre-jack can't flip, meat↔meat post-jack-out, keymap intent |
| **P3.M4.4 Dual hostile phase** | 🟡 | Independent AP pools + decoupled turn-end (auto-flip on exhaustion); end turn advances corp and ICE phases once each | ✅ AP-pool/turn-end model (`endOfTurnReady`/`concludeActiveOperatorTurn`); ⬜ verify M3.6 dual-phase with partner+body present |
| **P3.M4.5 PIP** | 🔲 | Inactive layer mini-render + status summary | desktop/mobile layout, no input capture |
| **P3.M4.6 Jack-out** | 🔲 | Voluntary + forced (1-HP) jack-out transitions back to Meatspace | cleanup, objective failure rules, snapshot round-trip |

**P3.M4.4 bugfix — stranded partner after restore (2026-06-15, playtest):** On a campaign mid-run restore, flipping to the meat partner after the Decker jacked out controlled a phantom: the partner appeared "stuck in a wall off the map" and couldn't move. Contributing factors: (1) restore rebuilds grid entities as *detached copies*, separate from the canonical roster crew objects; the primary tolerates this because `run.player` stays the grid copy (operator) while `crewMember` is re-linked to the roster object (identity) — two fields. (2) The partner has only `partnerMember`, doing double duty as both operator and roster ref. (3) `restoreActiveRun` unconditionally rebound `partnerMember` to the off-grid canonical roster object, so once the partner was a live grid entity (jacked in / jacked out) the flip's `#aliveMeatAlternate` handed control to the off-grid copy (id-match in `world.entities.has` masked it), centering the camera on the roster object's `(0,0)` and denying movement. Fix: `restoreActiveRun` re-binds `partnerMember` to the canonical object **only while it is still off-grid** (a dormant reserve a later jack-in spawns); once it is a live grid entity, keep that entity — mirroring `run.player`. Regression test: `dualDeploy.test.ts` "after jack-out the campaign round-trip keeps the partner on the grid" (identity + flip). **Follow-up (broader, pre-existing):** the detached-grid-copy-vs-canonical-roster split means combat stats applied *after* a mid-run restore land on the grid copy, not the roster object — a latent crew-HP desync across save→restore→play→save for the primary too. Investigate whether job-end reconciliation already covers it; if not, restore should rehydrate the canonical crew objects *as* the grid entities so there is one object, as in live play.

**P3.M4.4 implementation note — AP pools (2026-06-15):** Independent AP pools with a decoupled turn-end, settled from playtest (see the resolved decision above). Two new pure `Run` methods carry the model: **`endOfTurnReady()`** — the active actor is at 0 AP and there is no flip alternate with AP left (`#flipAlternate()` returns the operator `flip()` would hand control to: the other layer's operator while jacked, else the other live meat operator); and **`concludeActiveOperatorTurn(): 'continue' | 'auto-flip' | 'end'`** — `'continue'` while the active actor still has AP, `'end'` once the crew is spent (the shell drives the corp+ICE phases, which refresh every pool once), `'auto-flip'` when the active operator is spent but another still has AP (the method performs the flip; a spent-but-not-end-ready actor guarantees a live alternate with AP, so the flip is always safe). The frozen Decker body is never the active actor nor a flip alternate, so its full pool can't keep the turn alive; solo/single-deploy has no alternate and ends at 0 as before (no M3 regression). Shell: every auto-end-on-exhaustion site (the `applyIntent` `gateOnApExhausted` via new optional `ctx.concludeTurn`, plus consumable / loot / secured-interact) routes through one `concludeOperatorTurn()` helper that switches on the discriminant — `'end'` → `advanceTurn()`, `'auto-flip'` → shared `repaintAfterFlip(run, 'OPERATOR SPENT')` (factored out of `handleFlip`). **Wait** (`end-turn`) zeroes the active operator's AP then routes through a *separate* `passTurn` hook → `Run.passActiveOperatorTurn(): 'flip' | 'flip-and-end' | 'end'` (playtest refinement). Unlike exhaustion, Wait **always** flips to the other operator when one exists (`#flipAlternate` non-null), regardless of that operator's AP — `'flip'` keeps the turn open, `'flip-and-end'` also drives the hostile phases (next turn opens on the flipped-to operator), `'end'` is the solo/single-deploy case; the `?? advanceTurn` fallback keeps a hard end for harness contexts. The shell's `passOperatorTurn` repaints (`repaintAfterFlip(run, 'WAIT')`) on both flip outcomes and additionally `advanceTurn()`s on `'flip-and-end'`. Tests: `operatorTurnConclude.test.ts` (14) and an `applyIntent` `end-turn`-routes-through-`passTurn` case covers the predicate, the three-way conclude, auto-flip-not-end-not-refresh, never flipping to a dead/frozen operator, solo/single-deploy end-at-0, and post-jack-out meat↔meat. **Still open for M4.4:** verify the M3.6 dual-phase corp turn (`dualPhaseTurn.test.ts` was solo-Decker only) holds with the partner+body present — both layers tick once, no double refresh, deterministic with the partner on the field.

**P3.M4.3 implementation note (2026-06-15):** The flip is a free action bound to **Tab** (`keymap` → `{type:'flip'}`; the shell's `handleFlip` validates and flashes a deny when there's nothing to flip to, so the keymap stays dumb). `Run.flip()`/`canFlip()` swap active control: while jacked in, between the controllable meat operator and the cyber avatar (only when the meat side is a real partner, not the frozen solo body); post-jack-out, between the two live meat operators (`#aliveMeatAlternate`). The big seam change is in **`activeView`**: `isJackedIn` ("a cyber layer exists" — body vulnerability, dual-layer turn plumbing) now splits from new **`isCyberView`** ("the player is viewing/controlling the grid" = jacked **and** `activeLayer==='cyber'`). Render, tileset, vision, HUD, gear gates, corp-step render target, breach overlay, and mood/hint all switched to `isCyberView`; `meatActorOf` centers meat fog + the meat HUD pane on the controllable operator (partner after a dual jack-in). Solo cyber runs are unchanged (jack-in sets `activeLayer='cyber'` ⇒ `isCyberView` true everywhere it was `isJackedIn`). **Verification gap:** the shell `handleFlip`/render path has no DOM test harness and the debug harness lacks Cyber/PIP support, so the end-to-end flip needs an in-campaign playtest once a dual-deploy cyber contract is reachable through the live loop. **Follow-up:** no touch-pad flip button yet (keyboard-only); M4.5 still owes the PIP showing the *inactive* layer (today it always shows meat per M3.7, so it's redundant while viewing meat).

**P3.M4.2 implementation note (2026-06-15):** Run-model layer only — the shell/`activeView` wiring and the flip *command* land with P3.M4.3. `jackIn` now captures the Decker as the **body**, freezes it (`Entity.frozen`, enforced in `World.canMoveEntity` → `'jacked-in'`; still a live, targetable grid entity), and — when a partner was reserved — spawns the partner via `#partnerSpawnTile` (deterministic, prefers cells no live hostile can see and that sit against cover; falls back safe → any-free; throws on a full grid), hands it control (`meatActor`), and keeps `activeLayer = 'meat'`. A solo jack-in has no partner, so `meatActor` stays the Decker and `activeLayer = 'cyber'` (M3 behaviour preserved). New `Run` surface: `meatActor` (controllable meat crew), `activeLayer` (`'meat'`|`'cyber'`), `deckerBody` getter, and `activeWorld`/`activeActor` now honor `activeLayer` (via `cyberInputActive`). `player` deliberately stays the Decker/body so body-targeting feedback and the PIP keep reading it. `#finalizeJackOut` unfreezes the body, returns meat control to the Decker, and resets `activeLayer`. Persistence: the off-grid `partner` record is written only while the cyber layer is `dormant` (post-jack the partner is a live grid entity); `activeLayer` is captured while `active`; restore disambiguates the two meat PLAYER crew (Decker = body, non-Decker = partner), re-freezes the body when `active`, and re-establishes `meatActor`/`activeLayer`. **Follow-up:** partner-death flatline accounting (the partner can now die on the field but the campaign doesn't yet flatline it) — must land before M4 closes.

**P3.M4.1 implementation note (2026-06-15):** A Cyberspace dual-deploy reserves a meat partner without spawning it. `Run.partnerMember: Crew | null` (validated non-Decker, living, distinct from the deployed operator) is set at construction; `Run.enterBriefing` forbids a partner on a non-cyber contract but does **not** require one (a solo Decker cyber run stays legal — the dual-deploy product rule is enforced by the briefing UI, not the model). `Campaign.deployCrewMember(memberId, contract, partnerId?)` gains the optional partner, records `Campaign.deployedPartnerId`, commits both operators (both clear job-scoped salvage at `onJobEnd`), and gates the partner (cyber-only, living, non-Decker, distinct, known id). `<run-briefing>` inverts its P3.M3.1 gate: on a cyber contract the Decker row is locked as `CYBER OP` and the player selects the living meat partner (Decker auto-attaches via the emitted `partnerId`); with no eligible partner it falls back to the solo `NEEDS DECKER` gate. Persistence: the reserved partner round-trips as an off-grid entity record (`RunSnapshot.partner`, throwaway `(0,0)` cell) for standalone restore, and re-binds to the canonical crew object via `partnerMemberId` on the campaign path (BRIEFING and COMBAT/RESULT). A partner record without a Cyberspace contract throws on restore. **Follow-up:** partner-death flatline accounting lands with M4.2 (the partner isn't on the field until jack-in); a fully crew-depleted player still cannot field a partner for THE SCORE — revisit if that edge proves too punishing.

**Acceptance:**

- Dual-deploy: two operators on two grids, each controllable.
- Flip switches active control; inactive operator holds position; both hostile phases tick.
- PIP renders inactive layer (at minimum: grid + entities + operator status).
- Decker body vulnerable in Meatspace while jacked in; body death = Decker death.
- Jack-out despawns Cyberspace grid cleanly.
- Snapshot: both grids, both operators, flip state; restore round-trip mid-mission.
- Golden-path test: deploy → jack in → flip between layers → complete objectives in both → extract.

---

### P3.M5 — The Score (climactic mission) 🔲

**Depends on:** P3.M1 (arc structure), P3.M4 (simstim flip), P2.5.M7 (location persistence for the target site).

**Goal:** The **climactic dual-layer mission** that the entire campaign builds toward. The Score is a contract at the designated target site, requiring both Meatspace breach and Cyberspace penetration to complete.

**Scope:**

- **Score contract:** A special contract type (or recipe) that is only available in Act 3 when the player chooses to attempt it. Not randomly rolled — player-initiated from the Hub.
- **Dual objectives:** The Score has objectives in **both** layers:
  - **Meatspace:** Breach the target site (using P2.5.M7 pre-made breaches + new ones), reach the objective room, protect the Decker's body, extract.
  - **Cyberspace:** Penetrate the target's digital defenses (ICE gauntlet), disable core security (opens physical locks/routes for the Meatspace operator), extract the target data/asset.
  - Both must be satisfied for a clean completion. Partial completion (one layer only) = partial payout or narrative consequence (TBD).
- **Site knowledge payoff:** The target site uses P2.5.M7's persistent geometry. Every prior visit's breaches, mapped rooms, and learned patrol routes carry over. The player who cased the site thoroughly has a significant advantage.
- **Escalated difficulty:** The Score is harder than any normal contract — more hostiles, tighter turn budget, more ICE, higher stakes. Failure = campaign loss (crew wipe or objective irrecoverably failed).
- **Narrative climax:** The Score's briefing, objective copy, and completion text reflect the campaign's arc. The chronicle (P3.M6) records the outcome as the campaign's defining moment.

**Acceptance:**

- Score contract available only in Act 3, player-initiated.
- Dual-layer objectives: Meatspace + Cyberspace both required.
- Target site uses persistent geometry from prior visits (P2.5.M7 mutations present).
- Completion = campaign win; failure = campaign loss.
- Golden-path test: full Score run from deployment through dual-layer completion to extraction.

---

### P3.M6 — Chronicle (campaign narrative memory) 🟡

**Depends on:** P3.M1 (arc structure provides the narrative beats to chronicle). Can begin data collection earlier if arc state is available.

**Goal:** Ground the campaign's **resource + consequence** loop in something the player can **re-read**: a persisted **chronicle** of the active campaign, and a **durable summary** when a campaign ends. Deferred from P2.5.M3 — the chronicle needs the campaign arc to be meaningful.

**Scope:**

- **Active campaign chronicle:** Entries for each run (jobs taken, outcomes, objectives completed/failed, major Rep deltas, crew changes, Decker recruitment, Score prep milestones) stored **in the campaign save**.
- **Arc-aware entries:** Chronicle entries reflect the campaign's narrative arc — Act 1 entries read as "getting established"; Act 2 entries reference the Score target; Act 3 entries build tension toward the climax.
- **Presentation:** Surfaced from the Hub **Terminal** alongside / inside the existing **crew** view (exact IA: tab, section, or shared scroll — TBD).
- **Campaign end summary:** On win (Score completed) or loss (flatline / clock expired), roll up a **summary record** into a **persistent history** list (localStorage / DataStore — same durability pattern as runs/prefs). High-scores-style: scannable list with campaign stats, arc outcome, run count, crew roster at end.
- **History access:** Hub waypoint or menu entry to view past campaign summaries. Viewable without an active campaign.

**Acceptance:**

- New job appends chronicle entry; campaign load restores full chronicle.
- Chronicle entries reflect arc state (act, Score prep status).
- End-of-campaign (win or loss) produces one summary row in persistent history.
- Hub can open chronicle (active campaign) and history (past campaigns) without errors.
- Tests for append + round-trip + cap/trim policy if the list is bounded.

**P3.M6 implementation note:** The end-summary foundation is shipped. A validated `CampaignSummary` is built only after campaign settlement reaches `ENDED`, so the final completed-job increment, Credits (including the Score payoff), Rep, seed, and roster state are captured from the canonical final campaign. Salvage remains a campaign resource rather than a summary measure of value. `DataStore` keeps summaries newest-first, preserves the original record on duplicate archival, and trims history to 50 campaigns. Live completion and restored ended saves share the same idempotent archival path. `<game-over>` is now the single terminal campaign overlay with success and failure modes; terminal outcomes bypass the recoverable job-level `<crash-dump>` debrief. Active per-job chronicle entries, Terminal presentation, and history browsing remain follow-up work within P3.M6.

---

## Recorded design decisions

### Why the Decker is recruited, not chosen

The Decker arriving mid-campaign serves multiple purposes:

1. **Complexity gating:** The player learns Meatspace combat before Cyberspace mechanics arrive.
2. **Narrative beat:** The campaign literally expands — contracts that were purely physical now have digital options.
3. **Phase compatibility:** Phase 2.5 ships a complete Meatspace game. Phase 3 deepens it. Neither phase feels incomplete.
4. **Gibsonian flavor:** Case doesn't choose to be a console cowboy for the Straylight job — Armitage finds him. The Decker finding the player echoes this.

### Why Cyberspace is generated fresh (not persistent)

Cyberspace geometry represents the *current state* of a target's digital defenses — ICE deployments, firewall configurations, data node layouts. These change between visits (the corp patches vulnerabilities, rotates ICE). Persistent Cyberspace would imply the target never adapts, which undermines the fiction.

Meatspace geometry persists because *buildings don't rebuild breached walls overnight*. The asymmetry is thematically honest.

### Why the simstim flip is dual-control (not AI crew)

We considered three models: AI-controlled Meatspace crew, full squad tactics, and dual-control with flip. Dual-control wins because:

- It reuses the single-operator model twice (minimal new UI/control code).
- The tension is attention allocation, not AI trust or micro-management.
- It's closest to Case's experience in Neuromancer — he flips between cyberspace and Molly's simstim, but both are *his* experience, not delegated.

The key difference from Gibson: in the novel, Case can't control Molly — he only observes through simstim. In Kernel Panic, the player controls both operators. This is a deliberate gameplay concession — watching AI control your Meatspace operator would be frustrating in a tactics game. The *anxiety* of divided attention is preserved; the *helplessness* is not.

## Out of scope for Phase 3

- **Multi-level / sublevel maps:** Vertical map depth (multiple floors, stairs, elevators) is deferred. Labels like "Sublevel 3 cache" remain flavor. Multi-level is a natural extension once persistent locations and Cyberspace are stable — potentially Phase 4.
- **Faction reputation / NPC social interactions:** Phase 4 per the blueprint (Rep zones, NPC alignment).
- **Neural Backups / meta-progression:** Phase 5 per the blueprint.
- **Additional Cyberspace-only archetypes or specializations.**
