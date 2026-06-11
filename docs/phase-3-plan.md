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
- The flip is a **free action** (or 1 AP — TBD). The PIP / CCTV window from the blueprint shows the inactive layer in miniature.

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
| P3.M3 — Cyberspace grid + ICE | 🟡 First playable slice shipped (Spark/Guardian ICE open) |
| P3.M4 — Simstim flip (dual-deploy) | 🔲 Planned |
| P3.M5 — The Score (climactic mission) | 🔲 Planned |
| P3.M6 — Chronicle (campaign narrative memory) | 🔲 Planned |

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
| **P2.5.M5** (economy/rep) | KNOWN rep tier defined and reachable | Phase 3 gates Decker recruitment and Score access at `rep >= 50` (KNOWN floor; TRUSTED qualifies) |
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
  - Act 1 → Act 2: reach at least `KNOWN` rep tier (`rep >= 50`) + minimum successful job count (recommended: `completedJobs >= 4`). Triggers Score reveal and Decker recruitment (same beat).
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
  - **Win:** Complete the Score (extract with objective satisfied from the final mission). Terminal debrief: `*** SCORE COMPLETE ***`.
  - **Loss (flatline):** Entire crew wiped during any run (existing behavior, but now with arc context for the chronicle).
  - **Loss (clock):** `clockJobsTaken >= CLOCK_ACT2_DEADLINE_JOBS` (8) before `scoreAttempted`. Terminal debrief: `*** WINDOW CLOSED ***` — not a status-line footnote. Attempted Score keeps the deadline from retroactively killing the save.

**The Clock mechanic:**

The Clock creates mounting pressure that discourages indefinite grinding in Act 2/3. **Shipped implementation:** Act 2/3 **deploys taken** (successful or not) drive heat and the hard deadline — not global `completedJobs`, so entering Act 2 with a high job count from Stage 1 does not immediately start the Clock.

- `CLOCK_ACT2_GRACE_JOBS = 3` — first three Act 2/3 deploys are grace (no heat, no `clockStarted`)
- `CLOCK_HEAT_WINDOW_JOBS = 5` — deploys after grace before the window closes
- `CLOCK_ACT2_DEADLINE_JOBS = 8` — total Act 2/3 deploys (`grace + window`)
- `clockJobsTaken` increments on `deployCrewMember` while `arcStage` is `act-2` or `act-3` (Score deploy excluded — it sets `scoreAttempted`)
- `clockStarted` when `scoreRevealed && clockJobsTaken >= CLOCK_ACT2_GRACE_JOBS`
- `clockHeat = max(0, clockJobsTaken - CLOCK_ACT2_GRACE_JOBS)` once started
- Heat nudges Curator threat counts upward, capped per difficulty tier
- Returning to Hub at the deadline without `scoreAttempted` sets `Campaign.state` to `ENDED` with `endReason: 'clock-expired'` and presents the terminal game-over screen

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

**P3.M1.2 implementation note:** Hub entry now runs a monotonic arc transition evaluator. Act 1 advances to Act 2 at `rep >= ARC_ACT_2_MIN_REP` (50 — the KNOWN tier floor) plus `completedJobs >= 4`, sets `scoreRevealed`, and auto-assigns a Decker to the crew. Higher rep tiers qualify too: a save that overshoots KNOWN into TRUSTED before the job gate is crossed must not stall in Act 1 (an early implementation checked for the KNOWN tier band exactly, which blocked TRUSTED saves). Act 2 advances to Act 3 once `completedJobs >= 9`, at least 4 non-flatlined crew, and at least 3 visited roster sites sharing the Score target's principal (including the target itself). The crew gate counts living members only — attrition blocks advancement. Successful extractions increment `completedJobs`, abort extractions do not. M1.2 does not synthesize the Score target — that remains P3.M1.3.

**P3.M1.3 implementation note:** Score reveal always synthesizes a new CRITICAL-tier site from Curator lexicon `corp` principal and `corp/data/security/infrastructure/hidden` site tokens. Existing roster sites are never promoted — the Score is always a location the player hasn't visited yet. The synthesized site gets `scoreTarget: true`, `tier: 'score'`, and CRITICAL-footprint dimensions to support escalated hostile placement. Multiple persisted score targets, or score-tier sites missing `scoreTarget`, throw during Hub-entry arc evaluation.

