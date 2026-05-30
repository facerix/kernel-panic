# AGENTS.md

Agent-specific guidance. See [README.md](README.md) for project overview, architecture, and coding standards.

## Domain: Kernel Panic

Turn-based cyberpunk roguelike on HTML canvas (ASCII-plus terminal look). **Phase 2** deepens Meatspace: crew management, campaign layer, Tech archetype, salvage economy, Finn's shop. Later phases add jack-in / Matrix layer, ICE, CCTV PIP, Rep-driven NPCs.

Authoritative design notes: [docs/kernel-panic-v1-blueprint.md](docs/kernel-panic-v1-blueprint.md) and [docs/game-overview.md](docs/game-overview.md).

## Critical Patterns

### DataStore
```typescript
import DataStore from '/src/DataStore.js';

// Listen for changes
DataStore.addEventListener('change', evt => {
  const { changeType, key, data } = evt.detail;
  // changeType: "init" | "import" | "add" | "update" | "delete"
  // key: "prefs" | "runs"
});

// Access prefs
const currentArchetype = DataStore.prefs.archetype;

// Work with runs
const run = DataStore.getRunById(runId);
DataStore.addRun(runObject);
DataStore.updateRun(runObject);
DataStore.deleteRun(runId);

// Initialize on startup
await DataStore.init();
```

### DOM Creation
```typescript
import { h } from '/src/domUtils.js';

// Always use h() - never createElement directly
const el = h('div', { className: 'foo', id: '123' }, [child1, child2]);

// h() doesn't allow inline dataset manipulation, do it using the JS APIs
el.dataset.id = '456';
```

### Web Components
- `/components/` directory (`.ts` files, compiled to `dist/`)
- Shadow DOM, `<style>` tag, kebab-case tags
- Register with `customElements.define()`

