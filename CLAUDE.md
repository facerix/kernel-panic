# Kernel Panic

Turn-based cyberpunk roguelike PWA: tactical grid combat in Meatspace first, with Cyberspace and social systems planned in later phases.

## Domain

- **Archetypes (Phase 1):** Merc (ranged, Vault perk), Razor (melee/stealth, Slide perk).
- **Combat:** Grid-based, AP costs — move 1, ranged attack 2, melee attack 1, interact 1.
- **Systems:** A* pathfinding for drones, LOS, rare map destruction with persistence during a run.
- **Economy:** Credits and a Vouch meter (NPC/social play in later phases).
- **UI:** Canvas ASCII-plus terminal aesthetic; CRT-style presentation per blueprint.

Detailed mechanics and roadmap: `docs/kernel-panic-v1-blueprint.md`.

## Coding standards

Follow project `AGENTS.md`: DataStore for persistence, `h()` from `domUtils.js` for DOM (no `createElement`), Web Components in `/components/` with Shadow DOM, absolute imports (`/src/...`). No frameworks.

## Development

`npm start` — live-server on port **8099**. Lint/format: `npm run lint`, `npm run format`.
