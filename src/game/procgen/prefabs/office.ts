/**
 * "Office" prefab — small open room with two cover desks tucked against the
 * back wall. Footprint 5×4 (fits inside MIN_LEAF=6 with 1-tile buffer for a
 * doorway carve).
 *
 * Glyphs: `.` floor, `#` wall, `=` cover.
 *
 * The drone anchor sits centred along the top corridor; waypoints walk a
 * short patrol so the player gets a visible LOS check on entry.
 */

import type { PrefabAscii, PrefabMetadata } from './types.js';

export const ASCII: PrefabAscii = `
.....
.=.=.
.....
.....
`;

export const METADATA = Object.freeze({
  id: 'office',
  w: 5,
  h: 4,
  anchors: {
    drones: [
      {
        x: 2,
        y: 0,
      },
    ],
    cover: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ],
    exit: [{ x: 4, y: 3 }],
    corpCivilians: [{ x: 4, y: 1 }],
  },
  patrolPaths: [
    [
      { x: 2, y: 0 },
      { x: 2, y: 3 },
    ],
  ],
} satisfies PrefabMetadata);
