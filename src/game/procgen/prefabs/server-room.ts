/**
 * "Server room" prefab — 5×5 with rack-aligned cover columns. Two cover
 * lines parallel to the y-axis force a Razor-friendly stalk between racks
 * or a Merc-friendly vault over them. The drone anchor sits between the
 * racks so spotting it costs you positioning either way.
 */

import type { PrefabAscii, PrefabMetadata } from './types.js';

export const ASCII: PrefabAscii = `
.....
.=.=.
.....
.=.=.
.....
`;

export const METADATA = Object.freeze({
  id: 'server-room',
  w: 5,
  h: 5,
  anchors: {
    drones: [
      {
        x: 2,
        y: 2,
      },
    ],
    cover: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 3 },
    ],
    exit: [{ x: 0, y: 2 }],
    neutralCivilians: [{ x: 0, y: 4 }],
  },
  patrolPaths: [
    [
      { x: 2, y: 0 },
      { x: 2, y: 4 },
    ],
  ],
} satisfies PrefabMetadata);
