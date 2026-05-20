# Phase 2.5 Plan — Meatspace depth (pre–Cyberspace)

Living plan for the post–Phase 2 slice of Kernel Panic: **contract objectives**, **richer Meatspace combat and economy**, **campaign chronicle**, and **breaching / map memory** — all before the Phase 3 Matrix layer (jack-in, ICE, CCTV). **Target release: `v0.2.5`.** See [phase-2-plan.md](phase-2-plan.md) for the completed Phase 2 milestone set (M0–M8), [kernel-panic-v1-blueprint.md](kernel-panic-v1-blueprint.md) for the overall design vision, and [game-overview.md](game-overview.md) for the elevator pitch.

## Current status

| Milestone | Status |
|---|---|
| M1 — Contract objectives (label-driven run variety) | ✅ Done |
| M2 — Richer combat mechanics (objectives + pressure) | 🔲 Planned |
| M3 — Campaign history / chronicle | 🔲 Planned |
| M4 — Salvage revision + typed salvage + field consumables | 🔲 Planned |
| M5 — Hub, economy, Rep, crew tuning | 🔲 Planned |
| M6 — Breaching, map mutation, location memory | 🔲 Planned |

**Phase 2.5** is complete when:

1. Every milestone in the table above is ✅.
2. Full campaign loop from Phase 2 remains playable offline on iOS Safari + Chrome desktop: Hub → contract selection → job deployment → combat → extract or flatline → return to Hub, with Finn shop, Rep meter, recruitment, and new systems (objectives, chronicle, salvage types, shop tabs, breaching, etc.) integrated per milestone specs.
3. `v0.2.5` tagged in git.

## Milestones — detail

### M1 — Contract objectives (label-driven run variety) ✅

**Goal:** Each contract already rolls a **label**, **difficulty**, and **reward**; add a **randomly assigned objective** (or objective *family*) so the same tactical map loop supports different completion pressures. Labels stay flavor-first; the Curator rolls an `objective` (and optional parameters) alongside `seed` / tier so saves stay deterministic. UI (`<contract-select>`, `<run-briefing>`) surfaces objective text, not only `// label`.

**Out of scope for this milestone’s spec:** exact AP costs, failure modes, and Rep hooks — those land when mechanics are implemented (see M2 / shop tuning). This section records **design intent** and label → objective mapping.

#### Objective families (how they play)

| Family | Player-facing loop | Reuses existing systems |
|--------|---------------------|-------------------------|
| **Retrieve** | Enter → find interactable **pickup** (cache, dossier, crate) → carry or “secured” flag → **exit** | Space interact, LOS, `loot`-style flags |
| **Handoff** | Enter → locate **faction-tagged contact** (neutral fence, fixer, dead-letter box as NPC) → interact to deliver / receive → **exit** | Hub-style interact; NEUTRAL / authored spawns |
| **Terminal / slice** | Enter → reach **one or more terminals** → interact (maybe multi-tick or alarm on fail) → **exit** | Interact, optional `alarm` tie-in |
| **Deny / destroy** | Enter → **destroy marked object(s)** or eliminate a quota → **exit** | Combat, possibly non-drone props |
| **Sweep / clear** | Enter → **clear threats** or tagged “nodes” (antennas, relays) before extraction counts | Drone count, optional secondary entities |
| **Dual-site / sync** | Enter → complete **A then B** (or either order) within same floor — e.g. mirror payroll | Two interactables; routing puzzle |
| **Timed pressure** (optional modifier) | Any family + **turn budget** or escalating spawns | Telemetry / shell timer; ties to difficulty |

#### Current `CONTRACT_LABELS` → suggested default objective

Labels are **suggestive**, not 1:1 locked forever — the table is the default thematic read so the first implementation can map `label` → `objectiveKind` without a second RNG if desired.

