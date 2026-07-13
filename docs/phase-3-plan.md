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
| P3.M4 — Simstim flip (dual-deploy) | ✅ Done |
| P3.M5 — The Score (climactic mission) | ✅ Done |
| P3.M6 — Stolen Blueprints (shop rework + meta-progression) | ✅ Meta-store, catalog split, shop rework, Score target rework, abstract targets, and hub surface shipped (M6.1–M6.6) |
| P3.M7 — Chronicle (campaign narrative memory) | 🟡 End-summary foundation shipped |

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
  - Act 2 → Act 3: **casing alone** — at least `ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED` (4) visited sites sharing the Score target's principal, with the synthesized Score target itself **excluded** (you breach it during the heist, never on a prep run, so it is never "cased"). The Decker gate is gone — the Decker is always assigned at Act 2 entry. The earlier `completedJobs >= 9` and "4 living crew" gates were **dropped** (2026-06-28): both were arbitrary and invisible, and `completedJobs >= 4` is already required to enter casing. Casing is now the single, on-screen-visible driver — its progress shows as `CASED N/4` in the stage status line. Triggers "final prep" phase and the `act-3-reveal` Hub beat on first qualifying Hub entry.
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

**P3.M1.2 implementation note:** Hub entry now runs a monotonic arc transition evaluator. Act 1 advances to Act 2 at `rep >= ARC_ACT_2_MIN_REP` (65 — proven-operator bar, above the KNOWN recruitment floor) plus `completedJobs >= 4`, sets `scoreRevealed`, and auto-assigns a Decker to the crew. Higher rep tiers qualify too: a save that overshoots the rep floor before the job gate is crossed must not stall in Act 1. Terminal recruitment (`REP.RECRUIT_THRESHOLD = 50`) was inverted relative to the original M6 design so Stage 1 crew growth precedes the Score pitch. Act 2 advances to Act 3 on the **casing gate alone**: at least `ARC_ACT_3_MIN_PRINCIPAL_SITES_VISITED` (4) visited roster sites sharing the Score target's principal, the synthesized Score target **excluded** (`casedPrincipalSiteCount` filters `!site.scoreTarget`, so the crown jewel never counts toward its own unlock). The old `completedJobs >= 9` and "4 living crew" gates were removed (2026-06-28) as arbitrary and invisible; `Campaign.casingProgress()` exposes `{ cased, required }` for the gate and the `CASED N/4` status line, and is null before the Score target is designated. Successful extractions increment `completedJobs` (still gating Act 1 → Act 2), abort extractions do not. M1.2 does not synthesize the Score target — that remains P3.M1.3.

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
5. **The Score is always a cyber run** (2026-06-11, superseded by P3.M5): `buildScoreContract` now emits `SCORE_FINAL` with `{requiresCyberspace: true, count: 1, doorId: 'score-door-0'}`. Deploy goes through the living-Decker gate and, for the finale only, requires a living non-Decker meat partner at the model layer.

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

### P3.M4 — Simstim flip (dual-deploy) ✅

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
- **Jack-out:**
  - Jack-out despawns the Cyberspace grid, returning control to single-grid Meatspace
  - The Decker can voluntarily jack out at any time via two means: 1, moving to the cyberspace exit glyph, or 2, hitting an explicit "jack-out" key (doing it this way causes neural shock and loss of 3 HP, so should be confirmed before proceeding)
  - when jacking out, any unsatisfied Cyberspace objectives fail, but the run can still be completed for the usual penalty (the exception being the Score, which MUST be completed successfully).
  - The Decker is also forced out when their body is driven to 1 HP by hostile attacks in Meatspace.
- **Contracts without Cyberspace:** Single-deploy as today. The Decker deploys solo in Meatspace (no flip, no Cyberspace grid). Their drone override hack is their primary value. A pre-Score flatline opens one replacement Decker lead through the Terminal; a flatline during THE SCORE is campaign-terminal.
- **Save invariant:** A run may be single-layer, pre-jack dual-deploy, or active dual-layer. Those states must be explicit. A save with `cyberspace.active = true` but no cyber grid/avatar, or with a Decker marked jacked-in but no Meatspace body anchor, is corrupt and must throw.

**Integration slices:**

| Slice | Status | Change | Tests |
|---|---|---|---|
| **P3.M4.1 Dual deploy** | ✅ Done | Reserve the meat partner alongside the Decker on a Cyberspace deploy; `Run.partnerMember`, deploy gates, persistence | deploy gates, partner shape, campaign + standalone round-trip |
| **P3.M4.2 Jacked body anchor + partner spawn** | ✅ Done (model) | Decker body freezes at port; partner spawns at a safe meat cell; `activeLayer`/`meatActor`/`deckerBody` on `Run` | body frozen+targetable, movement rejected, partner placement, determinism, round-trip |
| **P3.M4.3 Flip command** | ✅ Done | Tab → free-action flip; `activeView` keys on `activeLayer`; `Run.flip()`/`canFlip()` | flip toggles layer/actor, solo+pre-jack can't flip, meat↔meat post-jack-out, keymap intent |
| **P3.M4.4 Dual hostile phase** | ✅ Done | Independent AP pools + decoupled turn-end (auto-flip on exhaustion); both hostile phases tick once each with partner+body present; partner death handled | AP-pool/turn-end model; dual-phase verify with partner+body; partner flatline + control repair + alert |
| **P3.M4.5 PIP** | ✅ Done | Inactive layer mini-render + status summary; both layers route flashes to whichever side is in the PIP | inactive-feed resolution, partner→body follow fallback, cyber/RAM chrome, body-hit-in-PIP routing, cyber vs meat palatte styling of both main & PIP canvases |
| **P3.M4.6 Jack-out** | ✅ Done | Exit-port, explicit-key, and forced (1-HP) jack-out transition back to Meatspace | cleanup, objective failure rules, neural-shock confirmation, snapshot round-trip |

