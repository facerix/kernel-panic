/**
 * <game-over> — the single terminal campaign overlay.
 *
 * Both outcomes consume the Chronicle's validated `CampaignSummary`: wins use
 * a cyan/green SCORE COMPLETE treatment, while losses retain the red GAME OVER
 * presentation. Per-job death and exfil debriefs remain in `<crash-dump>`.
 *
 * Usage:
 *   const screen = document.querySelector('game-over');
 *   screen.addEventListener('new-run', () => finishEndedCampaign());
 *   screen.setSummary(summary);
 *   screen.show();
 */

import { h } from '/src/domUtils.js';
import { validateCampaignSummary, type CampaignSummary } from '/src/game/campaignSummary.js';
import { selectEndFlavor } from '/src/game/endFlavor.js';

const CSS = `
:host {
  --go-accent: #ff3355;
  --go-bg: rgba(4, 2, 3, 0.98);
  --go-text: #f0d4da;
  --go-dim: #c96b7d;
  --go-roster-border: rgba(255, 51, 85, 0.28);
  --go-shadow: 0 0 48px rgba(255, 51, 85, 0.35), 0 16px 48px rgba(0, 0, 0, 0.75);

  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--go-text);
  background:
    radial-gradient(ellipse at center, rgba(255, 51, 85, 0.12) 0%, transparent 65%),
    rgba(0, 0, 0, 0.88);
  animation: game-over-backdrop 2.4s ease-in-out infinite alternate;
}

:host([result='win']) {
  --go-accent: #00e5b0;
  --go-bg: rgba(2, 10, 9, 0.98);
  --go-text: #d8fff5;
  --go-dim: #72d9c0;
  --go-roster-border: rgba(0, 229, 176, 0.3);
  --go-shadow: 0 0 54px rgba(0, 229, 176, 0.28), 0 16px 48px rgba(0, 0, 0, 0.72);
  background:
    radial-gradient(ellipse at center, rgba(0, 229, 176, 0.14) 0%, transparent 68%),
    rgba(0, 5, 4, 0.88);
  animation: score-complete-backdrop 5s ease-in-out infinite alternate;
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

@keyframes score-complete-backdrop {
  from { background-color: rgba(0, 4, 3, 0.86); }
  to { background-color: rgba(1, 14, 11, 0.92); }
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
  font-size: clamp(1.55rem, 6vw, 2.5rem);
  letter-spacing: 0.22em;
  color: var(--go-accent);
  text-shadow: 0 0 18px color-mix(in srgb, var(--go-accent) 45%, transparent);
  animation: game-over-pulse 1.8s ease-in-out infinite;
}

:host([result='win']) .banner {
  animation-duration: 3.6s;
}

@keyframes game-over-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.82; }
}

.rule {
  margin: 0 auto 1.25rem;
  width: min(320px, 76%);
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

.reward {
  display: none;
  margin: 0 0 1.25rem;
  padding: 0.6rem 0.85rem;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--go-roster-border);
  border-radius: 4px;
  text-align: center;
}

.reward .reward-kicker {
  display: block;
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  color: var(--go-dim);
}

.reward .reward-name {
  display: block;
  margin-top: 0.2rem;
  font-size: 1.1rem;
  letter-spacing: 0.06em;
  color: var(--go-accent);
  text-shadow: 0 0 12px color-mix(in srgb, var(--go-accent) 40%, transparent);
}

.reward .reward-flavor {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.82rem;
  font-style: italic;
  color: var(--go-text);
  line-height: 1.4;
}

.roster {
  margin: 0 0 1.25rem;
  padding: 0.65rem 0.85rem;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid var(--go-roster-border);
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

.roster-line .status.flatlined {
  color: #ff6680;
}

.meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.25rem;
  row-gap: 0.25rem;
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

function hexSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

class GameOver extends HTMLElement {
  #summary: CampaignSummary | null = null;
  #ready = false;
  #els: {
    banner: HTMLElement;
    reason: HTMLElement;
    detail: HTMLElement;
    reward: HTMLElement;
    rewardKicker: HTMLElement;
    rewardName: HTMLElement;
    rewardFlavor: HTMLElement;
    rosterList: HTMLElement;
    jobsDd: HTMLElement;
    repDd: HTMLElement;
    creditsDd: HTMLElement;
    seedDd: HTMLElement;
    causeDd: HTMLElement;
  } | null = null;

  connectedCallback() {
    if (this.#ready) return;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const banner = h('h1', { className: 'banner' });
    const reason = h('p', { className: 'reason' });
    const detail = h('p', { className: 'detail' });
    const rewardKicker = h('span', {
      className: 'reward-kicker',
      textContent: 'BLUEPRINT ACQUIRED',
    });
    const rewardName = h('span', { className: 'reward-name' });
    const rewardFlavor = h('span', { className: 'reward-flavor' });
    const reward = h('p', { className: 'reward' }, [rewardKicker, rewardName, rewardFlavor]);
    const rosterList = h('dd');
    const jobsDd = h('dd', { id: 'jobs' });
    const repDd = h('dd', { id: 'rep' });
    const creditsDd = h('dd', { id: 'credits' });
    const seedDd = h('dd', { id: 'seed' });
    const causeDd = h('dd', { id: 'cause' });
    const roster = h('dl', { className: 'roster' }, [
      h('dt', { textContent: 'FINAL ROSTER' }),
      rosterList,
    ]);

    const newCampaignBtn = h('button', {
      type: 'button',
      className: 'new-campaign',
      textContent: '[ NEW CAMPAIGN ]',
    }) as HTMLButtonElement;
    newCampaignBtn.addEventListener('click', () => this.#emit('new-run'));

    const panel = h('section', { className: 'panel' }, [
      banner,
      h('hr', { className: 'rule' }),
      reason,
      detail,
      reward,
      roster,
      h('dl', { className: 'meta' }, [
        h('dt', { textContent: 'jobs' }),
        jobsDd,
        h('dt', { textContent: 'rep' }),
        repDd,
        h('dt', { textContent: 'credits' }),
        creditsDd,
        h('dt', { textContent: 'seed' }),
        seedDd,
        h('dt', { textContent: 'cause' }),
        causeDd,
      ]),
      h('div', { className: 'actions' }, [newCampaignBtn]),
    ]);
    shadow.appendChild(panel);
    this.#els = {
      banner,
      reason,
      detail,
      reward,
      rewardKicker,
      rewardName,
      rewardFlavor,
      rosterList,
      jobsDd,
      repDd,
      creditsDd,
      seedDd,
      causeDd,
    };
    this.#ready = true;
    if (this.#summary) this.#render();
  }

  setSummary(summary: CampaignSummary) {
    this.#summary = validateCampaignSummary(summary);
    this.setAttribute('result', this.#summary.result);
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
    if (!this.#els || !this.#summary) return;
    const summary = this.#summary;
    // Every end-screen line is drawn deterministically from per-seed flavor
    // pools so each slot does distinct narrative work and varies run to run.
    const flavor = selectEndFlavor(summary);
    this.#els.banner.textContent = flavor.banner;
    this.#els.reason.textContent = flavor.reason;
    this.#els.detail.textContent = flavor.detail;
    // Score prize — present on any Score that stole a specific blueprint. P3.6:
    // that now includes a costly (`partial`) win, where the payload got out but
    // an operator did not; the kicker copy carries the difference in tone.
    const reward =
      summary.result === 'win' || summary.result === 'partial'
        ? (summary.scoreReward ?? null)
        : null;
    if (reward && flavor.rewardKicker) {
      this.#els.rewardKicker.textContent = flavor.rewardKicker;
      this.#els.rewardName.textContent = reward.label;
      this.#els.rewardFlavor.textContent = reward.flavor;
      this.#els.reward.style.display = 'block';
    } else {
      this.#els.reward.style.display = 'none';
    }
    this.#els.jobsDd.textContent = String(summary.completedJobs);
    this.#els.repDd.textContent = String(summary.rep);
    this.#els.creditsDd.textContent = String(summary.credits);
    this.#els.seedDd.textContent = hexSeed(summary.seed);
    this.#els.causeDd.textContent = summary.endReason;
    this.#els.rosterList.replaceChildren(
      ...summary.crewRoster.map(operator =>
        h('div', { className: 'roster-line' }, [
          h('span', { textContent: `${operator.callsign} (${operator.archetype})` }),
          h('span', {
            className: `status${operator.flatlined ? ' flatlined' : ''}`,
            textContent: operator.flatlined ? 'FLATLINED' : 'SURVIVED',
          }),
        ])
      )
    );
  }

  #emit(eventName: string) {
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { summary: this.#summary ? validateCampaignSummary(this.#summary) : null },
      })
    );
  }
}

customElements.define('game-over', GameOver);

export default GameOver;
