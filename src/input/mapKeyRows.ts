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
  { glyph: '⧰', label: "Patch's clinic" },
  { glyph: '£', label: 'ledger - chronicle of all runs' },
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
  { glyph: 's', label: 'sniper — telegraphed long shot; get cover or get hit' },
  { glyph: 'l', label: 'lookout — marks you for the team; does not shoot' },
  { glyph: 'm', label: 'medic — shields and patches durable allies' },
  { glyph: 'b', label: 'bruiser — armored melee; shoves you back on a hit' },
  { glyph: 'j', label: 'juggernaut — armored; suppressing fire from range' },
  { glyph: 'f', label: 'flanker — vanishes through cover; ambush melee' },
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