**P3.M4.4 — dual-phase verify + partner death (2026-06-15):** The M3.6 dual-phase corp turn (chained meat pass → ICE pass on the shared run rng) was only ever tested solo-Decker; re-verified with a partner + frozen body on the meat grid: the meat pass steps neither PLAYER operator, both layers tick regardless of which layer the player is viewing, one AP refresh per round across body + partner + avatar (+ ICE), determinism holds with the partner present (PLAYER faction draws no corp rng), and post-jack-out the meat corp turn runs solo (no ICE pass) with both operators present (`dualPhaseTurn.test.ts`, +5). **Partner death** (the playtest report — partner killed off-screen during the corp turn while the player was in Cyberspace, discovered only via a "no operator to flip to" deny): the meat partner flatlining is *not* run-ending (the Decker fights on), handled in `Run.#onEntityDamaged` → `#onPartnerFlatlined` — it repairs the active-operator state so the player never drives a corpse (if the dead partner was the meat actor, control returns to the Decker `player`; while still jacked in the body is frozen, so the view also force-flips to Cyberspace onto the avatar), and fires a new `onPartnerDown` shell hook that flashes an **unconditional** "⚠ OPERATOR DOWN" alert (the kill is invisible from the grid view). `Run.partnerDown` (partner fielded + not alive) drives `Campaign.onJobEnd`, which flatlines `deployedPartnerId` for good — independent of the Decker's outcome (extracted clean or died), and across a campaign round-trip. Tests: `partnerDeath.test.ts` (8). Closes the partner-death follow-up that M4.2 deferred. **Restore companion fix (playtest, dead-partner-stuck save):** `#onPartnerFlatlined` repairs control at the *moment* of death, but `restore()` still set `meatActor = gridPartner` unconditionally — so a save with a jacked-in run + dead partner (or any pre-fix save) reconstructed the stuck state (driving a corpse in Meatspace, `canFlip` false). Restore now mirrors the live repair: a dead grid partner is never the meat operator — `meatActor` falls back to the (frozen) body and the view defaults to Cyberspace onto the avatar; a living partner restores normally honoring the saved view.

**P3.M4.4 bugfix — stranded partner after restore (2026-06-15, playtest):** On a campaign mid-run restore, flipping to the meat partner after the Decker jacked out controlled a phantom: the partner appeared "stuck in a wall off the map" and couldn't move. Contributing factors: (1) restore rebuilds grid entities as *detached copies*, separate from the canonical roster crew objects; the primary tolerates this because `run.player` stays the grid copy (operator) while `crewMember` is re-linked to the roster object (identity) — two fields. (2) The partner has only `partnerMember`, doing double duty as both operator and roster ref. (3) `restoreActiveRun` unconditionally rebound `partnerMember` to the off-grid canonical roster object, so once the partner was a live grid entity (jacked in / jacked out) the flip's `#aliveMeatAlternate` handed control to the off-grid copy (id-match in `world.entities.has` masked it), centering the camera on the roster object's `(0,0)` and denying movement. Fix: `restoreActiveRun` re-binds `partnerMember` to the canonical object **only while it is still off-grid** (a dormant reserve a later jack-in spawns); once it is a live grid entity, keep that entity — mirroring `run.player`. Regression test: `dualDeploy.test.ts` "after jack-out the campaign round-trip keeps the partner on the grid" (identity + flip). **Follow-up (broader, pre-existing):** the detached-grid-copy-vs-canonical-roster split means combat stats applied *after* a mid-run restore land on the grid copy, not the roster object — a latent crew-HP desync across save→restore→play→save for the primary too. Investigate whether job-end reconciliation already covers it; if not, restore should rehydrate the canonical crew objects *as* the grid entities so there is one object, as in live play.

