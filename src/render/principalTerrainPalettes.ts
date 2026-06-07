/**
 * Principal-specific combat terrain moods (floor / wall / cover).
 * Rubble inherits wall colour in `glyphForTile` — not stored here.
 *
 * Curated per `CONTRACT_LEXICON.principals`; see `docs/phase-2.9-plan.md`.
 */

export interface TerrainPalette {
  readonly floor: string;
  readonly wall: string;
  readonly cover: string;
}

/** Baseline combat look — matches the original `TILE_GLYPH` terrain hues. */
export const DEFAULT_TERRAIN_PALETTE: TerrainPalette = Object.freeze({
  floor: '#1f4d44',
  wall: '#5fbcd4',
  cover: '#d49a3a',
});

const PALETTES: Readonly<Record<string, TerrainPalette>> = Object.freeze({
  // ── Corp principals ────────────────────────────────────────────────────────
  matsuda: {
    floor: '#1a3d38',
    wall: '#4a9aaa',
    cover: '#b8863a',
  },
  'vuong-holdings': {
    floor: '#1a2540',
    wall: '#6b8cff',
    cover: '#8b6fd4',
  },
  'spinning-fox': {
    floor: '#2a3028',
    wall: '#7a9a6b',
    cover: '#c49a50',
  },
  yutani: {
    floor: '#252a30',
    wall: '#6a8a9a',
    cover: '#9a8a5a',
  },
  'kestrel-dynamics': {
    floor: '#1f4d44',
    wall: '#5fbcd4',
    cover: '#c48a3a',
  },
  'sable-kline': {
    floor: '#1c2838',
    wall: '#5a7aaa',
    cover: '#aa7a4a',
  },
  heliodyne: {
    floor: '#2a2820',
    wall: '#8aaa6a',
    cover: '#d4a040',
  },
  'orchid-vector': {
    floor: '#1a3530',
    wall: '#7ad4c4',
    cover: '#6ab88a',
  },
  'northstar-civic': {
    floor: '#283038',
    wall: '#7a9ab0',
    cover: '#b0a060',
  },
  marrowgate: {
    floor: '#302820',
    wall: '#8a7a60',
    cover: '#d49040',
  },
  // ── Civic principals ───────────────────────────────────────────────────────
  'bayline-transit': {
    floor: '#222830',
    wall: '#6898b8',
    cover: '#8a9aaa',
  },
  'district-water-board': {
    floor: '#1a3040',
    wall: '#4a90b8',
    cover: '#5a8a70',
  },
  'civic-grid-office': {
    floor: '#282a28',
    wall: '#98b8a8',
    cover: '#b8a878',
  },
  'port-warden-bureau': {
    floor: '#1a2830',
    wall: '#5a8aaa',
    cover: '#c8a858',
  },
  // ── Rival principals ─────────────────────────────────────────────────────────
  'chrome-choir': {
    floor: '#302520',
    wall: '#c87858',
    cover: '#d4a050',
  },
  'redline-union': {
    floor: '#352820',
    wall: '#b87050',
    cover: '#e0a040',
  },
  'null-saints': {
    floor: '#281a30',
    wall: '#a060c0',
    cover: '#60a0a8',
  },
});

/**
 * Lookup terrain colours for a contract principal. Unknown ids fall back to
 * `DEFAULT_TERRAIN_PALETTE` with a dev-channel warning — same policy as
 * `enemyAliases.aliasFor`.
 */
export function terrainPaletteFor(principalId: string): TerrainPalette {
  const palette = PALETTES[principalId];
  if (!palette) {
    console.warn(`[terrainPalette] unknown principal "${principalId}"; using default`);
    return DEFAULT_TERRAIN_PALETTE;
  }
  return palette;
}
