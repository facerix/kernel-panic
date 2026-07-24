import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isCorpTurnTerminal,
  runCorpTurn,
  type CorpTurnDriverCtx,
} from '../../../src/game/corpTurnDriver.js';
import type { TurnActionStep } from '../../../src/types.js';

type TestStep = { type: string };

type FakeEntity = {
  id: string;
  alive: boolean;
  faction: string;
  takeTurnSteps?: () => Generator<TestStep, void, undefined>;
  takeTurn?: () => void;
};

type FakeRun = {
  state: string;
  world: { entities: Map<string, FakeEntity> };
  rng: { next: () => number };
};

type TestSchedule = ((cb: () => void, ms: number) => number) & {
  queue: { cb: () => void; ms: number }[];
  flush: () => void;
  step: () => void;
};

// ---------------------------------------------------------------------------
// Fixtures — the driver only reads a small slice of Run/world, so we hand-
// roll the surfaces directly rather than dragging in the full Run + World.
// ---------------------------------------------------------------------------

/** Build a fake run-like object the driver can iterate. */
function makeRun({
  state = 'COMBAT',
  entities = [],
}: { state?: string; entities?: FakeEntity[] } = {}): FakeRun {
  const map = new Map<string, FakeEntity>();
  for (const e of entities) map.set(e.id, e);
  return {
    state,
    world: { entities: map },
    rng: { next: () => 0 },
  };
}

/** Deterministic scheduler: collects callbacks instead of using real timers. */
function makeSchedule() {
  const queue: { cb: () => void; ms: number }[] = [];
  const fn = ((cb: () => void, ms: number) => queue.push({ cb, ms })) as TestSchedule;
  fn.queue = queue;
  fn.flush = () => {
    while (queue.length > 0) {
      const { cb } = queue.shift()!;
      cb();
    }
  };
  fn.step = () => {
    const { cb } = queue.shift()!;
    cb();
  };
  return fn;
}

function makeAnimLock() {
  const pushes: number[] = [];
  return {
    push: (ms: number) => pushes.push(ms),
    pushes,
  };
}

/** Minimal corp-entity stub with a configurable action sequence. */
function makeDrone(id: string, actions: TestStep[] = []) {
  return {
    id,
    alive: true,
    faction: 'corp',
    actionsLeft: [...actions],
    actionsTaken: [] as TestStep[],
    *takeTurnSteps(): Generator<TestStep, void, undefined> {
      while (this.actionsLeft.length > 0) {
        const next = this.actionsLeft.shift();
        this.actionsTaken.push(next!);
        yield next!;
      }
    },
  };
}

const baseCtx = (overrides: Record<string, unknown>): CorpTurnDriverCtx =>
  ({
    corpFaction: 'corp',
    paint: () => {},
    animLock: makeAnimLock(),
    actionDelayMs: 100,
    lockMarginMs: 50,
    onFinish: () => {},
    schedule: makeSchedule(),
    ...overrides,
  }) as unknown as CorpTurnDriverCtx;

// ---------------------------------------------------------------------------
// Terminal-state semantics
// ---------------------------------------------------------------------------

test('isCorpTurnTerminal: RESULT is terminal, COMBAT/HUB/BRIEFING are not', () => {
  assert.equal(isCorpTurnTerminal('RESULT'), true);
  assert.equal(isCorpTurnTerminal('COMBAT'), false);
  assert.equal(isCorpTurnTerminal('HUB'), false);
  assert.equal(isCorpTurnTerminal('BRIEFING'), false);
  assert.equal(isCorpTurnTerminal('anything-else'), false);
});

test('isCorpTurnTerminal is stable across calls (no internal-state mutation possible)', () => {
  // Regression guard: an earlier draft exported the underlying Set, and a
  // test that tried to assert immutability accidentally *added* a state to
  // it (Object.freeze doesn't lock Set internals). That mutation silently
  // bailed every subsequent corp turn. Now the set is module-internal —
  // there is no API to mutate it — but lock the behaviour with a smoke
  // check so a future "let's expose it for convenience" refactor crashes
  // a test instead of every COMBAT turn.
  for (let i = 0; i < 5; i++) {
    assert.equal(isCorpTurnTerminal('COMBAT'), false);
    assert.equal(isCorpTurnTerminal('RESULT'), true);
    assert.equal(isCorpTurnTerminal('HUB'), false);
  }
});

