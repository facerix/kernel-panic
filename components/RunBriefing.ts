/**
 * <run-briefing> — single-step Curator job modal. Shows the contract details
 * alongside an embedded <crew-list> for operative selection, with a JACK IN
 * button to confirm the deployment.
 *
 * Replaces the old two-step flow (pick crew in roster → show briefing → JACK
 * IN) with one modal that shows everything the player needs to decide.
 *
 * Emits:
 *   - `deploy` — player confirmed. `detail: { memberId, contract }`.
 *   - `dismiss` — player backed out (Esc / backdrop click).
 *
 * Usage:
 *   briefingEl.setContract(contract);
 *   briefingEl.setCrew(campaign.crew);
 *   briefingEl.show();
 *   briefingEl.addEventListener('deploy', evt => { ... });
 */

import { h } from '/src/domUtils.js';
import CrewList from '/components/CrewList.js';
import { encounterHostileCount } from '/src/game/encounters.js';
import { cloneObjective, contractRequiresCyberspace } from '/src/game/hub/Curator.js';
import type { Crew as CrewMember } from '/src/game/Crew.js';
import type { Contract } from '/src/game/hub/Curator.js';
import type { CrewRowGate } from '/components/CrewList.js';

type BriefingCells = {
  target: HTMLElement;
  difficulty: HTMLElement;
  seed: HTMLElement;
  threat: HTMLElement;
  reward: HTMLElement;
  objective: HTMLElement;
};

const CSS = `
:host {
  --briefing-bg: rgba(7, 18, 16, 0.96);
  --briefing-border: var(--accent-color, #00d9a5);
  --briefing-text: #c5efdf;
  --briefing-dim: #6ae8c8;
  --briefing-accent: var(--accent-color, #00d9a5);
  --briefing-danger: #ff5d73;
  --briefing-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--briefing-text);
}

:host([open]) {
  display: flex;
  position: fixed;
  inset: 0;
  z-index: 50;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.panel {
  background: var(--briefing-bg);
  border: 1px solid var(--briefing-border);
  border-radius: 6px;
  padding: 1.25rem 1.5rem 1.5rem;
  box-shadow: var(--briefing-shadow);
  min-width: min(560px, 92vw);
  max-width: min(760px, 96vw);
}

.title {
  margin: 0 0 0.75rem;
  text-align: center;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  color: var(--briefing-accent);
  border-bottom: 1px dashed var(--briefing-border);
  padding-bottom: 0.5rem;
}

.body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

.contract-details {
  font-size: 0.95rem;
}

.contract-details dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1rem;
  row-gap: 0.25rem;
  margin: 0;
}

.contract-details dt {
  color: var(--briefing-dim);
  letter-spacing: 0.08em;
}

.contract-details dd {
  margin: 0;
  color: var(--briefing-text);
  word-break: break-word;
}

.deploy-section {
  border-left: 1px dashed var(--briefing-border);
  padding-left: 1rem;
}

.deploy-label {
  color: var(--briefing-accent);
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  margin: 0 0 0.5rem;
}

/* Pass CSS custom properties down into the <crew-list> shadow. */
crew-list {
  --cl-text: var(--briefing-text);
  --cl-accent: var(--briefing-accent);
  --cl-dim: var(--briefing-dim);
  --cl-danger: var(--briefing-danger);
  --cl-row-hover: rgba(0, 217, 165, 0.08);
  --cl-row-active: rgba(0, 217, 165, 0.18);
}

.actions {
  display: flex;
  justify-content: center;
  margin-top: 0.75rem;
}

button.jack-in {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--briefing-accent);
  border: 1px solid var(--briefing-accent);
  padding: 0.55em 2em;
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.16em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  min-height: 44px;
}

button.jack-in:hover,
button.jack-in:focus-visible {
  background: var(--briefing-accent);
  color: #020403;
  outline: none;
}

button.jack-in:active {
  transform: scale(0.98);
}

button.jack-in:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button.jack-in:disabled:hover {
  background: transparent;
  color: var(--briefing-accent);
}

.hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--briefing-dim);
  letter-spacing: 0.1em;
  margin: 0.9rem 0 0;
}
`;