**P3.M1.4 implementation note:** Score reveal is player-visible. A one-shot `score-reveal` Hub reveal lets the Curator name the target, introduce the Decker, and teach the **CASING** job-board badge (same-principal org jobs during Act 2+). **SCORE SITE** still marks contracts whose `locationSiteId` matches the synthesized Score target. Arc briefings (`score-reveal`, `clock-reveal`, `act-3-reveal`) are priority Hub reveals: they are evaluated before lower-priority intros (Finn, clinic, terminal-recruit) so a mid-save act transition is not crowded out on the same visit. Their `hubReveals` flags commit on Curator briefing **dismiss** (`commitHubReveal` in the shell), not when `enterHub` queues the copy — so a missed modal can retry on the next Hub entry, and pre-P3 saves that qualify for Act 2 on first load under 3.0 are not silently bumped without the narrative beat. The shell resume path presents any pending `lastHubReveal` when restoring a HUB save. The Hub status row and Terminal crew roster show the current stage label (user-facing "STAGE N") plus Score target once revealed. Shared `arcSurface` helpers own the copy and invariant checks so multiple Score targets, or revealed Score state without a target, fail loud instead of rendering misleading UI.

**P3.M1.5 implementation note:** The Clock is driven by `clockJobsTaken` (Act 2/3 deploys), not `completedJobs` — entering Act 2 with many Stage 1 extractions does not start heat immediately. Grace: `CLOCK_ACT2_GRACE_JOBS` (3) deploys; then `clockStarted` and heat accrue until `CLOCK_ACT2_DEADLINE_JOBS` (8). A `clock-reveal` Hub briefing explains heat, the operational window, and what happens when it closes (copy in `clockRevealLines`). Clock HUD text appears only after `clockBriefingPresented` **and** `clockStarted`: `CLOCK: HEAT X / Y JOBS LEFT` on the canvas HUD, Terminal roster, and status bar. No "dormant" or "N jobs to heat" lines before the player has seen the briefing. Heat raises Curator threat counts without changing difficulty tier, capped per tier. Deadline loss sets `Campaign.endReason` to `clock-expired` and shows a dedicated terminal game-over screen (`*** WINDOW CLOSED ***` via `<crash-dump>`), not a clock status footnote. Score win uses `*** SCORE COMPLETE ***`; crew wipe keeps the existing campaign-terminal death path. An attempted Score keeps the deadline from retroactively killing the save.

**P3.M1.6 implementation note:** `Curator.generateContracts` now uses campaign-derived arc context behaviorally. Act 2 guarantees at least one fresh same-principal casing job for the Score target's organization. Act 3 guarantees a mostly same-principal prep board. The normal board avoids rolling the Score target itself so the finale stays a deliberate Hub action.

**P3.M1.7 implementation note:** Act 3 exposes a special `THE SCORE` contract through `Campaign.buildScoreContract()`, appended to the Hub job choices only when `Campaign.canAttemptScore()` passes. The first qualifying Hub visit also fires `act-3-reveal` ("You're ready… grab THE SCORE from the board while you can") before the player sees the fourth board slot. Deploying THE SCORE marks `scoreAttempted`, moves `arcStage` to `score`, uses the persisted Score target dimensions/memory, and completing it marks `scoreCompleted` and ends the campaign in a win state.

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

### P3.M3 — Cyberspace grid + ICE 🟡

