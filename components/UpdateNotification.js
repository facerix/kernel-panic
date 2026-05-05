/**
 * UpdateNotification Web Component
 * Displays a notification when a service worker update is available
 * Uses Shadow DOM with encapsulated styles
 */

class UpdateNotification extends HTMLElement {
  constructor() {
    super();
    this.pendingWorker = null;
    this.isVisible = false;
    this.isUpdating = false;
    this.boundHandleUpdateNow = this.handleUpdateNow.bind(this);
    this.boundHandleUpdateLater = this.handleUpdateLater.bind(this);

    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    this.cleanupEventListeners();
    if (this._updateProgressHandler) {
      window.removeEventListener('sw-update-progress', this._updateProgressHandler);
      this._updateProgressHandler = null;
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --update-notification-bg: linear-gradient(135deg, #7a7a7a 0%, #3a3a3a 50%, #5a5a5a 100%);
          --update-notification-color: white;
          --update-notification-border: transparent;
          --update-notification-btn-bg: white;
          --update-notification-btn-color: #5a5a5a;
          --update-notification-btn-hover: #f0f0f0;
        }

        .update-notification {
          position: fixed;
          top: max(12px, env(safe-area-inset-top, 0px));
          right: max(12px, env(safe-area-inset-right, 0px));
          left: auto;
          background: var(--update-notification-bg);
          color: var(--update-notification-color);
          padding: 15px;
          border-radius: 8px;
          border: 1px solid var(--update-notification-border);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 1000;
          max-width: min(300px, calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
          box-sizing: border-box;
          display: none;
        }

        @media (max-width: 360px) {
          .update-notification {
            left: max(12px, env(safe-area-inset-left, 0px));
            right: max(12px, env(safe-area-inset-right, 0px));
            max-width: none;
          }
        }

        .update-notification strong {
          display: block;
          margin-bottom: 8px;
        }

        .update-notification p {
          margin: 12px 0;
        }

        .update-notification button {
          background: var(--update-notification-btn-bg);
          color: var(--update-notification-btn-color);
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          margin: 8px 8px 0 0;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
          font-family: inherit;
        }

        .update-notification button:hover:not(:disabled) {
          background: var(--update-notification-btn-hover);
        }

        .update-notification button:active:not(:disabled) {
          transform: scale(0.98);
        }

        .update-notification button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .updating-state {
          display: none;
        }

        .updating-state.active {
          display: block;
        }

        .update-actions {
          display: block;
        }

        .update-actions.hidden {
          display: none;
        }

        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid color-mix(in srgb, var(--update-notification-color) 30%, transparent);
          border-top-color: var(--update-notification-color);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          vertical-align: middle;
          margin-right: 8px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .update-status {
          font-size: 13px;
          opacity: 0.9;
          margin-top: 8px;
        }
      </style>
      <div class="update-notification">
        <strong class="title">Update Available!</strong>
        <p class="message">A new version is ready.</p>
        <div class="update-actions">
          <button class="update-now">Update Now</button>
          <button class="update-later">Later</button>
        </div>
        <div class="updating-state">
          <div class="spinner"></div>
          <p class="update-status">Please wait while we install the update.</p>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const updateNowBtn = this.shadowRoot.querySelector('.update-now');
    const updateLaterBtn = this.shadowRoot.querySelector('.update-later');

    if (updateNowBtn) {
      updateNowBtn.addEventListener('click', this.boundHandleUpdateNow);
    }

    if (updateLaterBtn) {
      updateLaterBtn.addEventListener('click', this.boundHandleUpdateLater);
    }
  }

  cleanupEventListeners() {
    const updateNowBtn = this.shadowRoot.querySelector('.update-now');
    const updateLaterBtn = this.shadowRoot.querySelector('.update-later');

    if (updateNowBtn) {
      updateNowBtn.removeEventListener('click', this.boundHandleUpdateNow);
    }

    if (updateLaterBtn) {
      updateLaterBtn.removeEventListener('click', this.boundHandleUpdateLater);
    }
  }

  show(pendingWorker) {
    this.pendingWorker = pendingWorker;
    const notification = this.shadowRoot.querySelector('.update-notification');

    if (notification) {
      this.style.display = 'block';
      notification.style.display = 'block';
      this.isVisible = true;

      this.dispatchEvent(
        new CustomEvent('update-notification-shown', {
          detail: { pendingWorker },
          bubbles: true,
          composed: true,
        })
      );
    } else {
      console.error('[UpdateNotification] Could not find .update-notification element');
    }
  }

  hide() {
    const notification = this.shadowRoot.querySelector('.update-notification');

    if (notification) {
      this.style.display = 'none';
      notification.style.display = 'none';
      this.isVisible = false;

      this.dispatchEvent(
        new CustomEvent('update-notification-hidden', {
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  showUpdating(status = 'Please wait while we install the update.') {
    this.isUpdating = true;
    const notification = this.shadowRoot.querySelector('.update-notification');
    const actions = this.shadowRoot.querySelector('.update-actions');
    const updatingState = this.shadowRoot.querySelector('.updating-state');
    const statusText = this.shadowRoot.querySelector('.update-status');
    const title = this.shadowRoot.querySelector('.title');
    const message = this.shadowRoot.querySelector('.message');

    if (notification && actions && updatingState) {
      actions.classList.add('hidden');
      updatingState.classList.add('active');
      if (statusText) {
        statusText.textContent = status;
      }
      if (title) {
        title.textContent = 'Updating...';
      }
      if (message) {
        message.style.display = 'none';
      }

      const buttons = this.shadowRoot.querySelectorAll('button');
      buttons.forEach(btn => {
        btn.disabled = true;
      });
    }
  }

  handleUpdateNow() {
    this.showUpdating('Activating new service worker...');

    this.dispatchEvent(
      new CustomEvent('update-accepted', {
        detail: { pendingWorker: this.pendingWorker },
        bubbles: true,
        composed: true,
      })
    );

    if (window.serviceWorkerManager) {
      const handleUpdateProgress = event => {
        if (event.detail && event.detail.status) {
          this.showUpdating(event.detail.status);
        }
      };

      this._updateProgressHandler = handleUpdateProgress;
      window.addEventListener('sw-update-progress', handleUpdateProgress);

      window.serviceWorkerManager.handleUpdateNow(this.pendingWorker).catch(error => {
        console.error('[UpdateNotification] Update failed:', error);
        this.showUpdating('Update failed. Please try again.');
        this.isUpdating = false;
        const buttons = this.shadowRoot.querySelectorAll('button');
        buttons.forEach(btn => {
          btn.disabled = false;
        });
        if (this._updateProgressHandler) {
          window.removeEventListener('sw-update-progress', this._updateProgressHandler);
          this._updateProgressHandler = null;
        }
      });
    } else {
      console.error('[UpdateNotification] ServiceWorkerManager not available');
      this.hide();
    }
  }

  handleUpdateLater() {
    this.dispatchEvent(
      new CustomEvent('update-dismissed', {
        bubbles: true,
        composed: true,
      })
    );

    this.hide();
  }

  get visible() {
    return this.isVisible;
  }

  get pendingWorkerInstance() {
    return this.pendingWorker;
  }
}

customElements.define('update-notification', UpdateNotification);

export default UpdateNotification;
