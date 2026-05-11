# Kernel Panic

Turn-based cyberpunk roguelike as a Progressive Web App — tactical grid combat, Neuromancer-inspired tone, ASCII-plus terminal presentation on canvas. Vanilla ES modules, Web Components, and offline-first caching.

**Vision and roadmap:** [docs/kernel-panic-v1-blueprint.md](docs/kernel-panic-v1-blueprint.md)  
**Short overview:** [docs/game-overview.md](docs/game-overview.md)

## Architecture

- **No frameworks** — vanilla JavaScript with ES modules
- **Game view** — HTML `<canvas>` (grid / terminal UI)
- **Web Components** — `/components/` with Shadow DOM
- **Data** — `DataStore` singleton (`localStorage`, key `kp:data`)
- **DOM** — `h()` from `src/domUtils.js`
- **Service workers** — `sw.js` / `sw-dev.js` + shared `sw-core.js`

## Development

| Command       | Purpose                          |
| ------------- | -------------------------------- |
| `npm start`   | live-server at http://localhost:8099 |
| `npm run lint` | oxlint                          |
| `npm run format` | Prettier                     |

First-time setup after clone: see [USING_THIS_TEMPLATE.md](USING_THIS_TEMPLATE.md) (identity, caches, icons).

## Agent / assistant context

- [AGENTS.md](AGENTS.md) — coding patterns and domain summary  
- [CLAUDE.md](CLAUDE.md) — concise project + standards for Claude Code

## Credits

Scaffolded from the [Facerix](https://www.facerix.com/about) PWA template.
