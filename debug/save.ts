/**
 * Savegame editor — debug tool for inspecting and modifying the `kp:data`
 * localStorage payload without hand-editing raw JSON.
 *
 * Two views:
 *   1. **Quick-edit panel** — labeled fields for the most common campaign
 *      values (crew HP, salvage, credits, rep, arc stage).
 *   2. **Tree editor** — full recursive render of every key/value.
 *      Scalars are editable inline; objects/arrays collapse.
 *
 * All edits are staged in memory. Nothing touches localStorage until you
 * press "Save". A "Revert" button re-reads from storage. "Export" and
 * "Import" round-trip the full JSON blob for clipboard / file backup.
 */
import { h } from '/src/domUtils.js';

const STORAGE_KEY = 'kp:data';
/* eslint-disable-next-line no-unused-vars */
const CREW_ARCHETYPES = ['merc', 'razor', 'tech', 'decker'] as const;
const ARC_STAGES = ['act-1', 'act-2', 'act-3', 'score'] as const;
const CAMPAIGN_STATES = ['HUB', 'COMBAT', 'ENDED'] as const;

// ---------------------------------------------------------------------------
// Types (mirrors DataStore's KPData but kept local so we stay import-free
// from the game runtime — this page must work even if the save is corrupt).
// ---------------------------------------------------------------------------
type KPData = {
  prefs: Record<string, unknown>;
  runs: unknown[];
  campaign: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let data: KPData = { prefs: {}, runs: [], campaign: null };
let dirty = false;

function loadFromStorage(): KPData {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return { prefs: {}, runs: [], campaign: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      prefs: parsed.prefs ?? {},
      runs: parsed.runs ?? [],
      campaign: parsed.campaign ?? null,
    };
  } catch {
    return { prefs: {}, runs: [], campaign: null };
  }
}

function saveToStorage(): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  dirty = false;
  toast('Saved to localStorage');
  render();
}

function revert(): void {
  data = loadFromStorage();
  dirty = false;
  render();
  toast('Reverted from localStorage');
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toast(msg: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 1800);
}

// ---------------------------------------------------------------------------
// Deep accessor helpers
// ---------------------------------------------------------------------------

/** Walk a dotted path like "campaign.crew.0.hp" into the data tree. */
/* eslint-disable-next-line no-unused-vars */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur != null && typeof cur === 'object') {
    (cur as Record<string, unknown>)[parts[parts.length - 1]] = value;
  }
}

// ---------------------------------------------------------------------------
// Quick-edit panel
// ---------------------------------------------------------------------------
function renderQuickEdit(): void {
  const root = document.getElementById('quick-edit')!;
  root.innerHTML = '';
  const c = data.campaign;
  if (!c) {
    root.appendChild(
      h('div', { className: 'empty-state' }, [document.createTextNode('No active campaign.')])
    );
    return;
  }

  const panel = h('div', { className: 'quick-edit' }, [
    h('h2', null, [document.createTextNode('Quick edit — campaign')]),
  ]);

  const grid = h('div', { className: 'qe-grid' });

  // --- Economy ---
  grid.appendChild(qeNumberField('Credits', c, 'credits', 0));
  grid.appendChild(qeNumberField('Rep', c, 'rep', 0, 0, 100));

  // Typed salvage wallet
  const salvage = c.salvage;
  if (salvage && typeof salvage === 'object' && !Array.isArray(salvage)) {
    const sw = salvage as Record<string, unknown>;
    for (const bucket of ['scrap', 'tech', 'bioware', 'synth']) {
      if (bucket in sw) {
        grid.appendChild(qeNumberField(`Salvage: ${bucket}`, sw, bucket, 0));
      }
    }
  } else if (typeof salvage === 'number') {
    grid.appendChild(qeNumberField('Salvage (legacy)', c, 'salvage', 0));
  }

  // --- Campaign state ---
  grid.appendChild(qeSelectField('State', c, 'state', CAMPAIGN_STATES));

  // --- Arc ---
  const arc = c.arc as Record<string, unknown> | undefined;
  if (arc) {
    grid.appendChild(qeSelectField('Arc stage', arc, 'stage', ARC_STAGES));
    grid.appendChild(qeNumberField('Completed jobs', c, 'completedJobs', 0));
  }

  // --- Crew quick rows ---
  const crew = c.crew;
  if (Array.isArray(crew)) {
    for (let i = 0; i < crew.length; i++) {
      const m = crew[i] as Record<string, unknown>;
      const label = (m.callsign as string) || (m.id as string) || `crew-${i}`;
      grid.appendChild(
        h('span', { className: 'callsign', style: 'grid-column: 1 / -1; margin-top: 0.4rem' }, [
          document.createTextNode(`▸ ${label} (${m.archetype})`),
        ])
      );
      grid.appendChild(qeNumberField('HP', m, 'hp', 0, 0, m.maxHp as number));
      grid.appendChild(qeNumberField('Max HP', m, 'maxHp', 1));
      grid.appendChild(qeNumberField('AP', m, 'ap', 0, 0, m.maxAp as number));
      grid.appendChild(qeNumberField('Max AP', m, 'maxAp', 1));
      grid.appendChild(qeBoolField('Alive', m, 'alive'));
      grid.appendChild(qeBoolField('Flatlined', m, 'flatlined'));
    }
  }

  panel.appendChild(grid);
  root.appendChild(panel);
}