### TypeScript
- Source is `.ts` in `src/`, `components/`, `debug/`, and root entries (`index.ts`, `about.ts`)
- `tsc` compiles to `dist/`; browser loads ES modules from `dist/` directly (no bundler)
- `strict: true` — no `any` escape hatches in production code
- Shared structural types live in `src/types.ts`; class-backed types stay in their own files
- Use `import type` to avoid circular runtime imports when only the shape is needed
- Service workers remain plain `.js` (classic-worker global scope) — copied as static assets
- **Import paths use `.js` extensions** even in `.ts` files (TypeScript's `bundler` resolution requires this for runtime ESM compatibility)

### Error handling — fail loud, but recover

This is a tablet-first offline PWA with no visible JS console, so a raw `throw` that white-screens the tab is itself a *silent* failure: the player loses their session and we get no signal. "Crashing is preferred over data corruption" still holds — but "crash" means *fail loud to a boundary*, never *kill the tab*. Three tiers:

1. **Invariant violation / would-corrupt-the-save** → throw, but to the top-level **error boundary**, which preserves the last known-good save, emits a dev-channel signal (console + telemetry), and degrades the player to "something glitched — returning to the Hub, progress safe." Crash the *run*, not the *app*. Examples: negative `heal`, a snapshot that won't round-trip, a failed save-write validation.
2. **Expected recoverable runtime situation** → deterministic fallback + `console.warn`. Play continues. This is correct behavior, not a compromise. Example: `nudgeIfOccupied` relocating an entity off an occupied anchor.
3. **Forbidden:** a tier-2 fallback that feeds invalid state into persistence. If a fallback can't produce a valid, persistable state, it is a tier-1 case and must escalate to the boundary — never paper over.

Determinism caveat: tier-2 fallbacks must stay seed-deterministic so saves remain reproducible. See `docs/phase-2.6-plan.md` for the full doctrine and the boundary's spec.

## Important Files

| File | Purpose |
|------|---------|
| `src/DataStore.ts` | Central data store (localStorage) |
| `src/domUtils.ts` | `h()` helper, `isDevelopmentMode()` |
| `src/types.ts` | Shared structural types (GridPoint, TurnActionStep, etc.) |
| `src/ServiceWorkerManager.ts` | Service worker lifecycle |
| `sw-core.js` | Shared service worker logic (plain JS) |
| `sw.js` | Production service worker (plain JS) |
| `sw-dev.js` | Development service worker (plain JS) |
| `tsconfig.json` | Main build config (strict, ESNext, dist/ output) |
| `tsconfig.tests.json` | Test type-checking (extends main) |
| `tsconfig.test-build.json` | Test transpile-only build (noCheck: true) |

## Event Reference

```
DataStore ('change' event)
  └── detail: { changeType, key, data }
      ├── changeType: 'init' | 'import' | 'add' | 'update' | 'delete'
      ├── key: 'prefs' | 'runs' | '*' (for init/import)
      └── data: the affected item or ID being deleted

Window (dispatched by ServiceWorkerManager)
  ├── 'sw-update-available'  → detail: { registration, pendingWorker }
  └── 'sw-update-progress'   → detail: { status }

UpdateNotification (dispatched by component)
  ├── 'update-notification-shown'
  ├── 'update-notification-hidden'
  ├── 'update-accepted'
  └── 'update-dismissed'
```

## Naming Conventions

| Type | Convention | Examples |
|------|------------|---------|
| HTML files | lowercase | `index.html` |
| TS modules | camelCase | `domUtils.ts` |
| Classes | PascalCase | `DataStore`, `ServiceWorkerManager` |
| Components | PascalCase | `UpdateNotification.ts` |
| Web Component tags | kebab-case | `<update-notification>` |
| CSS utility classes | `u-` prefix | `.u-flex`, `.u-hidden` |
| Private fields | `#` prefix | `#items`, `#isRegistered` |
| Constants | UPPER_SNAKE | `CACHE_VERSION`, `LOG_PREFIX` |
| Type aliases | PascalCase | `GridPoint`, `FactionId`, `TurnActionStep` |
| Interfaces | PascalCase | `EntityInit`, `LootableEntity` |

## Common Tasks

**Storing a run:** Create run object → `DataStore.addRun(run)` → listen for "change" event with `key: 'runs'`.

**Updating preferences:** `DataStore.setPref("archetype", newType)`.

**Service Worker:** Automatically detects dev mode via `isDevelopmentMode()` in `domUtils.js`.

**Service worker precache:** Offline install precaches a hand-maintained list in `sw-core.js` → `CacheConfig.getCoreResources()`. When you add a new runtime module under `src/` or `components/` that the PWA loads (imported from `index.ts`, `about.ts`, a web component, or any module in that graph), add its compiled URL to that list — e.g. `/src/game/entities/Door.js`, not the `.ts` path. Skip `debug/` (not part of the offline shell) and modules that are only `import type` (they erase at compile time; e.g. `src/types.ts`). After changing the list, bump the cache version in `sw.js` / `sw-dev.js` so clients pick up the new precache on update.

## Things to Avoid

1. ❌ Frameworks (React, Vue, etc.)
2. ❌ Using `createElement` (use `h()`)
3. ❌ Bypassing DataStore for data operations
4. ❌ Adding heavy dependencies without approval
5. ❌ Using `any` in production code (strict mode is enforced)
6. ❌ Relative import paths from outside `src/` — HTML pages, `components/`,
   `debug/`, etc. must use absolute paths starting with `/` (they resolve
   through live-server and break otherwise).
   ```typescript
   import { h } from '/src/domUtils.js'; // ✓
   import { h } from 'src/domUtils.js';  // ✗ — breaks as a module
   ```
   **Inside `src/` itself**, use relative paths (`./constants.js`). This
   keeps the game-logic tree self-contained so `node --test` can import it
   without a server. See `docs/phase-1-plan.md` → "Architecture conventions."
7. ❌ Omitting `.js` extension in import paths — TypeScript's `bundler`
   resolution requires the `.js` extension for runtime ESM compatibility.

## Testing

- **Unit tests:** `npm test` — runs `typecheck` (main config) → `build:tests` (transpile-only) → `node --test "dist/tests/**/*.test.js"`.
- **Type-check tests only:** `npm run typecheck:tests` — currently has residual errors from intentionally loose test stubs; deferred.
- **Browser:** Use @Browser at `http://localhost:8099` (assume server is already running). Verify UI, interactions, console, service worker.

## Checklist

**Before:** Offline support? DataStore? Using `h()`? Types strict?

**After:** `npm run format` → `npm run lint` → `npm test` → fix issues → verify in browser. New `src/` or `components/` module in the PWA import graph? Update `sw-core.js` `getCoreResources()` (and SW cache version if needed).
