/**
 * The Hub map — small authored "safe space" the player returns to between
 * runs. Not procedural: the Hub is the same shape every visit so the player
 * forms a spatial relationship with the Curator and the door tile.
 *
 * Layout (12×8, walls outline the room, `D` is the exit door,
 * `C` is the Curator's tile, `@` is the player spawn):
 *
 *   ############
 *   #..........#
 *   #.C........#
 *   #..........#
 *   #..........#
 *   #.....@....#
 *   #.........¤#
 *   ############
 *
 * The door cell is `TILE.EXIT` (passable like FLOOR, distinct glyph); the
 * door coordinate is returned separately so hub / combat transitions stay explicit.
 */

import { Grid } from '../Grid.js';
import { TILE } from '../constants.js';

export const HUB_WIDTH = 12;
export const HUB_HEIGHT = 8;
export const HUB_PLAYER_SPAWN = Object.freeze({ x: 6, y: 5 });
export const HUB_CURATOR_SPAWN = Object.freeze({ x: 2, y: 2 });
export const HUB_EXIT_TILE = Object.freeze({ x: 10, y: 6 });

export function buildHub() {
  const grid = new Grid(HUB_WIDTH, HUB_HEIGHT, TILE.FLOOR);

  // Outer wall ring.
  for (let x = 0; x < HUB_WIDTH; x++) {
    grid.setTile(x, 0, TILE.WALL);
    grid.setTile(x, HUB_HEIGHT - 1, TILE.WALL);
  }
  for (let y = 0; y < HUB_HEIGHT; y++) {
    grid.setTile(0, y, TILE.WALL);
    grid.setTile(HUB_WIDTH - 1, y, TILE.WALL);
  }
  // Door cell — punch a passable tile in the right wall.
  grid.setTile(HUB_EXIT_TILE.x, HUB_EXIT_TILE.y, TILE.EXIT);
  grid.setTile(HUB_WIDTH - 1, HUB_EXIT_TILE.y, TILE.FLOOR);

  return {
    grid,
    playerSpawn: { ...HUB_PLAYER_SPAWN },
    curatorSpawn: { ...HUB_CURATOR_SPAWN },
    exitTile: { ...HUB_EXIT_TILE },
  };
}
