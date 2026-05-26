# Phase 3 Plan — Ghost in the Machine

Living plan for the Phase 3 slice of Kernel Panic: **campaign arc**, **Cyberspace**, **the Decker**, and **the Score** — the narrative and mechanical layer that gives the Meatspace foundations (Phase 2 / 2.5) a purpose. **Target release: `v0.3.0`.** See [phase-2.5-plan.md](phase-2.5-plan.md) for the Meatspace depth milestones that Phase 3 builds on, [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall design vision, and [game-overview.md](game-overview.md) for the elevator pitch.

## Design vision

The campaign is a **Neuromancer-shaped arc**: a crew of operators assembles over a series of street-level gigs, recruits a specialist who can open the digital layer, and builds toward a climactic multi-layer infiltration — **the Score**. Two interlocking pressures drive the player forward:

- **The Score** (the big job) — a multi-phase target that requires physical site knowledge, crew capability, and digital penetration. The player can't attempt it until they've built enough rep, gear, and intel. Every contract run is preparation.
- **The Clock** (mounting pressure) — something that makes delay costly. Each run the player takes, the world gets harder: corp security tightens, a rival crew closes in, or the operational window narrows. There's a soft optimum: prep enough to survive the Score, but don't over-prep or the world outpaces you.

### Campaign shape

| Arc | Runs | What happens | Systems |
|-----|------|-------------|---------|
| **Act 1: Street level** | 1–5 | Build rep, learn combat, recruit crew. Pure Meatspace gigs. Unconnected contracts from M2.10 recipes. | M2 objectives, M5 economy, M7 site roster begins |
| **Turning point** | ~5 | Reach top rep tier. Offered the Score (or discover it). Recruit the Decker. | Decker joins crew; Score target site designated |
| **Act 2: Casing** | 6–10 | Prep runs at/near the target site + resource building. Cyberspace available on some contracts. Learning the flip. Curator biases toward Score-adjacent contracts. | M7 persistence (casing), Cyberspace, simstim flip |
| **The Clock starts** | ~8 | Pressure mounts — rival crew, corp heat, neural degradation. Contracts get harder; delay has cost. | Clock mechanic |
| **Act 3: The Score** | 11–13 | Final prep runs, then the big job. Dual-layer climax: Meatspace breach + Cyberspace penetration. | Everything converges |

### The simstim flip

On contracts with a Cyberspace component, the player **dual-deploys**: a Meatspace operator and the Decker. Each has their own grid. The **flip** switches which operator the player actively controls — both are player-controlled, no AI autopilot. The inactive operator waits while hostiles in *both* layers advance every turn end.

- Reuses the existing single-operator control model twice (no squad tactics required).
- Tension is purely **attention allocation**: every turn spent in Cyberspace is a turn the Meatspace operator isn't moving, while corp drones keep closing in — and vice versa.
- The flip is a **free action** (or 1 AP — TBD). The PIP / CCTV window from the blueprint shows the inactive layer in miniature.

### The Decker

A new **player archetype** recruited mid-campaign (late Act 1 / start of Act 2), not available at campaign start.

- **Cyberspace specialist:** Primary value is digital — jacking in at terminals, fighting ICE, opening digital locks, slicing data.
- **Meatspace capable:** Viable as a solo deploy on non-Cyberspace contracts, but not their strength. Signature ability: **drone override hack** (turn a corp drone to your side temporarily — thematically perfect, reuses existing drone AI with faction flip).
- **Recruitment:** Gated by rep tier (top tier from M5). Narrative beat — the Decker seeks you out, or a fixer introduces them. Not a menu selection.

## Current status

| Milestone | Status |
|---|---|
| P3.M1 — Campaign arc structure | 🔲 Planned |
| P3.M2 — The Decker archetype | 🔲 Planned |
| P3.M3 — Cyberspace grid + ICE | 🔲 Planned |
| P3.M4 — Simstim flip (dual-deploy) | 🔲 Planned |
| P3.M5 — The Score (climactic mission) | 🔲 Planned |
| P3.M6 — Chronicle (campaign narrative memory) | 🔲 Planned |

**Phase 3** is complete when:

1. Every milestone in the table above is ✅.
2. Full campaign arc playable from Act 1 through the Score: Meatspace-only early game → Decker recruitment → Cyberspace contracts → dual-layer Score → win or flatline → chronicle summary.
3. Offline on iOS Safari + Chrome desktop throughout.
4. `v0.3.0` tagged in git.

## Phase 2.5 foundations (prerequisites)

Phase 3 depends on specific hooks built into Phase 2.5 milestones:

| 2.5 Milestone | Phase 3 hook | Notes |
|---|---|---|
| **M2.10** (recipes) | Recipe context accepts **arc stage** input | Phase 3 uses this to bias contract generation toward Score-adjacent objectives in Acts 2–3 |
| **M5** (economy/rep) | Top rep tier defined and reachable | Phase 3 gates Decker recruitment and Score access at this tier |
| **M7** (persistence) | Location schema includes `scoreTarget` flag; site roster + mutation deltas | Phase 3 designates one roster site as the Score target; player "cases" it across visits |

## Milestones — detail

### P3.M1 — Campaign arc structure 🔲

**Depends on:** Phase 2.5 complete (M2.10 recipe hooks, M5 rep tiers, M7 site roster).

**Goal:** The campaign has a **three-act structure** with a defined beginning, middle, and end. The player progresses through acts based on rep, run count, and narrative triggers. The Curator is arc-aware — it generates contracts appropriate to the current act.

**Scope:**

- **Arc state:** Campaign save tracks current act (1/2/3), run count, and arc-specific flags (Decker recruited, Score revealed, Clock started, Score attempted).
- **Act transitions:** Define triggers for act boundaries:
  - Act 1 → Act 2: reach top rep tier + minimum run count (e.g. 4–5 runs). Triggers Score reveal and Decker recruitment opportunity.
  - Act 2 → Act 3: Decker recruited + Score target site visited at least once + Clock threshold (e.g. run 10+). Triggers "final prep" phase.
  - Score available: Act 3 + player-initiated (choose to attempt the Score from the Hub).
- **Arc-aware Curator:** M2.10 recipe context gains `arcStage` field. Act 1 = broad pool, unconnected gigs. Act 2 = bias toward Score target site and related factions. Act 3 = mostly prep contracts at or near the target.
- **Win/loss conditions:**
  - **Win:** Complete the Score (extract with objective satisfied from the final mission).
  - **Loss (flatline):** Entire crew wiped during any run (existing behavior, but now with arc context for the chronicle).
  - **Loss (clock):** Clock expires before Score is attempted (if hard deadline chosen — see Clock mechanic below).

**The Clock mechanic:**

The Clock creates mounting pressure that discourages indefinite grinding. Options (pick one or combine at implementation):

- **Escalating global difficulty:** Each run after a threshold (e.g. run 8), corp security tier increases globally — more drones, tougher spawns, higher alarm sensitivity. Soft pressure: you *can* keep running, but it gets harder.
- **Rival crew:** A competing team is after the same Score. Abstract progress bar: each run you take, they advance. If they reach the Score first, you lose (or the Score becomes dramatically harder — they've tripped every alarm).
- **Operational window:** The Score target has a time-limited vulnerability (maintenance cycle, personnel rotation, satellite blind spot). After N total runs, the window closes permanently. Hard deadline.
- **Neural degradation:** The Decker's implants degrade with each jack-in. After N Cyberspace runs, they can no longer jack in — and the Score requires Cyberspace. Biological clock on the crew, not the world.

Implementation notes TBD after Clock type is chosen. Multiple types may coexist (escalating difficulty as soft pressure + operational window as hard deadline).

**Acceptance:**

- Arc state persists in campaign save; restore round-trip.
- Act transitions fire at correct thresholds; tests for boundary conditions.
- Curator generates arc-appropriate contracts per act (testable via seeded generation with arc context).
- At least one Clock type implemented with visible feedback (Hub status, contract briefing, or log).
- Win/loss conditions reachable in golden-path test.

---

### P3.M2 — The Decker archetype 🔲

**Depends on:** P3.M1 (arc structure for recruitment gating). Can develop archetype mechanics in parallel, but recruitment integration requires arc state.

**Goal:** Fourth player archetype — the **Decker** (working name; alternatives: Jockey, Slicer, Cowboy, Spike). Recruited mid-campaign as a narrative beat, not available at campaign start.

**Scope:**

- **Archetype definition:** Stats, AP costs, base loadout. Comparable to Merc/Razor/Tech in Meatspace capability but not optimized for it.
- **Signature ability — Drone Override Hack:** Target a corp drone within range; spend AP to attempt override. On success, drone switches to PLAYER faction for N turns (or until destroyed). Reuses existing drone AI with faction flip. Failure may trigger alarm (M2.1 cadence).
- **Cyberspace stats:** The Decker has Cyberspace-specific attributes (e.g. RAM, intrusion strength, ICE resistance) used in P3.M3. Other archetypes cannot jack in (or can with severe penalties — TBD).
- **Recruitment flow:** Triggered at Act 1 → Act 2 transition. Uses the **progressive Hub reveal** system from Phase 2.5 M5: Curator message introduces the Decker on Hub entry when rep threshold is met and `deckerRecruited` flag is unset. Same pattern as Finn's introduction and Terminal explanation — the Hub grows with the campaign.
- **Deployment:** The Decker is deployable as a solo operator on any contract (Meatspace only on non-Cyberspace contracts). On Cyberspace contracts, the Decker is one of the dual-deploy pair (see P3.M4).

**Acceptance:**

- Decker archetype playable in Meatspace: move, attack, interact, deploy — comparable to other archetypes.
- Drone Override Hack: golden-path test — target drone, override succeeds, drone attacks corp allies for N turns, reverts or is destroyed.
- Recruitment: gated by arc state; not available in Act 1; golden-path test for recruitment flow.
- Snapshot: Decker state (including Cyberspace attributes) persists in campaign save; restore round-trip.
- Key help: Decker glyph and ability description.

---

### P3.M3 — Cyberspace grid + ICE 🔲

**Depends on:** P3.M2 (Decker as the Cyberspace avatar). Can prototype grid mechanics independently.

**Goal:** The second tactical layer — a **Cyberspace grid** with its own geometry, traversal rules, and hostile AI (**ICE** — Intrusion Countermeasure Electronics). Generated fresh per jack-in (not persistent across runs).

**Scope:**

- **Cyberspace grid:** Separate `Grid` / `World` instance for the digital layer. **Graph-based nodes and logic pathways** (per blueprint) — may use the same grid engine with a different tileset/topology, or a simplified node graph. Design decision at implementation; document trade-offs.
- **Cyberspace tileset / aesthetic:** Distinct from Meatspace. Nodes, data lines, firewalls, open channels. ASCII glyphs TBD but visually differentiated (color palette, glyph set, CRT effects).
- **ICE hostiles:** Three types per blueprint:
  - **Probe:** Sentry / patrol. Detects the Decker, raises alert (Cyberspace alarm analog).
  - **Spark:** Fast, fragile attacker. Swarm behavior.
  - **Guardian:** Heavy. Guards critical nodes. High HP, high damage, limited mobility.
- **ICE AI:** A* pathfinding (reuse Meatspace drone infrastructure with Cyberspace-specific cost maps). Alarm/alert model adapted from M2.1 for the digital layer.
- **Cyberspace objectives:** What the Decker *does* once jacked in — slice data nodes, disable firewalls, open digital locks. Reuses `Interactable` patterns from M2.2 adapted for Cyberspace.
- **Generation:** Procedural per jack-in. Seeded from contract + campaign RNG. Not persistent (fresh each time). Complexity scales with contract difficulty / act.
- **Jack-in trigger:** Decker interacts with a Meatspace terminal (M2.2 `Interactable`). This spawns the Cyberspace grid and activates dual-deploy mode (P3.M4).

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
  - **Pre–jack-in phase:** Both operators start in Meatspace. The Meatspace operator moves and acts normally. The Decker must reach a terminal and jack in (M2.2 interact) to activate Cyberspace. Until jack-in, this is a normal single-grid mission.
  - **Post–jack-in:** Cyberspace grid spawns. Flip mechanic activates. Decker's Meatspace body remains at the terminal — vulnerable, immobile, and targetable by corp hostiles (blueprint: "your physical body is a vegetable").
- **The flip:** Switch active control between Meatspace operator and Decker. Active operator receives player input (move, attack, interact). Inactive operator holds position.
  - Cost: **free action** or **1 AP** (TBD — free action recommended for less friction; AP cost adds tactical weight).
  - Can flip at any point during the active operator's turn (before or after spending AP).
- **Turn structure:** Player turn → flip as desired → end turn → **both layers' hostile phases resolve** (corp drones move in Meatspace, ICE moves in Cyberspace). Both layers tick simultaneously.
- **PIP / CCTV window:** The inactive layer renders in a small overlay (corner of the screen). Shows grid state, hostile positions, the other operator's status. Read-only — no input accepted in the PIP. The blueprint's "real-time CCTV showing your physical body's status" becomes this.
- **Vulnerability:** While the Decker is jacked in, their Meatspace body is a valid target for corp hostiles. If the body is destroyed, the Decker is killed (flatline) and Cyberspace access is lost. The Meatspace operator's implicit job is to **protect the Decker's body** — or at least keep hostiles away from the terminal.
- **Jack-out:** The Decker can voluntarily jack out (returns control to single-grid Meatspace). Or is forced out if their body takes critical damage. Jack-out despawns the Cyberspace grid (any unsatisfied Cyberspace objectives fail).
- **Contracts without Cyberspace:** Single-deploy as today. The Decker deploys solo in Meatspace (no flip, no Cyberspace grid). Their drone override hack is their primary value.

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

**Depends on:** P3.M1 (arc structure), P3.M4 (simstim flip), M7 (location persistence for the target site).

**Goal:** The **climactic dual-layer mission** that the entire campaign builds toward. The Score is a contract at the designated target site, requiring both Meatspace breach and Cyberspace penetration to complete.

**Scope:**

- **Score contract:** A special contract type (or recipe) that is only available in Act 3 when the player chooses to attempt it. Not randomly rolled — player-initiated from the Hub.
- **Dual objectives:** The Score has objectives in **both** layers:
  - **Meatspace:** Breach the target site (using M7 pre-made breaches + new ones), reach the objective room, protect the Decker's body, extract.
  - **Cyberspace:** Penetrate the target's digital defenses (ICE gauntlet), disable core security (opens physical locks/routes for the Meatspace operator), extract the target data/asset.
  - Both must be satisfied for a clean completion. Partial completion (one layer only) = partial payout or narrative consequence (TBD).
- **Site knowledge payoff:** The target site uses M7's persistent geometry. Every prior visit's breaches, mapped rooms, and learned patrol routes carry over. The player who cased the site thoroughly has a significant advantage.
- **Escalated difficulty:** The Score is harder than any normal contract — more hostiles, tighter turn budget, more ICE, higher stakes. Failure = campaign loss (crew wipe or objective irrecoverably failed).
- **Narrative climax:** The Score's briefing, objective copy, and completion text reflect the campaign's arc. The chronicle (P3.M6) records the outcome as the campaign's defining moment.

**Acceptance:**

- Score contract available only in Act 3, player-initiated.
- Dual-layer objectives: Meatspace + Cyberspace both required.
- Target site uses persistent geometry from prior visits (M7 mutations present).
- Completion = campaign win; failure = campaign loss.
- Golden-path test: full Score run from deployment through dual-layer completion to extraction.

---

### P3.M6 — Chronicle (campaign narrative memory) 🔲

**Depends on:** P3.M1 (arc structure provides the narrative beats to chronicle). Can begin data collection earlier if arc state is available.

**Goal:** Ground the campaign's **resource + consequence** loop in something the player can **re-read**: a persisted **chronicle** of the active campaign, and a **durable summary** when a campaign ends. Deferred from Phase 2.5 M3 — the chronicle needs the campaign arc to be meaningful.

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
