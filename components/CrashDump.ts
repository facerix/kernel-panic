/**
 * <crash-dump> — DOM overlay shown while `Run.state === RESULT`, when
 * `Campaign.state === ENDED` (restore), or for the terminal job death that
 * wipes the crew. Renders the run's telemetry as a faux kernel-panic stack
 * trace (on DEATH) or a clean "JACK OUT" debrief (on EXIT). Campaign wipe uses
 * `outcome: 'campaign-over'` or `campaignTerminal: true` on a death payload.
 * Same component, different copy — keeps the shell's overlay count down per
 * the M8 plan.
 *
 *   *** KERNEL PANIC ***
 *   fault:  unhandled_exception_in_meatspace
 *   addr:   0x00000@meatspace
 *   trace:
 *     0x01  razor::take_damage(2)            <killed>
 *     0x02  combat::resolveRanged(drone-1)
 *   seed:   0x1A4F22B9
 *   turn:   24
 *   kills:  3
 *   [ RETURN TO HUB ]
 *
 * Usage:
 *   const dump = document.querySelector('crash-dump');
 *   dump.addEventListener('new-run', () => { dataStore.deleteCampaign(); startFreshCampaign(); });
 *   dump.setTelemetry({ outcome, archetype, turn, kills, cause, seed, hpAtDeath });
 *   dump.show();
 *
 * Visual verification via the shell — same rule as <touch-pad> / <run-briefing>.
 */

import { h } from '/src/domUtils.js';
import type { Telemetry } from '/src/types.js';

type CrewMemberStub = { callsign: string; archetype: string; flatlined: boolean };

const CSS = `
:host {
  --crash-bg: rgba(7, 12, 11, 0.97);
  --crash-text: #d6f3e3;
  --crash-dim: #6ae8c8;
  --crash-accent: var(--accent-color, #00d9a5);
  --crash-warn: #ff5577;
  --crash-border: var(--crash-accent);
  --crash-shadow: 0 0 32px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.55);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--crash-text);
}

:host([open]) {
  display: flex;
  align-items: center;
  justify-content: center;
}

:host([outcome="death"]),
:host([outcome="campaign-over"]) {
  --crash-accent: var(--crash-warn);
  --crash-border: var(--crash-warn);
}

.panel {
  background: var(--crash-bg);
  border: 1px solid var(--crash-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--crash-shadow);
  min-width: min(460px, 92vw);
  max-width: min(640px, 96vw);
}

.title {
  margin: 0 0 1rem;
  text-align: center;
  font-size: 1rem;
  letter-spacing: 0.18em;
  color: var(--crash-accent);
  border-bottom: 1px dashed var(--crash-border);
  padding-bottom: 0.5rem;
}

.fault {
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
  color: var(--crash-dim);
  white-space: pre;
}

.trace {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(106, 232, 200, 0.18);
  border-radius: 4px;
  font-size: 0.85rem;
  white-space: pre;
  overflow-x: auto;
  color: var(--crash-text);
}

.trace .killed {
  color: var(--crash-warn);
}

.meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.25rem;
  row-gap: 0.2rem;
  font-size: 0.9rem;
  margin: 0 0 1.25rem;
}

.meta dt {
  color: var(--crash-dim);
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

button.new-run {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--crash-accent);
  border: 1px solid var(--crash-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.16em;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.15s ease, color 0.15s ease;
}

button.new-run:hover,
button.new-run:focus-visible {
  background: var(--crash-accent);
  color: #020403;
  outline: none;
}

button.new-run:active { transform: scale(0.98); }
`;

