/**
 * "Lab" prefab — 10×6 experiment bay with a central equipment island, two
 * fodder sentry points, and both civilian taxonomies so alarm/Rep play gets
 * exercised in generated maps.
 */

import type { PrefabAscii, PrefabMetadata } from './types.js';

export const ASCII: PrefabAscii = `
..........
..........
....===...
..........
..........
..........
`;

export const METADATA = Object.freeze({
  id: 'lab',
  w: 10,
  h: 6,
  anchors: {
    fodder: [
      { x: 2, y: 1 },
      { x: 7, y: 4 },
    ],
    cover: [
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
    ],
    exit: [{ x: 9, y: 3 }],
    corpCivilians: [{ x: 1, y: 4 }],
    neutralCivilians: [{ x: 8, y: 1 }],
  },
  patrolPaths: [
    [
      { x: 2, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 4 },
      { x: 2, y: 4 },
    ],
    [
      { x: 7, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 1 },
      { x: 7, y: 1 },
    ],
  ],
} satisfies PrefabMetadata);
