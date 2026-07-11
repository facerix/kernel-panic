/**
 * <crew-inventory> — the Hub's read-only campaign stash overlay.
 *
 * Two sections:
 *   1. **SALVAGE** — the campaign-wide accumulated wallet (so the player can
 *      audit typed totals without opening the shop).
 *   2. **STOLEN KEYCARDS** — the persistent keycard inventory, each labelled by
 *      the location it was lifted from (e.g. "Redline server farm").
 *
 * No consumables (those are operator-held, not a shared crew pool) and nothing
 * to activate — the interactive kit lives on `<combat-inventory>`.
 */

import { emptySalvage, type TypedSalvage } from '/src/game/salvage.js';
import type { KeyItemView } from '/src/shell/domTypes.js';
import { InventoryOverlay } from '/components/InventoryOverlay.js';

class CrewInventory extends InventoryOverlay {
  setContents({
    salvage = emptySalvage(),
    keyItems = [] as KeyItemView[],
  }: {
    salvage?: TypedSalvage;
    keyItems?: KeyItemView[];
  } = {}) {
    this.salvage = salvage;
    this.keyItems = keyItems;
    if (this.ready) this.render();
  }

  protected panelTitle(): string {
    return '── INVENTORY ──';
  }

  protected renderBody(): void {
    this.renderSalvageSection();
    this.renderKeycardSection('STOLEN KEYCARDS', ki => ki.locationName ?? ki.label);
  }

  protected hintText(): string {
    if (this.salvageIsEmpty && this.keyItems.length === 0) return 'Nothing stashed. [ Esc close ]';
    return '[ Esc close ]';
  }
}

customElements.define('crew-inventory', CrewInventory);

export default CrewInventory;
