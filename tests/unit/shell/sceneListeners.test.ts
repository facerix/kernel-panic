import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus, EVENT } from '../../../src/game/events.js';
import { VisionField } from '../../../src/game/Vision.js';
import { ANIMATION_DURATIONS } from '../../../src/render/animations.js';
import {
  CLOAK_FLASH_FG,
  HEAL_FLASH_FG,
  MIND_INFLUENCE_FG,
  VAULT_IMPACT_FG,
} from '../../../src/render/palette.js';
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
  const fakeStyle = { setProperty: () => {}, removeProperty: () => {} };
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: {
      stageEl: {
        classList: fakeClassList,
        style: fakeStyle,
        offsetWidth: 0,
      } as unknown as HTMLElement,
      pipCanvas: {
        classList: fakeClassList,
        style: fakeStyle,
        offsetWidth: 0,
      } as unknown as HTMLCanvasElement,
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

test('fully mitigated body hits still shake and flash with the stopping defense color', () => {
  const bus = new EventBus();
  const body = { id: 'body', x: 3, y: 4, hp: 4, maxHp: 8, alive: true };
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

  const classes = new Set<string>();
  const properties = new Map<string, string>();
  const pipClasses = new Set<string>();
  const pipProperties = new Map<string, string>();
  const flashes: string[] = [];
  let pipPaints = 0;
  const stage = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    offsetWidth: 0,
  } as unknown as HTMLElement;
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: {
      stageEl: stage,
      pipCanvas: {
        classList: {
          add: (name: string) => pipClasses.add(name),
          remove: (name: string) => pipClasses.delete(name),
        },
        style: {
          setProperty: (name: string, value: string) => pipProperties.set(name, value),
          removeProperty: (name: string) => pipProperties.delete(name),
        },
        offsetWidth: 0,
      } as unknown as HTMLCanvasElement,
    },
    renderers: { main: {} as never, pip: {} as never },
    animLock: { push: () => {} },
    effects: {
      flash: (line: string) => flashes.push(line),
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

  bus.emit(EVENT.ENTITY_DAMAGED, {
    target: body,
    damage: 0,
    damageResolution: {
      incomingDamage: 2,
      armorAbsorbed: 1,
      shieldAbsorbed: 1,
      hpDamage: 0,
    },
  });
  assert.equal(classes.has('kp-shake'), true);
  assert.equal(classes.has('kp-mitigation-flash'), true);
  assert.equal(properties.get('--kp-impact-flash-color'), '#c8b6ff8c');
  assert.equal(pipClasses.has('pip-hit'), true);
  assert.equal(pipProperties.get('--kp-pip-impact-color'), '#c8b6ff8c');
  assert.equal(pipPaints, 1);
  assert.match(flashes[0] ?? '', /^BODY BLOCKED/);

  bus.emit(EVENT.ENTITY_DAMAGED, {
    target: body,
    damage: 0,
    damageResolution: {
      incomingDamage: 1,
      armorAbsorbed: 1,
      shieldAbsorbed: 0,
      hpDamage: 0,
    },
  });
  assert.equal(properties.get('--kp-impact-flash-color'), '#d49a3a8c');
  assert.equal(pipProperties.get('--kp-pip-impact-color'), '#d49a3a8c');
});

test('P3.5.M5: Nanite Repair pulses the shared stage flash', () => {
  const bus = new EventBus();
  const scene: ShellScene = {
    bus,
    world: null,
    player: null,
    state: 'combat',
  } as unknown as ShellScene;

  const classes = new Set<string>();
  const properties = new Map<string, string>();
  const stage = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    offsetWidth: 0,
  } as unknown as HTMLElement;

  let pushedDuration = 0;
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: { stageEl: stage, pipCanvas: {} as HTMLCanvasElement },
    renderers: {
      main: { draw: () => {} } as never,
      pip: { draw: () => {} } as never,
    },
    animLock: {
      push: (ms: number) => {
        pushedDuration = ms;
      },
    },
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
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  bus.emit(EVENT.NANITE_HEALED, { origin: { x: 2, y: 2 }, healed: 1 });

  assert.equal(classes.has('kp-mitigation-flash'), true);
  assert.equal(properties.get('--kp-impact-flash-color'), `${HEAL_FLASH_FG}8c`);
  assert.equal(pushedDuration, ANIMATION_DURATIONS.HEAL_FLASH);
});

test('P3.5.M5: Vault body-check pulses a gold impact burst on the occupant tile, distinct from a melee muzzle flash', () => {
  const bus = new EventBus();
  const scene: ShellScene = {
    bus,
    world: null,
    player: null,
    state: 'combat',
  } as unknown as ShellScene;

  const flashCalls: { x: number; y: number; opts: Record<string, unknown> }[] = [];
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: { stageEl: {} as HTMLElement, pipCanvas: {} as HTMLCanvasElement },
    renderers: {
      main: {
        flashCell: (x: number, y: number, opts: Record<string, unknown>) => {
          flashCalls.push({ x, y, opts });
          return true;
        },
      } as never,
      pip: {} as never,
    },
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
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  bus.emit(EVENT.ENTITY_DAMAGED, {
    target: { id: 'drone', x: 5, y: 2 },
    damage: 2,
    source: 'vault',
  });

  assert.equal(flashCalls.length, 1, 'vault slam fires exactly one cell flash');
  assert.equal(flashCalls[0].x, 5);
  assert.equal(flashCalls[0].y, 2);
  assert.equal(
    flashCalls[0].opts.char,
    '!',
    'vault gets its own impact glyph, not the bullet spark'
  );
  assert.equal(flashCalls[0].opts.color, VAULT_IMPACT_FG);
  assert.equal(flashCalls[0].opts.duration, ANIMATION_DURATIONS.VAULT_IMPACT_FLASH);
});

