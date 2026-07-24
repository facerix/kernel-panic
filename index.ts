/**
 * Game shell entry — component registration and boot only.
 * Orchestration lives in `/src/shell/shellRuntime.ts` via {@link GameShell}.
 */

import * as gameShell from '/src/shell/shellRuntime.js';

import '/components/ConfirmationModal.js';
import '/components/UpdateNotification.js';
import '/components/TouchPad.js';
import '/components/ContractSelect.js';
import '/components/RunBriefing.js';
import '/components/CrashDump.js';
import '/components/GameOver.js';
import '/components/FaultScreen.js';
import '/components/SystemStart.js';
import '/components/CuratorBriefing.js';
import '/components/InitialRecruit.js';
import '/components/CrewList.js';
import '/components/CrewRoster.js';
import '/components/FinnShop.js';
import '/components/ClinicModal.js';
import '/components/SettingsModal.js';
import '/components/CombatInventory.js';
import '/components/CrewInventory.js';
import '/components/ChronicleArchive.js';
import KeyHelp from '/components/KeyHelp.js';

const allComponentsReady = Promise.all([
  customElements.whenDefined('confirmation-modal'),
  customElements.whenDefined('update-notification'),
  customElements.whenDefined('touch-pad'),
  customElements.whenDefined('contract-select'),
  customElements.whenDefined('run-briefing'),
  customElements.whenDefined('crash-dump'),
  customElements.whenDefined('game-over'),
  customElements.whenDefined('fault-screen'),
  customElements.whenDefined('system-start'),
  customElements.whenDefined('curator-briefing'),
  customElements.whenDefined('initial-recruit'),
  customElements.whenDefined('crew-list'),
  customElements.whenDefined('crew-roster'),
  customElements.whenDefined('finn-shop'),
  customElements.whenDefined('clinic-modal'),
  customElements.whenDefined('settings-modal'),
  customElements.whenDefined('combat-inventory'),
  customElements.whenDefined('crew-inventory'),
  customElements.whenDefined('chronicle-archive'),
  customElements.whenDefined('key-help'),
]);

allComponentsReady
  .then(() => {
    gameShell.boot().catch(err => {
      console.error('[shell] boot failed', err);
      const statusEl = document.getElementById('game-status');
      if (statusEl) {
        statusEl.textContent = `BOOT ERROR — ${err instanceof Error ? err.message : String(err)}`;
      }
    });
  })
  .catch(err => {
    console.error('[shell] display components failed to load', err);
    const statusEl = document.getElementById('game-status');
    if (statusEl) {
      statusEl.textContent = `BOOT ERROR — ${err instanceof Error ? err.message : String(err)}`;
    }
  });

// Re-export for modules that expect KeyHelp on the entry graph.
void KeyHelp;
