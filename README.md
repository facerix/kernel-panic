# Facerix App Template

Progressive Web App (PWA) template for building offline-first web applications. Built with vanilla JavaScript, Web Components, and Service Workers.

## Architecture

- **No frameworks** - Pure vanilla JavaScript with ES6 modules
- **Web Components** - Custom elements in `/components/` with Shadow DOM
- **Data Store** - Singleton `DataStore` (EventTarget) manages all data in localStorage
- **DOM Creation** - Use `h()` helper from `src/domUtils.js` for all DOM manipulation
- **Service Workers** - Offline-first caching with automatic update notifications

## Development

### Commands

- **Start server**: `npm start` (live-server at http://localhost:8080)
- **Lint**: `npm run lint`
- **Format**: `npm run format`
- **Auto-fix linting**: `npm run lint:fix`

### Service Worker

Separate `sw.js` (production) and `sw-dev.js` (development) files. Automatically detects environment via `isDevelopmentMode()` in `domUtils.js`.

## Coding Standards

- **ES6 modules** - Always use `import`/`export`
- **Private fields** - Use `#fieldName` for encapsulation
- **const > let** - Prefer `const`, avoid `var`
- **Arrow functions** - For callbacks
- **async/await** - For promises

## Project Structure

```
/
├── index.html/js          # Main entry point
├── about.html/js          # About page
├── main.css               # Global styles
├── manifest.json          # PWA manifest
├── sw.js                  # Production service worker
├── sw-dev.js              # Development service worker
├── sw-core.js             # Shared service worker logic
├── components/            # Web Components (Custom Elements)
│   └── UpdateNotification.js
├── src/                   # Core utilities
│   ├── DataStore.js       # Singleton data store (localStorage)
│   ├── ServiceWorkerManager.js # Service worker lifecycle
│   ├── domUtils.js        # DOM helper functions (h() function)
│   └── uuid.js            # UUID generation
├── images/                # SVG/PNG assets
└── icons/                 # PWA icons
```

## Getting Started

See [USING_THIS_TEMPLATE.md](USING_THIS_TEMPLATE.md) for the full step-by-step setup guide.

## Credits

Template created by [Rylee Corradini](https://www.facerix.com/about).
