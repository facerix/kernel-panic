# Phase 2.6.5 Plan — Pre–2.7 balance & help UX

Living plan for a small slice between Phase 2.6 (resilience) and Phase 2.7 (enemy roles): **player-facing balance** and **help panel structure** that do not depend on the new hostile roster. **Target release: `v0.2.6-bal`** (`package.json`: `0.2.6-balance.1`). See [phase-2.6-plan.md](phase-2.6-plan.md), [phase-2.7-plan.md](phase-2.7-plan.md).

## Why this phase exists

Playtesting surfaced UX and Tech-turret tuning that should land **before** the enemy-identity work in 2.7/2.9 — not because they conflict, but because they improve the current skirmisher/guard loop without waiting for elites, medics, or principal theming.

## Milestones

| Milestone | Status |
|---|---|
| M1 — `<key-help>` three-tab layout | ✅ |
| M1.1 — How To Play (intro, move-into, perks) | ✅ |
| M1.2 — Map Key (expanded hostile behavior copy) | ✅ |
| M1.3 — Keyboard shortcuts tab (non–coarse-pointer only) | ✅ |
| M2 — Tech turret balance | ✅ |
| M2.1 — Deployed turret `maxHp` matches owner `maxHp` (Armour Plating) | ✅ |
| M2.2 — Ballistics Coil gear (+1 ranged damage; turrets inherit bonus) | ✅ |
| M2.3 — Two autofire steps per turret per player aftermath | ✅ |

**Phase 2.6.5** is complete when:

1. Every milestone above is ✅.
2. Help overlay uses three tabs on desktop; touch devices see How To Play + Map Key only.
3. Tech deploys turrets at the owner's current max HP and gear-driven damage; aftermath fires twice per live turret per yield.
4. Full Phase 2.5 campaign loop remains playable offline.
5. `v0.2.6-bal` tagged in git; `package.json` `0.2.6-balance.1`.

## Out of scope

- Enemy roles, tier composition, map-size bands (Phase 2.7).
- Principal aliases and mixed allegiance (Phase 2.9).
- Cyberspace / Decker (Phase 3).

## Versioning note

Git tag `v0.2.6-bal`; npm uses valid SemVer prerelease `0.2.6-balance.1` (not `0.2.6.1` — four-part numeric versions are invalid for `package.json`).
