/**
 * Seeded pseudo-random number generator.
 *
 * Mulberry32: a tiny, fast, statistically-decent 32-bit PRNG. Reproducible
 * from a u32 seed — same seed always produces the same stream — which is
 * what lets us:
 *   - replay turn-by-turn for debugging
 *   - snapshot a run's RNG into the M7 save without ballooning state
 *   - assert deterministic combat in tests
 *
 * Source: Tommy Ettinger / public domain, widely used in roguelike toolkits.
 */

/**
 * @param {number} seed — coerced to a u32. NaN/undefined → 0 (so callers
 *   forced to seed: pass a real seed). We don't crash here because tests and
 *   harness code pass through whatever the caller hands us; the consumer
 *   class (`Rng`) does coerce-and-store explicitly.
 * @returns {() => number} a function returning a float in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smallest random-source protocol for consumers that only draw unit floats. */
export interface RandomSource {
  next(): number;
}

/**
 * Stateful wrapper around `mulberry32`. The internal `state` is a single u32
 * that advances on every call — exposing it means a save can checkpoint a
 * run by writing `{ seed, state }` and restore it later by re-seeding to
 * `state`.
 *
 * Convenience helpers (`intRange`, `chance`, `pick`) consume one number from
 * the underlying stream each. Forking with `fork(label)` returns a fresh
 * `Rng` whose seed is derived from the current state plus a string-hashed
 * label — useful for stable substreams (e.g. one for combat, one for
 * mapgen) so adding a new mechanic doesn't perturb every other roll.
 */
export class Rng {
  seed: number;
  state: number;

  // Lazily-rebuilt mulberry closure. Recreated whenever `state` is restored
  // externally (e.g. on save load), so the stream resumes from the right spot.
  #advance: () => number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new TypeError(`Rng requires a finite numeric seed, got ${seed}`);
    }
    this.seed = seed >>> 0;
    this.state = this.seed;
    this.#advance = mulberry32(this.state);
  }

  /**
   * INVARIANT: `this.state` mirrors the closure's internal `a`. mulberry32
   * advances `a` by adding `0x6d2b79f5` (mod 2³²) on every call; we mirror
   * the same step here so a snapshot of `this.state` after N calls re-seeds
   * a fresh closure to the same point. If mulberry's stepping ever changes,
   * BOTH the closure and this mirror must move together — otherwise saves
   * silently desync from the live stream.
   */
  next(): number {
    const v = this.#advance();
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    return v;
  }

  /**
   * Integer in [min, max) — half-open, like `Array.slice`. Crashes if the
   * range is empty so a bug like `intRange(5, 5)` doesn't silently always
   * return 5 (it would hide off-by-one errors elsewhere).
   */
  intRange(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError(`intRange bounds must be integers, got [${min}, ${max})`);
    }
    if (max <= min) {
      throw new RangeError(`intRange requires max > min, got [${min}, ${max})`);
    }
    return min + Math.floor(this.next() * (max - min));
  }

  /** True with probability `p` ∈ [0, 1]. */
  chance(p: number): boolean {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError(`chance probability must be in [0, 1], got ${p}`);
    }
    return this.next() < p;
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new TypeError('pick requires a non-empty array');
    }
    return arr[this.intRange(0, arr.length)];
  }

  /**
   * Restore the stream to a previously-captured state. Pair with reading
   * `.state` to checkpoint into DataStore.
   */
  setState(state: number): void {
    if (!Number.isFinite(state)) {
      throw new TypeError(`setState requires a finite numeric state, got ${state}`);
    }
    this.state = state >>> 0;
    this.#advance = mulberry32(this.state);
  }

  /**
   * Derive an independent substream. The new Rng's seed is a hash of this
   * stream's current state and the label string. Same (state, label) → same
   * substream, so substreams are still reproducible from the parent seed.
   */
  fork(label: string): Rng {
    if (typeof label !== 'string' || label.length === 0) {
      throw new TypeError('fork requires a non-empty string label');
    }
    let h = this.state >>> 0;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    }
    return new Rng(h);
  }
}
