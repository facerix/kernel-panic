/**
 * Binary Space Partition for procedural map generation.
 *
 * Recursively cuts a rectangular region into smaller leaves until each leaf
 * is small enough to stamp a single prefab into. Pure over an `Rng`: the
 * same seed (and the same parent region) always produces the same tree, so
 * map tests can pin a layout by fixing the rng state.
 *
 * Tunables:
 *   - `MIN_LEAF`   leaf must fit at least the smallest prefab
 *   - `MAX_LEAF`   above this, we *must* keep splitting
 *   - `SPLIT_RATIO_RANGE`  where along the chosen axis we cut, expressed as
 *                          a fraction of the parent's length. Mid-range only
 *                          (no degenerate sliver leaves).
 *
 * Geometry: regions use top-left origin `{x, y, width, height}` matching the
 * Grid coordinate system. Cut axis is chosen by aspect ratio (long side gets
 * the cut) so leaves stay roughly square; ties break randomly.
 *
 * Throws on a region too small to even hold one leaf — silent fallback would
 * mask a `mapBuild` bug calling us with a degenerate viewport.
 */

export const BSP_TUNABLES = Object.freeze({
  MIN_LEAF: 6,
  MAX_LEAF: 12,
  // Cut anywhere from 35% to 65% of the parent's chosen axis. Tighter than
  // the textbook 30–70 because we also gate each child against MIN_LEAF; the
  // mid-third gives us elbow room without producing 1-tile slivers.
  SPLIT_RATIO_MIN: 0.35,
  SPLIT_RATIO_MAX: 0.65,
});

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Region
 * @typedef {{ region: Region, left: BspNode | null, right: BspNode | null,
 *             axis: 'h' | 'v' | null }} BspNode
 */

/**
 * Recursively split `region` until every leaf is between MIN_LEAF and
 * MAX_LEAF on each side. Returns the root of the BSP tree. Leaves have
 * `left === null && right === null && axis === null`.
 *
 * `opts` overrides any tunable (used by tests to pin behaviour).
 */
export function splitRegion(rng, region, opts = {}) {
  if (!rng || typeof rng.next !== 'function') {
    throw new TypeError('splitRegion requires an Rng with a next() method');
  }
  validateRegion(region);
  const tunables = { ...BSP_TUNABLES, ...opts };
  if (region.width < tunables.MIN_LEAF || region.height < tunables.MIN_LEAF) {
    throw new RangeError(
      `splitRegion: region ${regionLabel(region)} smaller than MIN_LEAF=${tunables.MIN_LEAF}`
    );
  }
  return split(rng, region, tunables);
}

/**
 * Walk the BSP tree and collect every leaf (in DFS left-first order). The
 * order is stable for a given tree, so tests can index leaves predictably.
 */
export function leaves(node) {
  if (!node) return [];
  if (!node.left && !node.right) return [node];
  return [...leaves(node.left), ...leaves(node.right)];
}

/**
 * Walk every internal (non-leaf) node, leaf-most-first. Useful for corridor
 * carving: you connect every internal split's two children, working from the
 * deepest splits outward.
 */
export function internalNodes(node) {
  if (!node || (!node.left && !node.right)) return [];
  const out = [];
  if (node.left) out.push(...internalNodes(node.left));
  if (node.right) out.push(...internalNodes(node.right));
  out.push(node);
  return out;
}

function split(rng, region, tunables) {
  const node = { region, left: null, right: null, axis: null };

  // Stop condition: small enough on both axes. We *force* further splits
  // while either side exceeds MAX_LEAF, because we don't want a single
  // gigantic prefab eating the whole map.
  const mustSplit = region.width > tunables.MAX_LEAF || region.height > tunables.MAX_LEAF;
  const canSplit = region.width >= tunables.MIN_LEAF * 2 || region.height >= tunables.MIN_LEAF * 2;

  if (!mustSplit && !canSplit) return node;
  // Both small enough — flip a coin once we're inside the size envelope.
  // Below MAX_LEAF we *can* still split; we choose to half the time so the
  // map gets variety (not always the same leaf count for a given size).
  if (!mustSplit && !rng.chance(0.5)) return node;

  const axis = pickAxis(rng, region, tunables);
  if (!axis) return node;

  const length = axis === 'v' ? region.width : region.height;
  const minPos = Math.max(tunables.MIN_LEAF, Math.floor(length * tunables.SPLIT_RATIO_MIN));
  const maxPos = Math.min(
    length - tunables.MIN_LEAF,
    Math.floor(length * tunables.SPLIT_RATIO_MAX)
  );
  if (maxPos < minPos) {
    // The MIN_LEAF constraint pinches the legal cut window shut on this
    // axis — happens when the parent is barely 2× MIN_LEAF. Try the other
    // axis once before giving up.
    const otherAxis = axis === 'v' ? 'h' : 'v';
    const otherLength = otherAxis === 'v' ? region.width : region.height;
    if (otherLength >= tunables.MIN_LEAF * 2) {
      return splitOnAxis(rng, region, otherAxis, tunables, node);
    }
    return node;
  }
  return splitOnAxis(rng, region, axis, tunables, node, minPos, maxPos);
}

function splitOnAxis(rng, region, axis, tunables, node, minPos = null, maxPos = null) {
  const length = axis === 'v' ? region.width : region.height;
  const lo = minPos ?? Math.max(tunables.MIN_LEAF, Math.floor(length * tunables.SPLIT_RATIO_MIN));
  const hi =
    maxPos ?? Math.min(length - tunables.MIN_LEAF, Math.floor(length * tunables.SPLIT_RATIO_MAX));
  if (hi < lo) return node; // genuinely can't split — return as leaf

  // intRange is half-open [lo, hi+1) so cuts include the boundary.
  const cut = rng.intRange(lo, hi + 1);
  const leftRegion =
    axis === 'v'
      ? { x: region.x, y: region.y, width: cut, height: region.height }
      : { x: region.x, y: region.y, width: region.width, height: cut };
  const rightRegion =
    axis === 'v'
      ? { x: region.x + cut, y: region.y, width: region.width - cut, height: region.height }
      : {
          x: region.x,
          y: region.y + cut,
          width: region.width,
          height: region.height - cut,
        };

  node.axis = axis;
  node.left = split(rng, leftRegion, tunables);
  node.right = split(rng, rightRegion, tunables);
  return node;
}

function pickAxis(rng, region, tunables) {
  // Long side wins when there's a clear difference (>1.2×); otherwise toss.
  const wMin = region.width >= tunables.MIN_LEAF * 2;
  const hMin = region.height >= tunables.MIN_LEAF * 2;
  if (!wMin && !hMin) return null;
  if (!wMin) return 'h';
  if (!hMin) return 'v';
  if (region.width >= region.height * 1.2) return 'v';
  if (region.height >= region.width * 1.2) return 'h';
  return rng.chance(0.5) ? 'v' : 'h';
}

function validateRegion(region) {
  if (
    !region ||
    !Number.isInteger(region.x) ||
    !Number.isInteger(region.y) ||
    !Number.isInteger(region.width) ||
    !Number.isInteger(region.height)
  ) {
    throw new TypeError(`splitRegion: region requires integer x,y,width,height`);
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new RangeError(`splitRegion: region width/height must be positive`);
  }
}

function regionLabel(r) {
  return `${r.width}x${r.height}@(${r.x},${r.y})`;
}
