# AGENTS.md

Agent-specific guidance. See [README.md](README.md) for project overview, architecture, and coding standards.

## Domain: Kernel Panic

Turn-based cyberpunk roguelike on HTML canvas (ASCII-plus terminal look). **Phase 1** targets Meatspace MVP: grid movement/combat, Merc and Razor archetypes, A* + LOS, hub and death screen. Later phases add jack-in / Matrix layer, ICE, CCTV PIP, Vouch-driven NPCs.

Authoritative design notes: [docs/kernel-panic-v1-blueprint.md](docs/kernel-panic-v1-blueprint.md) and [docs/game-overview.md](docs/game-overview.md).

## Critical Patterns

### DataStore
```javascript
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
```javascript
import { h } from '/src/domUtils.js';

// Always use h() - never createElement directly
const el = h('div', { className: 'foo', id: '123' }, [child1, child2]);

// h() doesn't allow inline dataset manipulation, do it using the JS APIs
el.dataset.id = '456';
```

### Web Components
- `/components/` directory
- Shadow DOM, `<style>` tag, kebab-case tags
- Register with `customElements.define()`

## Important Files

| File | Purpose |
|------|---------|
| `src/DataStore.js` | Central data store (localStorage) |
| `src/domUtils.js` | `h()` helper, `isDevelopmentMode()` |
| `src/ServiceWorkerManager.js` | Service worker lifecycle |
| `sw-core.js` | Shared service worker logic |
| `sw.js` | Production service worker |
| `sw-dev.js` | Development service worker |

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
| JS modules | camelCase | `domUtils.js` |
| Classes | PascalCase | `DataStore`, `ServiceWorkerManager` |
| Components | PascalCase | `UpdateNotification.js` |
| Web Component tags | kebab-case | `<update-notification>` |
| CSS utility classes | `u-` prefix | `.u-flex`, `.u-hidden` |
| Private fields | `#` prefix | `#items`, `#isRegistered` |
| Constants | UPPER_SNAKE | `CACHE_VERSION`, `LOG_PREFIX` |

## Common Tasks

**Storing a run:** Create run object → `DataStore.addRun(run)` → listen for "change" event with `key: 'runs'`.

**Updating preferences:** `DataStore.setPref("archetype", newType)`.

**Service Worker:** Automatically detects dev mode via `isDevelopmentMode()` in `domUtils.js`.

## Things to Avoid

1. ❌ Frameworks (React, Vue, etc.)
2. ❌ Using `createElement` (use `h()`)
3. ❌ Bypassing DataStore for data operations
4. ❌ Adding heavy dependencies without approval
5. ❌ Relative import paths from outside `src/` — HTML pages, `components/`,
   `debug/`, etc. must use absolute paths starting with `/` (they resolve
   through live-server and break otherwise).
   ```javascript
   import { h } from '/src/domUtils.js'; // ✓
   import { h } from 'src/domUtils.js';  // ✗ — breaks as a module
   ```
   **Inside `src/` itself**, use relative paths (`./constants.js`). This
   keeps the game-logic tree self-contained so `node --test` can import it
   without a server. See `docs/phase-1-plan.md` → "Architecture conventions."

## Testing

Use @Browser at `http://localhost:8099` (assume server is already running). Verify UI, interactions, console, service worker.

## Checklist

**Before:** Offline support? DataStore? Using `h()`?

**After:** `npm run format` → `npm run lint` → fix lint → test in browser
