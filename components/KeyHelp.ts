/**
 * <key-help> — help overlay with tabbed How To Play / Map Key / Shortcuts.
 *
 * Reads `describeKeymap(scope)` from `/src/input/keyHelp.js` and map rows from
 * `/src/input/mapKeyRows.js`. Shortcuts tab is omitted on coarse-pointer devices.
 *
 * Usage:
 *   const help = document.querySelector('key-help');
 *   help.setScope('hub');     // or 'combat'
 *   help.show();
 *
 * The host shell owns `?` and Esc routing — see /index.js.
 */

import { h } from '/src/domUtils.js';
import { describeKeymap } from '/src/input/keyHelp.js';
import {
  MAP_KEY_UNIVERSAL,
  MAP_KEY_HUB,
  MAP_KEY_COMBAT_TERRAIN,
  MAP_KEY_COMBAT_HOSTILES,
  MAP_KEY_COMBAT_ALLIES,
  type MapKeyRow,
} from '/src/input/mapKeyRows.js';
import { ARCHETYPES } from '/src/game/archetypes/index.js';
import type { ArchetypeInfo } from '/src/game/archetypes/index.js';

const KEY_LABEL = Object.freeze({
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
});

const GROUPS = Object.freeze([
  { id: 'move', title: 'MOVEMENT' },
  { id: 'action', title: 'ACTIONS' },
  { id: 'system', title: 'SYSTEM' },
]);

type HelpTabId = 'play' | 'map' | 'keys';

/** True when the primary pointer is coarse (touch / most on-screen pads). */
function isCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

const CSS = `
:host {
  --help-bg: rgba(7, 18, 16, 0.96);
  --help-border: var(--accent-color, #00d9a5);
  --help-text: #c5efdf;
  --help-dim: #6ae8c8;
  --help-accent: var(--accent-color, #00d9a5);
  --help-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 45;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--help-text);
}

:host([open]) {
  display: flex;
}

.panel {
  background: var(--help-bg);
  border: 1px solid var(--help-border);
  border-radius: 6px;
  padding: 1rem 1.4rem 1.25rem;
  box-shadow: var(--help-shadow);
  min-width: min(380px, 92vw);
  max-width: min(640px, 96vw);
  max-height: min(88vh, 720px);
  display: flex;
  flex-direction: column;
}

.title {
  margin: 0 0 0.5rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--help-accent);
  border-bottom: 1px dashed var(--help-border);
  padding-bottom: 0.4rem;
  flex-shrink: 0;
}

.tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0 0 0.65rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px dashed rgba(0, 217, 165, 0.25);
  flex-shrink: 0;
}

.tab-btn {
  font: inherit;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  padding: 0.35rem 0.55rem;
  border: 1px solid rgba(0, 217, 165, 0.35);
  border-radius: 4px;
  background: transparent;
  color: var(--help-dim);
  cursor: pointer;
}

.tab-btn[aria-selected="true"] {
  color: var(--help-accent);
  border-color: var(--help-accent);
  background: rgba(0, 217, 165, 0.08);
}

.tab-body {
  display: grid;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.tab-pane {
  grid-area: 1 / 1;
  min-width: 0;
  width: 100%;
}

.tab-pane:not(.is-active) {
  visibility: hidden;
  pointer-events: none;
}

.intro p {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--help-text);
}

.intro p:last-child {
  margin-bottom: 0;
}

.tile-hints-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  column-gap: 1rem;
  align-items: start;
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
}

.controls-note {
  font-size: 0.78rem !important;
  color: var(--help-dim) !important;
  letter-spacing: 0.04em;
}

.section-label {
  margin: 0.35rem 0 0.2rem;
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  color: var(--help-dim);
  font-weight: 600;
}

.group-note {
  font-size: 0.78rem !important;
  color: var(--help-dim) !important;
  letter-spacing: 0.04em;
  margin: 0.25rem 1rem;
}

@media (pointer: coarse) {
  section.group h3 {
    font-size: 0.65rem !important;
  }
  dl.rows {
    font-size: 0.82rem;
  }
}

section.group {
  margin: 0.6rem 0 0;
  padding-bottom: 0.25rem;
}

section.group h3 {
  margin: 0 0 0.25rem;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  color: var(--help-dim);
}

dl.rows {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.18rem;
  margin: 0;
  font-size: 0.9rem;
}

dl.rows dt {
  color: var(--help-accent);
  white-space: nowrap;
  text-align: left;
}

dl.rows dd {
  margin: 0;
  color: var(--help-text);
}

.hint {
  text-align: center;
  font-size: 0.8rem;
  color: var(--help-dim);
  letter-spacing: 0.1em;
  margin-top: 0.8rem;
  flex-shrink: 0;
}
`;

