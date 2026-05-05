// Singleton module for service worker registration
// Provides centralized management of service worker lifecycle
import { isDevelopmentMode } from './domUtils.js';

export class ServiceWorkerManager {
  #isRegistered = false;
  #registration = null;
  #listenersSetup = false;
  #developmentMode = isDevelopmentMode();
  #swFile = this.#developmentMode ? '/sw-dev.js' : '/sw.js';
  #isUpdating = false;

  constructor() {
    if (ServiceWorkerManager.instance) {
      return ServiceWorkerManager.instance;
    }
    ServiceWorkerManager.instance = this;
  }

  async register() {
    if (!('serviceWorker' in navigator)) {
      console.warn(`[App] Service Workers not supported in this browser`);
      return null;
    }

    const existingRegistration = await navigator.serviceWorker.getRegistration();
    if (existingRegistration) {
      console.log(`[App] Service Worker already registered`);
      this.#registration = existingRegistration;
      this.#isRegistered = true;

      this.#checkForMultipleWorkers().catch(error => {
        console.warn(`[App] Error checking for multiple workers:`, error);
      });

      if (!this.#listenersSetup) {
        this.#setupUpdateListeners();
      }
      return this.#registration;
    }

    if (this.#isRegistered) {
      console.log(`[App] Service Worker already registered in this instance`);
      return this.#registration;
    }

    try {
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          window.addEventListener('load', resolve, { once: true });
        });
      }

      this.#registration = await navigator.serviceWorker.register(this.#swFile);
      this.#isRegistered = true;

      console.log(`[App] Service Worker registered successfully:`, this.#registration.scope);

      this.#setupUpdateListeners();

      return this.#registration;
    } catch (error) {
      console.error(`[App] Service Worker registration failed:`, error);
      return null;
    }
  }

  async #checkForMultipleWorkers() {
    if (!this.#registration) return;

    const active = this.#registration.active;
    const waiting = this.#registration.waiting;
    const installing = this.#registration.installing;
    const controller = navigator.serviceWorker.controller;

    if ((active && waiting) || (active && installing) || (waiting && installing)) {
      console.warn(`[App] Multiple service workers detected:`, {
        active: active ? `${active.state} (script: ${active.scriptURL})` : 'none',
        waiting: waiting ? `${waiting.state} (script: ${waiting.scriptURL})` : 'none',
        installing: installing ? `${installing.state} (script: ${installing.scriptURL})` : 'none',
        controller: controller ? `${controller.state} (script: ${controller.scriptURL})` : 'none',
      });

      if (waiting && controller && waiting !== controller && !this.#isUpdating) {
        try {
          const activeVersion = await this.getVersion();
          const waitingVersion = await this.getLatestVersion();
          if (activeVersion === waitingVersion) {
            console.log(`[App] Waiting worker is same version as active. Auto-activating...`);
            await this.skipWaiting(waiting);
            return;
          }
        } catch (error) {
          console.warn(`[App] Could not verify versions, proceeding normally:`, error);
        }
      }
    }
  }

  #setupUpdateListeners() {
    if (!this.#registration || this.#listenersSetup) return;

    setTimeout(async () => {
      if (this.#registration.waiting && navigator.serviceWorker.controller && !this.#isUpdating) {
        const waitingWorker = this.#registration.waiting;

        try {
          const currentVersion = await this.getVersion();
          const latestVersion = await this.getLatestVersion();
          if (currentVersion === latestVersion) {
            console.log(`[App] Waiting worker is same version, skipping notification`);
            return;
          }
        } catch (error) {
          console.warn(`[App] Could not verify versions:`, error);
        }

        console.log(`[App] Found waiting service worker from previous session`);
        this.#dispatchUpdateEvent(waitingWorker);
      }
    }, 0);

    this.#registration.addEventListener('updatefound', () => {
      const newWorker = this.#registration.installing;
      if (!newWorker) return;

      console.log(`[App] New service worker installing...`);

      const handleStateChange = () => {
        console.log(`[App] Service worker state changed to: ${newWorker.state}`);

        if (
          (newWorker.state === 'installed' || newWorker.state === 'waiting') &&
          navigator.serviceWorker.controller &&
          !this.#isUpdating
        ) {
          this.getLatestVersion()
            .then(latestVersion => {
              return this.getVersion().then(currentVersion => {
                if (currentVersion === latestVersion) {
                  console.log(`[App] New worker is same version, skipping notification`);
                  return false;
                }
                return true;
              });
            })
            .then(shouldShow => {
              if (shouldShow) {
                console.log(`[App] New service worker available. Consider refreshing the page.`);
                this.#dispatchUpdateEvent(newWorker);
              }
              newWorker.removeEventListener('statechange', handleStateChange);
            })
            .catch(error => {
              console.warn(`[App] Could not verify version, showing notification:`, error);
              console.log(`[App] New service worker available. Consider refreshing the page.`);
              this.#dispatchUpdateEvent(newWorker);
              newWorker.removeEventListener('statechange', handleStateChange);
            });
        }
      };

      newWorker.addEventListener('statechange', handleStateChange);
      handleStateChange();
    });

    this.#listenersSetup = true;
  }

  #dispatchUpdateEvent(pendingWorker) {
    if (this.#isUpdating) {
      console.log(`[App] Update already in progress, skipping notification`);
      return;
    }

    const event = new CustomEvent('sw-update-available', {
      detail: {
        registration: this.#registration,
        pendingWorker: pendingWorker || this.#registration.waiting,
      },
    });
    window.dispatchEvent(event);
  }

  async checkForUpdates() {
    if (!this.#registration) {
      console.warn(`[App] Cannot check for updates: no registration`);
      return;
    }

    try {
      console.log(`[App] Manually checking for service worker updates...`);
      await this.#registration.update();

      setTimeout(() => {
        if (this.#registration.waiting && navigator.serviceWorker.controller) {
          console.log(`[App] Update check found waiting service worker`);
          this.#dispatchUpdateEvent(this.#registration.waiting);
        }
      }, 100);
    } catch (error) {
      console.error(`[App] Failed to check for updates:`, error);
    }
  }

  getRegistration() {
    return this.#registration;
  }

  isRegistered() {
    return this.#isRegistered;
  }

  async getCacheInfo() {
    if (!this.#registration || !this.#registration.active) {
      return null;
    }

    return new Promise(resolve => {
      const messageChannel = new window.MessageChannel();
      messageChannel.port1.onmessage = event => {
        resolve(event.data);
      };

      this.#registration.active.postMessage({ type: 'GET_CACHE_INFO' }, [messageChannel.port2]);
    });
  }

  async getVersion() {
    if (!this.#registration || !this.#registration.active) {
      return null;
    }

    try {
      const cacheInfo = await this.getCacheInfo();
      return cacheInfo?.version || null;
    } catch (error) {
      console.error(`[App] Failed to get service worker version:`, error);
      return null;
    }
  }

  async getLatestVersion() {
    if (!this.#registration) {
      return null;
    }

    const pendingWorker = this.#registration.waiting || this.#registration.installing;
    if (!pendingWorker) {
      return null;
    }

    try {
      return new Promise(resolve => {
        const messageChannel = new window.MessageChannel();
        const timeout = setTimeout(() => {
          messageChannel.port1.close();
          resolve(null);
        }, 1000);

        messageChannel.port1.onmessage = event => {
          clearTimeout(timeout);
          messageChannel.port1.close();
          resolve(event.data?.version || null);
        };

        messageChannel.port1.onerror = () => {
          clearTimeout(timeout);
          messageChannel.port1.close();
          resolve(null);
        };

        pendingWorker.postMessage({ type: 'GET_CACHE_INFO' }, [messageChannel.port2]);
      });
    } catch (error) {
      console.error(`[App] Failed to get latest service worker version:`, error);
      return null;
    }
  }

  #dispatchUpdateProgress(status) {
    const event = new CustomEvent('sw-update-progress', {
      detail: { status },
    });
    window.dispatchEvent(event);
  }

  async skipWaiting(worker = null) {
    const targetWorker = worker || this.#registration?.waiting;

    if (!this.#registration || !targetWorker) {
      console.warn(`[App] No waiting service worker to skip waiting`);
      return;
    }

    this.#dispatchUpdateProgress('Sending activation signal...');
    console.log(`[App] Sending SKIP_WAITING message to service worker`);
    targetWorker.postMessage({ type: 'SKIP_WAITING' });

    return new Promise(resolve => {
      let resolved = false;

      const handleControllerChange = () => {
        if (resolved) return;
        if (navigator.serviceWorker.controller) {
          this.#dispatchUpdateProgress('New service worker activated...');
          console.log(`[App] New service worker is now controlling the page`);
          setTimeout(() => {
            if (!this.#registration.waiting || this.#registration.waiting !== targetWorker) {
              console.log(`[App] Old waiting worker has been terminated`);
              this.#dispatchUpdateProgress('Preparing to reload...');
            } else {
              console.warn(`[App] Warning: Waiting worker still exists`);
              this.#dispatchUpdateProgress('Waiting for old worker to terminate...');
            }
            if (!resolved) {
              resolved = true;
              resolve();
            }
          }, 200);
        } else {
          this.#dispatchUpdateProgress('Waiting for service worker activation...');
          setTimeout(() => {
            if (navigator.serviceWorker.controller) {
              console.log(`[App] New service worker is now controlling the page (delayed)`);
              this.#dispatchUpdateProgress('Preparing to reload...');
              if (!resolved) {
                resolved = true;
                resolve();
              }
            } else {
              console.warn(`[App] No controller after skipWaiting, resolving anyway`);
              this.#dispatchUpdateProgress('Reloading...');
              if (!resolved) {
                resolved = true;
                resolve();
              }
            }
          }, 500);
        }
      };

      const handleMessage = event => {
        if (event.data && event.data.type === 'SW_ACTIVATED') {
          console.log(`[App] Service worker confirmed activation: ${event.data.version}`);
          this.#dispatchUpdateProgress('Service worker activated. Reloading...');
          if (!resolved) {
            resolved = true;
            navigator.serviceWorker.removeEventListener('message', handleMessage);
            navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
            resolve();
          }
        }
      };

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange, {
        once: true,
      });
      navigator.serviceWorker.addEventListener('message', handleMessage);

      setTimeout(() => {
        if (!resolved) {
          console.log(`[App] Skip waiting timeout, proceeding with reload`);
          this.#dispatchUpdateProgress('Reloading page...');
          resolved = true;
          navigator.serviceWorker.removeEventListener('message', handleMessage);
          navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
          resolve();
        }
      }, 3000);
    });
  }

  async clearAllCaches() {
    if (!('caches' in window)) {
      console.warn(`[App] Cache API not supported`);
      return;
    }

    try {
      const cacheNames = await caches.keys();
      const appCaches = cacheNames.filter(name => name.startsWith('app-cache-'));

      console.log(`[App] Clearing ${appCaches.length} cache(s):`, appCaches);

      await Promise.all(appCaches.map(cacheName => caches.delete(cacheName)));

      console.log(`[App] Successfully cleared all caches`);

      if (this.#registration) {
        await this.#registration.unregister();
        console.log(`[App] Service worker unregistered`);
        this.#isRegistered = false;
        this.#registration = null;
      }

      window.location.reload();
    } catch (error) {
      console.error(`[App] Failed to clear caches:`, error);
      throw error;
    }
  }

  async handleUpdateNow(pendingWorker) {
    if (this.#isUpdating) {
      console.log(`[App] Update already in progress`);
      return;
    }

    this.#isUpdating = true;
    console.log(`[App] Handling update now request`);

    try {
      await this.skipWaiting(pendingWorker);

      if (!navigator.serviceWorker.controller) {
        this.#dispatchUpdateProgress('Verifying service worker activation...');
        console.warn(
          `[App] No service worker controller after skipWaiting, waiting a bit longer...`
        );
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (this.#registration.waiting && this.#registration.waiting === pendingWorker) {
        this.#dispatchUpdateProgress('Waiting for old worker to terminate...');
        console.warn(
          `[App] Warning: Waiting worker still exists after skipWaiting. Waiting longer...`
        );
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (this.#registration.waiting === pendingWorker) {
          console.error(
            `[App] Error: Waiting worker still exists. This may cause multiple workers.`
          );
        }
      }

      this.#dispatchUpdateProgress('Reloading page...');
      console.log(`[App] Reloading page to use new service worker...`);
      window.location.reload();
    } catch (error) {
      console.error(`[App] Failed to update service worker:`, error);
      this.#dispatchUpdateProgress('Update failed. Please try again.');
      this.#isUpdating = false;
      throw error;
    }
  }
}

export const serviceWorkerManager = new ServiceWorkerManager();

window.serviceWorkerManager = serviceWorkerManager;
