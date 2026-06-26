import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus, EVENT } from '../../../src/game/events.js';
import { VisionField } from '../../../src/game/Vision.js';
import { SceneListenerController } from '../../../src/shell/sceneListeners.js';
import type { ShellScene } from '../../../src/shell/sceneView.js';

test('SceneListenerController rewire replaces bus handlers', () => {
  let flashCount = 0;
  let recomputeCount = 0;
  const bus = new EventBus();
  const scene: ShellScene = {
    bus,
    world: null,
    player: null,
    state: 'hub',
  } as unknown as ShellScene;

  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: { stageEl: {} as HTMLElement, pipCanvas: {} as HTMLCanvasElement },
    renderers: {
      main: { draw: () => {} } as never,
      pip: { draw: () => {} } as never,
    },
    animLock: { push: () => {} },
    effects: {
      flash: () => {
        flashCount++;
      },
      paint: () => {},
      paintPip: () => {},
      recomputeVision: () => {
        recomputeCount++;
      },
    },
    onCivilianHarmReset: () => {},
    onCivilianHarmed: () => {},
    onRepAdjust: () => {},
    onAlarmTransition: () => {},
    onObjectiveTimerExpired: () => {},
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });

  controller.rewire();
  bus.emit(EVENT.ENTITY_MOVED);
  assert.equal(recomputeCount, 1);

  controller.rewire();
  bus.emit(EVENT.DOOR_UNLOCKED, { label: 'Vault door' });
  assert.equal(flashCount, 1);
});

test('P3.M4.5: meat body damage flashes the PIP only while viewing Cyberspace', () => {
  const bus = new EventBus();
  const body = { id: 'body', x: 3, y: 4, hp: 4, maxHp: 8, alive: true };
  // Minimal jacked-in scene: archetype marks it a Run, cyberspace active = a layer exists.
  const scene = {
    bus,
    world: { entities: new Map() },
    player: body,
    archetype: 'decker',
    cyberspace: {
      phase: 'active',
      layer: { avatar: { id: 'avatar' }, bus: new EventBus(), mapSeenKeys: () => [] },
    },
    activeLayer: 'cyber',
    state: 'combat',
  } as unknown as ShellScene;

  const flashes: string[] = [];
  let pipPaints = 0;
  const fakeClassList = { remove: () => {}, add: () => {}, toggle: () => {} };
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: {
      stageEl: { classList: fakeClassList, offsetWidth: 0 } as unknown as HTMLElement,
      pipCanvas: { classList: fakeClassList, offsetWidth: 0 } as unknown as HTMLCanvasElement,
    },
    // No flashCell ⇒ runMuzzleFlash is a no-op, so we exercise only the damage block.
    renderers: { main: {} as never, pip: {} as never },
    animLock: { push: () => {} },
    effects: {
      flash: (msg: string) => flashes.push(msg),
      paint: () => {},
      paintPip: () => {
        pipPaints++;
      },
      recomputeVision: () => {},
    },
    onCivilianHarmReset: () => {},
    onCivilianHarmed: () => {},
    onRepAdjust: () => {},
    onAlarmTransition: () => {},
    onObjectiveTimerExpired: () => {},
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  // Viewing Cyberspace: the meat body is in the PIP, so a body hit pulses it.
  bus.emit(EVENT.ENTITY_DAMAGED, { target: body, damage: 3 });
  assert.equal(pipPaints, 1);
  assert.equal(flashes.length, 1);
  assert.match(flashes[0] ?? '', /^BODY HIT/);

  // Flip back to Meatspace: the body is on the main canvas now — no PIP feedback.
  (scene as unknown as { activeLayer: string }).activeLayer = 'meat';
  bus.emit(EVENT.ENTITY_DAMAGED, { target: body, damage: 3 });
  assert.equal(pipPaints, 1);
  assert.equal(flashes.length, 1);
});

test('P3.M4.6: forced jack-out body repair is not memorised as a meat corpse', () => {
  const bus = new EventBus();
  const body = { id: 'body', x: 3, y: 4, hp: 1, maxHp: 8, alive: true };
  const scene = {
    bus,
    world: { entities: new Map() },
    player: body,
    archetype: 'decker',
    cyberspace: { phase: 'resolved', objectiveComplete: false },
    activeLayer: 'meat',
    state: 'combat',
  } as unknown as ShellScene;

  let memorised = 0;
  const fakeClassList = { remove: () => {}, add: () => {}, toggle: () => {} };
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: {
      stageEl: { classList: fakeClassList, offsetWidth: 0 } as unknown as HTMLElement,
      pipCanvas: { classList: fakeClassList, offsetWidth: 0 } as unknown as HTMLCanvasElement,
    },
    renderers: { main: {} as never, pip: {} as never },
    animLock: { push: () => {} },
    effects: {
      flash: () => {},
      paint: () => {},
      paintPip: () => {},
      recomputeVision: () => {},
    },
    onCivilianHarmReset: () => {},
    onCivilianHarmed: () => {},
    onRepAdjust: () => {},
    onAlarmTransition: () => {},
    onObjectiveTimerExpired: () => {},
    memoriseMeatCorpse: () => {
      memorised++;
    },
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  bus.emit(EVENT.ENTITY_DAMAGED, { target: body, damage: 1, killed: true });

  assert.equal(memorised, 0);
});
