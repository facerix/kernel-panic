export const STATUS_ACTION_HISTORY_LIMIT = 3;

export type StatusActivityRow = {
  source: 'action' | 'ephemeral';
  text: string;
};

export function recordStatusActionLine(
  history: readonly string[],
  line: string,
  limit = STATUS_ACTION_HISTORY_LIMIT
): string[] {
  const normalized = line.replace(/^>\s*/, '');
  return [normalized, ...history].slice(0, limit);
}

export function statusActionRows(
  history: readonly string[],
  pendingCount: number,
  hasEphemeral: boolean
): [StatusActivityRow, StatusActivityRow] {
  const pending = history.slice(0, Math.max(0, pendingCount)).reverse();
  if (pending.length >= 2) {
    return [
      { source: 'action', text: pending.slice(0, -1).join(' / ') },
      { source: 'action', text: pending[pending.length - 1] ?? '' },
    ];
  }

  const latest = history[0] ?? '';
  if (hasEphemeral) {
    return [
      { source: 'ephemeral', text: '' },
      { source: 'action', text: latest },
    ];
  }

  return [
    { source: 'action', text: history[1] ?? '' },
    { source: 'action', text: latest },
  ];
}
