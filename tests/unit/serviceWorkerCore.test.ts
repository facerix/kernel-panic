import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

type WorkerCore = {
  handleInstall(
    cacheNames: { name: string; staticName: string },
    coreResources: string[],
    staticAssets: string[],
    logPrefix?: string
  ): Promise<void>;
};

type WorkerCacheConfig = {
  getCoreResources(): string[];
};

function loadWorkerCore(fetchImpl: (url: string) => Promise<object>) {
  const puts: Array<{ cache: string; url: string }> = [];
  const self: Record<string, unknown> = {};
  const sandbox = {
    self,
    URL,
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchImpl,
    caches: {
      async open(cacheName: string) {
        return {
          async put(url: string) {
            puts.push({ cache: cacheName, url });
          },
        };
      },
    },
  };
  vm.runInNewContext(readFileSync('sw-core.js', 'utf8'), sandbox, { filename: 'sw-core.js' });
  return {
    cacheConfig: self.CacheConfig as WorkerCacheConfig,
    core: self.ServiceWorkerCore as WorkerCore,
    puts,
  };
}

test('every core precache URL maps to a repository source or static asset', () => {
  const { cacheConfig } = loadWorkerCore(async () => ({ ok: true, status: 200 }));
  const missing = Array.from(cacheConfig.getCoreResources()).filter(url => {
    if (url === '/') return !existsSync('index.html');
    const relative = url.slice(1);
    if (!relative.endsWith('.js')) return !existsSync(relative);
    // A /*.js precache URL maps to a compiled .ts source, or — for vendored
    // libraries copied verbatim into dist/ (see src/vendor/) — to a .js source
    // that already exists as-is.
    return !existsSync(relative.replace(/\.js$/, '.ts')) && !existsSync(relative);
  });
  assert.deepEqual(missing, []);
});

test('service-worker install rejects an incomplete core precache', async () => {
  const { core } = loadWorkerCore(async url => ({
    ok: url !== '/missing.js',
    status: url === '/missing.js' ? 404 : 200,
  }));

  await assert.rejects(
    core.handleInstall(
      { name: 'core-v2', staticName: 'static-v2' },
      ['/index.js', '/missing.js'],
      ['/icon.svg'],
      '[test]'
    ),
    /Refusing incomplete install.*missing\.js/
  );
});

test('optional static-asset failure does not invalidate a complete core shell', async () => {
  const { core, puts } = loadWorkerCore(async url => ({
    ok: url !== '/optional.png',
    status: url === '/optional.png' ? 503 : 200,
  }));

  await core.handleInstall(
    { name: 'core-v2', staticName: 'static-v2' },
    ['/index.js'],
    ['/optional.png'],
    '[test]'
  );
  assert.deepEqual(puts, [{ cache: 'core-v2', url: '/index.js' }]);
});