| Label | Natural read | Suggested objective family | In-game sketch |
|-------|----------------|---------------------------|-----------------|
| **Sublevel 3 cache** | Buried data stash | **Retrieve** | A **cache** interactable (sublevel tile cluster or hidden room); must **pick up / secure** before exit counts as clean completion (or gates full pay). |
| **Vuong Holdings server farm** | Corp data center | **Terminal / slice** | One or more **server racks / terminals** to interact with (“slice”); higher tiers could arm **CorpCivilian** alarm pressure. |
| **Black market dropoff — Pier 9** | Physical handoff | **Handoff** | Spawn a **named neutral contact** (or static “drop box” entity with contact flavor); **interact adjacent** to complete package transfer; exit. |
| **Glassed clinic data dump** | Salvage from a hit site | **Retrieve** (+ hazard flavor) | **Medical records** or **samples** pickup in a **risky zone** (smoke, broken LOS, or “glass” debris as palette); retrieve then exit. |
| **Spinning Fox warehouse** | Logistics / storage | **Retrieve** or **Deny** | Either **lift a crate** (retrieve) or **torch/disable shipment** (destroy interactable); tier picks weight. |
| **Matsuda payroll mirror** | Finance + redundancy | **Dual-site / sync** | **Two mirrors**: interact **payroll terminal** + **off-site mirror** (or two pads); order-free or “sync window” for critical tier. |
| **Transit authority dead drop** | TA blind handoff | **Retrieve** | **Dead drop** prop (concealed tile); **find + interact** once; then exit — same mechanical skeleton as cache, different fiction. |
| **Harbor node sweep** | Security sweep language | **Sweep / clear** | **All drones** or **N relay nodes** must be cleared; extraction allowed only when quota met (contrast with pure stealth exit). |

#### Additional label ideas (same pool style)

Additional `CONTRACT_LABELS` / families to build out:

- **Ransomware sinkhole — District 4** — Terminal / slice (isolate payload).
- **Cryo convoy manifest** — Retrieve (manifest pickup) or Handoff (deliver to journalist NPC).
- **Sentinel maintenance window** — Timed modifier + Terminal / slice (quiet window expires).
- **Yutani water table tap** — Dual-site (two sampling bores) or Retrieve.
- **Ghost auction ledger** — Retrieve (ledger) + optional Handoff exit contact.
- **Basement floodgate override** — Deny / destroy (valve or pump) or Terminal sequence.
- **Skybridge relay blind** — Sweep (relay entities) or Retrieve (blind drop on bridge).

#### Acceptance (when implemented)

- `Contract` carries `objective` beyond `reach-exit` (enum or tagged union), serialised in run snapshots.
- `generateContracts` assigns objective **deterministically** from `rng` + label (or explicit joint roll).
- Briefing + job board show **objective line**; completion logic in `Run` / shell respects objective before payout (exact rules refined in M2).
- Tests: Curator snapshot shape + persistence round-trip for new objective fields; at least one golden-path objective test per family (as mechanics land).

#### Implementation notes

- Contracts now carry `objective: { kind, title, briefing, params? }` instead of a flat objective string; old `"reach-exit"` saves migrate at restore.
- `Curator.generateContracts` maps each current label deterministically to an objective family, and throws if a future label lacks a mapping.
- `<contract-select>` shows the short objective title; `<run-briefing>` shows the longer briefing line.
- `Run` now gates extraction through `isObjectiveSatisfied(contract)`, currently permissive for all M1 families so M2 can replace it with family-specific state.

---

### M2 — Richer combat mechanics (objectives + pressure) 🔲

**Goal:** Build on M1 contract objectives with Meatspace systems called out in the pitch and blueprint: **noise / alarm cadence**, **terminal-slice tension**, **environmental hazards**, **new corp hostiles**, and **access gating** that sets up M6 breaching.

**Scope (initial spec):**

- **Noise / alarm:** Cooldowns and clearer escalation / de-escalation so alarm is a tunable pressure layer, not only a binary spike. Player-facing feedback in log and/or diagnostics.
- **Terminal / slice:** Interactions that can raise alarm; support **alarm deactivation** (second terminal, slice completion, or timed window — exact rule per objective family TBD at implementation).
- **Hazard tiles:** e.g. persistent or turn-scoped tiles that affect LOS, movement cost, or damage — supports Retrieve-in-risk-zone fiction from M1.
- **Additional corp hostiles:** e.g. **stationary turrets** (corp-aligned, distinct from player Tech turrets) and other low-scope entities that increase map variety without ballooning AI surface area.
- **Locked doors:** Must be **unlocked** (key, hack, objective flag) or **breached**; full **breach interaction** and destructible geometry land in **M6** — M2 may ship doors as blockers + unlock flags so maps and objectives can depend on them early.

**Acceptance (when implemented):** At least one new hostile type and one hazard type in procgen or prefabs; alarm cooldown / deactivation path testable on a golden-path contract; locked doors integrated with pathing and objectives; snapshot-safe state for new entities and door flags.

---

### M3 — Campaign history / chronicle 🔲

**Goal:** Ground the pitch’s **resource + consequence** loop in something the player can **re-read**: a persisted **chronicle** of the active campaign, and a **durable summary** when a campaign ends.

