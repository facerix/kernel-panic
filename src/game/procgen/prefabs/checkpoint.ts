/**
 * "Checkpoint" prefab — a security divider with a single door in the center
 * wall. The `|` authoring glyph parses as floor plus a door anchor; the door
 * entity decides whether that cell blocks movement.
 */

import type { PrefabAscii, PrefabMetadata } from './types.js';

export const ASCII: PrefabAscii = `
...#...
...#...
...|...
...#...
...#...
`;

export const METADATA = Object.freeze({
  id: 'checkpoint',
  w: 7,
  h: 5,
  anchors: {
    drones: [
      {
        x: 5,
        y: 2,
      },
    ],
    cover: [],
    exit: [{ x: 6, y: 2 }],
    doors: [{ x: 3, y: 2 }],
    corpCivilians: [{ x: 5, y: 1 }],
  },
  patrolPaths: [
    [
      { x: 5, y: 1 },
      { x: 5, y: 3 },
    ],
  ],
} satisfies PrefabMetadata);
