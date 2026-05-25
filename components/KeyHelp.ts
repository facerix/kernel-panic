/**
 * <key-help> — help overlay: how to play, then scope-filtered shortcuts.
 *
 * Reads `describeKeymap(scope)` from `/src/input/keyHelp.js` so the rendered
 * list is the same source of truth a unit test ties to the keymap itself —
 * if a future milestone adds a binding to `keymap.js` without an entry in
 * `HELP_ROWS`, the drift test fails before this panel can lie to the player.
 *
 * Usage:
 *   const help = document.querySelector('key-help');
 *   help.setScope('hub');     // or 'combat'
 *   help.show();              // help.hide() / help.toggle() also exist
 *
 * The host shell owns `?` and Esc routing (so the same `?` can also dismiss
 * other panels) — see /index.js.
 */

import { h } from '/src/domUtils.js';
import { describeKeymap } from '/src/input/keyHelp.js';
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
  { id: 'move', title: 'MOVE' },
  { id: 'action', title: 'ACTION' },
  { id: 'system', title: 'SYSTEM' },
]);

const GROUP_NOTES: Record<string, string> = Object.freeze({
  move: 'Move into a hostile = melee, into an ally or neutral = interact',
  action: '',
  system: '',
});

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
  max-width: min(560px, 96vw);
}

.title {
  margin: 0 0 0.65rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--help-accent);
  border-bottom: 1px dashed var(--help-border);
  padding-bottom: 0.4rem;
}

.intro,
.tile-hints {
  margin: 0 0 0.85rem;
  padding: 0 0 0.75rem;
  border-bottom: 1px dashed rgba(0, 217, 165, 0.25);
}

