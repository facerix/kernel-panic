# AGENTS.md

Agent-specific guidance. See [README.md](README.md) for project overview, architecture, and coding standards.

## Critical Patterns

### DataStore
```javascript
import DataStore from '/src/DataStore.js';

DataStore.addEventListener('change', evt => {
  const { changeType, items } = evt.detail;
  // changeType: "init" | "add" | "update" | "delete"
});

const items = DataStore.items;
DataStore.updateItem(item);
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
| `src/uuid.js` | UUID generation |
| `sw-core.js` | Shared service worker logic |
| `sw.js` | Production service worker |
| `sw-dev.js` | Development service worker |

## Event Reference

```
DataStore ('change' event)
  └── detail: { changeType, items, affectedRecords }
      └── changeType: 'init' | 'add' | 'update' | 'delete'

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
| JS modules | camelCase | `domUtils.js`, `uuid.js` |
| Classes | PascalCase | `DataStore`, `ServiceWorkerManager` |
| Components | PascalCase | `UpdateNotification.js` |
| Web Component tags | kebab-case | `<update-notification>` |
| CSS utility classes | `u-` prefix | `.u-flex`, `.u-hidden` |
| Private fields | `#` prefix | `#items`, `#isRegistered` |
| Constants | UPPER_SNAKE | `CACHE_VERSION`, `LOG_PREFIX` |

## Common Tasks

**Adding an item:** Create object → `DataStore.addItem()` → listen for "change" to re-render.

**Service Worker:** Automatically detects dev mode via `isDevelopmentMode()` in `domUtils.js`.

## Things to Avoid

1. ❌ Frameworks (React, Vue, etc.)
2. ❌ Using `createElement` (use `h()`)
3. ❌ Bypassing DataStore for data operations
4. ❌ Adding heavy dependencies without approval
5. ❌ Relative import paths — always use absolute paths starting with `/`
   ```javascript
   import { h } from '/src/domUtils.js'; // ✓
   import { h } from 'src/domUtils.js';  // ✗ — breaks as a module
   ```

## Testing

Use @Browser at `http://localhost:8080` (assume server is already running). Verify UI, interactions, console, service worker.

## Checklist

**Before:** Offline support? DataStore? Using `h()`?

**After:** `npm run format` → `npm run lint` → fix lint → test in browser
