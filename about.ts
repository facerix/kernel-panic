import { serviceWorkerManager } from './src/ServiceWorkerManager.js';
import type {
  UpdateAvailableDetail,
  UpdateRestartRequiredDetail,
} from './src/ServiceWorkerManager.js';
import '/components/UpdateNotification.js';
import '/components/ConfirmationModal.js';

interface ConfirmationModal extends HTMLElement {
  showModal(
    message: string,
    buttons: { btnClearCache: HTMLButtonElement; clearCacheStatus: HTMLSpanElement }
  ): void;
}

interface UpdateNotification extends HTMLElement {
  show(update: UpdateAvailableDetail): void;
  showRestartRequired(release: UpdateRestartRequiredDetail['release']): void;
  showUnavailable(message: string): void;
  showUpdating(status?: string): void;
  showFailure(message: string): void;
}

const whenLoaded = Promise.all([
  customElements.whenDefined('update-notification'),
  customElements.whenDefined('confirmation-modal'),
]);

whenLoaded.then(async () => {
  const updateNotification = document.querySelector('update-notification') as UpdateNotification;
  const confirmationModal = document.querySelector('confirmation-modal') as ConfirmationModal;

  window.addEventListener('sw-update-available', event => {
    console.log('Service worker update available, showing notification');
    updateNotification?.show((event as CustomEvent<UpdateAvailableDetail>).detail);
  });
  window.addEventListener('sw-update-restart-required', event => {
    const detail = (event as CustomEvent<UpdateRestartRequiredDetail>).detail;
    updateNotification?.showRestartRequired(detail.release);
  });
  window.addEventListener('sw-update-error', event => {
    const detail = (event as CustomEvent<{ message: string }>).detail;
    updateNotification?.showUnavailable(detail.message);
  });
  window.addEventListener('sw-update-progress', event => {
    const detail = (event as CustomEvent<{ status: string }>).detail;
    updateNotification?.showUpdating(detail.status);
  });
  updateNotification?.addEventListener('update-accepted', event => {
    const pendingWorker = (event as CustomEvent<{ pendingWorker: ServiceWorker }>).detail
      .pendingWorker;
    serviceWorkerManager.handleUpdateNow(pendingWorker).catch(error => {
      console.error('[about] Update failed:', error);
      updateNotification.showFailure('Update failed. The current version remains active.');
    });
  });
  updateNotification?.addEventListener('update-restart-requested', () => {
    window.location.reload();
  });

  await serviceWorkerManager.register();

  const version = document.getElementById('version') as HTMLSpanElement;
  const latestVersion = document.getElementById('latestVersion');
  const latestVersionContainer = document.getElementById('latestVersionContainer');
  const noUpdateContainer = document.getElementById('noUpdateContainer');
  const btnUpdate = document.getElementById('btnUpdate');

  const currentVersion = await serviceWorkerManager.getVersion();
  if (currentVersion) {
    version.innerText = currentVersion;
  } else {
    version.innerText = 'Not available';
  }

  const latestVersionInfo = await serviceWorkerManager.getLatestVersion();
  if (latestVersion && latestVersionContainer && noUpdateContainer) {
    if (latestVersionInfo && latestVersionInfo !== currentVersion) {
      latestVersion.innerText = latestVersionInfo;
      latestVersionContainer.style.display = 'flex';
      noUpdateContainer.style.display = 'none';
    } else {
      latestVersionContainer.style.display = 'none';
      if (currentVersion) {
        noUpdateContainer.style.display = 'block';
      } else {
        noUpdateContainer.style.display = 'none';
      }
    }
  }

  btnUpdate?.addEventListener('click', () => {
    serviceWorkerManager.checkForUpdates();
  });

  const btnClearCache = document.getElementById('btnClearCache') as HTMLButtonElement;
  const clearCacheStatus = document.getElementById('clearCacheStatus') as HTMLSpanElement;

  btnClearCache?.addEventListener('click', async () => {
    confirmationModal?.showModal('This will clear all cached data and reload the page. Continue?', {
      btnClearCache: btnClearCache,
      clearCacheStatus: clearCacheStatus,
    });
    confirmationModal?.addEventListener('confirm', async () => {
      if (clearCacheStatus) {
        btnClearCache.disabled = true;
        clearCacheStatus.innerText = 'Clearing caches...';
        try {
          await serviceWorkerManager.clearAllCaches();
        } catch (error) {
          console.error('Failed to clear caches:', error);
          clearCacheStatus.innerText = 'Failed to clear caches';
          btnClearCache.disabled = false;
        }
      }
    });
    confirmationModal?.addEventListener('cancel', () => {
      btnClearCache.disabled = false;
      clearCacheStatus && (clearCacheStatus.innerText = '');
    });
  });
});
