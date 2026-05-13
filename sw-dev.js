// Service Worker for Kernel Panic - Development Version
const VERSION = '0.1.6-dev';
importScripts(`/sw-core.js?v=${VERSION}`);

const cacheConfig = CacheConfig.create(VERSION);
const CACHE_VERSION = cacheConfig.version;
const CACHE_NAMES = cacheConfig;
const CACHE_PREFIX = cacheConfig.prefix;
const LOG_PREFIX = `[KernelPanic ${CACHE_VERSION} - Dev]`;

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
    ServiceWorkerCore.handleActivate(CACHE_NAMES, CACHE_PREFIX, LOG_PREFIX)
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    ServiceWorkerCore.handleFetch(event.request, CACHE_NAMES, LOG_PREFIX)
      .catch(error => {
        console.error(`${LOG_PREFIX} Fetch failed:`, error);
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
        throw error;
      })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(
      ServiceWorkerCore.handleMessage(event, CACHE_NAMES.name, CACHE_VERSION, LOG_PREFIX)
    );
  } else {
    ServiceWorkerCore.handleMessage(event, CACHE_NAMES.name, CACHE_VERSION, LOG_PREFIX);
  }
});
