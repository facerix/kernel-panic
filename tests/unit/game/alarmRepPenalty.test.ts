import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALARM_KIND, alarmPayloadTriggersRepPenalty } from '../../../src/game/events.js';

test('alarmPayloadTriggersRepPenalty: facility and legacy payloads penalize', () => {
  assert.equal(alarmPayloadTriggersRepPenalty({ kind: ALARM_KIND.FACILITY }), true);
  assert.equal(alarmPayloadTriggersRepPenalty({}), true);
  assert.equal(alarmPayloadTriggersRepPenalty(undefined), true);
});

test('alarmPayloadTriggersRepPenalty: lookout pings do not penalize', () => {
  assert.equal(
    alarmPayloadTriggersRepPenalty({ kind: ALARM_KIND.LOOKOUT, target: 'player' }),
    false
  );
});

test('alarmPayloadTriggersRepPenalty: CorpCivilian facility raise penalizes', () => {
  assert.equal(
    alarmPayloadTriggersRepPenalty({
      kind: ALARM_KIND.FACILITY,
      repPenalty: true,
    }),
    true
  );
});

test('alarmPayloadTriggersRepPenalty: repPenalty false skips penalty', () => {
  assert.equal(
    alarmPayloadTriggersRepPenalty({
      kind: ALARM_KIND.FACILITY,
      repPenalty: false,
    }),
    false
  );
});