test('P3.5.M5: Mind Influence pulses a violet burst on the target tile in Meatspace (Adept)', () => {
  const bus = new EventBus();
  const scene: ShellScene = {
    bus,
    world: null,
    player: null,
    state: 'combat',
  } as unknown as ShellScene;

  const flashCalls: { x: number; y: number; opts: Record<string, unknown> }[] = [];
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: { stageEl: {} as HTMLElement, pipCanvas: {} as HTMLCanvasElement },
    renderers: {
      main: {
        flashCell: (x: number, y: number, opts: Record<string, unknown>) => {
          flashCalls.push({ x, y, opts });
          return true;
        },
      } as never,
      pip: {} as never,
    },
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
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  // A failed roll gets the same pulse as a success — log copy carries the outcome.
  bus.emit(EVENT.MIND_INFLUENCED, {
    actor: { id: 'adept' },
    target: { id: 'drone', x: 6, y: 3, glyph: 'd' },
    success: false,
  });

  assert.equal(flashCalls.length, 1);
  assert.equal(flashCalls[0].x, 6);
  assert.equal(flashCalls[0].y, 3);
  assert.equal(flashCalls[0].opts.char, 'd', "overpaints the target's own glyph");
  assert.equal(flashCalls[0].opts.color, MIND_INFLUENCE_FG);
  assert.equal(flashCalls[0].opts.duration, ANIMATION_DURATIONS.MIND_INFLUENCE_FLASH);
});

test('P3.5.M5: Razor Slide pulses a pale mint burst on its own landing tile, subtler than a hostile-targeted flash', () => {
  const bus = new EventBus();
  const scene: ShellScene = {
    bus,
    world: null,
    player: null,
    state: 'combat',
  } as unknown as ShellScene;

  const flashCalls: { x: number; y: number; opts: Record<string, unknown> }[] = [];
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: { stageEl: {} as HTMLElement, pipCanvas: {} as HTMLCanvasElement },
    renderers: {
      main: {
        flashCell: (x: number, y: number, opts: Record<string, unknown>) => {
          flashCalls.push({ x, y, opts });
          return true;
        },
      } as never,
      pip: {} as never,
    },
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
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  bus.emit(EVENT.RAZOR_CLOAKED, {
    actor: { id: 'razor', x: 2, y: 4, glyph: '@' },
  });

  assert.equal(flashCalls.length, 1);
  assert.equal(flashCalls[0].x, 2);
  assert.equal(flashCalls[0].y, 4);
  assert.equal(flashCalls[0].opts.char, '@', "overpaints the Razor's own glyph, not a foreign one");
  assert.equal(flashCalls[0].opts.color, CLOAK_FLASH_FG);
  assert.notEqual(
    CLOAK_FLASH_FG,
    MIND_INFLUENCE_FG,
    'self-cloak reads differently from a hostile-targeted pulse'
  );
  assert.equal(flashCalls[0].opts.duration, ANIMATION_DURATIONS.CLOAK_FLASH);
});

test('P3.5.M5: Mind Influence pulses on the cyber grid for the CyberAvatar Override', () => {
  const bus = new EventBus();
  const cyberBus = new EventBus();
  const scene = {
    bus,
    world: { entities: new Map() },
    player: { id: 'body', x: 3, y: 4, hp: 4, maxHp: 8, alive: true },
    archetype: 'decker',
    cyberspace: {
      phase: 'active',
      layer: { avatar: { id: 'avatar' }, bus: cyberBus, mapSeenKeys: () => [] },
    },
    activeLayer: 'cyber',
    state: 'combat',
  } as unknown as ShellScene;

  const flashCalls: { x: number; y: number; opts: Record<string, unknown> }[] = [];
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: { stageEl: {} as HTMLElement, pipCanvas: {} as HTMLCanvasElement },
    renderers: {
      // Viewing cyber ⇒ the cyber grid is on the main canvas.
      main: {
        flashCell: (x: number, y: number, opts: Record<string, unknown>) => {
          flashCalls.push({ x, y, opts });
          return true;
        },
      } as never,
      pip: {} as never,
    },
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
    memoriseMeatCorpse: () => {},
    memoriseCyberCorpse: () => {},
  });
  controller.rewire();

  cyberBus.emit(EVENT.MIND_INFLUENCED, {
    actor: { id: 'avatar' },
    target: { id: 'probe-ice-0', x: 4, y: 3, glyph: 'i' },
    success: true,
  });

  assert.equal(flashCalls.length, 1);
  assert.equal(flashCalls[0].x, 4);
  assert.equal(flashCalls[0].y, 3);
  assert.equal(flashCalls[0].opts.char, 'i');
  assert.equal(flashCalls[0].opts.color, MIND_INFLUENCE_FG);
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
  const fakeStyle = { setProperty: () => {}, removeProperty: () => {} };
  const controller = new SceneListenerController({
    getScene: () => scene,
    getCampaign: () => null,
    getMeatVision: () => new VisionField(),
    getCyberVision: () => new VisionField(),
    resetCyberVision: () => new VisionField(),
    dom: {
      stageEl: {
        classList: fakeClassList,
        style: fakeStyle,
        offsetWidth: 0,
      } as unknown as HTMLElement,
      pipCanvas: {
        classList: fakeClassList,
        style: fakeStyle,
        offsetWidth: 0,
      } as unknown as HTMLCanvasElement,
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
