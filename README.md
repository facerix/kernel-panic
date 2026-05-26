# Kernel Panic

Turn-based cyberpunk roguelike as a Progressive Web App — tactical grid combat, Neuromancer-inspired tone, ASCII-plus terminal presentation on canvas. TypeScript (strict), ES modules, Web Components, and offline-first caching.

**Vision and roadmap:** [docs/kernel-panic-v1-blueprint.md](docs/kernel-panic-v1-blueprint.md)  
**Short overview:** [docs/game-overview.md](docs/game-overview.md)  
**Current phase:** [docs/phase-2.5-plan.md](docs/phase-2.5-plan.md) (`v0.2.5`)

## Architecture

- **No frameworks, no bundler** — TypeScript compiled by `tsc` to `dist/`; browser loads ES modules directly
- **Game view** — HTML `<canvas>` (grid / terminal UI)
- **Web Components** — `/components/` with Shadow DOM
- **Data** — `DataStore` singleton (`localStorage`, key `kp:data`)
- **DOM** — `h()` from `src/domUtils.ts`
- **Service workers** — `sw.js` / `sw-dev.js` + shared `sw-core.js` (plain JS, not compiled)

## Development

| Command | Purpose |
|---------|---------|
| `npm start` | dev server at http://localhost:8099 (tsc watch + asset copy + live-server) |
| `npm test` | typecheck + build tests + node --test |
| `npm run typecheck` | type-check main source (strict) |
| `npm run lint` | oxlint |
| `npm run format` | Prettier |

## Agent / assistant context

- [AGENTS.md](AGENTS.md) — coding patterns and domain summary  
- [CLAUDE.md](CLAUDE.md) — concise project + standards for Claude Code

## Credits

Scaffolded from the [Facerix](https://www.facerix.com/about) PWA template.
