/**
 * <game-over> — full-screen terminal loss overlay. Shown when the campaign is
 * truly over: crew wipe, Score window closed, or the last operator flatlines
 * on a job. Distinct from `<crash-dump>`, which handles recoverable per-job
 * setbacks and successful exfil debriefs.
 *
 *   GAME OVER
 *   The Score window closed.
 *   Corp security caught up. The contract is cold…
 *   [ NEW CAMPAIGN ]
 *
 * Usage:
 *   const screen = document.querySelector('game-over');
 *   screen.addEventListener('new-run', () => finishEndedCampaign());
 *   screen.setTelemetry({ campaignEndReason: 'clock-expired', seed });
 *   screen.show();
 */

import { h } from '/src/domUtils.js';
import type { GameOverTelemetry } from '/src/types.js';

const CSS = `
:host {
  --go-accent: #ff3355;
  --go-bg: rgba(4, 2, 3, 0.98);
  --go-text: #f0d4da;
  --go-dim: #c96b7d;
  --go-shadow: 0 0 48px rgba(255, 51, 85, 0.35), 0 16px 48px rgba(0, 0, 0, 0.75);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--go-text);
  background:
    radial-gradient(ellipse at center, rgba(255, 51, 85, 0.12) 0%, transparent 65%),
    rgba(0, 0, 0, 0.88);
  animation: game-over-backdrop 2.4s ease-in-out infinite alternate;
}

:host([open]) {
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes game-over-backdrop {
  from { background-color: rgba(0, 0, 0, 0.86); }
  to { background-color: rgba(12, 2, 4, 0.92); }
}

.panel {
  background: var(--go-bg);
  border: 2px solid var(--go-accent);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--go-shadow);
  min-width: min(520px, 94vw);
  max-width: min(680px, 96vw);
  text-align: center;
}

.banner {
  margin: 0 0 0.35rem;
  font-size: clamp(1.75rem, 6vw, 2.5rem);
  letter-spacing: 0.28em;
  color: var(--go-accent);
  text-shadow: 0 0 18px rgba(255, 51, 85, 0.45);
  animation: game-over-pulse 1.8s ease-in-out infinite;
}

@keyframes game-over-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.82; }
}

.rule {
  margin: 0 auto 1.25rem;
  width: min(280px, 70%);
  border: none;
  border-top: 2px solid var(--go-accent);
  opacity: 0.7;
}

.reason {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  color: var(--go-text);
}

.detail {
  margin: 0 0 1.25rem;
  font-size: 0.9rem;
  color: var(--go-dim);
  line-height: 1.45;
}

.roster {
  margin: 0 0 1.25rem;
  padding: 0.65rem 0.85rem;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 51, 85, 0.28);
  border-radius: 4px;
  font-size: 0.85rem;
  text-align: left;
}

.roster dt {
  margin: 0;
  color: var(--go-dim);
  letter-spacing: 0.1em;
  font-size: 0.75rem;
}

.roster dd {
  margin: 0.35rem 0 0;
  display: grid;
  gap: 0.2rem;
}

.roster-line {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.roster-line .status {
  color: var(--go-accent);
  letter-spacing: 0.08em;
}

.meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.25rem;
  row-gap: 0.2rem;
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
  text-align: left;
}

.meta dt {
  color: var(--go-dim);
  letter-spacing: 0.08em;
}

.meta dd {
  margin: 0;
  word-break: break-word;
}

.actions {
  display: flex;
  justify-content: center;
}

button.new-campaign {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--go-accent);
  border: 2px solid var(--go-accent);
  padding: 0.65em 2.25em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1.05rem;
  letter-spacing: 0.2em;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.15s ease, color 0.15s ease;
}

button.new-campaign:hover,
button.new-campaign:focus-visible {
  background: var(--go-accent);
  color: #020403;
  outline: none;
}

button.new-campaign:active { transform: scale(0.98); }
`;

