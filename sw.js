// Service Worker for Kernel Panic - Production Version
// Import shared caching core with cache-busting query parameter
const VERSION = '0.3.6';
importScripts(`/sw-release.js?v=${VERSION}`);
importScripts(`/sw-core.js?v=${VERSION}`);

if (!self.KernelPanicRelease || self.KernelPanicRelease.version !== VERSION) {
  throw new Error(`[KernelPanic] Release metadata does not match worker version ${VERSION}`);
}
const RELEASE_INFO = self.KernelPanicRelease;

const cacheConfig = CacheConfig.create(VERSION);
const CACHE_VERSION = cacheConfig.version;
const CACHE_NAMES = cacheConfig;
const CACHE_PREFIX = cacheConfig.prefix;
const LOG_PREFIX = `[KernelPanic ${CACHE_VERSION}]`;

const coreResources = CacheConfig.getCoreResources();
const staticAssets = CacheConfig.getStaticAssets();

console.log(`${LOG_PREFIX} Configuration loaded:`, {
  version: CACHE_VERSION,
  versionedCache: CACHE_NAMES.name,
  staticCache: CACHE_NAMES.staticName,
  coreResources: coreResources.length,
  staticAssets: staticAssets.length
});

self.addEventListener('install', event => {
  event.waitUntil(
    ServiceWorkerCore.handleInstall(
      CACHE_NAMES,
      coreResources,
      staticAssets,
      LOG_PREFIX,
      false
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    ServiceWorkerCore.handleActivate(
      CACHE_NAMES,
      CACHE_PREFIX,
      CACHE_VERSION,
      RELEASE_INFO,
      LOG_PREFIX
    )
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    ServiceWorkerCore.handleFetch(event.request, CACHE_NAMES, LOG_PREFIX)
      .catch(error => {
        console.error(`${LOG_PREFIX} Fetch failed for ${event.request.url}:`, error);
        throw error;
      })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(
      ServiceWorkerCore.handleMessage(
        event,
        CACHE_NAMES.name,
        CACHE_VERSION,
        RELEASE_INFO,
        LOG_PREFIX
      )
    );
  } else {
    ServiceWorkerCore.handleMessage(
      event,
      CACHE_NAMES.name,
      CACHE_VERSION,
      RELEASE_INFO,
      LOG_PREFIX
    );
  }
});
