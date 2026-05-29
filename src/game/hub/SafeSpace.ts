/**
 * The Hub map — small authored "safe house" the player returns to between
 * runs. Not procedural: the Hub is the same shape every visit so the player
 * forms a spatial relationship with the Curator, the loadout Terminal, and
 * the exit door.
 *
 * Layout (12×8, walls outline the room, `D` is the exit door,
 * `C` is the Curator, `F` is Finn the fence, `‡` is the loadout Terminal,
 * `⧰` is Patch the clinic, `@` is the player spawn):
 *
 *   ############
 *   #..........#
 *   #.C..F...‡.#
 *   #..........#
 *   #..........#
 *   #⧰....@....#
 *   #..........¤
 *   ############
 *
 * The door cell is `TILE.EXIT` (passable like FLOOR, distinct glyph); the
 * door coordinate is returned separately so hub / combat transitions stay
 * explicit. Curator and Terminal sit on FLOOR — entities, not tiles — so the
 * grid bytes are identical run-to-run.
 */

import { Grid } from '../Grid.js';
import { TILE } from '../constants.js';

export const HUB_WIDTH = 12;
export const HUB_HEIGHT = 8;
export const HUB_PLAYER_SPAWN = Object.freeze({ x: 6, y: 5 });
export const HUB_CURATOR_SPAWN = Object.freeze({ x: 2, y: 2 });
// Terminal sits across the room from the Curator so the player has to make
// the explicit decision to walk to it (no accidental archetype reroll while
// heading for the Curator). Walkable FLOOR, distinct from every other named
// tile in the hub.
export const HUB_FINN_SPAWN = Object.freeze({ x: 5, y: 2 });
export const HUB_CLINIC_SPAWN = Object.freeze({ x: 2, y: 5 });
export const HUB_TERMINAL_SPAWN = Object.freeze({ x: 9, y: 2 });
export const HUB_EXIT_TILE = Object.freeze({ x: 11, y: 6 });

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
  // Exit door — punch a passable tile in the right wall.
  grid.setTile(HUB_EXIT_TILE.x, HUB_EXIT_TILE.y, TILE.EXIT);

  return {
    grid,
    playerSpawn: { ...HUB_PLAYER_SPAWN },
    curatorSpawn: { ...HUB_CURATOR_SPAWN },
    finnSpawn: { ...HUB_FINN_SPAWN },
    clinicSpawn: { ...HUB_CLINIC_SPAWN },
    terminalSpawn: { ...HUB_TERMINAL_SPAWN },
    exitTile: { ...HUB_EXIT_TILE },
  };
}
