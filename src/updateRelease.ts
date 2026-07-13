export type UpdateRelease = Readonly<{
  version: string;
  shellEpoch: number;
  title: string;
  highlights: readonly string[];
}>;

export type AvailableUpdate = Readonly<{
  pendingWorker: ServiceWorker;
  active: UpdateRelease;
  pending: UpdateRelease;
  required: boolean;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Validate release metadata received across the service-worker message boundary. */
export function parseUpdateRelease(value: unknown, label = 'release metadata'): UpdateRelease {
  const candidate = record(value, label);
  const { version, shellEpoch, title, highlights } = candidate;

  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new TypeError(`${label}.version must be a non-empty string`);
  }
  if (!Number.isInteger(shellEpoch) || (shellEpoch as number) < 1) {
    throw new RangeError(`${label}.shellEpoch must be a positive integer`);
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError(`${label}.title must be a non-empty string`);
  }
  if (
    !Array.isArray(highlights) ||
    highlights.length === 0 ||
    highlights.some(item => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new TypeError(`${label}.highlights must be a non-empty array of non-empty strings`);
  }

  return Object.freeze({
    version,
    shellEpoch: shellEpoch as number,
    title,
    highlights: Object.freeze([...(highlights as string[])]),
  });
}

/**
 * A higher shell epoch means the pending worker cannot safely serve the
 * currently loaded application shell. Downgrades are deployment errors.
 */
export function requiresUpdateAcknowledgement(
  active: UpdateRelease,
  pending: UpdateRelease
): boolean {
  if (pending.shellEpoch < active.shellEpoch) {
    throw new Error(
      `pending shell epoch ${pending.shellEpoch} is older than active epoch ${active.shellEpoch}`
    );
  }
  return pending.shellEpoch > active.shellEpoch;
}
