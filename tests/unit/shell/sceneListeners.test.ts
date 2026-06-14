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
