/**
 * P3.M3.3 — CyberspaceLayer: the digital tactical layer owned by `Run`.
 *
 * Owns its own `EventBus`, `World` (own `Grid`), `CyberAvatar`, `EntryPort`,
 * and map memory. Deliberately NOT a nested `Run` — no contract, telemetry,
 * or extraction machinery; the owning `Run` remains the single state machine
 * and bridges the two layers:
 *
 *   - **Turn cadence:** there is one `TurnQueue` (the meat one). `Run`'s
 *     `TURN_ENDED` listener calls {@link onTurnEnded} with the incoming
 *     faction, refreshing that faction's AP in the cyber world and ticking
 *     the cyber alarm on round advance — both worlds tick, Meatspace keeps
 *     moving while the Decker is jacked in.
 *   - **Determinism:** `build` forks `new Rng(contractSeed).fork('cyberspace')`,
 *     so the layout is a function of the *contract*, independent of the turn
 *     the player jacks in — and trivially reproducible on restore.
 *   - **Persistence:** serialization lives in `Run.snapshot` (symmetric with
 *     the meat world); `persistence.restoreCyberspace` rebuilds the layer via
 *     the plain constructor. `nodeTiles`/`patrolRings` are build-time spawn
 *     anchors only — restored layers carry their spawned entities instead.
 */
import { EventBus } from '../events.js';
import { World } from '../World.js';
import { Rng } from '../../rng.js';
import { buildCyberMap } from './cyberMapBuild.js';
import { CyberAvatar } from './CyberAvatar.js';
import { EntryPort } from './EntryPort.js';
import { DataNode, sliceDifficultyFor } from './DataNode.js';
import { ProbeIce } from './ProbeIce.js';
import { PatrolHostile } from '../ai/PatrolHostile.js';
import { FACTION, type ContractDifficulty, type FactionId } from '../constants.js';
import { coordKey } from '../mapConnectivity.js';
import type { Decker } from '../archetypes/Decker.js';
import type { GridPoint } from '../../types.js';

export type CyberspaceLayerInit = {
  bus: EventBus;
  world: World;
  avatar: CyberAvatar;
  port: EntryPort;
  entryTile: GridPoint;
  /** Build-time data-node anchors (P3.M3.4). Empty on a restored layer. */
  nodeTiles?: GridPoint[];
  /** Build-time Probe patrol rings (P3.M3.5). Empty on a restored layer. */
  patrolRings?: GridPoint[][];
};

export type CyberspaceLayerBuildOptions = {
  contractSeed: number;
  difficulty: ContractDifficulty;
  decker: Decker;
  /**
   * P3.M3.4: data nodes to spawn — the contract objective's `count`.
   * Deliberately required (no default): a count silently diverging from the
   * contract would corrupt the objective.
   */
  nodeCount: number;
};

export class CyberspaceLayer {
  readonly bus: EventBus;
  readonly world: World;
  readonly avatar: CyberAvatar;
  readonly port: EntryPort;
  readonly entryTile: GridPoint;
  readonly nodeTiles: GridPoint[];
  readonly patrolRings: GridPoint[][];
  /** Cyber-grid fog memory — the twin of `Run.mapSeen` for the digital layer. */
  mapSeen: Set<string>;

  constructor({
    bus,
    world,
    avatar,
    port,
    entryTile,
    nodeTiles,
    patrolRings,
  }: CyberspaceLayerInit) {
    if (!(world instanceof World)) {
      throw new TypeError('CyberspaceLayer requires a World');
    }
    if (!(avatar instanceof CyberAvatar)) {
      throw new TypeError('CyberspaceLayer requires a CyberAvatar');
    }
    if (!(port instanceof EntryPort)) {
      throw new TypeError('CyberspaceLayer requires an EntryPort');
    }
    if (
      !entryTile ||
      !Number.isInteger(entryTile.x) ||
      !Number.isInteger(entryTile.y) ||
      !world.grid.inBounds(entryTile.x, entryTile.y)
    ) {
      throw new RangeError('CyberspaceLayer requires an in-bounds integer entryTile');
    }
    this.bus = bus;
    this.world = world;
    this.avatar = avatar;
    this.port = port;
    this.entryTile = { ...entryTile };
    this.nodeTiles = (nodeTiles ?? []).map(p => ({ ...p }));
    this.patrolRings = (patrolRings ?? []).map(ring => ring.map(p => ({ ...p })));
    this.mapSeen = new Set();
  }