**P3.M4.4 implementation note — AP pools (2026-06-15):** Independent AP pools with a decoupled turn-end, settled from playtest (see the resolved decision above). Two new pure `Run` methods carry the model: **`endOfTurnReady()`** — the active actor is at 0 AP and there is no flip alternate with AP left (`#flipAlternate()` returns the operator `flip()` would hand control to: the other layer's operator while jacked, else the other live meat operator); and **`concludeActiveOperatorTurn(): 'continue' | 'auto-flip' | 'end'`** — `'continue'` while the active actor still has AP, `'end'` once the crew is spent (the shell drives the corp+ICE phases, which refresh every pool once), `'auto-flip'` when the active operator is spent but another still has AP (the method performs the flip; a spent-but-not-end-ready actor guarantees a live alternate with AP, so the flip is always safe). The frozen Decker body is never the active actor nor a flip alternate, so its full pool can't keep the turn alive; solo/single-deploy has no alternate and ends at 0 as before (no M3 regression). Shell: every auto-end-on-exhaustion site (the `applyIntent` `gateOnApExhausted` via new optional `ctx.concludeTurn`, plus consumable / loot / secured-interact) routes through one `concludeOperatorTurn()` helper that switches on the discriminant — `'end'` → `advanceTurn()`, `'auto-flip'` → shared `repaintAfterFlip(run, 'OPERATOR SPENT')` (factored out of `handleFlip`). **Wait** (`end-turn`) zeroes the active operator's AP then routes through a *separate* `passTurn` hook → `Run.passActiveOperatorTurn(): 'flip' | 'flip-and-end' | 'end'` (playtest refinement). Unlike exhaustion, Wait **always** flips to the other operator when one exists (`#flipAlternate` non-null), regardless of that operator's AP — `'flip'` keeps the turn open, `'flip-and-end'` also drives the hostile phases (next turn opens on the flipped-to operator), `'end'` is the solo/single-deploy case; the `?? advanceTurn` fallback keeps a hard end for harness contexts. The shell's `passOperatorTurn` repaints (`repaintAfterFlip(run, 'WAIT')`) on both flip outcomes and additionally `advanceTurn()`s on `'flip-and-end'`. Tests: `operatorTurnConclude.test.ts` (14) and an `applyIntent` `end-turn`-routes-through-`passTurn` case covers the predicate, the three-way conclude, auto-flip-not-end-not-refresh, never flipping to a dead/frozen operator, solo/single-deploy end-at-0, and post-jack-out meat↔meat. **Still open for M4.4:** verify the M3.6 dual-phase corp turn (`dualPhaseTurn.test.ts` was solo-Decker only) holds with the partner+body present — both layers tick once, no double refresh, deterministic with the partner on the field.

**P3.M4.3 implementation note (2026-06-15):** The flip is a free action bound to **Tab** (`keymap` → `{type:'flip'}`; the shell's `handleFlip` validates and flashes a deny when there's nothing to flip to, so the keymap stays dumb). `Run.flip()`/`canFlip()` swap active control: while jacked in, between the controllable meat operator and the cyber avatar (only when the meat side is a real partner, not the frozen solo body); post-jack-out, between the two live meat operators (`#aliveMeatAlternate`). The big seam change is in **`activeView`**: `isJackedIn` ("a cyber layer exists" — body vulnerability, dual-layer turn plumbing) now splits from new **`isCyberView`** ("the player is viewing/controlling the grid" = jacked **and** `activeLayer==='cyber'`). Render, tileset, vision, HUD, gear gates, corp-step render target, breach overlay, and mood/hint all switched to `isCyberView`; `meatActorOf` centers meat fog + the meat HUD pane on the controllable operator (partner after a dual jack-in). Solo cyber runs are unchanged (jack-in sets `activeLayer='cyber'` ⇒ `isCyberView` true everywhere it was `isJackedIn`). **Verification gap:** the shell `handleFlip`/render path has no DOM test harness and the debug harness lacks Cyber/PIP support, so the end-to-end flip needs an in-campaign playtest once a dual-deploy cyber contract is reachable through the live loop. **Follow-up:** no touch-pad flip button yet (keyboard-only); M4.5 still owes the PIP showing the *inactive* layer (today it always shows meat per M3.7, so it's redundant while viewing meat).

**P3.M4.2 implementation note (2026-06-15):** Run-model layer only — the shell/`activeView` wiring and the flip *command* land with P3.M4.3. `jackIn` now captures the Decker as the **body**, freezes it (`Entity.frozen`, enforced in `World.canMoveEntity` → `'jacked-in'`; still a live, targetable grid entity), and — when a partner was reserved — spawns the partner via `#partnerSpawnTile` (deterministic, prefers cells no live hostile can see and that sit against cover; falls back safe → any-free; throws on a full grid), hands it control (`meatActor`), and keeps `activeLayer = 'meat'`. A solo jack-in has no partner, so `meatActor` stays the Decker and `activeLayer = 'cyber'` (M3 behaviour preserved). New `Run` surface: `meatActor` (controllable meat crew), `activeLayer` (`'meat'`|`'cyber'`), `deckerBody` getter, and `activeWorld`/`activeActor` now honor `activeLayer` (via `cyberInputActive`). `player` deliberately stays the Decker/body so body-targeting feedback and the PIP keep reading it. `#finalizeJackOut` unfreezes the body, returns meat control to the Decker, and resets `activeLayer`. Persistence: the off-grid `partner` record is written only while the cyber layer is `dormant` (post-jack the partner is a live grid entity); `activeLayer` is captured while `active`; restore disambiguates the two meat PLAYER crew (Decker = body, non-Decker = partner), re-freezes the body when `active`, and re-establishes `meatActor`/`activeLayer`. **Follow-up:** partner-death flatline accounting (the partner can now die on the field but the campaign doesn't yet flatline it) — must land before M4 closes.

**P3.M4.1 implementation note (2026-06-15):** A Cyberspace dual-deploy reserves a meat partner without spawning it. `Run.partnerMember: Crew | null` (validated non-Decker, living, distinct from the deployed operator) is set at construction; `Run.enterBriefing` forbids a partner on a non-cyber contract but does **not** require one (a solo Decker cyber run stays legal — the dual-deploy product rule is enforced by the briefing UI, not the model). `Campaign.deployCrewMember(memberId, contract, partnerId?)` gains the optional partner, records `Campaign.deployedPartnerId`, commits both operators (both clear job-scoped salvage at `onJobEnd`), and gates the partner (cyber-only, living, non-Decker, distinct, known id). `<run-briefing>` inverts its P3.M3.1 gate: on a cyber contract the Decker row is locked as `CYBER OP` and the player selects the living meat partner (Decker auto-attaches via the emitted `partnerId`); with no eligible partner it falls back to the solo `NEEDS DECKER` gate. Persistence: the reserved partner round-trips as an off-grid entity record (`RunSnapshot.partner`, throwaway `(0,0)` cell) for standalone restore, and re-binds to the canonical crew object via `partnerMemberId` on the campaign path (BRIEFING and COMBAT/RESULT). A partner record without a Cyberspace contract throws on restore. **Follow-up:** partner-death flatline accounting lands with M4.2 (the partner isn't on the field until jack-in); a fully crew-depleted player still cannot field a partner for THE SCORE — revisit if that edge proves too punishing.

**P3.M4.5 implementation note (2026-06-15):** The M3.7 PIP (always the meatspace body CCTV) now renders the **inactive** layer after the simstim flip — the layer the player is *not* driving. `pip.ts` is the pure seam: `pipFeedFor` resolves `'meat'` when viewing cyber and `'cyber'` when viewing meat (absent `activeLayer` defaults to the meat feed, preserving solo/legacy behaviour); `pipWorldOf`/`pipFollowTargetOf`/`pipChrome`/`shouldShowPip` all key off the feed. The meat feed follows the **living partner**, falling back to the Decker's frozen **body** once the partner flatlines (or on a solo Decker run) — chrome labels `PARTNER`/`BODY` accordingly; the cyber feed follows the avatar and reads `// THE GRID //` + `RAM` over a magenta-tinted (`.pip-cyber`) border, with cyber fog (`cyberVision`) and no principal palette. `pointer-events: none` keeps the overlay read-only. **Flash routing fix:** M3.7 routed body-hit feedback to the PIP whenever `isJackedIn`; that was only correct while viewing cyber. `sceneListeners` now routes by *which layer is in the PIP* — meat events (body/partner damage, muzzle, ranged noise) flash the PIP iff `isCyberView` (meat is the inactive feed) and the main canvas otherwise; cyber events symmetrically flash the PIP when viewing meat, including a new `RAM HIT`/`RAM WIPED` pulse so off-screen ICE damage is visible. Tests: `pip.test.ts` rewritten for the inactive-feed resolution + partner/body fallback + cyber chrome (11), and a `sceneListeners.test.ts` case locks the body-hit-routes-to-PIP-only-while-viewing-cyber predicate. **Follow-up:** still no touch-pad flip button (keyboard-only, from M4.3); the end-to-end PIP swap wants a live in-campaign playtest once a dual-deploy cyber contract is reachable (no DOM harness for the render path).

**P3.M4.6 implementation note (2026-06-17):** Forced jack-out now lands on the same resolver as voluntary jack-out: if the frozen Decker body takes Meatspace damage while the cyber layer is active and is driven to **1 HP or below**, `Run.#onEntityDamaged` clamps the body alive at 1 HP, bypasses early-jack-out confirmation (it is not a choice), tears down the cyber layer, burns the jack-in port, returns control to the Decker in Meatspace, and latches the data-node objective at its current progress. Unsliced nodes therefore make the cyber objective permanently incomplete; already-sliced objectives remain complete. This covers both nonlethal hits to exactly 1 HP and lethal hits that `Entity.damage()` had already marked dead before the run listener repaired the body. Snapshot round-trip preserves the resolved cyber latch, burned port, living 1-HP Decker, and post-jack-out meat control. Shell corpse memory now ignores the repaired body even when the raw damage payload said `killed: true`, so the PIP/visibility cache does not record the Decker as a corpse after emergency ejection. Tests: `jackOut.test.ts` (+3 forced-jack-out cases) and `sceneListeners.test.ts` (+1 repaired-body corpse-memory guard).

**P3.M4.6 explicit jack-out key closeout (2026-06-17):** The missing second voluntary path is now bound to **`j`** (`keymap` → `{type:'jack-out'}`; touch pad mirrors it as `JACK OUT`). Unlike routing out through the Cyberspace exit glyph, explicit jack-out always confirms when the shell is wired because it applies `JACK_OUT_SHOCK_DAMAGE = 3` HP neural shock to the Decker's body after the link actually drops. The request is valid from either side of a live dual-deploy jack-in, so the player can eject while controlling the meat partner; it burns the link, resolves/despawns Cyberspace, latches objective progress, and then applies shock. At critical HP, confirmed shock can flatline the Decker, but the save state is still resolved/burned before death settlement — no dead-but-still-jacked-in state. Key help and touch controls both advertise the action. Tests: `jackOut.test.ts` (+3 explicit-key cases), `keymap.test.ts`, `applyIntent.test.ts`, `touchpad.test.ts`, and `keyHelp.test.ts`. Closes P3.M4.

**Acceptance:**

- Dual-deploy: two operators on two grids, each controllable.
- Flip switches active control; inactive operator holds position; both hostile phases tick.
- PIP renders inactive layer (at minimum: grid + entities + operator status).
- Decker body vulnerable in Meatspace while jacked in; body at 1 HP = forced jack-out, while cyber avatar death still flatlines the Decker.
- Jack-out despawns Cyberspace grid cleanly.
- Snapshot: both grids, both operators, flip state; restore round-trip mid-mission.
- Golden-path test: deploy → jack in → flip between layers → complete objectives in both → extract.

---

### P3.M5 — The Score (climactic mission) ✅

**Depends on:** P3.M1 (arc structure), P3.M4 (simstim flip), P2.5.M7 (location persistence for the target site).

**Goal:** The **climactic dual-layer mission** that the entire campaign builds toward. The Score is a contract at the designated target site, requiring both Meatspace breach and Cyberspace penetration to complete.

**Status (2026-06-20):** Complete for the M5 scope. The finale ships as one linked Cyberspace core node and one locked Meatspace route/payload pair, with independent operative extraction and terminal win/partial/loss campaign outcomes. The schema remains open for future multiple node/lock pairs, but M5 deliberately ships exactly one pair.

**Scope:**

- **Score contract:** A special `score-final` objective emitted by `Campaign.buildScoreContract()` only when Act 3 Score gates pass. It is not randomly rolled — player-initiated from the Hub — and it uses the persisted Score target site's dimensions, breach deltas, seen tiles, and site memory.
- **Dual objectives:** The Score has objectives in **both** layers:
  - **Meatspace:** Reach the locked Score route, enter the objective room after the core unlock, secure the Score payload, protect the Decker's body, and extract both deployed operatives.
  - **Cyberspace:** Jack in, slice the single Score core data node, and jack out or continue coordinating the Meatspace finish.
  - Both layer objectives plus both deployed operatives extracting alive are required for clean completion. Confirmed early/one-layer extraction is terminal partial completion, not a retry path.
- **Site knowledge payoff:** The target site uses P2.5.M7's persistent geometry. Every prior visit's breaches, mapped rooms, and learned patrol routes carry over. The player who cased the site thoroughly has a significant advantage.
- **Escalated difficulty:** The Score is harder than any normal contract — more hostiles, tighter turn budget, more ICE, higher stakes. Failure = campaign loss (crew wipe or objective irrecoverably failed).
- **Independent extraction:** Score runs persist `extractedOperativeIds`. A deployed Meatspace operative who reaches the exit after objectives are complete is marked extracted and removed from active control/targeting; the run continues until the remaining required operative also extracts. Either the meat partner or the Decker body can leave first. Early exit before full objectives uses the existing confirmation path; confirmed extraction ends the campaign as partial.
- **Terminal outcomes:** Full Score extraction sets `score-complete`, marks the campaign as a win, and awards the full `1,000 Cr` Score payoff. Confirmed partial extraction sets `score-partial`, marks the campaign result as `partial`, and awards no full Score payoff. Decker flatline during the Score remains `decker-flatlined-score`; crew wipe remains terminal loss.
- **Narrative climax:** The Score's briefing, objective copy, and completion/partial/failure text reflect the campaign's arc. The chronicle (P3.M6) records the outcome as the campaign's defining moment.

**P3.M5 implementation note (2026-06-20):** `OBJECTIVES.SCORE_FINAL` is validated separately from normal `data-node-slice` contracts and requires `requiresCyberspace: true`, a positive `count`, and a stable linked `doorId`. `DataNode` emits `EVENT.DATA_NODE_SLICED`; Score runs listen for that event and unlock the linked Meatspace door once the core node is sliced. Score objective satisfaction is a conjunction of cyber core progress and secured payload state; extraction is a separate requirement handled by `Run.#extractScoreOperative`. Snapshot/restore persists the extracted operative ids plus off-grid extracted operative records so mid-finale saves can restore a partner-first or body-first extraction state without resurrecting the extracted crew onto the grid. `Campaign.onJobEnd` maps incomplete Score exits to `score-partial`, skips the normal abort Rep penalty, and ends the campaign without the Score reward; `buildCampaignSummary` now reports `win | partial | loss`, and `<game-over>` renders distinct compromised-Score copy.

**Acceptance:**

- ✅ Score contract available only in Act 3, player-initiated, and gated by living Decker + living non-Decker partner.
- ✅ Dual-layer objectives: Meatspace payload + Cyberspace core both required for clean completion.
- ✅ Target site uses persistent geometry from prior visits (P2.5.M7 dimensions, breach deltas, and seen tiles present).
- ✅ Completion = campaign win with Score reward; confirmed partial = terminal partial result with no full reward; Decker flatline / crew wipe remain campaign loss.
- ✅ Golden-path and persistence tests cover full Score deployment, linked door unlock, partner-first extraction, mid-Score restore, early partial extraction, campaign partial settlement, and summary/game-over validation.

---

### P3.M6 — Stolen Blueprints (shop rework + meta-progression) 🔲

**Depends on:** P3.M5 (Score completion path — unlock writes to meta-store on `score-complete`); P2.5.M5 (existing shop/rep system being replaced).

**Goal:** Replace rep-gated shop access with a **meta-progression unlock system** rooted in successful Score heists. The item catalog is restructured into two explicit groups: **default items** (always available) and **scoreable items** (each a distinct Score target, unlocked permanently by stealing its blueprint). An enriched scoreable pool (8–12 items total, at least 5 net-new) means multiple campaigns have distinct heist targets before the pool exhausts; once exhausted, Scores shift to abstract RNG-driven credit payloads that keep the arc alive indefinitely.

**Scope:**

- **Data model change:** The current `minRepTier` property on items is retired as a shop-access mechanism. Items are reorganized into two fixed compile-time catalogs:
  - **`DEFAULT_ITEMS`:** Items previously flagged `BURNED` or `UNKNOWN` `minRepTier`. Always available in Finn's shop; no condition, no gate.
  - **`SCOREABLE_ITEMS`:** Items previously flagged `KNOWN` `minRepTier`, plus at least 5 net-new items added as part of this milestone. Each has a unique ID, a name, stats, and a short flavor line describing what was stolen (the prototype, the implant design, the weapons schematic). Not available in the shop until unlocked via a Score heist.
  - `minRepTier` can be safely removed from item definitions, as it no longer influences shop availability after this milestone, and is not referenced elsewhere.

- **Finn's shop rework:** Rep no longer gates shop inventory.
  - `DEFAULT_ITEMS` always stocked from campaign start.
  - Unlocked `SCOREABLE_ITEMS` added to stock permanently once acquired; locked scoreable items are not shown at all. The discovery of a new item appearing in Finn's shop after a Score is the reward.
  - Shop variance = which scoreable items the meta-crew has acquired across all past campaigns. Rep meter decoupled from shop access (still drives arc transitions as before).

- **Score target rework:** `buildScoreContract()` draws from the set of not-yet-acquired `SCOREABLE_ITEMS`. The Score target site is still a synthesized CRITICAL-tier facility, but briefing copy and objective text frame the site around the specific payload — the R&D lab, the secure vault, the production facility where the prototype lives. On clean `score-complete`, the item ID is written to the meta-progression store and the item becomes permanently available in Finn's shop.

- **Abstract Score targets (pool exhausted):** When all `SCOREABLE_ITEMS` are acquired, `buildScoreContract()` shifts to abstract RNG-driven credit payloads drawn from a small fixed category set (corp payroll, exotic meta-materials, black-market data cache, prototype weapons cache, etc.). Payload category is seeded from the contract RNG so each exhausted-pool campaign gets different flavor. The full arc structure runs identically; the payout is a substantial credit sum rather than a shop unlock. No item is written to the meta-store.

- **Meta-progression store:** New `DataStore` key `unlockedScoreableItems: string[]` (item IDs, ordered by acquisition date). Written only on `score-complete` (not `score-partial` — the prototype wasn't secured). Read at campaign init and Hub load. Idempotent archival: writing a duplicate ID is a no-op (no throw, no double-entry). Half-populated or structurally invalid store throws on restore rather than silently falling back to an empty list.

- **Hub surface:** Finn's shop renders only purchasable items — `DEFAULT_ITEMS + unlockedScoreableItems`. An `ACQUISITIONS: N / M` counter is deferred to P3.M7, where it fits naturally in the Chronicle / history view.

**Implementation slices:**

| Slice | Status | Change | Tests |
|---|---|---|---|
| **P3.M6.1 Meta-store** | ✅ | `DataStore` key `unlockedScoreableItems`; read at campaign init; idempotent archival; duplicate no-op; corrupt throws | round-trip, idempotent archival, duplicate no-op, corrupt throws |
| **P3.M6.2 Item catalog split** | ✅ | Define `DEFAULT_ITEMS` and `SCOREABLE_ITEMS` catalogs; retire `minRepTier` as shop gate; add at least 5 net-new scoreable items (fully wired gear) | catalog validation, no duplicate IDs, all items have required fields, `minRepTier` not read by shop |
| **P3.M6.3 Shop rework** | ✅ | Shop stocks `DEFAULT_ITEMS + unlockedScoreableItems`; no rep gate; locked scoreable items not rendered | shop shows only default items when meta-store is empty; adds unlocked scoreable items as they accrue; rep change has no effect on stock |
| **P3.M6.4 Score target rework** | ✅ | `buildScoreContract()` draws from unacquired `SCOREABLE_ITEMS`; briefing copy reflects item; completion writes meta-store | available targets exclude acquired; retired items not rolled; store updated on complete |
| **P3.M6.5 Abstract targets** | ✅ | Exhausted-pool Score draws RNG credit payload from category set; seeded flavor; arc gates pass with empty scoreable pool | category selection determinism, arc unaffected, no meta-store write |
| **P3.M6.6 Hub surface** | ✅ | Shop renders only purchasable items; no locked placeholders | shop never renders a locked scoreable item regardless of meta-store state |

**P3.M6.1 implementation note:** The meta-progression store lands as a new
`DataStore` key, `unlockedScoreableItems: string[]` (item IDs, acquisition order,
newest-last), backed by a pure validator module `src/game/scoreableUnlocks.ts`
(mirroring the `campaignSummary.ts` ⇄ `DataStore` relationship):
`normalizeUnlockedScoreableItems` (absent → `[]`, non-array/non-string-element throws,
de-dupes preserving order) and `archiveScoreableItem` (idempotent append, duplicate →
`{ added: false }`). `DataStore.archiveScoreableItem(id)` only emits a `change` event /
saves when the store actually changes (matching `archiveCampaign`'s `added` gate); the
getter returns a defensive copy. Per the global "crashing beats data corruption"
directive, `#loadDataFromJson` was split so an unparseable blob still resets to defaults
but a **structurally corrupt (yet parseable) scoreable store throws** out of
`init`/`import` rather than silently erasing earned blueprints. Structural validation
only — catalog membership (id ∈ `SCOREABLE_ITEMS`) is a follow-up once that catalog
exists in M6.2. The `score-complete` write call-site lands in M6.4. **Follow-up:**
`campaignHistory` keeps its older swallow-and-reset-on-corrupt posture (deliberately not
retrofitted in this slice). Tests: `scoreableUnlocks.test.ts`, plus three
`DataStore.test.ts` cases (absent → `[]`, idempotent archival + persistence + defensive
copy, corrupt store throws).

**P3.M6.2 implementation note:** The single rep-gated `CATALOG` was split into two
frozen arrays — `DEFAULT_ITEMS` (the four always-available consumables: Stim, Smoke,
Incendiary, Breaching Charge) and `SCOREABLE_ITEMS` (the four former KNOWN-tier gear
items plus **five net-new prototypes**). `minRepTier` was removed from the `Item` type
and every descriptor; `getShopCatalog()` now takes no rep argument and returns a fresh
copy of `DEFAULT_ITEMS` only (the unlocked-scoreable merge is M6.3's seam). `getItemById`
searches both catalogs; `SCOREABLE_ITEM_IDS` (a frozen `Set`) is exported for M6.4's
pool membership checks. Each scoreable item carries a `flavor` line (the stolen-prototype
fiction) for M6.4 briefing copy.

Rather than scale the existing four gear channels, the **five net-new items each fill a
stat channel no crew gear previously touched** (a deliberate design choice — a heist reward
should be a new capability, not a bigger number). Premium "bigger X" variants were
explicitly rejected in design review: with random unlock order and no equip limit, a
premium can arrive before its base and double-buying the base is identical, so the variant
adds nothing.
- **Monoblade** (`+1 melee dmg`) — the Razor's signature attack had zero gear support.
  New `gear.meleeDamageBonus`, applied via a new `Crew.meleeAttackDamage()` that mirrors
  `rangedAttackDamage()`; `Combat.attackerMeleeDamage` now prefers that method.
- **Subdermal Plating** (`+1 damageReduction`) — the flat-armour channel (min-1 floor in
  `Combat.applyDamageReduction`) existed but no crew gear set it. The live `damageReduction`
  stat is the source of truth; `gear.armorBonus` tracks it for cap-clamping. This stat was
  **not** carried by the campaign-crew snapshot, so `snapshotCrewMember`/`restoreCrewMember`
  were extended to persist it (the in-job entity snapshot already round-tripped it).
- **Reflex Booster** (`+1 maxAp`, hard-capped at 1) — the master action resource. `maxAp`
  already round-trips on both save paths; `gear.apBonus` tracks. Immediate benefit (the
  extra AP is usable the same turn), matching Armour Plating's `+hp`.
- **Phase Shield Prototype** (`+1 shield/turn`) — re-grants `shieldHp` at the start of each
  crew turn via a new `Crew.refreshAp()` override (the same hook the Razor uses to clear
  stealth; `super.refreshAp` zeroes the shield, the override tops it back up). Free and
  uncontested, unlike the Medic's AP-costed `MEDIC_SHIELD_HP`, so kept to +1.
- **Regen Mesh** (`+1 HP/turn`) — heals real HP up to max each turn via the same refresh
  hook; slow in-combat sustain distinct from the shield's resettable buffer.

`refreshAp` regen is guarded (`alive` + amount `> 0`) so a flatlined body regenerates
nothing (`heal`/`addShield` would otherwise throw on a corpse). The five new `Gear` fields
are optional (`?? 0` reads) so pre-M6.2 gear snapshots restore cleanly; `repairGearForCrew`
clamps the capped bonuses. Capped items follow the Ballistics Coil pattern (bonus = cap → a
duplicate purchase is a harmless no-op). **Known transitional state:** between M6.2 and M6.3
the shop shows only `DEFAULT_ITEMS`, so the former KNOWN gear is temporarily unbuyable until
the M6.3 unlocked-item merge lands.

**Defense HUD follow-up (2026-07-13):** the active Meatspace HUD now groups defenses beside
HP: Phase Shield is a live `SH ◆` / spent `SH ◇` resource, while Subdermal Plating remains a
persistent numeric `ARM 1` modifier. Unequipped channels are omitted, so absent and spent
shield states cannot be confused. Connected ranged/melee hits now carry an explicit damage
resolution (`incomingDamage`, armor absorbed, shield absorbed, real HP damage); hostile-turn
copy surfaces the layers only when armor or shield actually changes the outcome. Combat entry
runs the normal first-player-turn refresh, so an equipped Phase Shield begins charged rather
than appearing spent until round two. The HUD's screen-reader summary exposes the same states;
fully absorbed body hits retain the impact shake and replace the red damage vignette/PIP pulse
with the stopping defense's HUD color (shield takes precedence when both layers contribute).
SW cache **`0.3.2b`**.

**Follow-up (kaizen, tabled):** a **revive** path — un-flatline a crew member at the Hub for
a steep Cred cost, zeroing their gear (and resetting the derived maxHp/maxAp/damageReduction
to archetype base). Pure Hub economy + narrative, no combat-mechanics implications. Needs a
new `Campaign.reviveMember()` and a delivery surface (Clinic service vs. Finn purchase — the
shop target-picker currently excludes flatlined crew). Deferred to its own slice; revisit
after M6.3/M6.4.

**P3.M6.3 implementation note:** `getShopCatalog(unlockedScoreableIds = [])` now returns
`DEFAULT_ITEMS` plus the `SCOREABLE_ITEMS` whose ids appear in the supplied unlock list
(membership via a `Set`); rep is structurally gone (no parameter). `Finn.catalog()` is a
thin passthrough. The shell reads the meta-store **live** at shop-open time
(`presentFinnShop` → `dataStore.unlockedScoreableItems`) rather than caching it at campaign
init — a refinement of the M6.1 "read at init/Hub load" sketch. This is simpler and always
correct, and the practical difference is nil: the only in-campaign unlock path is completing
the climactic Score (M6.4), after which the player doesn't return to shop. **Lenient
membership:** an unlocked id that isn't a known scoreable item (a retired or
forward-version blueprint) is silently skipped, not thrown — the shop can't render a
nonexistent item, and hard-failing would brick saves across catalog changes. This resolves
the M6.1 "catalog membership validation" follow-up in the shop layer (the store stays
structural-only). The `buildScoreContract` acquired-set exclusion (which also needs the
unlock list) lands in M6.4; it will read the same `dataStore.unlockedScoreableItems`.

**P3.M6.4 implementation note:** `buildScoreContract(unlockedScoreableIds = [])` now draws a
specific heist payload via `pickScorePayload(seed, acquired)` — `SCOREABLE_ITEMS` minus the
acquired ids, selected with a `Rng` seeded from the target seed XORed with a salt
(`SCORE_PAYLOAD_SALT`) so the choice is deterministic per campaign yet independent of the
map roll. Retired/foreign ids in the acquired list simply aren't in the pool, so they're
never rolled. The chosen blueprint's `flavor` + `label` frame the briefing, and its id rides
in `objective.params.scoreItemId` (a plain `ObjectiveParams` string that `cloneObjective`
preserves across a mid-run save/restore). On clean `score-complete`, `onJobEnd` reads that id
off the completing contract and records it on `meta.scoreUnlockedItemId` (alongside the
existing `meta.scorePartial`), exposed via the `Campaign.scoreUnlockedItemId` getter
(validated against `SCOREABLE_ITEM_IDS`). The shell writes it to the meta-store in
`presentEndedCampaignOverlay` — the shared terminal-settlement chokepoint for both live
completion and a restored already-ended save — right beside `archiveCampaign`, and the write
is idempotent so the double path is safe. Partial Scores record nothing (prototype not
secured). **Exhausted pool:** `pickScorePayload` returns `null`, the contract drops the
`scoreItemId` param and falls back to generic briefing with no unlock — the abstract
credit-payload Score is M6.5.

*Messaging polish (playtest feedback):* the Score payload pickup is now labelled with the
target blueprint and carries its `flavor` (new optional `Pickup.detail`, persisted), so the
grab logs e.g. `secures Monoblade` followed by the flavor beat. The stolen blueprint is
captured **in the `CampaignSummary`** as an optional, self-contained `scoreReward`
(`{ id, label, flavor }`) — `buildCampaignSummary` resolves it from `scoreUnlockedItemId`,
and `<game-over>` reads it straight off the summary on a win. Persisting it (rather than a
presentation-only setter) seeds the **M7 Chronicle**, which will surface acquisitions from
history. `validateCampaignSummary` gained a `requireKeys(required, optional)` helper so the
schema tolerates the new optional field (and future ones); the reward is validated
self-contained and round-trips through clone. Abstract / exhausted-pool Scores carry no
`scoreReward` and keep the generic "Score payload" pickup.

**P3.M6.5 implementation note:** When `pickScorePayload` returns `null` (every
scoreable blueprint already stolen), `buildScoreContract` now draws an abstract
credit payload via `pickAbstractScorePayload(seed)` instead of the old flat
generic line. The pick is seeded from the **Score target site seed** XORed with
its own salt (`ABSTRACT_SCORE_PAYLOAD_SALT`, distinct from `SCORE_PAYLOAD_SALT`),
so the category is deterministic per campaign and independent of both the map
roll and the (empty) blueprint draw. `ABSTRACT_SCORE_TARGETS` is a frozen set of
`{ id, label, flavor }` categories (liquid reserves, bearer bonds, slush fund,
cold-wallet keys, payroll skim) — "you've stolen everything worth stealing; now
you're just taking their money." The abstract briefing is framed from the chosen
category's `flavor` + `label`. Crucially the contract carries **no
`scoreItemId`**, so a clean abstract Score settles the arc (`score-complete`,
`SCORE_CREDITS_REWARD` paid) exactly like a blueprint Score but
`scoreUnlockedItemId` stays `null` and the terminal-settlement meta-store write
is a no-op. The Score payload pickup keeps its generic "Score payload" label with
no flavor (the M6.4 Run-side fallback already handles a missing id). Arc gating
never read the scoreable pool, so "arc unaffected with an empty pool" is
structural — the new test exercises it end-to-end (build → deploy → complete)
for regression cover.

**P3.M6.6 implementation note:** The substantive hub-surface change — stock is
`DEFAULT_ITEMS + unlocked scoreable` with locked blueprints filtered out — landed
in M6.3's `getShopCatalog`, the single filtering chokepoint. `<finn-shop>` renders
strictly the catalog handed to `setCatalog` (grouped by scope; unaffordable rows
are disabled, never locked), and `presentFinnShop` is the only caller — it always
feeds `Finn.catalog(dataStore.unlockedScoreableItems)`. So there was **no new
production code** for M6.6; the milestone is the hub-surface regression cover the
acceptance names. The guard is a meta-store **state sweep** at the `Finn.catalog`
boundary (empty / one unlock / all unlocked / ghost ids / duplicates) asserting a
scoreable is stocked iff unlocked and never as a locked placeholder, plus a
companion check that every surfaced row is a real purchasable item (default or
unlocked scoreable). `<finn-shop>` renders only the catalog handed to
`setCatalog`, so the boundary filter is the invariant's single seam. The deferred
`ACQUISITIONS: N / M` counter remains an M7 Chronicle concern. **M6 complete.**

**Recorded design decisions:**

- **Why `minRepTier` is retired as a shop gate:** Rep-gated access was mechanical — the best gear was reachable by grinding rep without doing anything interesting. Two explicit catalogs make availability rules legible in the data rather than computed from a tier comparison at runtime.
- **Why default items are fixed:** The interesting question is "which upgrades has the meta-crew earned?" not "will Finn have ammo today?" Fixed default stock removes friction and keeps meaningful variance on scoreable unlocks.
- **Why abstract payloads instead of pool reset:** Resetting would retroactively devalue past heists. Abstract payloads acknowledge mastery — "you've stolen everything worth stealing; now you're just taking their money" — while keeping the arc valid indefinitely for long-running meta-campaigns.
- **Why partial Score doesn't unlock:** Incomplete extraction means the prototype wasn't secured. Clean win only; the fiction holds.

**Acceptance:**

- Finn's shop never gates by rep; `DEFAULT_ITEMS` always present from campaign start.
- Unlocked `SCOREABLE_ITEMS` appear in shop; locked ones are not rendered.
- `buildScoreContract()` excludes acquired scoreable items; draws abstract credit payload when pool is exhausted.
- Meta-store persists across campaign boundaries; duplicate ID writes are no-ops; corrupt store throws.
- Golden-path test: complete Score with scoreable item target → next campaign shows item in Finn's shop and excludes it from Score target pool.

---

### P3.M7 — Chronicle (campaign narrative memory) ✅

**Depends on:** P3.M1 (arc structure provides the narrative beats to chronicle). Can begin data collection earlier if arc state is available.

**Goal:** Ground the campaign's **resource + consequence** loop in something the player can **re-read**: a persisted **chronicle** of the active campaign, and a **durable summary** when a campaign ends. Deferred from P2.5.M3 — the chronicle needs the campaign arc to be meaningful.

**Scope:**

- **Active campaign chronicle:** Entries for each run (jobs taken, outcomes, objectives completed/failed, major Rep deltas, crew changes, Decker recruitment, Score prep milestones, Score target blueprint / credits stolen when all items are unlocked) stored **in the campaign save**.
- **Arc-aware entries:** Chronicle entries reflect the campaign's narrative arc — Act 1 entries read as "getting established"; Act 2 entries reference the Score target; Act 3 entries build tension toward the climax.
- **Presentation:** Surfaced from a new Hub entry point (not the existing crew terminal: it remains focused on crew stats, inventory, and recruiting).
- **Campaign end summary:** On win (Score completed) or loss (flatline / clock expired), roll up a **summary record** into a **persistent history** list (localStorage / DataStore — same durability pattern as runs/prefs). High-scores-style: scannable list with campaign stats, arc outcome, run count, crew roster at end.
- **History access:** Hub waypoint or menu entry to view past campaign summaries. Viewable without an active campaign.
- **Acquisitions counter:** The Chronicle / history view surfaces an `ACQUISITIONS: N / M` counter showing how many scoreable item blueprints the meta-crew has stolen across all campaigns (read from `unlockedScoreableItems` in the meta-store). The shop itself shows only purchasable items; this is the right place to communicate meta-progression depth.

**Acceptance:**

- New job appends chronicle entry; campaign load restores full chronicle.
- Chronicle entries reflect arc state (act, Score prep status).
- End-of-campaign (win or loss) produces one summary row in persistent history.
- Hub can open chronicle (active campaign) and history (past campaigns) without errors.
- Tests for append + round-trip + cap/trim policy if the list is bounded.

**P3.M7 implementation note:** Shipped. The Chronicle now persists active-campaign entries in the campaign save, recording crew assembly, Decker recruitment, arc transitions, and job outcomes with stage-aware copy. The Hub exposes a dedicated `LOG` entry point that opens a Chronicle/archive modal rather than reusing the crew terminal. That surface shows the live campaign log, current arc status lines, archived `CampaignSummary` history, and an `ACQUISITIONS: N / M` meta-progression counter sourced from `unlockedScoreableItems`. The end-summary foundation remains the archival backend: a validated `CampaignSummary` is still built only after campaign settlement reaches `ENDED`, stored newest-first, deduplicated by campaign id, and trimmed to 50 history rows. Chronicle state round-trips through snapshot restore, including pending run context so job entries still settle correctly after reload.

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
