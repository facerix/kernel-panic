import { h } from '/src/domUtils.js';
import type { CampaignChronicleEntry } from '/src/game/chronicle.js';
import type { CampaignSummary } from '/src/game/campaignSummary.js';

type ChronicleData = {
  activeChronicle?: {
    statusLines?: readonly string[];
    entries: readonly CampaignChronicleEntry[];
  } | null;
  history: readonly CampaignSummary[];
  acquisitions: { unlocked: number; total: number };
};

type ChronicleTab = 'chronicle' | 'history';

type ChronicleMetaRefs = {
  body: HTMLElement;
  meta: HTMLElement;
  panel: HTMLElement;
  status: HTMLElement;
  tabs: HTMLElement;
};

const CSS = `
:host {
  --chronicle-bg: rgba(7, 18, 16, 0.96);
  --chronicle-border: var(--accent-color, #00d9a5);
  --chronicle-text: #c5efdf;
  --chronicle-dim: #6ae8c8;
  --tab-active: rgba(0, 217, 165, 0.18);
  --chronicle-accent: var(--accent-color, #00d9a5);
  --chronicle-gold: #ffd166;
  --chronicle-danger: #ff6a78;
  --chronicle-shadow: 0 0 28px rgba(0, 217, 165, 0.18), 0 12px 36px rgba(0, 0, 0, 0.5);

  display: none;
  position: fixed;
  inset: 0;
  z-index: 65;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.62);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--chronicle-text);
}

:host([open]) {
  display: flex;
}

.panel {
  width: min(880px, 96vw);
  max-height: min(760px, 92vh);
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(7, 18, 16, 0.98), rgba(2, 8, 7, 0.98));
  border: 1px solid var(--chronicle-border);
  border-radius: 6px;
  box-shadow: var(--chronicle-shadow);
  overflow: hidden;
}

.head {
  padding: 1rem 1.25rem 0.9rem;
  border-bottom: 1px dashed rgba(0, 217, 165, 0.3);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.title {
  margin: 0;
  color: var(--chronicle-accent);
  letter-spacing: 0.18em;
  font-size: 0.98rem;
}

.meta {
  margin-top: 0.7rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.pill {
  border: 1px solid rgba(106, 232, 200, 0.25);
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  color: var(--chronicle-gold);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
}

.status {
  margin-top: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  color: var(--chronicle-dim);
  font-size: 0.84rem;
}

.tabs {
  display: flex;
  gap: 0.45rem;
  padding: 0.85rem 1.25rem 0;
}

.tab {
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--chronicle-dim);
  border: 1px solid rgba(106, 232, 200, 0.35);
  border-radius: 4px;
  min-height: 40px;
  padding: 0.45rem 0.75rem;
  font: inherit;
  cursor: pointer;
}

button.tab[aria-selected='true'] {
  background: var(--tab-active);
  color: var(--chronicle-accent);
  font-weight: 700;
}

.body {
  flex: 1;
  overflow: auto;
  padding: 1rem 1.25rem 1.2rem;
}

.empty {
  margin: 0;
  color: var(--chronicle-dim);
  font-style: italic;
}

.entry {
  border: 1px solid rgba(106, 232, 200, 0.18);
  border-radius: 6px;
  padding: 0.85rem 0.9rem;
  background: rgba(0, 0, 0, 0.18);
}

.entry + .entry {
  margin-top: 0.75rem;
}

.entry-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: baseline;
  margin-bottom: 0.4rem;
}

.entry-title {
  color: var(--chronicle-accent);
  font-size: 0.9rem;
  letter-spacing: 0.12em;
}

.entry-tag {
  color: var(--chronicle-gold);
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.entry-summary {
  margin: 0;
  line-height: 1.5;
}

.detail-list {
  margin: 0.55rem 0 0;
  padding-left: 1rem;
  color: var(--chronicle-dim);
  font-size: 0.84rem;
}

.detail-list li {
  margin: 0.12rem 0;
}

.history-grid {
  display: grid;
  gap: 0.75rem;
}

.history-result {
  color: var(--chronicle-gold);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
}

.history-result.loss {
  color: var(--chronicle-danger);
}

.history-result.partial {
  color: #ffb347;
}

@media (max-width: 720px) {
  .panel {
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }

  .entry-head,
  .title-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
`;

const TAB_HISTORY = 'history';
const TAB_CHRONICLE = 'chronicle';
type TabId = typeof TAB_HISTORY | typeof TAB_CHRONICLE;