function qeNumberField(
  label: string,
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
  min?: number,
  max?: number
): HTMLElement {
  const cur = typeof obj[key] === 'number' ? (obj[key] as number) : fallback;
  const input = h('input', {
    type: 'number',
    value: String(cur),
    ...(min !== undefined ? { min: String(min) } : {}),
    ...(max !== undefined ? { max: String(max) } : {}),
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    obj[key] = Number.isInteger(cur) ? Math.round(v) : v;
    markDirty();
  });
  return h('label', null, [document.createTextNode(label), input]);
}

function qeBoolField(label: string, obj: Record<string, unknown>, key: string): HTMLElement {
  const cur = !!obj[key];
  const input = h('input', { type: 'checkbox', checked: cur }) as HTMLInputElement;
  input.addEventListener('change', () => {
    obj[key] = input.checked;
    markDirty();
  });
  return h('label', null, [document.createTextNode(label), input]);
}

function qeSelectField(
  label: string,
  obj: Record<string, unknown>,
  key: string,
  options: readonly string[]
): HTMLElement {
  const cur = String(obj[key] ?? '');
  const select = h(
    'select',
    null,
    options.map(o => {
      const opt = h('option', { value: o }, [document.createTextNode(o)]) as HTMLOptionElement;
      if (o === cur) opt.selected = true;
      return opt;
    })
  ) as HTMLSelectElement;
  select.addEventListener('change', () => {
    obj[key] = select.value;
    markDirty();
  });
  return h('label', null, [document.createTextNode(label), select]);
}

function markDirty(): void {
  dirty = true;
  renderToolbar();
}

// ---------------------------------------------------------------------------
// Tree editor
// ---------------------------------------------------------------------------

function renderTree(): void {
  const root = document.getElementById('tree-root')!;
  root.innerHTML = '';
  const container = h('div', { className: 'tree' });
  container.appendChild(buildNode('kp:data', data, 'data', true));
  root.appendChild(container);
}

function buildNode(key: string, value: unknown, path: string, startOpen = false): HTMLElement {
  if (value === null || value === undefined) {
    return leafNode(key, value, path);
  }
  if (Array.isArray(value)) {
    return arrayNode(key, value, path, startOpen);
  }
  if (typeof value === 'object') {
    return objectNode(key, value as Record<string, unknown>, path, startOpen);
  }
  return leafNode(key, value, path);
}

function objectNode(
  key: string,
  obj: Record<string, unknown>,
  path: string,
  startOpen: boolean
): HTMLElement {
  const keys = Object.keys(obj);
  const details = h('details', startOpen ? { open: true } : {}) as HTMLDetailsElement;
  const summary = h('summary', null, [
    h('span', { className: 'key' }, [document.createTextNode(key)]),
    document.createTextNode(': '),
    h('span', { className: 'bracket' }, [document.createTextNode('{')]),
    h('span', { className: 'count' }, [document.createTextNode(` ${keys.length} keys `)]),
    h('span', { className: 'bracket' }, [document.createTextNode('}')]),
  ]);
  details.appendChild(summary);
  for (const k of keys) {
    details.appendChild(buildNode(k, obj[k], `${path}.${k}`));
  }
  return details;
}

