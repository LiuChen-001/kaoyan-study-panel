import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { today, daysBetween, initializeMemory, predictMastery, review, validateMemory } from '../src/memory.js';
import { initialState, migrateState, subjectMetrics, validateState } from '../src/model.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('Shanghai natural dates cross midnight after 20 minutes, independent of machine zone', () => {
  assert.equal(today(new Date('2026-10-03T15:50:00Z')), '2026-10-03');
  assert.equal(today(new Date('2026-10-03T16:10:00Z')), '2026-10-04');
  assert.equal(daysBetween('2026-10-03', '2026-10-04'), 1);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
});

test('first learning has zero history; queries decay without mutation and survive serialization', () => {
  assert.equal(predictMastery(null, '2026-12-31'), 0);
  const memory = review(null, 80, '2026-10-03');
  const snapshot = JSON.stringify(memory);
  assert.equal(memory.retentionPerDay, 0.5);
  assert.deepEqual(memory.recentPreInterventionMasteries, [0, 0, 0, 0, 0]);
  close(predictMastery(memory, '2026-10-04'), 0.4);
  close(predictMastery(JSON.parse(snapshot), '2026-10-05'), 0.2);
  assert.equal(JSON.stringify(memory), snapshot);
  assert.throws(() => initializeMemory(0));
});

test('raw pre-review history advances once per day, keeps five samples and retains initial date', () => {
  let memory = initializeMemory(100, '2026-10-01');
  const pres = [];
  for (let day = 2; day <= 7; day++) {
    const date = `2026-10-0${day}`;
    const pre = predictMastery(memory, date); pres.unshift(pre);
    const oldP = memory.retentionPerDay;
    memory = review(memory, 100, date);
    const history = [...pres.slice(0, 5), ...Array(Math.max(0, 5 - pres.length)).fill(0)];
    assert.deepEqual(memory.recentPreInterventionMasteries, history);
    assert.ok(memory.retentionPerDay > oldP);
    assert.equal(memory.initialLearnedDate, '2026-10-01');
  }
});

test('initial-day edits replace initial learning; only increases above the current prediction are allowed', () => {
  const first = initializeMemory(80, '2026-10-03');
  const next = review(first, 90, '2026-10-03');
  close(next.retentionPerDay, 0.5);
  assert.deepEqual(next.recentPreInterventionMasteries, [0, 0, 0, 0, 0]);
  for (const value of [0, 79, 80, 101, NaN]) assert.throws(() => review(first, value, '2026-10-03'));
  assert.doesNotThrow(() => review(first, 60, '2026-10-04')); // less than last base, greater than today's 40
  assert.throws(() => review(initializeMemory(100, '2026-10-03'), 100, '2026-10-03'));
  assert.throws(() => review(first, 90, '2026-10-02'));
  close(predictMastery(first, '2026-10-02'), 0.8);
});

test('irregular review dates remain a five-date history without resetting cumulative retention', () => {
  let memory = initializeMemory(80, '2026-10-01');
  const dates = [];
  for (const date of ['2026-10-02', '2026-10-04', '2026-10-07', '2026-10-11', '2026-10-16', '2026-10-22', '2026-10-29']) {
    const tau = daysBetween(memory.lastInterventionDate, date);
    const oldP = memory.retentionPerDay;
    const pre = predictMastery(memory, date);
    memory = review(memory, 100, date);
    dates.push(date);
    assert.ok(tau >= 1);
    assert.ok(memory.retentionPerDay > oldP);
    assert.equal(memory.recentPreInterventionMasteries[0], pre);
    assert.deepEqual(memory.recentReviewDates, dates.slice(-5).reverse());
    validateMemory(memory, true, true);
  }
  assert.throws(() => validateMemory({ ...memory, recentReviewDates: ['2026-10-29', '2026-10-29'] }, true, true), /倒序/);
  assert.throws(() => validateMemory({ ...memory, recentReviewDates: [] }, true, true), /最近一次/);
});

test('long gaps, invalid dates and unrepresentable parameters never silently become p=1', () => {
  const memory = initializeMemory(80, '2000-01-01');
  assert.equal(predictMastery(memory, '2026-10-03'), 0);
  const after = review(memory, 80, '2026-10-03');
  assert.ok(after.retentionPerDay > 0 && after.retentionPerDay < 1);
  assert.throws(() => initializeMemory(80, '2026-02-30'));
  assert.throws(() => validateMemory({ ...memory, retentionPerDay: 1 }));
  assert.equal(review({ ...memory, baseMastery: Number.MIN_VALUE, retentionPerDay: 1 - Number.EPSILON }, 100, '2000-01-01').retentionPerDay, 0.5);
});

test('legacy migration starts every node unlearned exactly once, preserves annual data and weights', () => {
  const fresh = initialState(data);
  const { memory, ...fields } = fresh;
  const old = { ...fields, version: 1, mastery: Object.fromEntries(Object.keys(memory).map(id => [id, 80])) };
  const upgraded = migrateState(data, old);
  assert.ok(Object.values(upgraded.memory).every(value => value === null));
  assert.deepEqual(upgraded.annual, old.annual);
  assert.equal(old.mastery['math:F5'], 80);
  upgraded.memory['math:F5'] = review(null, 80, '2026-10-03');
  assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(upgraded))), upgraded);
  validateState(data, upgraded);
  const score0 = subjectMetrics(data.subjects[0], upgraded, '2026-10-03').earned;
  close(subjectMetrics(data.subjects[0], upgraded, '2026-10-04').earned, score0 / 2);
  close(subjectMetrics(data.subjects[0], upgraded, '2026-10-05').earned, score0 / 4);
});