const STAGE_LABELS = Object.freeze({
  'act-1': 'Stage 1',
  'act-2': 'Stage 2',
  'act-3': 'Stage 3',
  score: 'The Score',
});

const EMPTY_DATA: ChronicleData = Object.freeze({
  activeChronicle: null,
  history: Object.freeze([]),
  acquisitions: Object.freeze({ unlocked: 0, total: 0 }),
});

class ChronicleArchive extends HTMLElement {
  #ready = false;
  #data: ChronicleData = EMPTY_DATA;
  #activeTab: ChronicleTab = 'history';
  #els: ChronicleMetaRefs | null = null;
  #onBackdrop: ((evt: PointerEvent) => void) | null = null;
  #onKeyDown: ((evt: KeyboardEvent) => void) | null = null;

  connectedCallback() {
    if (this.#ready) return;
    this.tabIndex = -1;
    const shadow = this.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const meta = h('div', { className: 'meta' });
    const status = h('div', { className: 'status' });
    const tabs = h('div', { className: 'tabs' });
    const body = h('div', { className: 'body' });

    const panel = h('section', { className: 'panel' }, [
      h('div', { className: 'head' }, [
        h('div', { className: 'title-row' }, [
          h('h2', { className: 'title', textContent: '── LEDGER ──' }),
        ]),
        meta,
        status,
      ]),
      tabs,
      body,
    ]);

    shadow.appendChild(panel);
    this.#els = { body, meta, panel, status, tabs };
    this.#onKeyDown = evt => this.#handleKey(evt);
    this.#onBackdrop = evt => this.#handleBackdrop(evt);
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('click', this.#onBackdrop);
    this.#ready = true;
    this.#render();
  }

  disconnectedCallback() {
    if (this.#onKeyDown) this.removeEventListener('keydown', this.#onKeyDown);
    if (this.#onBackdrop) this.removeEventListener('click', this.#onBackdrop);
  }

  setData(data: ChronicleData) {
    this.#data = normalizeChronicleData(data);
    if (!this.#data.activeChronicle) {
      this.#activeTab = 'history';
    }
    this.#render();
  }

  show() {
    this.setAttribute('open', '');
    queueMicrotask(() => this.focus());
  }

  hide() {
    this.removeAttribute('open');
  }

  get isOpen() {
    return this.hasAttribute('open');
  }

  #render() {
    if (!this.#ready || !this.#els) return;
    this.#els.meta.replaceChildren(...this.#buildMetaPills());
    this.#els.status.replaceChildren(...this.#buildStatusLines());
    this.#els.tabs.replaceChildren(...this.#buildTabs());
    this.#els.body.replaceChildren(
      this.#activeTab === 'chronicle' ? this.#buildChronicle() : this.#buildHistory()
    );
  }

  #buildMetaPills(): HTMLElement[] {
    const pills = [
      h('span', {
        className: 'pill',
        textContent: `ACQUISITIONS: ${this.#data.acquisitions.unlocked} / ${this.#data.acquisitions.total}`,
      }),
      h('span', {
        className: 'pill',
        textContent: `ARCHIVE: ${this.#data.history.length} campaigns`,
      }),
    ];
    if (this.#data.activeChronicle) {
      pills.push(
        h('span', {
          className: 'pill',
          textContent: `LIVE LOG: ${this.#data.activeChronicle.entries.length} entries`,
        })
      );
    }
    return pills;
  }

  #buildStatusLines(): HTMLElement[] {
    return (this.#data.activeChronicle?.statusLines ?? []).map(line =>
      h('div', { textContent: line })
    );
  }

  #buildTabs(): HTMLElement[] {
    const tabs: Array<{ id: ChronicleTab; label: string }> = [
      { id: 'chronicle', label: 'Active Chronicle' },
      { id: 'history', label: 'History' },
    ];
    return tabs.map(tab => {
      const button = h('button', {
        type: 'button',
        className: 'tab',
        textContent: tab.label,
      });
      button.setAttribute('aria-selected', String(this.#activeTab === tab.id));
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => {
        this.#activeTab = tab.id;
        this.#render();
      });
      return button;
    });
  }

  #buildChronicle(): HTMLElement {
    const chronicle = this.#data.activeChronicle;
    if (!chronicle || chronicle.entries.length === 0) {
      return h('p', {
        className: 'empty',
        textContent:
          'No campaign entries yet. The log will fill as the crew takes jobs and the arc unfolds.',
      });
    }
    return h(
      'div',
      {},
      chronicle.entries.map(entry =>
        h('article', { className: 'entry' }, [
          h('div', { className: 'entry-head' }, [
            h('div', { className: 'entry-title', textContent: entry.title }),
            h('div', {
              className: 'entry-tag',
              textContent: `${STAGE_LABELS[entry.stage]} • ${entry.kind}`,
            }),
          ]),
          h('p', { className: 'entry-summary', textContent: entry.summary }),
          h(
            'ul',
            { className: 'detail-list' },
            entry.detailLines.map(line => h('li', { textContent: line }))
          ),
        ])
      )
    );
  }

