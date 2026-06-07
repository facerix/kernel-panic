import type { EnemyArchetype } from './encounters.js';

/**
 * Principal-facing theming layer (Phase 2.9 M1).
 *
 * Behavior classes (`Skirmisher`, `Guard`, …) stay stable; this table maps a
 * `(principalId, ENEMY_ARCHETYPE)` pair to the diegetic name a player reads in
 * the log / describe / corp-turn copy, plus a short bracket tag.
 *
 * Identity lives here; allegiance (`faction`) and tactical role (glyph) do not.
 * See `docs/phase-2.9-plan.md`.
 */
export interface EnemyAlias {
  /** Combat-log / describe name, e.g. `"Auditor"`. */
  readonly displayName: string;
  /** Short bracket prefix, e.g. `"Matsuda"` → `[Matsuda]Auditor`. `''` when the owner is unknown. */
  readonly principalTag: string;
}

interface PrincipalAliases {
  readonly tag: string;
  /**
   * Keying on `Record<EnemyArchetype, string>` makes TypeScript reject a
   * principal that omits any archetype — a compile-time completeness guard
   * complementing the runtime coverage test.
   */
  readonly names: Readonly<Record<EnemyArchetype, string>>;
}

/**
 * Curated alias table. Kestrel Dynamics is the baseline merc roster (names mirror
 * C2077 corp security literally); other principals diverge by domain — finance,
 * data, logistics, infrastructure, medical, civic, and rival/street.
 *
 * Tags are capped at 8 chars for tablet combat-log width (enforced by test).
 */
