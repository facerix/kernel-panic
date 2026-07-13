// Singleton module for service worker registration
// Provides centralized management of service worker lifecycle
import { isDevelopmentMode } from './domUtils.js';
import {
  parseUpdateRelease,
  requiresUpdateAcknowledgement,
  type AvailableUpdate,
  type UpdateRelease,
} from './updateRelease.js';

export type UpdateAvailableDetail = AvailableUpdate;
export type UpdateRestartRequiredDetail = Readonly<{ release: UpdateRelease | null }>;

export class ServiceWorkerManager {
  #isRegistered = false;
  #registration: ServiceWorkerRegistration | null = null;
  #listenersSetup = false;
  #developmentMode = isDevelopmentMode();
  #swFile = this.#developmentMode ? '/sw-dev.js' : '/sw.js';
  #isUpdating = false;
  #announcedWorker: ServiceWorker | null = null;
  #hadController = false;
  static instance: ServiceWorkerManager | null = null;

  constructor() {
    if (ServiceWorkerManager.instance) {
      return ServiceWorkerManager.instance;
    }
    ServiceWorkerManager.instance = this;
  }

  async register() {
    if (!('serviceWorker' in navigator)) {
      console.warn(`[KernelPanic] Service Workers not supported in this browser`);
      return null;
    }

    const existingRegistration = await navigator.serviceWorker.getRegistration();
    if (existingRegistration) {
      console.log(`[KernelPanic] Service Worker already registered`);
      this.#registration = existingRegistration;
      this.#isRegistered = true;

      this.#checkForMultipleWorkers();

      if (!this.#listenersSetup) {
        this.#setupUpdateListeners();
      }
      this.#registration.update().catch(error => {
        console.error(`[KernelPanic] Startup service-worker update check failed:`, error);
      });
      return this.#registration;
    }

    if (this.#isRegistered) {
      console.log(`[KernelPanic] Service Worker already registered in this instance`);
      return this.#registration;
    }

    try {
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          window.addEventListener('load', resolve, { once: true });
        });
      }

      this.#registration = await navigator.serviceWorker.register(this.#swFile, {
        updateViaCache: 'none',
      });
      this.#isRegistered = true;

      console.log(
        `[KernelPanic] Service Worker registered successfully:`,
        this.#registration.scope
      );

      this.#setupUpdateListeners();

      return this.#registration;
    } catch (error) {
      console.error(`[KernelPanic] Service Worker registration failed:`, error);
      return null;
    }
  }

  #checkForMultipleWorkers() {
    if (!this.#registration) return;

    const active = this.#registration.active;
    const waiting = this.#registration.waiting;
    const installing = this.#registration.installing;
    const controller = navigator.serviceWorker.controller;

    if ((active && waiting) || (active && installing) || (waiting && installing)) {
      console.warn(`[KernelPanic] Multiple service workers detected:`, {
        active: active ? `${active.state} (script: ${active.scriptURL})` : 'none',
        waiting: waiting ? `${waiting.state} (script: ${waiting.scriptURL})` : 'none',
        installing: installing ? `${installing.state} (script: ${installing.scriptURL})` : 'none',
        controller: controller ? `${controller.state} (script: ${controller.scriptURL})` : 'none',
      });
    }
  }

  #setupUpdateListeners() {
    if (!this.#registration || this.#listenersSetup) return;

    this.#hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const previouslyControlled = this.#hadController;
      this.#hadController = Boolean(navigator.serviceWorker.controller);
      if (!previouslyControlled || this.#isUpdating) return;
      this.#dispatchRestartRequired();
    });

    setTimeout(() => {
      if (this.#registration?.waiting && navigator.serviceWorker.controller && !this.#isUpdating) {
        const waitingWorker = this.#registration.waiting;
        console.log(`[KernelPanic] Found waiting service worker from previous session`);
        this.#announceUpdate(waitingWorker);
      }
    }, 0);

    this.#registration.addEventListener('updatefound', () => {
      const newWorker = this.#registration?.installing;
      if (!newWorker) return;

      console.log(`[KernelPanic] New service worker installing...`);

      const handleStateChange = () => {
        console.log(`[KernelPanic] Service worker state changed to: ${newWorker.state}`);

        if (
          newWorker.state === 'installed' &&
          navigator.serviceWorker.controller &&
          !this.#isUpdating
        ) {
          this.#announceUpdate(newWorker);
          newWorker.removeEventListener('statechange', handleStateChange);
        }
      };

      newWorker.addEventListener('statechange', handleStateChange);
      handleStateChange();
    });

    this.#listenersSetup = true;
  }

  async #announceUpdate(pendingWorker: ServiceWorker): Promise<void> {
    if (this.#isUpdating || this.#announcedWorker === pendingWorker) return;
    const activeWorker = this.#registration?.active;
    if (!activeWorker || !navigator.serviceWorker.controller) return;

    try {
      const [active, pending] = await Promise.all([
        this.getReleaseInfo(activeWorker),
        this.getReleaseInfo(pendingWorker),
      ]);
      if (active.version === pending.version) {
        console.log(`[KernelPanic] Waiting worker is same version, skipping notification`);
        return;
      }

      const detail: UpdateAvailableDetail = Object.freeze({
        pendingWorker,
        active,
        pending,
        required: requiresUpdateAcknowledgement(active, pending),
      });
      this.#announcedWorker = pendingWorker;
      window.dispatchEvent(
        new CustomEvent<UpdateAvailableDetail>('sw-update-available', { detail })
      );
    } catch (error) {
      this.#announcedWorker = pendingWorker;
      console.error(`[KernelPanic] Refusing update with invalid release metadata:`, error);
      window.dispatchEvent(
        new CustomEvent('sw-update-error', {
          detail: { message: 'Update metadata is invalid. The current version remains active.' },
        })
      );
    }
  }

  #dispatchRestartRequired(): void {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    this.getReleaseInfo(controller)
      .then(release => {
        const detail: UpdateRestartRequiredDetail = Object.freeze({ release });
        window.dispatchEvent(
          new CustomEvent<UpdateRestartRequiredDetail>('sw-update-restart-required', { detail })
        );
      })
      .catch(error => {
        console.error(`[KernelPanic] Activated worker has invalid release metadata:`, error);
        const detail: UpdateRestartRequiredDetail = Object.freeze({ release: null });
        window.dispatchEvent(
          new CustomEvent<UpdateRestartRequiredDetail>('sw-update-restart-required', { detail })
        );
      });
  }

  async checkForUpdates() {
    if (!this.#registration) {
      console.warn(`[KernelPanic] Cannot check for updates: no registration`);
      return;
    }

    try {
      console.log(`[KernelPanic] Manually checking for service worker updates...`);
      await this.#registration.update();

      setTimeout(() => {
        if (this.#registration?.waiting && navigator.serviceWorker.controller) {
          console.log(`[KernelPanic] Update check found waiting service worker`);
          this.#announceUpdate(this.#registration.waiting);
        }
      }, 100);
    } catch (error) {
      console.error(`[KernelPanic] Failed to check for updates:`, error);
    }
  }

  getRegistration() {
    return this.#registration;
  }

  isRegistered() {
    return this.#isRegistered;
  }

  async getCacheInfo(): Promise<{ version: string } | null> {
    if (!this.#registration || !this.#registration.active) {
      return null;
    }

    return new Promise(resolve => {
      const messageChannel = new window.MessageChannel();
      messageChannel.port1.onmessage = event => {
        resolve(event.data);
      };

      this.#registration?.active?.postMessage({ type: 'GET_CACHE_INFO' }, [messageChannel.port2]);
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
      console.error(`[KernelPanic] Failed to get service worker version:`, error);
      return null;
    }
  }

  async getReleaseInfo(worker: ServiceWorker): Promise<UpdateRelease> {
    return new Promise((resolve, reject) => {
      const messageChannel = new window.MessageChannel();
      const timeout = window.setTimeout(() => {
        messageChannel.port1.close();
        reject(new Error('Timed out waiting for service-worker release metadata'));
      }, 1000);

      messageChannel.port1.onmessage = event => {
        window.clearTimeout(timeout);
        messageChannel.port1.close();
        try {
          resolve(parseUpdateRelease(event.data, 'service-worker release metadata'));
        } catch (error) {
          reject(error);
        }
      };

      worker.postMessage({ type: 'GET_RELEASE_INFO' }, [messageChannel.port2]);
    });
  }

  async getLatestVersion(): Promise<string | null> {
    if (!this.#registration) {
      return null;
    }

    const pendingWorker = this.#registration.waiting || this.#registration.installing;
    if (!pendingWorker) {
      return null;
    }

    try {
      return (await this.getReleaseInfo(pendingWorker)).version;
    } catch (error) {
      console.error(`[KernelPanic] Failed to get latest service worker version:`, error);
      return null;
    }
  }

  #dispatchUpdateProgress(status: string): void {
    const event = new CustomEvent('sw-update-progress', {
      detail: { status },
    });
    window.dispatchEvent(event);
  }

  async skipWaiting(worker?: ServiceWorker | null): Promise<void> {
    const targetWorker = worker || this.#registration?.waiting;

    if (!this.#registration || !targetWorker) {
      console.warn(`[KernelPanic] No waiting service worker to skip waiting`);
      return;
    }

    this.#dispatchUpdateProgress('Sending activation signal...');
    console.log(`[KernelPanic] Sending SKIP_WAITING message to service worker`);
    targetWorker.postMessage({ type: 'SKIP_WAITING' });

    return new Promise(resolve => {
      let resolved = false;

      const handleControllerChange = () => {
        if (resolved) return;
        if (navigator.serviceWorker.controller) {
          this.#dispatchUpdateProgress('New service worker activated...');
          console.log(`[KernelPanic] New service worker is now controlling the page`);
          setTimeout(() => {
            if (!this.#registration?.waiting || this.#registration?.waiting !== targetWorker) {
              console.log(`[KernelPanic] Old waiting worker has been terminated`);
              this.#dispatchUpdateProgress('Preparing to reload...');
            } else {
              console.warn(`[KernelPanic] Warning: Waiting worker still exists`);
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
              console.log(`[KernelPanic] New service worker is now controlling the page (delayed)`);
              this.#dispatchUpdateProgress('Preparing to reload...');
              if (!resolved) {
                resolved = true;
                resolve();
              }
            } else {
              console.warn(`[KernelPanic] No controller after skipWaiting, resolving anyway`);
              this.#dispatchUpdateProgress('Reloading...');
              if (!resolved) {
                resolved = true;
                resolve();
              }
            }
          }, 500);
        }
      };

      const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'SW_ACTIVATED') {
          console.log(`[KernelPanic] Service worker confirmed activation: ${event.data.version}`);
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
          console.log(`[KernelPanic] Skip waiting timeout, proceeding with reload`);
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
      console.warn(`[KernelPanic] Cache API not supported`);
      return;
    }

    try {
      const cacheNames = await caches.keys();
      const appCaches = cacheNames.filter(name => name.startsWith('kernel-panic-cache-'));

      console.log(`[KernelPanic] Clearing ${appCaches.length} cache(s):`, appCaches);

      await Promise.all(appCaches.map(cacheName => caches.delete(cacheName)));

      console.log(`[KernelPanic] Successfully cleared all caches`);

      if (this.#registration) {
        await this.#registration.unregister();
        console.log(`[KernelPanic] Service worker unregistered`);
        this.#isRegistered = false;
        this.#registration = null;
      }

      window.location.reload();
    } catch (error) {
      console.error(`[KernelPanic] Failed to clear caches:`, error);
      throw error;
    }
  }

  async handleUpdateNow(pendingWorker?: ServiceWorker | null): Promise<void> {
    if (this.#isUpdating) {
      console.log(`[KernelPanic] Update already in progress`);
      return;
    }

    this.#isUpdating = true;
    console.log(`[KernelPanic] Handling update now request`);

    try {
      await this.skipWaiting(pendingWorker);

      if (!navigator.serviceWorker.controller) {
        this.#dispatchUpdateProgress('Verifying service worker activation...');
        console.warn(
          `[KernelPanic] No service worker controller after skipWaiting, waiting a bit longer...`
        );
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (this.#registration?.waiting && this.#registration?.waiting === pendingWorker) {
        this.#dispatchUpdateProgress('Waiting for old worker to terminate...');
        console.warn(
          `[KernelPanic] Warning: Waiting worker still exists after skipWaiting. Waiting longer...`
        );
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (this.#registration.waiting === pendingWorker) {
          console.error(
            `[KernelPanic] Error: Waiting worker still exists. This may cause multiple workers.`
          );
        }
      }

      this.#dispatchUpdateProgress('Reloading page...');
      console.log(`[KernelPanic] Reloading page to use new service worker...`);
      window.location.reload();
    } catch (error) {
      console.error(`[KernelPanic] Failed to update service worker:`, error);
      this.#dispatchUpdateProgress('Update failed. Please try again.');
      this.#isUpdating = false;
      throw error;
    }
  }
}

export const serviceWorkerManager = new ServiceWorkerManager();

declare global {
  interface Window {
    serviceWorkerManager: ServiceWorkerManager;
  }
}

window.serviceWorkerManager = serviceWorkerManager;