function arrayNode(key: string, arr: unknown[], path: string, startOpen: boolean): HTMLElement {
  const details = h('details', startOpen ? { open: true } : {}) as HTMLDetailsElement;
  const summary = h('summary', null, [
    h('span', { className: 'key' }, [document.createTextNode(key)]),
    document.createTextNode(': '),
    h('span', { className: 'bracket' }, [document.createTextNode('[')]),
    h('span', { className: 'count' }, [document.createTextNode(` ${arr.length} items `)]),
    h('span', { className: 'bracket' }, [document.createTextNode(']')]),
  ]);
  details.appendChild(summary);
  for (let i = 0; i < arr.length; i++) {
    details.appendChild(buildNode(String(i), arr[i], `${path}.${i}`));
  }
  return details;
}

function leafNode(key: string, value: unknown, path: string): HTMLElement {
  const row = h('div', { className: 'leaf' });
  row.appendChild(h('span', { className: 'key' }, [document.createTextNode(`${key}: `)]));

  if (value === null || value === undefined) {
    row.appendChild(h('span', { className: 'val-null' }, [document.createTextNode('null')]));
    return row;
  }

  if (typeof value === 'boolean') {
    const select = h('select', { className: 'inline-edit' }, [
      h('option', { value: 'true', selected: value === true }, [
        document.createTextNode('true'),
      ]) as HTMLOptionElement,
      h('option', { value: 'false', selected: value === false }, [
        document.createTextNode('false'),
      ]) as HTMLOptionElement,
    ]) as HTMLSelectElement;
    select.classList.add('val-bool');
    select.addEventListener('change', () => {
      setByPath(data, path.replace(/^data\./, ''), select.value === 'true');
      select.classList.add('dirty');
      markDirty();
    });
    row.appendChild(select);
    return row;
  }

  if (typeof value === 'number') {
    const input = h('input', {
      className: 'inline-edit val-num',
      type: 'number',
      value: String(value),
      style: `width: ${Math.max(4, String(value).length + 2)}ch`,
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      setByPath(data, path.replace(/^data\./, ''), v);
      input.classList.add('dirty');
      markDirty();
    });
    row.appendChild(input);
    return row;
  }

  // string
  const str = String(value);
  const input = h('input', {
    className: 'inline-edit val-str',
    type: 'text',
    value: str,
    style: `width: ${Math.max(4, str.length + 2)}ch`,
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    setByPath(data, path.replace(/^data\./, ''), input.value);
    input.classList.add('dirty');
    markDirty();
  });
  row.appendChild(input);
  return row;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function renderToolbar(): void {
  const bar = document.getElementById('toolbar')!;
  bar.innerHTML = '';

  const saveBtn = h('button', null, [document.createTextNode(dirty ? '● Save' : 'Save')]);
  saveBtn.addEventListener('click', saveToStorage);

  const revertBtn = h('button', null, [document.createTextNode('Revert')]);
  revertBtn.addEventListener('click', revert);

  const exportBtn = h('button', null, [document.createTextNode('Export')]);
  exportBtn.addEventListener('click', () => {
    const json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(
      () => toast('Copied to clipboard'),
      () => {
        // Fallback: download as file
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: 'kp-save.json' }) as HTMLAnchorElement;
        a.click();
        URL.revokeObjectURL(url);
        toast('Downloaded kp-save.json');
      }
    );
  });

  const importBtn = h('button', null, [document.createTextNode('Import')]);
  importBtn.addEventListener('click', () => {
    const json = prompt('Paste JSON:');
    if (!json) return;
    try {
      const parsed = JSON.parse(json);
      data = {
        prefs: parsed.prefs ?? {},
        runs: parsed.runs ?? [],
        campaign: parsed.campaign ?? null,
      };
      dirty = true;
      render();
      toast('Imported — press Save to persist');
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`);
    }
  });

  const nukeBtn = h('button', { className: 'danger' }, [document.createTextNode('Nuke save')]);
  nukeBtn.addEventListener('click', () => {
    if (!confirm('Delete ALL save data from localStorage? This cannot be undone.')) return;
    window.localStorage.removeItem(STORAGE_KEY);
    data = { prefs: {}, runs: [], campaign: null };
    dirty = false;
    render();
    toast('Save data nuked');
  });

  bar.append(saveBtn, revertBtn, exportBtn, importBtn, nukeBtn);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(): void {
  renderToolbar();
  renderQuickEdit();
  renderTree();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

data = loadFromStorage();
render();