const ALIAS_TABLE: Readonly<Record<string, PrincipalAliases>> = Object.freeze({
  // ── Corp principals ────────────────────────────────────────────────────────
  matsuda: {
    tag: 'Matsuda',
    names: {
      skirmisher: 'Auditor',
      guard: 'Floor Security',
      sniper: 'Marksman',
      lookout: 'Compliance Officer',
      medic: 'Forensic Tech',
      bruiser: 'Collections Agent',
      juggernaut: 'Senior Auditor',
      flanker: 'Process Server',
    },
  },
  'vuong-holdings': {
    tag: 'Vuong',
    names: {
      skirmisher: 'Crawler',
      guard: 'Server Warden',
      sniper: 'Packet Sniper',
      lookout: 'Net Analyst',
      medic: 'Sysadmin',
      bruiser: 'Firewall',
      juggernaut: 'Root Admin',
      flanker: 'Daemon',
    },
  },
  'spinning-fox': {
    tag: 'Fox',
    names: {
      skirmisher: 'Courier',
      guard: 'Dock Guard',
      sniper: 'Overwatch',
      lookout: 'Dispatcher',
      medic: 'Field Medic',
      bruiser: 'Loader',
      juggernaut: 'Yard Boss',
      flanker: 'Runner',
    },
  },
  yutani: {
    tag: 'Yutani',
    names: {
      skirmisher: 'Sec-Op',
      guard: 'Facility Guard',
      sniper: 'Marksman',
      lookout: 'Watch Officer',
      medic: 'Trauma Unit',
      bruiser: 'Heavy',
      juggernaut: 'Site Commander',
      flanker: 'Infiltrator',
    },
  },
  'kestrel-dynamics': {
    tag: 'Kestrel',
    names: {
      skirmisher: 'Patrol Unit',
      guard: 'Contract Guard',
      sniper: 'Sniper',
      lookout: 'Tactician',
      medic: 'Trauma Tech',
      bruiser: 'Enforcer',
      juggernaut: 'Juggernaut',
      flanker: 'Assassin',
    },
  },
  'sable-kline': {
    tag: 'Sable',
    names: {
      skirmisher: 'Analyst',
      guard: 'Vault Security',
      sniper: 'Marksman',
      lookout: 'Risk Officer',
      medic: 'Recovery Tech',
      bruiser: 'Liquidator',
      juggernaut: 'Director',
      flanker: 'Fixer',
    },
  },
  heliodyne: {
    tag: 'Helio',
    names: {
      skirmisher: 'Grid-Op',
      guard: 'Plant Guard',
      sniper: 'Marksman',
      lookout: 'Control Tech',
      medic: 'Safety Officer',
      bruiser: 'Lineman',
      juggernaut: 'Plant Chief',
      flanker: 'Saboteur',
    },
  },
  'orchid-vector': {
    tag: 'Orchid',
    names: {
      skirmisher: 'Orderly',
      guard: 'Ward Security',
      sniper: 'Marksman',
      lookout: 'Triage Nurse',
      medic: 'Trauma Surgeon',
      bruiser: 'Bouncer',
      juggernaut: 'Chief Surgeon',
      flanker: 'Surgical Tech',
    },
  },
  'northstar-civic': {
    tag: 'N*',
    names: {
      skirmisher: 'Patrol Officer',
      guard: 'Civic Guard',
      sniper: 'Marksman',
      lookout: 'Watch Captain',
      medic: 'Paramedic',
      bruiser: 'Riot Officer',
      juggernaut: 'Precinct Chief',
      flanker: 'Detective',
    },
  },
  marrowgate: {
    tag: 'Marrow',
    names: {
      skirmisher: 'Hauler',
      guard: 'Gate Guard',
      sniper: 'Overwatch',
      lookout: 'Foreman',
      medic: 'Field Medic',
      bruiser: 'Roughneck',
      juggernaut: 'Depot Boss',
      flanker: 'Wrangler',
    },
  },
  // ── Civic principals (fold into FACTION.CORP — the establishment) ───────────
  'bayline-transit': {
    tag: 'Bayline',
    names: {
      skirmisher: 'Transit Officer',
      guard: 'Station Guard',
      sniper: 'Marksman',
      lookout: 'Controller',
      medic: 'First Responder',
      bruiser: 'Fare Enforcer',
      juggernaut: 'Transit Marshal',
      flanker: 'Inspector',
    },
  },
  'district-water-board': {
    tag: 'DWB',
    names: {
      skirmisher: 'Utility Patrol',
      guard: 'Works Guard',
      sniper: 'Marksman',
      lookout: 'Flow Monitor',
      medic: 'Safety Officer',
      bruiser: 'Reclaimer',
      juggernaut: 'Works Chief',
      flanker: 'Meter Reader',
    },
  },
  'civic-grid-office': {
    tag: 'Grid',
    names: {
      skirmisher: 'Grid Officer',
      guard: 'Substation Guard',
      sniper: 'Marksman',
      lookout: 'Load Dispatcher',
      medic: 'Safety Officer',
      bruiser: 'Lineman',
      juggernaut: 'Grid Marshal',
      flanker: 'Breaker',
    },
  },
  'port-warden-bureau': {
    tag: 'Port',
    names: {
      skirmisher: 'Port Officer',
      guard: 'Harbor Guard',
      sniper: 'Marksman',
      lookout: 'Harbormaster',
      medic: 'Rescue Tech',
      bruiser: 'Longshoreman',
      juggernaut: 'Port Marshal',
      flanker: 'Customs Agent',
    },
  },
  // ── Rival principals (FACTION.RIVAL — gang/street) ─────────────────────────
  'chrome-choir': {
    tag: 'Choir',
    names: {
      skirmisher: 'Racketeer',
      guard: 'Bouncer',
      sniper: 'Soloist',
      lookout: 'Lookout',
      medic: 'Street Doc',
      bruiser: 'Heavyweight',
      juggernaut: 'Headliner',
      flanker: 'Cutthroat',
    },
  },
  'redline-union': {
    tag: 'Redline',
    names: {
      skirmisher: 'Picketer',
      guard: 'Steward',
      sniper: 'Sharpshooter',
      lookout: 'Spotter',
      medic: 'Union Medic',
      bruiser: 'Enforcer',
      juggernaut: 'Union Boss',
      flanker: 'Saboteur',
    },
  },
  'null-saints': {
    tag: 'Saints',
    names: {
      skirmisher: 'Initiate',
      guard: 'Acolyte',
      sniper: 'Ghost',
      lookout: 'Oracle',
      medic: 'Mender',
      bruiser: 'Zealot',
      juggernaut: 'Archon',
      flanker: 'Phantom',
    },
  },
});

/** Capitalize an archetype id for the generic fallback name (`skirmisher` → `Skirmisher`). */
function genericName(archetype: string): string {
  if (archetype.length === 0) return archetype;
  return archetype.charAt(0).toUpperCase() + archetype.slice(1);
}

/**
 * Resolve the display alias for a spawned hostile.
 *
 * Fallback policy (Phase 2.9 decision): an uncurated `(principalId, archetype)`
 * pair is a real gap we want to surface — so we `console.warn` (loud in dev) but
 * still return the generic archetype name so a run/save never breaks (graceful
 * in prod). A known principal contributes its tag even when only the name falls
 * back.
 */
export function aliasFor(principalId: string, archetype: EnemyArchetype): EnemyAlias {
  const entry = ALIAS_TABLE[principalId];
  const name = entry?.names[archetype];
  if (entry === undefined || name === undefined) {
    console.warn(
      `[enemyAliases] no curated alias for (${principalId}, ${archetype}); ` +
        `falling back to generic name "${genericName(archetype)}"`
    );
    return { displayName: genericName(archetype), principalTag: entry?.tag ?? '' };
  }
  return { displayName: name, principalTag: entry.tag };
}