  #buildHistory(): HTMLElement {
    if (this.#data.history.length === 0) {
      return h('p', {
        className: 'empty',
        textContent: 'No archived campaigns yet. Finish a campaign and it will appear here.',
      });
    }
    return h(
      'div',
      { className: 'history-grid' },
      this.#data.history.map(summary => {
        const resultClass =
          summary.result === 'loss'
            ? 'history-result loss'
            : summary.result === 'partial'
              ? 'history-result partial'
              : 'history-result';
        const rewardLine = summary.scoreReward
          ? `Blueprint stolen: ${summary.scoreReward.label}`
          : summary.result === 'win'
            ? 'Blueprint stolen: abstract credit cache'
            : `End reason: ${summary.endReason}`;
        return h('article', { className: 'entry' }, [
          h('div', { className: 'entry-head' }, [
            h('div', {
              className: 'entry-title',
              textContent: `${summary.completedJobs} jobs • ${summary.credits} Cr • REP ${summary.rep}`,
            }),
            h('div', {
              className: resultClass,
              textContent: summary.result.toUpperCase(),
            }),
          ]),
          h('p', {
            className: 'entry-summary',
            textContent: `${formatDate(summary.completedAt)} — ${rewardLine}.`,
          }),
          h('ul', { className: 'detail-list' }, [
            h('li', { textContent: `Campaign seed ${summary.seed}` }),
            h('li', {
              textContent: `Crew at end: ${summary.crewRoster
                .map(
                  member =>
                    `${member.callsign} (${member.archetype}${member.flatlined ? ', flatlined' : ''})`
                )
                .join(', ')}`,
            }),
          ]),
        ]);
      })
    );
  }

  #handleBackdrop(evt: PointerEvent) {
    if (!this.isOpen || !this.#els) return;
    if (evt.composedPath().includes(this.#els.panel)) return;
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }

  #switchTab(tab: TabId) {
    if (tab === this.#activeTab) return;
    this.#activeTab = tab;
    this.#render();
  }

  #handleKey(evt: KeyboardEvent) {
    if (!this.isOpen) return;
    evt.stopPropagation();

    switch (evt.key) {
      case 'Escape':
        evt.preventDefault();
        this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
        break;

      case 'ArrowLeft':
      case 'a':
        evt.preventDefault();
        this.#switchTab(TAB_CHRONICLE);
        break;

      case 'ArrowRight':
      case 'd':
        evt.preventDefault();
        this.#switchTab(TAB_HISTORY);
        break;

      case 'Tab':
        evt.preventDefault();
        this.#switchTab(this.#activeTab === TAB_HISTORY ? TAB_CHRONICLE : TAB_HISTORY);
        return;
    }
  }
}

function normalizeChronicleData(data: ChronicleData): ChronicleData {
  if (!data || typeof data !== 'object') {
    throw new TypeError('<chronicle-archive>.setData requires a data object');
  }
  if (!Array.isArray(data.history)) {
    throw new TypeError('<chronicle-archive>.setData requires history[]');
  }
  if (
    !data.acquisitions ||
    !Number.isInteger(data.acquisitions.unlocked) ||
    !Number.isInteger(data.acquisitions.total)
  ) {
    throw new TypeError('<chronicle-archive>.setData requires acquisitions counts');
  }
  if (data.activeChronicle && !Array.isArray(data.activeChronicle.entries)) {
    throw new TypeError('<chronicle-archive>.setData activeChronicle.entries must be an array');
  }
  return {
    activeChronicle: data.activeChronicle
      ? {
          entries: [...data.activeChronicle.entries],
          statusLines: [...(data.activeChronicle.statusLines ?? [])],
        }
      : null,
    history: [...data.history],
    acquisitions: { ...data.acquisitions },
  };
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

customElements.define('chronicle-archive', ChronicleArchive);

export default ChronicleArchive;
