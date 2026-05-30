/**
 * Top-level error boundary — the bridge that makes the project's "fail loud,
 * but recover" doctrine (see `AGENTS.md` → "Error handling") survivable on a
 * console-less tablet PWA.
 *
 * A raw `throw` that escapes to the browser white-screens the tab — which is
 * itself a *silent* failure: the player loses their session and we get no
 * signal. This module catches those tier-1 throws at the top level and:
 *
 *   1. normalizes the thrown value to an `Error`,
 *   2. emits a dev-channel signal (`onSignal` — defaults to `console.error`
 *      plus a no-op telemetry seam; wire the seam to a real sink later),
 *   3. hands off to a `degrade` callback — the shell wires this to "stop the
 *      run, DON'T autosave the corrupt state, re-read the last-good campaign
 *      from disk, return to the Hub, show <fault-screen>."
 *
 * Crash the *run*, not the *app*.
 *
 * This module is deliberately browser-free: it attaches to an injected
 * `EventTarget` (the real `window` in production, a stub in tests) so the
 * recovery logic is testable under `node --test`. Node has no `ErrorEvent` /
 * `PromiseRejectionEvent` constructors, so we duck-type the event payload
 * (`.error` / `.reason` / `.message`) rather than depend on those types.
 */

/** The source surface a fault arrived from. */
export type FaultSource = 'error' | 'unhandledrejection';

/** A normalized fault handed to `onSignal` and `degrade`. */
export type FaultSignal = {
  /** Always a real `Error`, even when the thrown value wasn't one. */
  error: Error;
  /** Which global event surfaced the fault. */
  source: FaultSource;
};

export type ErrorBoundaryOptions = {
  /** Event source — `window` in production, a stub `EventTarget` in tests. */
  target: EventTarget;
  /**
   * Recover from a tier-1 fault. The shell wires this to the coarse
   * "whole run → Hub, save intact" degrade. Invoked at most once (latched);
   * a throw inside it is contained, never propagated.
   */
  degrade: (signal: FaultSignal) => void;
  /**
   * Dev-channel signal, fired *before* `degrade`. Defaults to `console.error`
   * plus a no-op telemetry seam. This is the "fail loud" half of the doctrine.
   */
  onSignal?: (signal: FaultSignal) => void;
};

/**
 * No-op telemetry seam. The boundary emits every fault here so a real sink can
 * be wired in later without touching the call sites. Intentionally swallows its
 * own errors — telemetry must never become a second fault source.
 */
function emitTelemetry(_signal: FaultSignal): void {
  // Phase 2.6: hook only. A later phase points this at a real backend.
}

function defaultSignal(signal: FaultSignal): void {
  console.error(
    `[error-boundary] tier-1 fault (${signal.source}) — degrading to Hub:`,
    signal.error
  );
  try {
    emitTelemetry(signal);
  } catch {
    // A telemetry failure must not block the degrade path.
  }
}

/** Coerce an arbitrary thrown/rejected value into a real `Error`. */
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(`Non-Error fault value: ${JSON.stringify(value)}`);
  } catch {
    return new Error('Non-Error fault value (unserializable)');
  }
}

/**
 * Install the boundary on `target`. Returns an uninstall function that detaches
 * the listeners (handy for tests and hot-reload).
 */
export function installErrorBoundary(options: ErrorBoundaryOptions): () => void {
  if (!options || typeof options !== 'object') {
    throw new TypeError('installErrorBoundary: options object required');
  }
  const { target, degrade } = options;
  if (!target || typeof target.addEventListener !== 'function') {
    throw new TypeError('installErrorBoundary: options.target must be an EventTarget');
  }
  if (typeof degrade !== 'function') {
    throw new TypeError('installErrorBoundary: options.degrade must be a function');
  }
  const onSignal = options.onSignal ?? defaultSignal;

  // Latch: the boundary degrades exactly once. A fault that fires *during*
  // degrade (e.g. the recovery path itself throws and re-enters the global
  // handler) must not loop us back through degrade.
  let degrading = false;

  function handle(source: FaultSource, raw: unknown): void {
    if (degrading) {
      // Already recovering — surface the secondary fault but don't re-degrade.
      try {
        console.error(`[error-boundary] secondary ${source} fault during degrade:`, raw);
      } catch {
        // ignore — nothing more we can safely do
      }
      return;
    }
    degrading = true;
    const signal: FaultSignal = { error: toError(raw), source };
    try {
      onSignal(signal);
    } catch (signalErr) {
      // The signal channel failed; recovery still has to happen.
      try {
        console.error('[error-boundary] onSignal threw:', signalErr);
      } catch {
        // ignore
      }
    }
    try {
      degrade(signal);
    } catch (degradeErr) {
      // Last line of defense: degrade itself failed. We can't recover further,
      // but we must not propagate — that would re-enter the global handler.
      try {
        console.error('[error-boundary] degrade threw:', degradeErr);
      } catch {
        // ignore
      }
    }
  }

  const onError = (ev: Event) => {
    const e = ev as Event & { error?: unknown; message?: unknown };
    // Prefer the thrown object; fall back to the message string browsers attach.
    handle('error', e.error ?? e.message ?? ev);
  };
  const onRejection = (ev: Event) => {
    const e = ev as Event & { reason?: unknown };
    handle('unhandledrejection', e.reason ?? ev);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
