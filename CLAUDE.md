# Kernel Panic

Turn-based cyberpunk roguelike PWA: tactical grid combat in Meatspace first, with Cyberspace and social systems planned in later phases. Currently in **Phase 2.5** — contract objectives, campaign history, and more; see `docs/phase-2.5-plan.md` (`v0.2.5`).

## Domain

- **Archetypes:** Merc (ranged, Vault perk), Razor (melee/stealth, Slide perk), Tech (turret deploy).
- **Combat:** Grid-based, AP costs — move 1, ranged attack 2, melee attack 1, interact 1, deploy 2.
- **Systems:** A* pathfinding for drones, LOS, campaign persistence, salvage economy.
- **Economy:** Salvage → Finn's shop. Rep meter (NPC/social play in M5+).
- **UI:** Canvas ASCII-plus terminal aesthetic; CRT-style presentation per blueprint.

Detailed mechanics and roadmap: `docs/kernel-panic-v1-blueprint.md`. Current plan: `docs/phase-2.5-plan.md`.

## Coding standards

Follow project `AGENTS.md`: TypeScript (strict), DataStore for persistence, `h()` from `domUtils.ts` for DOM (no `createElement`), Web Components in `/components/` with Shadow DOM. No frameworks, no bundler.

- Source is `.ts`; compiled to `dist/` by `tsc`. Import paths use `.js` extensions.
- Inside `src/`: relative imports. Outside `src/` (components, debug, entries): absolute `/src/...` imports.
- Shared structural types in `src/types.ts`. Class-backed types in their own files.
- Service workers stay plain `.js` (classic-worker scope).

## Development

| Command | Purpose |
|---------|---------|
| `npm start` | dev server on port **8099** (tsc watch + asset copy + live-server) |
| `npm test` | typecheck + build tests + node --test |
| `npm run typecheck` | type-check main source only |
| `npm run lint` | oxlint |
| `npm run format` | Prettier |