function hexSeed(seed: number) {
  if (!Number.isFinite(seed)) return '?';
  return `0x${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function deathTitle() {
  return '*** KERNEL PANIC ***';
}

function exitTitle() {
  return '*** JACK OUT ***';
}

function campaignOverTitle() {
  return '*** CAMPAIGN TERMINATED ***';
}

function deathFault() {
  return ['fault:  unhandled_exception_in_meatspace', 'addr:   0x00000@meatspace', 'trace:'].join(
    '\n'
  );
}

function exitFault() {
  return ['status: exfil_successful', 'addr:   0x00000@meatspace', 'trace:'].join('\n');
}

function campaignOverFault() {
  return [
    'fault:  collective_operator_pool_exhausted',
    'addr:   0x00000@campaign_layer',
    'trace:',
  ].join('\n');
}

function campaignTerminalFault() {
  return [
    'notice: final_operator_channel_lost — no surviving crew',
    'fault:  unhandled_exception_in_meatspace',
    'addr:   0x00000@meatspace',
    'trace:',
  ].join('\n');
}

function buildCampaignOverTraceLines(crewRoster: CrewMemberStub[]) {
  return crewRoster.map((op, i) => {
    const idx = (i + 1).toString(16).padStart(2, '0');
    const tag = op.flatlined ? '<flatlined>' : '';
    return {
      text: `  0x${idx}  roster::${op.callsign} (${op.archetype})`,
      tag,
    };
  });
}

function buildTraceLines(telemetry: Telemetry) {
  if (telemetry.outcome === 'campaign-over') {
    return buildCampaignOverTraceLines(telemetry.crewRoster ?? []);
  }

  const archetype = telemetry.archetype ?? 'entity';
  const lastSource = telemetry.lastDamageSource ?? 'unknown';
  const attacker = telemetry.lastAttacker ?? 'unknown';
  const killed = telemetry.outcome === 'death';

  // Format: "  0xNN  module::function(arg)            <killed>"
  // We pack synthetic stack frames so the panic reads like a real backtrace.
  const lines = [];
  if (telemetry.outcome === 'death') {
    lines.push({
      text: `  0x01  ${archetype}::take_damage(${telemetry.hpAtDamage ?? '?'})`,
      tag: killed ? '<killed>' : '',
    });
    lines.push({
      text: `  0x02  combat::resolve_${lastSource}(${attacker})`,
      tag: '',
    });
    lines.push({
      text: `  0x03  ai::Hostile::takeTurn()`,
      tag: '',
    });
  } else {
    // EXIT: walk the player off the exit tile. Friendlier trace.
    lines.push({ text: `  0x01  ${archetype}::reach_exit()`, tag: '<ok>' });
    lines.push({ text: `  0x02  world::move_entity(${archetype})`, tag: '' });
    if (Number.isInteger(telemetry.kills) && Number(telemetry.kills) > 0) {
      lines.push({ text: `  0x03  combat::resolve_kills(${telemetry.kills})`, tag: '' });
    }
  }
  return lines;
}

class CrashDump extends HTMLElement {
  #telemetry: Telemetry | null = null;
  #ready = false;
  #els: {
    title: HTMLElement;
    fault: HTMLElement;
    trace: HTMLElement;
    seedDd: HTMLElement;
    turnDd: HTMLElement;
    killsDd: HTMLElement;
    causeDd: HTMLElement;
    newRunBtn: HTMLButtonElement;
  } | null = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const title = h('h2', { className: 'title' });
    const fault = h('pre', { className: 'fault' });
    const trace = h('pre', { className: 'trace' });
    const seedDd = h('dd', { id: 'seed' });
    const turnDd = h('dd', { id: 'turn' });
    const killsDd = h('dd', { id: 'kills' });
    const causeDd = h('dd', { id: 'cause' });

    const newRunBtn = h('button', {
      type: 'button',
      className: 'new-run',
      textContent: '[ RETURN TO HUB ]',
    }) as HTMLButtonElement;
    newRunBtn.addEventListener('click', () => this.#emit('new-run'));

    const panel = h('section', { className: 'panel' }, [
      title,
      fault,
      trace,
      h('dl', { className: 'meta' }, [
        h('dt', { textContent: 'seed' }),
        seedDd,
        h('dt', { textContent: 'turn' }),
        turnDd,
        h('dt', { textContent: 'kills' }),
        killsDd,
        h('dt', { textContent: 'cause' }),
        causeDd,
      ]),
      h('div', { className: 'actions' }, [newRunBtn]),
    ]);
    shadow.appendChild(panel);
    this.#els = { title, fault, trace, seedDd, turnDd, killsDd, causeDd, newRunBtn };
    this.#ready = true;
    if (this.#telemetry) this.#render();
  }

  /**
   * @param {{
   *   outcome: 'death' | 'exit' | 'campaign-over',
   *   campaignTerminal?: boolean,
   *   crewRoster?: { callsign: string, archetype: string, flatlined: boolean }[],
   *   salvage?: number,
   *   archetype?: string,
   *   turn?: number,
   *   kills?: number,
   *   cause?: string,
   *   seed?: number,
   *   hpAtDeath?: number | null,
   *   hpAtDamage?: number | null,
   *   lastDamageSource?: string | null,
   *   lastAttacker?: string | null,
   * }} telemetry
   */
  setTelemetry(telemetry: Telemetry) {
    if (!telemetry || typeof telemetry !== 'object') {
      throw new TypeError('<crash-dump>.setTelemetry requires a telemetry object');
    }
    const { outcome, campaignTerminal } = telemetry;
    if (outcome !== 'death' && outcome !== 'exit' && outcome !== 'campaign-over') {
      throw new Error(`<crash-dump>: unknown outcome "${outcome}"`);
    }
    if (campaignTerminal && outcome !== 'death') {
      throw new Error('<crash-dump>: campaignTerminal is only valid with outcome "death"');
    }
    if (outcome === 'campaign-over' && !Array.isArray(telemetry.crewRoster)) {
      throw new TypeError('<crash-dump>: campaign-over requires crewRoster array');
    }
    this.#telemetry = { ...telemetry };
    this.setAttribute('outcome', outcome);
    if (this.#ready) this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      (this.shadowRoot?.querySelector('button.new-run') as HTMLButtonElement)?.focus();
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
    const isCampaignOver = t.outcome === 'campaign-over';
    const isDeath = t.outcome === 'death';
    const isCampaignTerminalDeath = isDeath && t.campaignTerminal;

    if (isCampaignOver || isCampaignTerminalDeath) {
      this.#els.title.textContent = campaignOverTitle();
      this.#els.fault.textContent = isCampaignOver ? campaignOverFault() : campaignTerminalFault();
    } else if (isDeath) {
      this.#els.title.textContent = deathTitle();
      this.#els.fault.textContent = deathFault();
    } else {
      this.#els.title.textContent = exitTitle();
      this.#els.fault.textContent = exitFault();
    }

    const newRunLabel =
      isCampaignOver || isCampaignTerminalDeath ? '[ NEW CAMPAIGN ]' : '[ RETURN TO HUB ]';
    this.#els.newRunBtn.textContent = newRunLabel;

    // Build trace with `<killed>` highlight.
    const lines = buildTraceLines(t);
    this.#els.trace.replaceChildren();
    lines.forEach((line, i) => {
      this.#els!.trace.appendChild(document.createTextNode(line.text));
      if (line.tag) {
        this.#els!.trace.appendChild(document.createTextNode('   '));
        const span = h('span', {
          className: line.tag.includes('killed') ? 'killed' : '',
          textContent: line.tag,
        });
        this.#els!.trace.appendChild(span);
      }
      if (i < lines.length - 1) {
        this.#els!.trace.appendChild(document.createTextNode('\n'));
      }
    });

    this.#els.seedDd.textContent = hexSeed(t.seed ?? 0);
    if (isCampaignOver) {
      this.#els.turnDd.textContent = '—';
      this.#els.killsDd.textContent = '—';
      this.#els.causeDd.textContent =
        Number.isInteger(t.salvage) && Number(t.salvage) >= 0
          ? `pool salvage ${t.salvage} (lost with run)`
          : 'no-surviving-crew';
    } else {
      this.#els.turnDd.textContent = Number.isInteger(t.turn) ? String(t.turn) : '?';
      this.#els.killsDd.textContent = Number.isInteger(t.kills) ? String(t.kills) : '0';
      this.#els.causeDd.textContent = t.cause ?? (isDeath ? 'unknown' : 'exit-reached');
    }
  }

  #emit(eventName: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(eventName, { detail: { ...detail, telemetry: { ...this.#telemetry } } })
    );
  }
}

customElements.define('crash-dump', CrashDump);

export default CrashDump;