test('runCorpTurn bails on RESULT state without calling onFinish', () => {
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'RESULT' }),
      onFinish: () => (finished = true),
    })
  );
  assert.equal(finished, false, 'onFinish must not fire while the run is in RESULT');
});

// ---------------------------------------------------------------------------
// Empty-roster regression — the user-reported HUB-stuck bug
// ---------------------------------------------------------------------------

test('runCorpTurn fires onFinish immediately when no corp entities exist (HUB scenario)', () => {
  // Repro of the M0 user bug: in the HUB there are no corp entities, so
  // the empty-roster branch runs. Previously the shell guarded finish on
  // `state === COMBAT`, dropping the HUB endTurn on the floor and sticking
  // the queue on CORP forever.
  let finished = false;
  const schedule = makeSchedule();
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'HUB', entities: [] }),
      onFinish: () => (finished = true),
      schedule,
    })
  );
  assert.equal(finished, true);
  assert.equal(
    schedule.queue.length,
    0,
    'no pump should be scheduled when there is nothing to pump'
  );
});

test('runCorpTurn fires onFinish immediately when every corp entity is dead', () => {
  // Same shape as HUB — the player has cleared the map. The shell would
  // previously have hung on the queue waiting for a corp turn that never
  // produced any actions.
  const dead = {
    id: 'd',
    alive: false,
    faction: 'corp',
    takeTurnSteps() {
      throw new Error('dead drone should never be stepped');
    },
  };
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'COMBAT', entities: [dead] }),
      onFinish: () => (finished = true),
    })
  );
  assert.equal(finished, true);
});

test('runCorpTurn ignores non-corp entities (e.g. Curator, Terminal in Hub)', () => {
  const civilian = {
    id: 'curator',
    alive: true,
    faction: 'neutral',
    takeTurnSteps() {
      throw new Error('non-corp entity should not be stepped');
    },
  };
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'HUB', entities: [civilian] }),
      onFinish: () => (finished = true),
    })
  );
  assert.equal(finished, true);
});

// ---------------------------------------------------------------------------
// Pump semantics — one yield per scheduled tick, paint between each
// ---------------------------------------------------------------------------

test('runCorpTurn batches invisible steps without paint or schedule', () => {
  const drone = makeDrone('d', [
    { type: 'move-patrol' },
    { type: 'move-patrol' },
    { type: 'fire' },
  ]);
  const paints: number[] = [];
  const lock = makeAnimLock();
  const schedule = makeSchedule();
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'COMBAT', entities: [drone] }),
      paint: () => paints.push(drone.actionsTaken.length),
      animLock: lock,
      schedule,
      shouldAnimateStep: (_id: string, step: TurnActionStep) => step.type === 'fire',
      onFinish: () => (finished = true),
    })
  );

  assert.equal(drone.actionsTaken.length, 3, 'all three yields ran synchronously');
  assert.deepEqual(paints, [3], 'only the visible step triggered paint');
  assert.equal(schedule.queue.length, 1, 'one paced tick after the visible step');
  assert.deepEqual(lock.pushes, [150], 'lock only extended for the visible step');
  assert.equal(finished, false);
  schedule.step();
  assert.equal(finished, true);
});

test('runCorpTurn pumps one yield per schedule tick, painting between each', () => {
  const drone = makeDrone('d', [{ type: 'fire' }, { type: 'move-engage' }]);
  const paints: number[] = [];
  const lock = makeAnimLock();
  const schedule = makeSchedule();
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'COMBAT', entities: [drone] }),
      paint: () => paints.push(drone.actionsTaken.length),
      animLock: lock,
      actionDelayMs: 130,
      lockMarginMs: 120,
      schedule,
      onFinish: () => (finished = true),
    })
  );

  // Synchronously: the first yield ran, one paint happened, one schedule
  // call was queued, onFinish has NOT fired yet.
  assert.equal(drone.actionsTaken.length, 1, 'first yield ran synchronously');
  assert.deepEqual(paints, [1]);
  assert.equal(schedule.queue.length, 1);
  assert.equal(schedule.queue[0].ms, 130);
  assert.deepEqual(lock.pushes, [250], 'lock extended by actionDelay + lockMargin');
  assert.equal(finished, false);

  schedule.step(); // pump for the second yield
  assert.equal(drone.actionsTaken.length, 2);
  assert.deepEqual(paints, [1, 2]);
  // Second yield queued another pump. That pump will see no more yields
  // and call onFinish.
  schedule.step();
  assert.equal(finished, true, 'onFinish fires after every generator drains');
});