.intro-heading {
  margin: 0 0 0.45rem;
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  color: var(--help-dim);
  font-weight: 600;
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

.tile-hints {
  .tile-hints-content {
    display: grid;
    grid-template-columns: max-content 1fr;
    grid-auto-flow: column;
    align-items: baseline;
    column-gap: 2rem;
    row-gap: 0.18rem;
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
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
  .section-label {
    font-size: 0.72rem;
    opacity: 0.95;
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
  font-size: 0.8rem;
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
}
`;

function labelForKey(key: string) {
  return KEY_LABEL[key as keyof typeof KEY_LABEL] ?? key;
}

function joinKeys(keys: string[]) {
  return keys.map(labelForKey).join(' ');
}

class KeyHelp extends HTMLElement {
  #scope = 'combat';
  #archetypeInfo: ArchetypeInfo | null = null;
  #ready = false;
  #body: HTMLDivElement | null = null;
  #panelEl: HTMLDivElement | null = null;
  #onBackdrop: EventListener | null = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    this.#body = h('div') as HTMLDivElement;
    this.#panelEl = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── HELP ──' }) as HTMLHeadingElement,
      this.#body,
      h('p', { className: 'hint', textContent: '[ ? or Esc to close ]' }) as HTMLParagraphElement,
    ]) as HTMLDivElement;
    shadow.appendChild(this.#panelEl);

    // Backdrop click closes on outside click.
    this.#onBackdrop = evt => {
      if (!evt.composedPath().includes(this.#panelEl as EventTarget)) this.#emit('dismiss');
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    this.#render();
  }

  /**
   * Filter the rows shown. Re-renders immediately if connected; throws on an
   * unknown scope to match the crash-over-silent-fallback rule (a typo
   * elsewhere would otherwise render an empty help panel).
   */
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
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  // ---- internal ---------------------------------------------------------

  #render() {
    if (!this.#body) return;
    while (this.#body.firstChild) this.#body.removeChild(this.#body.firstChild);
    this.#body.appendChild(this.#buildIntro());
    this.#body.appendChild(this.#buildTileHints());
    this.#body.appendChild(h('h3', { className: 'section-label', textContent: 'SHORTCUTS' }));
    // `describeKeymap` throws on a bad scope — propagate, don't paper over.
    const rows = describeKeymap(this.#scope);
    for (const group of GROUPS) {
      const groupRows = rows.filter(r => r.group === group.id);
      if (groupRows.length === 0) continue;
      const bodyChildren = [h('h3', { textContent: group.title })];
      const note = GROUP_NOTES[group.id];
      if (note) {
        bodyChildren.push(h('p', { className: 'group-note', textContent: note }));
      }
      const dl = h('dl', { className: 'rows' });
      for (const r of groupRows) {
        const label = r.label.includes('{perkLabel}')
          ? r.label.replace('{perkLabel}', this.#archetypeInfo?.perkLabel ?? '')
          : r.label;
        dl.appendChild(h('dt', { textContent: joinKeys(r.keys as string[]) }));
        dl.appendChild(h('dd', { textContent: label }));
      }
      bodyChildren.push(dl);
      this.#body.appendChild(h('section', { className: 'group' }, bodyChildren));
    }
  }

  /**
   * Short gameplay primer + pointer-specific control hint. Copy is hand-tuned
   * to match Hub vs Combat scope from `helpScopeForRunState()` in index.js.
   */
  #buildIntro() {
    const scope = this.#scope;
    const coarse = isCoarsePointer();

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
      textContent: `Opposing drones and defenses act after you wait (.) and pass the round. Walls and corners break line of sight for ranged shots; melee is usually cheaper AP than firing. ${perkHint} — pick it, aim a direction when prompted, then confirm.`,
    });

    const controlHint = coarse
      ? h('p', {
          className: 'controls-note',
          textContent:
            'On touch devices the on-screen pad along the bottom sends the same intents as the shortcut list below — use it first, and treat the keys as a reference.',
        })
      : h('p', {
          className: 'controls-note',
          textContent: 'Use the shortcut table below as a live reference while you play.',
        });

    const children = [
      h('h3', { className: 'intro-heading', textContent: 'HOW TO PLAY' }),
      shared,
      scope === 'hub' ? hubExtra : combatExtra,
      controlHint,
    ];

    return h('div', { className: 'intro' }, children);
  }

  #buildTileHints() {
    const scope = this.#scope;

    const universalTiles = h('dl', { className: 'rows' }, [
      h('dt', { textContent: '#' }),
      h('dd', { textContent: 'wall' }),
      h('dt', { textContent: '=' }),
      h('dd', { textContent: 'cover' }),
      h('dt', { textContent: '¤' }),
      h('dd', { textContent: 'exit' }),
    ]);
    const hubTiles = h('dl', { className: 'rows' }, [
      h('dt', { textContent: 'C' }),
      h('dd', { textContent: 'Curator' }),
      h('dt', { textContent: '¥' }),
      h('dd', { textContent: "Finn's shop" }),
      h('dt', { textContent: '‡' }),
      h('dd', { textContent: 'Crew terminal' }),
    ]);
    const combatTiles = h('dl', { className: 'rows' }, [
      h('dt', { textContent: '░' }),
      h('dd', { textContent: 'smoke' }),
      h('dt', { textContent: '▓' }),
      h('dd', { textContent: 'hazard (1 dmg/turn)' }),
      h('dt', { textContent: '‡' }),
      h('dd', { textContent: 'terminal' }),
      h('dt', { textContent: '!' }),
      h('dd', { textContent: 'objective pickup' }),
      h('dt', { textContent: '&' }),
      h('dd', { textContent: 'handoff contact' }),
      h('dt', { textContent: 'X' }),
      h('dd', { textContent: 'deny target' }),
      h('dt', { textContent: '§' }),
      h('dd', { textContent: 'dual-site sync pad' }),
      h('dt', { textContent: '$' }),
      h('dd', { textContent: 'corp turret' }),
      h('dt', { textContent: '~' }),
      h('dd', { textContent: 'relay node' }),
    ]);

    const children = [
      universalTiles,
      scope === 'hub' ? hubTiles : null,
      scope === 'combat' ? combatTiles : null,
    ].filter(Boolean);

    return h('section', { className: 'tile-hints' }, [
      h('h3', { className: 'section-label', textContent: 'KEY TO MAP SYMBOLS' }),
      h('div', { className: 'tile-hints-content' }, children as HTMLElement[]),
    ]);
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
