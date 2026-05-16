/**
 * "Hallway" prefab — 6×3 corridor with cover at the thirds. No drone anchor
 * (a corridor is a transit space, not a sentry post); the cover gives the
 * player legitimate firing positions when bridging two combat rooms.
 */

export const ASCII = `
......
.+..+.
......
`;

export const METADATA = Object.freeze({
  id: 'hallway',
  w: 6,
  h: 3,
  anchors: {
    drones: [],
    cover: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
    exit: [{ x: 5, y: 1 }],
  },
});
