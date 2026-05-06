// Service Worker Core - Shared Caching Logic
// This module contains reusable caching strategies and utilities
// used by both production and development service workers

/**
 * Configuration helper
 * Creates cache configuration from a version string and provides shared resource lists
 */
const CacheConfig = {
  create(version, prefix = 'kernel-panic-cache-') {
    return {
      version,
      name: `${prefix}v${version}`,
      staticName: `${prefix}static`,
      runtimeName: `${prefix}runtime`,
      prefix
    };
  },
  
  getCoreResources() {
    return [
      '/',
      '/index.html',
      '/index.js',
      '/about.html',
      '/about.js',
      '/main.css',
      '/manifest.json',
    ];
  },
  
  getStaticAssets() {
    return [
      '/icon.svg',
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/favicon-96x96.png',
      '/icons/icon-192x192.png',
      '/icons/icon512_maskable.png',
      '/icons/icon512_rounded.png',
      '/fonts/silkscreen/slkscr-webfont.woff',
      '/fonts/silkscreen/slkscrb-webfont.woff',
    ];
  },
};

/**
 * Core caching utilities and strategies
 */
const ServiceWorkerCore = {
  isRefreshableResource(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    
    const hasRefreshableExtension = pathname.endsWith('.html') || 
                                   pathname.endsWith('.css') || 
                                   pathname.endsWith('.js');
    
    const isDocument = request.destination === 'document';
    const isRootPath = pathname === '/' || pathname === '';
    
    return hasRefreshableExtension || isDocument || isRootPath;
  },

  isHTMLResource(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    
    const hasHTMLExtension = pathname.endsWith('.html');
    const isDocument = request.destination === 'document';
    const isRootPath = pathname === '/' || pathname === '';
    
    return hasHTMLExtension || isDocument || isRootPath;
  },

  isStaticAsset(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    
    return pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|otf|webp)$/);
  },

  async cacheFirstWithRefresh(request, cacheName, logPrefix = '[SW]') {
    const cache = await caches.open(cacheName);
    
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      this.refreshCacheInBackground(request, cache, logPrefix).catch(error => {
        console.warn(`${logPrefix} Background refresh failed for ${request.url}:`, error);
      });
      
      return cachedResponse;
    }
    
    console.log(`${logPrefix} Fetching from network: ${request.url}`);
    try {
      const response = await fetch(request);
      
      if (response && response.status === 200 && response.type === 'basic') {
        const responseToCache = response.clone();
        await cache.put(request, responseToCache);
        console.log(`${logPrefix} Cached new resource: ${request.url}`);
      }
      
      return response;
    } catch (error) {
      console.error(`${logPrefix} Network fetch failed for ${request.url}:`, error);
      throw error;
    }
  },

  async refreshCacheInBackground(request, cache, logPrefix = '[SW]') {
    try {
      const response = await fetch(request, { cache: 'reload' });
      
      if (response && response.status === 200 && response.type === 'basic') {
        await cache.put(request, response.clone());
      } else {
        console.warn(`${logPrefix} Background refresh got invalid response for ${request.url}:`, response.status);
      }
    } catch (error) {
      console.warn(`${logPrefix} Background refresh network error for ${request.url}:`, error.message);
    }
  },

  async networkFirst(request, cacheName, logPrefix = '[SW]') {
    const cache = await caches.open(cacheName);
    
    try {
      console.log(`${logPrefix} Network-first fetch: ${request.url}`);
      const response = await fetch(request, { cache: 'reload' });
      
      if (response && response.status === 200 && response.type === 'basic') {
        const responseToCache = response.clone();
        await cache.put(request, responseToCache);
        console.log(`${logPrefix} Network response cached: ${request.url}`);
      }
      
      return response;
    } catch (error) {
      console.warn(`${logPrefix} Network failed, trying cache: ${request.url}`);
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        console.log(`${logPrefix} Serving from cache (network failed): ${request.url}`);
        return cachedResponse;
      }
      
      console.error(`${logPrefix} Both network and cache failed for ${request.url}:`, error);
      throw error;
    }
  },

  async cacheFirst(request, cacheName, logPrefix = '[SW]') {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const response = await fetch(request, { cache: 'reload' });
    
    if (response && response.status === 200 && response.type === 'basic') {
      const cache = await caches.open(cacheName);
      const responseToCache = response.clone();
      await cache.put(request, responseToCache);
      console.log(`${logPrefix} Cached new resource: ${request.url}`);
    }
    
    return response;
  },

  async handleInstall(cacheNames, coreResources, staticAssets, logPrefix = '[SW]', skipWaiting = false) {
    console.log(`${logPrefix} Service Worker installing...`);
    
    if (!cacheNames || !cacheNames.name) {
      throw new Error(`${logPrefix} Invalid cacheNames object: ${JSON.stringify(cacheNames)}`);
    }
    if (!Array.isArray(coreResources) || coreResources.length === 0) {
      throw new Error(`${logPrefix} Invalid coreResources: must be a non-empty array`);
    }
    
    try {
      const versionedCache = await caches.open(cacheNames.name);
      console.log(`${logPrefix} Caching ${coreResources.length} core resources to: ${cacheNames.name}`);
      
      let coreCachedCount = 0;
      const failedResources = [];
      for (const url of coreResources) {
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) {
            await versionedCache.put(url, response);
            coreCachedCount++;
          } else {
            console.warn(`${logPrefix} Failed to cache core resource ${url}: ${response.status}`);
            failedResources.push({ url, status: response.status });
          }
        } catch (error) {
          console.warn(`${logPrefix} Failed to cache core resource ${url}:`, error.message);
          failedResources.push({ url, error: error.message });
        }
      }
      
      console.log(`${logPrefix} ✓ Cached ${coreCachedCount}/${coreResources.length} core resources`);
      if (failedResources.length > 0) {
        console.warn(`${logPrefix} Failed core resources:`, failedResources);
      }
      
      const staticCache = await caches.open(cacheNames.staticName);
      console.log(`${logPrefix} Caching ${staticAssets.length} static assets to: ${cacheNames.staticName}`);
      
      let cachedCount = 0;
      for (const url of staticAssets) {
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) {
            await staticCache.put(url, response);
            cachedCount++;
          } else {
            console.warn(`${logPrefix} Failed to cache ${url}: ${response.status}`);
          }
        } catch (error) {
          console.warn(`${logPrefix} Failed to cache ${url}:`, error.message);
        }
      }
      console.log(`${logPrefix} ✓ Cached ${cachedCount}/${staticAssets.length} static assets`);
      
      if (skipWaiting) {
        await self.skipWaiting();
      }
    } catch (error) {
      console.error(`${logPrefix} Failed to cache resources:`, error);
      throw error;
    }
  },

  async handleActivate(cacheNames, cachePrefix, logPrefix = '[SW]') {
    console.log(`${logPrefix} Service Worker activating...`);
    
    const existingCaches = await caches.keys();
    const cachesToKeep = [cacheNames.name, cacheNames.staticName, cacheNames.runtimeName];
    
    await Promise.all(
      existingCaches.map(cacheName => {
        if (cacheName.startsWith(cachePrefix) && !cachesToKeep.includes(cacheName)) {
          console.log(`${logPrefix} Deleting old cache: ${cacheName}`);
          return caches.delete(cacheName);
        }
      })
    );
    
    console.log(`${logPrefix} Service Worker activated`);
    console.log(`${logPrefix} Active caches: ${cachesToKeep.join(', ')}`);
    await self.clients.claim();
  },

  async handleFetch(request, cacheNames, logPrefix = '[SW]', useNetworkFirstForHTML = false) {
    if (request.method !== 'GET') {
      return fetch(request);
    }

    let cacheName;
    if (this.isStaticAsset(request)) {
      cacheName = cacheNames.staticName;
    } else {
      cacheName = cacheNames.name;
    }

    if (useNetworkFirstForHTML && this.isHTMLResource(request)) {
      return this.networkFirst(request, cacheName, logPrefix);
    }

    if (this.isRefreshableResource(request)) {
      return this.cacheFirstWithRefresh(request, cacheName, logPrefix);
    } else {
      return this.cacheFirst(request, cacheName, logPrefix);
    }
  },

  async handleMessage(event, cacheName, cacheVersion, logPrefix = '[SW]') {
    console.log(`${logPrefix} Received message:`, event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
      console.log(`${logPrefix} Skipping waiting and activating immediately...`);
      await self.skipWaiting();
      console.log(`${logPrefix} Service worker activated, claiming clients...`);
      
      await self.clients.claim();
      
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      console.log(`${logPrefix} Claimed ${clients.length} client(s), ready for new version`);
      
      clients.forEach(client => {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: cacheVersion
        });
      });
    }
    
    if (event.data && event.data.type === 'GET_CACHE_INFO') {
      event.ports[0].postMessage({
        cacheName: cacheName,
        version: cacheVersion
      });
    }
  }
};

self.CacheConfig = CacheConfig;
self.ServiceWorkerCore = ServiceWorkerCore;