  /**
   * Build a fresh layer for `decker` jacking into a contract. Layout is a
   * deterministic function of the contract seed (see module docstring).
   */
  static build({
    contractSeed,
    difficulty,
    decker,
    nodeCount,
  }: CyberspaceLayerBuildOptions): CyberspaceLayer {
    if (!Number.isFinite(contractSeed)) {
      throw new TypeError(`CyberspaceLayer.build requires a finite contractSeed`);
    }
    if (!Number.isInteger(nodeCount) || nodeCount <= 0) {
      throw new RangeError(`CyberspaceLayer.build nodeCount must be a positive integer`);
    }
    const rng = new Rng(contractSeed).fork('cyberspace');
    const map = buildCyberMap({ rng, difficulty });
    if (nodeCount > map.nodeTiles.length) {
      throw new RangeError(
        `CyberspaceLayer.build: nodeCount ${nodeCount} exceeds the map's ` +
          `${map.nodeTiles.length} node tiles`
      );
    }
    const bus = new EventBus();
    const world = new World(map.grid, { events: bus });
    const avatar = new CyberAvatar({
      id: 'cyber-avatar-0',
      x: map.entryTile.x,
      y: map.entryTile.y,
      ram: decker.ram,
      intrusionStrength: decker.intrusionStrength,
      iceResistance: decker.iceResistance,
      callsign: decker.callsign,
    });
    const port = new EntryPort({ id: 'entry-port-0', x: map.portTile.x, y: map.portTile.y });
    world.addEntity(avatar);
    world.addEntity(port);
    // P3.M3.4: data nodes claim the *farthest* node anchors from the entry —
    // the avatar has to cross the lattice (and, from P3.M3.5, the ICE
    // patrolling it). Chebyshev sort is stable over the deterministic
    // generator order, so placement is a pure function of the contract seed.
    const sliceDifficulty = sliceDifficultyFor(difficulty);
    const anchors = [...map.nodeTiles].sort(
      (a, b) => chebyshevFrom(map.entryTile, b) - chebyshevFrom(map.entryTile, a)
    );
    for (let i = 0; i < nodeCount; i++) {
      world.addEntity(
        new DataNode({
          id: `data-node-${i}`,
          x: anchors[i].x,
          y: anchors[i].y,
          sliceDifficulty,
        })
      );
    }
    // P3.M3.5: one Probe per patrol ring, spawned at a seed-picked ring tile
    // (the rng has fully determined the map by here, so this stays a pure
    // function of the contract seed). Probes bind to the layer bus at build —
    // the restore path re-binds via `restoreCyberspaceLayer`.
    map.patrolRings.forEach((ring, i) => {
      const spawn = ring[rng.intRange(0, ring.length)];
      const probe = new ProbeIce({
        id: `probe-ice-${i}`,
        x: spawn.x,
        y: spawn.y,
        patrolWaypoints: ring,
      });
      world.addEntity(probe);
      probe.bindToBus(bus);
    });
    return new CyberspaceLayer({
      bus,
      world,
      avatar,
      port,
      entryTile: map.entryTile,
      nodeTiles: map.nodeTiles,
      patrolRings: map.patrolRings,
    });
  }

  /**
   * Mirror of `TurnQueue.endTurn`'s per-world work, driven by the meat
   * queue's `TURN_ENDED` payload: refresh the incoming faction's AP in the
   * cyber world, and tick the cyber alarm on round advance (the incoming
   * faction wrapping back to PLAYER).
   */
  onTurnEnded(next: FactionId): void {
    for (const entity of this.world.entities.values()) {
      if (entity.alive && entity.faction === next) {
        entity.refreshAp();
      }
    }
    if (next === FACTION.PLAYER) {
      this.world.tickAlarm();
    }
  }

  /** Record seen cyber-grid coordinate keys. Out-of-bounds keys are corrupt and throw. */
  recordSeen(keys: Iterable<string>): void {
    for (const key of keys) {
      const point = parseCoordKey(key);
      if (!this.world.grid.inBounds(point.x, point.y)) {
        throw new RangeError(`CyberspaceLayer.recordSeen: key "${key}" is out of bounds`);
      }
      this.mapSeen.add(coordKey(point.x, point.y));
    }
  }

  /** Sorted (row-major) seen keys for byte-stable snapshots. */
  mapSeenKeys(): string[] {
    return [...this.mapSeen].sort((a, b) => {
      const pa = parseCoordKey(a);
      const pb = parseCoordKey(b);
      return pa.y === pb.y ? pa.x - pb.x : pa.y - pb.y;
    });
  }

  /**
   * Unbind ICE bus subscriptions on jack-out/death so dead-layer listeners
   * can never fire again. Probe ICE lands in P3.M3.5; the hook is wired now
   * so `Run.jackOut` has one teardown seam.
   */
  teardown(): void {
    for (const entity of this.world.entities.values()) {
      if (entity instanceof PatrolHostile) {
        entity.unbind();
      }
    }
  }
}

function chebyshevFrom(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function parseCoordKey(key: string): GridPoint {
  if (typeof key !== 'string') {
    throw new TypeError('CyberspaceLayer: coordinate key must be a string');
  }
  const match = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!match) {
    throw new TypeError(`CyberspaceLayer: malformed coordinate key "${key}"`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}