function labelForKey(key: string) {
  return KEY_LABEL[key as keyof typeof KEY_LABEL] ?? key;
}

function joinKeys(keys: string[]) {
  return keys.map(labelForKey).join(' ');
}

function rowsFromMapKey(entries: readonly MapKeyRow[]) {
  const dl = h('dl', { className: 'rows' });
  for (const row of entries) {
    dl.appendChild(h('dt', { textContent: row.glyph }));
    dl.appendChild(h('dd', { textContent: row.label }));
  }
  return dl;
}

/** Keys routed to tab switching while the overlay is open (see index.ts). */
const TAB_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Tab', 'a', 'd']);

class KeyHelp extends HTMLElement {
  #scope = 'combat';
  #archetypeInfo: ArchetypeInfo | null = null;
  #activeTab: HelpTabId = 'play';
  #ready = false;
  #tabBarEl: HTMLDivElement | null = null;
  #body: HTMLDivElement | null = null;
  #panelEl: HTMLDivElement | null = null;
  #onBackdrop: EventListener | null = null;
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#tabBarEl = h('div', { className: 'tab-bar', role: 'tablist' }) as HTMLDivElement;
    this.#body = h('div', { className: 'tab-body' }) as HTMLDivElement;
    this.#panelEl = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── HELP ──' }) as HTMLHeadingElement,
      this.#tabBarEl,
      this.#body,
      h('p', {
        className: 'hint',
        textContent: '[ ←/→ tab  ·  ? or Esc to close ]',
      }) as HTMLParagraphElement,
    ]) as HTMLDivElement;
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    this.addEventListener('keydown', this.#onKeyDown);
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  setScope(scope: string, archetypeId?: string) {
    this.#scope = scope;
    this.#archetypeInfo =
      archetypeId && archetypeId in ARCHETYPES
        ? ARCHETYPES[archetypeId as keyof typeof ARCHETYPES]
        : null;
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => this.focus());
  }

  hide() {
    this.removeAttribute('open');
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
    return this.isOpen;
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  disconnectedCallback() {
    if (this.#onKeyDown) this.removeEventListener('keydown', this.#onKeyDown);
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  /** Used by index.ts to allow tab keys through the global swallow layer. */
  static isTabNavKey(key: string) {
    return TAB_NAV_KEYS.has(key);
  }

  #visibleTabs(): HelpTabId[] {
    const tabs: HelpTabId[] = ['play', 'map'];
    if (!isCoarsePointer()) tabs.push('keys');
    return tabs;
  }

  #switchTab(tab: HelpTabId) {
    if (tab === this.#activeTab) return;
    this.#activeTab = tab;
    this.#render();
    queueMicrotask(() => this.focus());
  }

  #switchTabRelative(delta: number) {
    const tabs = this.#visibleTabs();
    const idx = tabs.indexOf(this.#activeTab);
    if (idx < 0) return;
    const next = tabs[(idx + delta + tabs.length) % tabs.length];
    this.#switchTab(next);
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    evt.stopPropagation();

    if (evt.key === 'ArrowLeft' || evt.key === 'a') {
      evt.preventDefault();
      this.#switchTabRelative(-1);
      return;
    }
    if (evt.key === 'ArrowRight' || evt.key === 'd') {
      evt.preventDefault();
      this.#switchTabRelative(1);
      return;
    }
    if (evt.key === 'Tab') {
      evt.preventDefault();
      this.#switchTabRelative(1);
    }
  }

  #render() {
    if (!this.#body || !this.#tabBarEl) return;
    const touchDevice = isCoarsePointer();
    if (touchDevice && this.#activeTab === 'keys') {
      this.#activeTab = 'play';
    }

    while (this.#tabBarEl.firstChild) this.#tabBarEl.removeChild(this.#tabBarEl.firstChild);
    const tabs: { id: HelpTabId; label: string }[] = [
      { id: 'play', label: 'How To Play' },
      { id: 'map', label: 'Map Key' },
    ];
    if (!touchDevice) tabs.push({ id: 'keys', label: 'Shortcuts' });

    for (const tab of tabs) {
      const btn = h('button', {
        type: 'button',
        className: 'tab-btn',
        role: 'tab',
        textContent: tab.label,
      }) as HTMLButtonElement;
      btn.setAttribute('aria-selected', this.#activeTab === tab.id ? 'true' : 'false');
      btn.setAttribute('aria-controls', `key-help-pane-${tab.id}`);
      btn.addEventListener('click', () => this.#switchTab(tab.id));
      this.#tabBarEl.appendChild(btn);
    }

    while (this.#body.firstChild) this.#body.removeChild(this.#body.firstChild);
    const panes: { id: HelpTabId; el: HTMLElement }[] = [
      { id: 'play', el: this.#buildIntro(touchDevice) },
      { id: 'map', el: this.#buildMapKey() },
    ];
    if (!touchDevice) {
      panes.push({ id: 'keys', el: this.#buildKeybinds() });
    }
    for (const { id, el } of panes) {
      const active = id === this.#activeTab;
      const pane = h('div', {
        className: active ? 'tab-pane is-active' : 'tab-pane',
        id: `key-help-pane-${id}`,
        role: 'tabpanel',
      }) as HTMLDivElement;
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
      pane.appendChild(el);
      this.#body.appendChild(pane);
    }
    this.#body.scrollTop = 0;
  }

  #buildIntro(touchDevice = false) {
    const scope = this.#scope;

    const shared = h('p', {
      textContent:
        'Kernel Panic is turn-based on a grid: you spend action points (AP) to move one tile at a time and to use actions.',
    });

    const hubExtra = h('p', {
      textContent:
        'In the hub, walk up to the Curator or the crew terminal (‡ glyph) and use Interact to hear rumors, pick contracts, or open the crew roster.',
    });

    const perkHint = this.#archetypeInfo
      ? `Your archetype special (${this.#archetypeInfo.perkName}) is a strong ability`
      : 'Your archetype special (Vault, Slide, or Deploy) is a strong reposition';
    const combatExtra = h('p', {
      textContent: `Opposing hostiles act after you wait (.) and pass the round. Walls and corners break line of sight for ranged shots; melee is usually cheaper AP than firing. ${perkHint} — pick it, aim a direction when prompted, then confirm.`,
    });

    const moveHint = h('p', {
      textContent: 'Moving into a hostile attacks; into anything else, you interact.',
    });

    const turretHint =
      scope === 'combat' && this.#archetypeInfo?.id === 'tech'
        ? h('p', {
            textContent:
              'Your deployed turret (T) inherits your max HP and fires twice each time you wait — before hostiles move.',
          })
        : null;

    const controlHint = touchDevice
      ? null
      : h('p', {
          className: 'controls-note',
          textContent: 'Open the Shortcuts tab for the live key reference.',
        });

    const children = [
      shared,
      scope === 'hub' ? hubExtra : combatExtra,
      moveHint,
      turretHint,
      controlHint,
    ].filter(Boolean) as HTMLElement[];

    return h('div', { className: 'intro' }, children);
  }

  #buildMapKey() {
    const scope = this.#scope;
    const sections: HTMLElement[] = [rowsFromMapKey(MAP_KEY_UNIVERSAL)];

    if (scope === 'hub') {
      sections.push(rowsFromMapKey(MAP_KEY_HUB));
    } else {
      sections.push(
        rowsFromMapKey(MAP_KEY_COMBAT_TERRAIN),
        rowsFromMapKey(MAP_KEY_COMBAT_HOSTILES),
        rowsFromMapKey(MAP_KEY_COMBAT_ALLIES)
      );
    }

    return h('section', { className: 'tile-hints' }, [
      h('p', {
        className: 'section-label',
        textContent: scope === 'hub' ? 'HUB & UNIVERSAL' : 'COMBAT MAP',
      }),
      h('div', { className: 'tile-hints-content' }, sections),
    ]);
  }

  #buildKeybinds() {
    const rows = describeKeymap(this.#scope);
    const sections = [];
    for (const group of GROUPS) {
      const groupRows = rows.filter(r => r.group === group.id);
      if (groupRows.length === 0) continue;
      const dl = h('dl', { className: 'rows' });
      for (const r of groupRows) {
        const label = r.label.includes('{perkLabel}')
          ? r.label.replace('{perkLabel}', this.#archetypeInfo?.perkLabel ?? '')
          : r.label;
        dl.appendChild(h('dt', { textContent: joinKeys(r.keys as string[]) }));
        dl.appendChild(h('dd', { textContent: label }));
      }
      sections.push(
        h('section', { className: 'group' }, [h('h3', { textContent: group.title }), dl])
      );
    }

    return h('div', { className: 'keybinds' }, sections);
  }

  #emit(eventName: string, detail: unknown | null = null) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: detail ?? {},
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('key-help', KeyHelp);

export default KeyHelp;
