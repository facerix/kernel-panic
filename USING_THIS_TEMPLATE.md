# Using This Template

Step-by-step guide for initializing a new app from the Facerix PWA template. Follow these in order.

---

## 1. Document your app's purpose

Before touching code, write a brief description of what the app does. You'll paste it into several places below.

Create any domain-specific reference docs in `docs/` (e.g. `docs/how-to-play.md` for a game, `docs/data-model.md` for a data app).

---

## 2. Update identity files

### `package.json`
- `name` → your app's slug (e.g. `"muggins"`)
- `version` → `"0.1.0"`
- `description` → one-line description

### `manifest.json`
- `name` and `short_name` → your app name
- `description` → one-line description
- `theme_color` and `background_color` → your chosen colors (see step 4)

### `LICENSE`
- Update the `ADDITIONAL TERMS` section to describe your app rather than the template.

---

## 3. Update AI coding assistant docs

These files are read by Claude Code and Cursor on every session — keeping them accurate saves you from re-explaining context.

### Create `CLAUDE.md`
Start from scratch. Include:
- One-sentence description of the app
- **Domain section**: the key concepts, rules, or data model an agent needs to understand (e.g. game rules, entity relationships)
- Coding standards (copy from template's `AGENTS.md` — the patterns section)
- Dev server line: `npm start — live-server on port 8080`

### Update `AGENTS.md`
Add an app-specific domain section at the top. Keep the coding patterns, naming conventions, troubleshooting, and checklist sections — they apply to every project.

---

## 4. Choose and apply colors

Pick a `theme_color` and `background_color` that suit the app's mood. A few guidelines:
- `theme_color` tints the browser chrome; `background_color` is the splash screen — they don't need to contrast with each other
- Set both to complementary values that fit the app's identity

Apply the colors in three places:
- `manifest.json` — `theme_color` and `background_color`
- `main.css` — `--accent-color` (use the lighter/accent tone), `body background-color`, `main background-color`, `body color`
- `index.html` and `about.html` — `<meta name="theme-color">` (match `theme_color`)

---

## 5. Update HTML files

### `index.html`
- `<title>` → app name
- `<meta name="description">` → one-line description
- `<meta name="theme-color">` → match `manifest.json` `theme_color`
- `<link rel="canonical">` → your deployment URL
- All OG tags (`og:title`, `og:description`, `og:url`) → app name, description, URL
- `<img alt>` → e.g. `"Muggins logo"`
- `<h1>` → app name
- Remove or replace the "Welcome to your new app" placeholder in `<main>`

### `about.html`
- Same title, meta, canonical, OG tag updates as above
- Replace "App Name" in the `<h1>` and any body text

---

## 6. Update service worker files

### `sw.js` and `sw-dev.js`
- Top comment: `// Service Worker for [App Name] - Production/Development Version`
- `LOG_PREFIX`: change `[App ...]` → `[YourApp ...]`

### `sw-core.js`
- `CacheConfig.create()` default prefix: `'app-cache-'` → `'yourapp-cache-'`

### `src/ServiceWorkerManager.js`
- Replace all `[App]` log prefixes with `[YourApp]`
- In `clearAllCaches()`: update the `.startsWith('app-cache-')` filter to match your new prefix

---

## 7. Update DataStore

In `src/DataStore.js`, change the localStorage key from `'items'` to something app-specific (e.g. `'games'`, `'records'`). Do this before writing any real data — changing it later requires a migration.

---

## 8. Delete template meta-docs

The following files exist to document the template itself and have no place in a concrete app:

| File | Why it can go |
|------|--------------|
| `COMPARISON.md` | Template project comparison |
| `PATTERNS.md` | Template pattern analysis |
| `QUICKSTART.md` | Template setup guide |
| `TEMPLATE_GUIDE.md` | Template customization reference |
| `ANALYSIS_SUMMARY.md` | Template genealogy |
| `ARCHITECTURE.md` | Generic architecture diagrams (useful early, superseded by app-specific docs) |
| `PROJECT_STRUCTURE.md` | Generic file map (covered by `README.md`) |
| `START_HERE.md` | Template welcome doc |
| `INDEX.md` | Template doc index (only needed if you have many docs) |
| `SUMMARY.txt` | Template file inventory |
| `docs/howto-raw.txt` | Raw source material, if any |

Check each for content worth saving to `AGENTS.md` before deleting. In practice, the things worth keeping are:
- Troubleshooting tips
- Non-obvious API details (e.g. event schemas)
- Naming or coding conventions not already in `AGENTS.md`

---

## 9. Add app icons

Replace the placeholder icons with real ones. Required sizes:
- `icons/icon512_maskable.png` — 512×512, maskable
- `icons/icon512_rounded.png` — 512×512, rounded
- `icons/icon-192x192.png` — 192×192
- `favicon.ico` — 32×32
- `icon.svg` — scalable version
- `apple-touch-icon.png` — 180×180

Tools: [realfavicongenerator.net](https://realfavicongenerator.net/) or [favicon.io](https://favicon.io/).

---

## 10. Verify and run

```bash
npm install
npm start
# Visit http://localhost:8080
```

Check:
- App name appears correctly in header and browser tab
- Theme color shows in browser chrome (on mobile or when installed)
- DevTools → Application → Service Workers → service worker registers
- DevTools → Application → Manifest → icons and colors look right
- `about.html` debug panel shows version and cache info

```bash
npm run format
npm run lint
```

Fix any lint errors before your first real commit.

---

## What's left

At this point the scaffold is clean and app-specific. What remains is entirely up to your app:

- Build out `index.html` / `index.js` with your UI
- Add Web Components in `/components/`
- Extend `DataStore.js` with your data model and methods
- Register new files in `sw-core.js` → `getCoreResources()`
- Add assets to `/images/` and register them in `getStaticAssets()`