> **Status (2026-06-11):** the first playable slice (M3.1–M3.6, plus voluntary
> jack-out pulled forward from M4.6 and an early-jack-out confirmation) is
> shipped end-to-end on `3.0-cyberspace` — see
> [phase-3-cyberspace-plan.md](phase-3-cyberspace-plan.md) for slice notes and
> recorded scope decisions. The milestone stays open for **Spark and Guardian
> ICE**. The Score contract is now always a cyber run (scope decision #5).

**Depends on:** P3.M2 (Decker as the Cyberspace avatar). Can prototype grid mechanics independently.

**Goal:** The second tactical layer — a **Cyberspace grid** with its own geometry, traversal rules, and hostile AI (**ICE** — Intrusion Countermeasure Electronics). Generated fresh per jack-in (not persistent across runs).

**Scope:**

- **Cyberspace grid:** Separate `Grid` / `World` instance for the digital layer. **First implementation should reuse the existing square grid engine** with a distinct tileset and generation rules, then reserve a later graph-topology refactor only if the square grid fails the feel test. This keeps pathfinding, rendering, snapshots, and tests inside known machinery.
- **Cyberspace tileset / aesthetic:** Distinct from Meatspace. Nodes, data lines, firewalls, open channels. ASCII glyphs TBD but visually differentiated (color palette, glyph set, CRT effects).
- **ICE hostiles:** Three types per blueprint:
  - **Probe:** Sentry / patrol. Detects the Decker, raises alert (Cyberspace alarm analog).
  - **Spark:** Fast, fragile attacker. Swarm behavior.
  - **Guardian:** Heavy. Guards critical nodes. High HP, high damage, limited mobility.
- **ICE AI:** A* pathfinding (reuse Meatspace drone infrastructure with Cyberspace-specific cost maps). Alarm/alert model adapted from P2.5.M2.1 for the digital layer.
- **Cyberspace objectives:** What the Decker *does* once jacked in — slice data nodes, disable firewalls, open digital locks. Reuses `Interactable` patterns from P2.5.M2.2 adapted for Cyberspace.
- **Generation:** Procedural per jack-in. Seeded from contract + campaign RNG. Not persistent (fresh each time). Complexity scales with contract difficulty / act.
- **Jack-in trigger:** Decker interacts with a Meatspace terminal (P2.5.M2.2 `Interactable`). This spawns the Cyberspace grid and activates dual-deploy mode (P3.M4).

**Entering Cyberspace — first playable slice:**

The first jack-in should prove the door between layers before shipping every ICE behavior:

1. Add a `requiresCyberspace` / `cyberspaceObjective` contract param for Act 2+ jobs, generated only when the Decker has been recruited.
2. Place a Meatspace jack-in terminal using the existing `Terminal` / interactable placement path, distinct in label from ordinary terminal-slice props.
3. When the Decker interacts with the jack-in terminal, create a `cyberspace` run layer with:
   - generated grid and seed metadata,
   - Decker digital avatar,
   - one data node objective,
   - at least one Probe ICE.
4. Latch a run state like `cyberspace.active = true`; repeated jack-in attempts against the same terminal throw or log a deterministic "already linked" message depending on whether state is corrupt or just redundant input.
5. Saving mid-jack-in restores both Meatspace and Cyberspace. Absent or malformed Cyberspace snapshot data for an active jack-in is tier-1 corrupt state and must throw to the boundary.

**Suggested slice order:**

| Slice | Change | Tests |
|---|---|---|
| **P3.M3.1 Contract flag** | Add Cyberspace-capable contract metadata and validation | generated only Act 2+, invalid flag/params throw |
| **P3.M3.2 Jack-in terminal** | Place a terminal that can start the digital layer | deterministic placement, no collision with objective props |
| **P3.M3.3 Cyber layer model** | Add serializable `Run.cyberspace` layer with grid/world/avatar | snapshot round-trip, active-layer invariants |
| **P3.M3.4 Data node objective** | Slice one data node and feed objective satisfaction | incomplete blocks clean extraction, complete allows it |
| **P3.M3.5 Probe ICE** | Minimal ICE patrol/detect/attack loop | seeded movement, detection/alarm, damage/death |
| **P3.M3.6 Render swap** | Render Cyberspace when active; Meatspace remains reachable for P3.M4 | browser smoke and console-clean verification |

**Acceptance:**

- Cyberspace grid renders distinctly from Meatspace.
- All three ICE types functional: patrol, attack, guard behaviors.
- At least one Cyberspace objective type (data node slice) with `isObjectiveSatisfied` integration.
- Cyberspace grid generated deterministically from seed; snapshot round-trip for mid-run save/restore.
- Jack-in from Meatspace terminal spawns Cyberspace grid.

---

### P3.M4 — Simstim flip (dual-deploy) 🔲

**Depends on:** P3.M2 (Decker), P3.M3 (Cyberspace grid). This is the integration milestone.

**Goal:** The **simstim flip** — dual-deploy two operators (Meatspace + Decker in Cyberspace) with a flip mechanic that switches active control between layers. The PIP/CCTV window shows the inactive layer.

**Scope:**

- **Dual-deploy:** On contracts with a Cyberspace component, the player selects two operators: one for Meatspace, one (the Decker) for Cyberspace. Both are placed on their respective grids at mission start (Meatspace operator at spawn, Decker at the jack-in terminal's Cyberspace entry node).
  - **Pre–jack-in phase:** The Decker starts in Meatspace, where they move and act normally. The player must reach a terminal and jack in (P2.5.M2.2 interact) to activate Cyberspace. Until jack-in, this is a normal single-grid mission.
  - **Post–jack-in:** Cyberspace grid spawns. Flip mechanic activates. Decker's Meatspace body remains at the terminal — vulnerable, immobile, and targetable by corp hostiles (blueprint: "your physical body is a vegetable"). Secondary operator now enters the Meatspace grid.
- **The flip:** Switch active control between Meatspace operator and Decker. Active operator receives player input (move, attack, interact). Inactive operator holds position.
  - Cost: **free action** for the first implementation. AP cost can be revisited after playtesting, but the first version should make the new mental model easy to explore.
  - Can flip at any point during the active operator's turn (before or after spending AP).
- **Turn structure:** Player turn → flip as desired → end turn → **both layers' hostile phases resolve** (corp drones move in Meatspace, ICE moves in Cyberspace). Both layers tick simultaneously.
- **PIP / CCTV window:** The inactive layer renders in a small overlay (bottom right corner of the screen). Shows grid state, hostile positions, the other operator's status. Read-only — no input accepted in the PIP. The blueprint's "real-time CCTV showing your physical body's status" becomes this.
- **Vulnerability:** While the Decker is jacked in, their Meatspace body is a valid target for corp hostiles. If the body is destroyed, the Decker is killed (flatline) and Cyberspace access is lost. The Meatspace operator's explicit job is to **protect the Decker's body** — or at least keep hostiles away from the terminal.
- **Jack-out:** The Decker can voluntarily jack out (returns control to single-grid Meatspace). Or is forced out if their body takes critical damage. Jack-out despawns the Cyberspace grid (any unsatisfied Cyberspace objectives fail).
- **Contracts without Cyberspace:** Single-deploy as today. The Decker deploys solo in Meatspace (no flip, no Cyberspace grid). Their drone override hack is their primary value, but if they're flatlined, the campaign is over - no new Deckers can be recruited.
- **Save invariant:** A run may be single-layer, pre-jack dual-deploy, or active dual-layer. Those states must be explicit. A save with `cyberspace.active = true` but no cyber grid/avatar, or with a Decker marked jacked-in but no Meatspace body anchor, is corrupt and must throw.

**Integration slices:**

| Slice | Change | Tests |
|---|---|---|
| **P3.M4.1 Dual deploy pre-jack** | Select Meatspace operator + Decker; both begin in Meatspace | deployment gates, placement, no Decker = no Cyberspace contract |
| **P3.M4.2 Jacked body anchor** | Decker body becomes immobile target at terminal after jack-in | body targetable, movement rejected, death flatlines Decker |
| **P3.M4.3 Flip command** | Free action swaps active input layer | input routed to active layer only, inactive holds position |
| **P3.M4.4 Dual hostile phase** | End turn advances corp and ICE phases once each | deterministic order, both layers tick, no double AP refresh |
| **P3.M4.5 PIP** | Inactive layer mini-render + status summary | desktop/mobile layout, no input capture |
| **P3.M4.6 Jack-out** | Voluntary and forced jack-out transitions back to Meatspace | cleanup, objective failure rules, snapshot round-trip |

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

### P3.M6 — Chronicle (campaign narrative memory) 🔲

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
