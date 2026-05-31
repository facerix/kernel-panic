/**
 * Map symbol glossary for `<key-help>` Map Key tab.
 * Hand-authored copy — update when new grid glyphs ship.
 */

export type MapKeyRow = { glyph: string; label: string };

export const MAP_KEY_UNIVERSAL: readonly MapKeyRow[] = Object.freeze([
  { glyph: '#', label: 'wall' },
  { glyph: '=', label: 'cover (blocks shots; breaks civilian sight)' },
  { glyph: '¤', label: 'exit' },
]);

export const MAP_KEY_HUB: readonly MapKeyRow[] = Object.freeze([
  { glyph: 'C', label: 'Curator — contracts & rumors' },
  { glyph: '¥', label: "Finn's shop" },
  { glyph: '⧰', label: 'Clinic (Patch)' },
  { glyph: '‡', label: 'crew terminal' },
]);

export const MAP_KEY_COMBAT_TERRAIN: readonly MapKeyRow[] = Object.freeze([
  { glyph: '▪ ▫', label: 'locked / open door' },
  { glyph: '‡', label: 'terminal (slice / alarm)' },
  { glyph: '~', label: 'relay node' },
  { glyph: '%', label: 'rubble / corpse wreck' },
  { glyph: '░', label: 'smoke (blocks LOS)' },
  { glyph: '▓', label: 'hazard (damage each turn)' },
]);

/** Hostile glyphs and one-line combat behavior */
export const MAP_KEY_COMBAT_HOSTILES: readonly MapKeyRow[] = Object.freeze([
  { glyph: 'c', label: 'corp civilian — facility alarm if they see you' },
  { glyph: 'g', label: 'guard — closes fast and hits hard' },
  { glyph: 'k', label: 'skirmisher — ranged; backs off if you close in' },
  { glyph: 'n', label: 'sniper — telegraphed long shot; get cover or get hit' },
  { glyph: 's', label: 'spotter — marks you for the team; does not shoot' },
  { glyph: '$', label: 'turret — stationary ranged' },
  { glyph: '◆', label: 'corp asset (objective target)' },
]);

export const MAP_KEY_COMBAT_ALLIES: readonly MapKeyRow[] = Object.freeze([
  { glyph: 'T', label: 'your turret — fires twice after your turn' },
  { glyph: '& A', label: 'allies' },
  { glyph: '§', label: 'mirror unit' },
  { glyph: '! *', label: 'dead drops / pickups' },
  { glyph: 'κ', label: 'access keycard' },
  { glyph: 'ø', label: 'breaching charge' },
]);