**Scope:**

- **Active campaign:** Chronicle entries (jobs taken, outcomes, major Rep / payout deltas, objective families — field set TBD) stored **in the campaign save**.
- **Presentation:** Surfaced from the Hub **Terminal** alongside / inside the existing **crew** view (exact IA: tab, section, or shared scroll — TBD).
- **Campaign end:** On wipe or victory, roll up a **summary record** into a **persistent history** list (localStorage / DataStore — same durability pattern as runs/prefs), **high-scores–style**: scannable list the player can open from a **new Hub waypoint** (e.g. interactable or menu entry on the Hub map).

**Acceptance (when implemented):** New job appends chronicle; campaign load restores it; end-of-campaign produces one summary row; Hub can open history UI without an active campaign; tests for append + round-trip + cap/trim policy if the list is bounded.

---

### M4 — Salvage revision + typed salvage + field consumables 🔲

**Goal:** Align salvage with **spatial honesty** and **blueprint economy depth** ahead of Phase 3, and widen **combat pickups** beyond the Hub-bought inventory alone.

**Scope:**

- **Drone corpses:** **Salvaging a drone corpse removes it from the map** (no “phantom” tile once stripped). Closes the kaizen item on **corpse memory / lootability** — revisit [kaizen.md](./kaizen.md) when shipped and mark the line closed or superseded.
- **Typed salvage:** Bring **salvage component types** forward from the Phase 3 deferral (see kaizen “typed salvage”): multiple categories (names + schema TBD) that Finn and crafting-adjacent hooks can use in M5.
- **Collectable combat consumables:** **Spawn-on-map** pickups usable in the job, e.g. **smoke bombs**, **immediate-use stims**, **throwable incendiary bombs**. **Breaching charges** are **not** in M4 — they ship with **M6** (Finn + wall mutation).

**Acceptance (when implemented):** Salvage types in campaign snapshot; corpse removal after salvage; at least one pickup type per category above with serialization tests; migration path for saves that only had numeric salvage (define defaults or one-time conversion).

---

### M5 — Hub, economy, Rep, crew management tuning 🔲

**Goal:** Tie **Rep**, **crew attrition**, and **typed salvage** into a coherent Hub loop and shop UX without Cyberspace scope creep.

**Scope:**

- **Hub clinic:** A Hub-side way to recover HP or reduce attrition (exact economy: Creds, salvage, or per-visit limit — TBD). Addresses long-standing “no Hub heal” pressure from playtesting notes in [kaizen.md](./kaizen.md).
- **Finn’s shop:** **Richer economy** built around **salvage component types** from M4 (buy/sell/recipes or exchange rates TBD).
- **Shop UI:** **Salvage selling** is a **separate visual tab** from **consumable / gear purchases** (clearer mental model than a single scroll list).
- **Contract access:** Remove the **“better-contracts”** meta upgrade from the shop; replace with a **simple Rep-tier gate** (e.g. higher Rep unlocks **more lucrative** or **higher-tier** job rolls). Exact thresholds and tier names TBD.

**Acceptance (when implemented):** Clinic usable in Hub; Finn tabs + typed-salvage pricing; Rep gate drives contract generation or filtering; tests for gate boundaries and snapshot persistence of new prefs/campaign fields.

---

### M6 — Breaching, map mutation, location memory 🔲

**Goal:** Deliver blueprint **Meatspace destruction + persistence** and optional **return visits** to the same fiction location across a campaign.

**Scope:**

- **Breaching:** **Breaching charge** (or equivalent) sold via **Finn**; **destructible walls** (subset of tiles or tagged prefab regions); **new run objective** for **targeted demolition** (extends M1 Deny/destroy family with authored breach targets).
- **Persistence:** Wall/floor mutations **serialize** in the job snapshot as today; extend design so **maps tied to specific contract locations** can live in **localStorage for the duration of a campaign** so a **later job at the same site** can **reuse the same geometry** while varying **objectives, occupants, and pickups**.

**Acceptance (when implemented):** Breach item + at least one wall type destructible; demolition objective in contract roll; location-keyed map cache documented (key schema, eviction on campaign delete); tests for snapshot + cache hit/miss + corruption guard (crash over silent bad map).

---

## Recorded problems (deferred)

Open items that span Phase 2.5 and later work stay in [`docs/kaizen.md`](./kaizen.md). When M4 lands, update the **typed salvage** and **corpse memory** entries to point at shipped behavior or Phase 3 remainder.