function hexSeed(seed: number) {
  if (!Number.isFinite(seed)) return '?';
  return `0x${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function reasonCopy(telemetry: GameOverTelemetry): string {
  if (telemetry.campaignEndReason === 'clock-expired') {
    return 'The Score window closed.';
  }
  if (telemetry.campaignTerminal) {
    return 'Final operator lost on the wire.';
  }
  return 'No surviving operators.';
}

function detailCopy(telemetry: GameOverTelemetry): string {
  if (telemetry.campaignEndReason === 'clock-expired') {
    return 'Corp security caught up. The contract is cold and this campaign is over.';
  }
  if (telemetry.campaignTerminal) {
    const label = telemetry.cause ?? telemetry.archetype ?? 'operator';
    return `Last channel down — ${label}. No backup left on the roster.`;
  }
  const salvageNote =
    telemetry.salvage != null && typeof telemetry.salvage === 'number' && telemetry.salvage >= 0
      ? `Pool salvage ${telemetry.salvage} is lost with the run.`
      : 'Every crew slot on the roster is flatlined.';
  return `${salvageNote} Start a new campaign to run the board again.`;
}

function causeLabel(telemetry: GameOverTelemetry): string {
  if (telemetry.campaignEndReason === 'clock-expired') return 'window-closed';
  if (telemetry.campaignTerminal) return 'final-operator-lost';
  return 'crew-wipe';
}

class GameOver extends HTMLElement {
  #telemetry: GameOverTelemetry | null = null;
  #ready = false;
  #els: {
    reason: HTMLElement;
    detail: HTMLElement;
    roster: HTMLElement;
    rosterList: HTMLElement;
    seedDd: HTMLElement;
    causeDd: HTMLElement;
    newCampaignBtn: HTMLButtonElement;
  } | null = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const reason = h('p', { className: 'reason' });
    const detail = h('p', { className: 'detail' });
    const rosterList = h('dd');
    const seedDd = h('dd', { id: 'seed' });
    const causeDd = h('dd', { id: 'cause' });
    const roster = h('dl', { className: 'roster' }, [
      h('dt', { textContent: 'ROSTER' }),
      rosterList,
    ]);

    const newCampaignBtn = h('button', {
      type: 'button',
      className: 'new-campaign',
      textContent: '[ NEW CAMPAIGN ]',
    }) as HTMLButtonElement;
    newCampaignBtn.addEventListener('click', () => this.#emit('new-run'));

    const panel = h('section', { className: 'panel' }, [
      h('h1', { className: 'banner', textContent: 'GAME OVER' }),
      h('hr', { className: 'rule' }),
      reason,
      detail,
      roster,
      h('dl', { className: 'meta' }, [
        h('dt', { textContent: 'seed' }),
        seedDd,
        h('dt', { textContent: 'cause' }),
        causeDd,
      ]),
      h('div', { className: 'actions' }, [newCampaignBtn]),
    ]);
    shadow.appendChild(panel);
    this.#els = { reason, detail, roster, rosterList, seedDd, causeDd, newCampaignBtn };
    this.#ready = true;
    if (this.#telemetry) this.#render();
  }

  setTelemetry(telemetry: GameOverTelemetry) {
    if (!telemetry || typeof telemetry !== 'object') {
      throw new TypeError('<game-over>.setTelemetry requires a telemetry object');
    }
    const { campaignEndReason, campaignTerminal } = telemetry;
    if (!campaignEndReason && !campaignTerminal) {
      throw new Error('<game-over>: requires campaignEndReason or campaignTerminal');
    }
    this.#telemetry = { ...telemetry };
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      (this.shadowRoot?.querySelector('button.new-campaign') as HTMLButtonElement)?.focus();
    });
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  #render() {
    if (!this.#els || !this.#telemetry) return;
    const t = this.#telemetry;
    this.#els.reason.textContent = reasonCopy(t);
    this.#els.detail.textContent = detailCopy(t);
    this.#els.seedDd.textContent = hexSeed(t.seed ?? 0);
    this.#els.causeDd.textContent = causeLabel(t);

    if (t.campaignEndReason === 'clock-expired') {
      this.#els.roster.hidden = true;
      return;
    }

    const roster = t.crewRoster ?? [];
    this.#els.roster.hidden = roster.length === 0;
    this.#els.rosterList.replaceChildren(
      ...roster.map(op =>
        h('div', { className: 'roster-line' }, [
          h('span', { textContent: `${op.callsign} (${op.archetype})` }),
          h('span', {
            className: 'status',
            textContent: op.flatlined ? 'FLATLINED' : 'ACTIVE',
          }),
        ])
      )
    );
  }

  #emit(eventName: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(eventName, { detail: { ...detail, telemetry: { ...this.#telemetry } } })
    );
  }
}

customElements.define('game-over', GameOver);

export default GameOver;