test('runCorpTurn pumps multiple drones in turn', () => {
  const a = makeDrone('a', [{ type: 'fire' }]);
  const b = makeDrone('b', [{ type: 'move-patrol' }]);
  const schedule = makeSchedule();
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'COMBAT', entities: [a, b] }),
      schedule,
      onFinish: () => (finished = true),
    })
  );
  // a's first yield ran. b hasn't been touched.
  assert.equal(a.actionsTaken.length, 1);
  assert.equal(b.actionsTaken.length, 0);
  schedule.step();
  // a's generator drained, next pump dropped through to b's first yield.
  assert.equal(b.actionsTaken.length, 1);
  schedule.step();
  // b drained; final pump fires onFinish.
  assert.equal(finished, true);
});

test('runCorpTurn stops pumping if state transitions to RESULT mid-turn', () => {
  // Simulate "player flatlined by a drone's killing shot": the run goes
  // into RESULT inside a yield. The next pump tick must bail rather than
  // race the result screen with more corp actions.
  const run = makeRun({ state: 'COMBAT' });
  const drone = makeDrone('d', [{ type: 'fire' }, { type: 'fire' }]);
  run.world!.entities.set(drone.id, drone);
  const schedule = makeSchedule();
  let finished = false;
  runCorpTurn(
    baseCtx({
      run,
      schedule,
      onFinish: () => (finished = true),
    })
  );
  // First yield ran. Now flatline the player synchronously — the shell
  // would do this via Run.enterResult inside the bus listener.
  run.state = 'RESULT';
  schedule.step();
  // Pump should have bailed; drone's second action was NOT consumed and
  // onFinish was NOT called.
  assert.equal(drone.actionsTaken.length, 1, 'pump must not consume yields after RESULT');
  assert.equal(finished, false, 'onFinish must not fire on a terminal run');
});

// ---------------------------------------------------------------------------
// Defensive: takeTurn fallback for non-step-aware corp entities
// ---------------------------------------------------------------------------

test('runCorpTurn falls back to takeTurn() for entities without takeTurnSteps', () => {
  let called = 0;
  const e = {
    id: 'static-threat',
    alive: true,
    faction: 'corp',
    takeTurn() {
      called++;
    },
  };
  let finished = false;
  runCorpTurn(
    baseCtx({
      run: makeRun({ state: 'COMBAT', entities: [e] }),
      onFinish: () => (finished = true),
    })
  );
  assert.equal(called, 1, 'takeTurn fallback must run for non-step-aware AI');
  assert.equal(finished, true, 'no yields produced → onFinish fires immediately');
});

// ---------------------------------------------------------------------------
// Validation — crash loudly on malformed ctx
// ---------------------------------------------------------------------------

test('runCorpTurn rejects malformed ctx', () => {
  assert.throws(() => runCorpTurn(null), /ctx/);
  assert.throws(() => runCorpTurn({}), /run\.state/);
  assert.throws(
    () => runCorpTurn(baseCtx({ run: { state: 'COMBAT', world: {} }, corpFaction: 'corp' })),
    /entities/
  );
  assert.throws(
    () =>
      runCorpTurn(
        baseCtx({ run: makeRun(), corpFaction: '', paint: () => {}, animLock: makeAnimLock() })
      ),
    /corpFaction/
  );
  assert.throws(() => runCorpTurn(baseCtx({ run: makeRun(), paint: 'nope' })), /paint/);
  assert.throws(() => runCorpTurn(baseCtx({ run: makeRun(), animLock: {} })), /animLock/);
  assert.throws(() => runCorpTurn(baseCtx({ run: makeRun(), actionDelayMs: -1 })), /actionDelayMs/);
  assert.throws(() => runCorpTurn(baseCtx({ run: makeRun(), lockMarginMs: NaN })), /lockMarginMs/);
  assert.throws(() => runCorpTurn(baseCtx({ run: makeRun(), onFinish: null })), /onFinish/);
  assert.throws(() => runCorpTurn(baseCtx({ run: makeRun(), schedule: 'nope' })), /schedule/);
});
