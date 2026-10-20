import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeMemory, review, validateMemory, predictMastery, daysBetween } from '../src/memory.js';
const legacy = memory => { const { reviewOrigin, ...curve } = memory; return curve; };

test('same-day replacements equal one direct intervention, including initial learning and reload', () => {
  const first = initializeMemory(70, '2026-10-01');
  const initial = review(review(first, 80, '2026-10-01'), 90, '2026-10-01');
  assert.deepEqual(initial, initializeMemory(90, '2026-10-01'));
  const morning = review(initial, 60, '2026-10-02');
  const noon = review(JSON.parse(JSON.stringify(morning)), 75, '2026-10-02');
  const evening = review(noon, 95, '2026-10-02');
  assert.deepEqual(evening, review(initial, 95, '2026-10-02'));
  assert.deepEqual(evening.recentPreInterventionMasteries, [.45, 0, 0, 0, 0]);
  assert.equal(evening.reviewOrigin.lastInterventionDate, '2026-10-01');
  assert.equal(evening.reviewOrigin.reviewOrigin, undefined);
  assert.throws(() => review(evening, 94, '2026-10-02'), /只能提高/);
  assert.throws(() => review(evening, 99, '2026-10-01'), /系统日期/);
  assert.equal(predictMastery(evening, '2026-10-03'), .95 * evening.retentionPerDay);
});

test('many daily edits keep five distinct-day samples and a constant-size origin', () => {
  let direct = initializeMemory(80, '2026-10-01');
  let edited = structuredClone(direct);
  for (let day = 2; day <= 9; day++) {
    const date = `2026-10-0${day}`;
    const prior = structuredClone(edited);
    const pre = predictMastery(edited, date) * 100;
    edited = review(review(review(edited, pre + (100 - pre) / 3, date), pre + 2 * (100 - pre) / 3, date), 100, date);
    direct = review(direct, 100, date);
    assert.deepEqual(edited, direct);
    assert.equal(daysBetween(edited.reviewOrigin.lastInterventionDate, date), 1);
    assert.deepEqual(edited.reviewOrigin, legacy(prior));
    assert.equal(JSON.stringify(edited).split('reviewOrigin').length, 2);
    validateMemory(edited, true);
  }
});

test('invalid day origins cannot encode zero-length interventions or nested snapshots', () => {
  const memory = review(initializeMemory(80, '2026-10-01'), 90, '2026-10-02');
  assert.throws(() => validateMemory({ ...memory, reviewOrigin: { ...memory.reviewOrigin, lastInterventionDate: '2026-10-02' } }, true), /至少相隔一天/);
  assert.throws(() => validateMemory({ ...memory, reviewOrigin: { ...memory.reviewOrigin, reviewOrigin: null } }, true), /嵌套/);
  assert.throws(() => validateMemory(legacy(memory), true), /缺少/);

});