function hexSeed(seed: number) {
  if (!Number.isFinite(seed)) return '?';
  const n = (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `0x${n}`;
}

function threatCopy(count: number) {
  if (!Number.isInteger(count)) return '?';
  if (count === 0) return 'No hostiles detected';
  return `${count} ${count === 1 ? 'hostile' : 'hostiles'}`;
}

function rewardCopy(contract: Partial<Contract>) {
  if (contract.context?.tags.includes('score') && contract.context.recipeId === 'score-final') {
    return contract.reward ? `Cr +${contract.reward.credits} / Campaign finale` : 'Campaign finale';
  }
  const reward = contract.reward;
  if (!reward) return '?';
  const recruit = reward.recruit ? ' + recruit lead' : '';
  return `Cr +${reward.credits} / REP +${reward.repDelta}${recruit}`;
}

class RunBriefing extends HTMLElement {
  #contract: Contract | null = null;
  #crew: CrewMember[] = [];
  #selectedMember: CrewMember | null = null;
  #ready = false;
  #cells: BriefingCells | null = null;
  #listEl: CrewList | null = null;
  #jackInBtn: HTMLButtonElement | null = null;
  #panelEl: HTMLElement | null = null;
  #onKeyDown: ((this: HTMLElement, ev: KeyboardEvent) => void) | null = null;
  #onBackdrop: ((this: HTMLElement, ev: PointerEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    // Contract detail cells.
    const target = h('dd', { id: 'target' });
    const difficulty = h('dd', { id: 'difficulty' });
    const seed = h('dd', { id: 'seed' });
    const threat = h('dd', { id: 'threat' });
    const reward = h('dd', { id: 'reward' });
    const objective = h('dd', { id: 'objective' });
    this.#cells = { target, difficulty, seed, threat, reward, objective };

    const contractPane = h('div', { className: 'contract-details' }, [
      h('dl', {}, [
        h('dt', { textContent: 'TARGET' }),
        target,
        h('dt', { textContent: 'TIER' }),
        difficulty,
        h('dt', { textContent: 'SEED' }),
        seed,
        h('dt', { textContent: 'THREAT' }),
        threat,
        h('dt', { textContent: 'REWARD' }),
        reward,
        h('dt', { textContent: 'OBJ' }),
        objective,
      ]),
    ]);

    // Crew list pane — select highlights, JACK IN commits.
    this.#listEl = document.createElement('crew-list') as CrewList;
    this.#listEl?.addEventListener('select', evt => {
      this.#selectedMember = (evt as CustomEvent<{ member: CrewMember }>).detail.member;
      if (this.#jackInBtn) {
        this.#jackInBtn.disabled = !this.#deployable(this.#selectedMember);
      }
    });

    this.#jackInBtn = h('button', {
      type: 'button',
      className: 'jack-in',
      textContent: '[ JACK IN ]',
      disabled: true,
    }) as HTMLButtonElement;
    this.#jackInBtn.addEventListener('click', () => this.#commit());

    const deployPane = h('div', { className: 'deploy-section' }, [
      h('p', { className: 'deploy-label', textContent: 'DEPLOY OPERATIVE' }),
      this.#listEl,
      h('div', { className: 'actions' }, [this.#jackInBtn]),
    ]);

    const body = h('div', { className: 'body' }, [contractPane, deployPane]);
    const hint = h('p', {
      className: 'hint',
      textContent: '[ ↑/↓ select  ·  Enter / JACK IN deploy  ·  Esc dismiss ]',
    });

    this.#panelEl = h('section', { className: 'panel' }, [
      h('h2', { className: 'title', textContent: '── CONTRACT ──' }),
      body,
      hint,
    ]);
    shadow.appendChild(this.#panelEl);

    this.#onKeyDown = this.#handleKey.bind(this);
    // Capture: Enter on <crew-list> rows must commit here before the row
    // <button> runs its implicit activation (redundant click).
    this.addEventListener('keydown', this.#onKeyDown, { capture: true });
    this.#onBackdrop = evt => {
      // Nested shadow (crew-list rows) retargets `target` to this host.
      if (evt.composedPath().includes(this.#panelEl as EventTarget)) return;
      this.dispatchEvent(new CustomEvent('dismiss'));
    };
    this.addEventListener('click', this.#onBackdrop);

    this.#ready = true;
    if (this.#contract) this.#renderContract();
  }

  /**
   * Set the contract to display.
   */
  setContract(contract: Contract) {
    if (!contract || typeof contract !== 'object') {
      throw new TypeError('<run-briefing>.setContract requires a contract object');
    }
    this.#contract = cloneContract(contract);
    if (this.#ready) this.#renderContract();
    // The deployment gate depends on the contract (P3.M3.1) — re-render any
    // already-set crew so row gating cannot go stale on contract swap.
    if (this.#crew.length > 0) this.#syncCrewList();
  }

  /**
   * Set the crew for the operative selection pane.
   * @param {Array} crew
   */
  setCrew(crew: CrewMember[]) {
    if (!Array.isArray(crew)) {
      throw new TypeError('<run-briefing>.setCrew requires an array');
    }
    this.#crew = crew;
    this.#syncCrewList();
  }

  /**
   * P3.M4.1: a Cyberspace dual-deploy auto-includes the Decker (the jack-in
   * operator) and asks the player to pick the *meat partner* who rides along.
   * The Decker row renders locked (CYBER OP); living non-Deckers are the
   * selectable partners.
   *
   * Solo fallback (P3.M3 behaviour): if no living non-Decker is available, the
   * dual-deploy is impossible — only the Decker can deploy, so other rows show
   * NEEDS DECKER and the run goes in solo.
   */
  #cyberPartnerMode(): boolean {
    return (
      !!this.#contract &&
      contractRequiresCyberspace(this.#contract) &&
      this.#crew.some(member => member.archetype !== 'Decker' && !member.flatlined)
    );
  }

  #rowGate(): CrewRowGate | null {
    if (!this.#contract || !contractRequiresCyberspace(this.#contract)) return null;
    if (this.#cyberPartnerMode()) {
      return member => (member.archetype === 'Decker' ? 'CYBER OP' : null);
    }
    return member => (member.archetype === 'Decker' ? null : 'NEEDS DECKER');
  }

  #deployable(member: CrewMember | null): boolean {
    if (!member || member.flatlined) return false;
    const gate = this.#rowGate();
    return gate ? gate(member) === null : true;
  }

  #syncCrewList() {
    this.#selectedMember = null;
    if (this.#jackInBtn) this.#jackInBtn.disabled = true;
    this.#listEl?.setCrew(this.#crew, this.#rowGate());
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => {
      if (!this.#listEl?.focusSelected()) this.focus();
    });
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  disconnectedCallback() {
    if (this.#onKeyDown) this.removeEventListener('keydown', this.#onKeyDown, { capture: true });
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  #renderContract() {
    if (!this.#cells) return;
    const c = this.#contract ?? ({} as Contract);
    this.#cells.target.textContent = c.label ?? '?';
    this.#cells.difficulty.textContent = c.difficulty?.toUpperCase?.() ?? '?';
    this.#cells.seed.textContent = hexSeed(c.seed);
    this.#cells.threat.textContent = threatCopy(encounterHostileCount(c));
    this.#cells.reward.textContent = rewardCopy(c);
    const turnLimit = c.objective?.params?.turnLimit;
    const window =
      Number.isInteger(turnLimit) && Number(turnLimit) > 0 ? ` Window: ${turnLimit} turns.` : '';
    this.#cells.objective.textContent = `${c.objective?.briefing ?? '?'}${window}`;
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.dispatchEvent(new CustomEvent('dismiss'));
      return;
    }
    // Enter on a crew row (focus inside <crew-list>) submits like a form —
    // JACK IN is a sibling of the list, so it is excluded from this path check.
    if (
      evt.key === 'Enter' &&
      !this.#jackInBtn?.disabled &&
      evt.composedPath().includes(this.#listEl as EventTarget)
    ) {
      evt.preventDefault();
      evt.stopPropagation();
      this.#commit();
      return;
    }
    // Arrow/WASD selection is handled by <crew-list> internally.
  }

  #commit() {
    const selected = this.#selectedMember;
    if (!this.#contract || !selected || !this.#deployable(selected)) return;
    // P3.M4.1: in dual-deploy mode the selected row is the meat partner and the
    // Decker auto-attaches as the jack-in operator; otherwise the selected row
    // deploys solo (non-cyber, or cyber with no partner available).
    let memberId = selected.id;
    let partnerId: string | null = null;
    if (this.#cyberPartnerMode()) {
      const decker = this.#crew.find(
        member => member.archetype === 'Decker' && !member.flatlined
      );
      if (!decker) return; // cyber board invariant: a living Decker exists
      memberId = decker.id;
      partnerId = selected.id;
    }
    this.dispatchEvent(
      new CustomEvent('deploy', {
        detail: { memberId, partnerId, contract: cloneContract(this.#contract) },
      })
    );
  }
}

function cloneContract(contract: Contract): Contract {
  return {
    ...contract,
    objective: cloneObjective(contract.objective),
    reward: { ...contract.reward },
  };
}

customElements.define('run-briefing', RunBriefing);

export default RunBriefing;
