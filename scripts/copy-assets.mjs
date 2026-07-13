/**
 * Copy static (non-TypeScript) assets into dist/ so live-server can serve
 * dist/ as the web root. tsc emits the compiled .js alongside these.
 *
 * The asset list is explicit on purpose — no globbing surprises. If a listed
 * asset is missing the script throws: a broken build should fail loudly, not
 * silently ship an incomplete dist/.
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

// Individual files copied to the same relative path under dist/.
const files = [
  'index.html',
  'about.html',
  'main.css',
  'manifest.json',
  '.htaccess',
  'favicon.ico',
  'favicon-96x96.png',
  'apple-touch-icon.png',
  'icon.svg',
  // Service workers stay as hand-written classic-worker JS (not compiled).
  'sw.js',
  'sw-dev.js',
  'sw-core.js',
  'sw-release.js',
  // Debug harness pages (their scripts are compiled by tsc into dist/debug/).
  'debug/index.html',
  'debug/map.html',
  'debug/save.html',
];

// Directories copied recursively.
const dirs = ['fonts', 'icons', 'images'];

async function run() {
  await mkdir(dist, { recursive: true });

  for (const rel of files) {
    const dest = join(dist, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(root, rel), dest);
  }

  for (const rel of dirs) {
    await cp(join(root, rel), join(dist, rel), { recursive: true });
  }

  console.log(`[copy-assets] copied ${files.length} files + ${dirs.length} dirs to dist/`);
}

run().catch(err => {
  console.error('[copy-assets] failed:', err);
  process.exit(1);
});
