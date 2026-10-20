import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, migrateState } from '../src/model.js';
import { initializeMemory, predictMastery, review, updatedRetention } from '../src/memory.js';
import { windowReview, nonzeroReview, cumulativeReview, recallReview } from './legacy-fixtures.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-13, `${a} != ${b}`);
const dateAt = day => new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);

test('three reviews at 90% reach the two calibration targets', () => {
  for (const [gaps, expected] of [[[1, 1, 1], [.6831410702376615, .8147675270339196, .9]], [[1, 2, 5], [.6831410702376615, .8504704044109391, .96]]]) {
    let memory = initializeMemory(90, dateAt(0)), day = 0;
    for (let i = 0; i < gaps.length; i++) {
      day += gaps[i];
      memory = review(memory, 90, dateAt(day));
      close(memory.retentionPerDay, expected[i]);
    }
    close(predictMastery(memory, dateAt(day + 1)), .9 * expected.at(-1));
  }
});

test('earlier reviews accumulate beyond five samples even with identical final mastery and interval', () => {
  const first = initializeMemory(90, dateAt(0));
  const once = review(first, 90, dateAt(1));
  let repeated = first;
  for (let day = 1; day <= 10; day++) {
    const prior = repeated.retentionPerDay;
    repeated = review(JSON.parse(JSON.stringify(repeated)), 90, dateAt(day));
    assert.ok(repeated.retentionPerDay > prior);
    if (day > 1) assert.ok(repeated.retentionPerDay > once.retentionPerDay);
  }
  assert.equal(repeated.recentReviewDates.length, 5);
  // The same final-day update is strictly ordered by accumulated old retention.
  for (const u of [.01, .3, .6, .9, 1]) for (const tau of [1, 2, 5, 10000]) {
    const rates = [.1, .5, .7, .9, .99].map(p => updatedRetention(p, u, tau, .4));
    assert.ok(rates.every((p, i) => i === 0 || p > rates[i - 1]));
  }
});

test('achieved mastery and spacing increase retention when pre-review recall is held fixed; tiny valid improvements still count once', () => {
  for (const p of [.1, .5, .7, .95]) {
    assert.ok(updatedRetention(p, .9, 1, .4) > updatedRetention(p, .6, 1, .4));
    assert.ok(updatedRetention(p, .9, 5, .4) > updatedRetention(p, .9, 2, .4));
    assert.ok(updatedRetention(p, .9, 2, .4) > updatedRetention(p, .9, 1, .4));
  }
  const old = initializeMemory(90, dateAt(0));
  const next = review(old, 45.000001, dateAt(1));
  assert.ok(next.retentionPerDay > old.retentionPerDay);
  assert.throws(() => review(next, 45.000001, dateAt(1)), /只能提高/);
  assert.throws(() => updatedRetention(1 - Number.EPSILON / 2, 1, 10000, 1), /浮点精度/);
});

test('v6/v7/v8/v9/v10 recalculate only the latest review, preserving samples, origins, wrong questions and English', () => {
  for (const version of [6, 7, 8, 9, 10]) {
    const old = { ...initialState(data), version };
    const legacyReview = version === 10 ? recallReview : version === 6 ? windowReview : version === 9 ? cumulativeReview : nonzeroReview;
    const prior = legacyReview(initializeMemory(80, dateAt(0)), 100, dateAt(1));
    const memory = legacyReview(prior, 100, dateAt(3));
    old.memory['math:F5'] = memory;
    old.memory['cs:F5'] = structuredClone(memory);
    old.wrongQuestions['math:F5'] = '习题 P028：003';
    old.english.articles = [{ id: 'reading', title: 'Reading', memory: structuredClone(memory) }];
    const before = structuredClone(old);
    const next = migrateState(data, old);
    const after = next.memory['math:F5'];
    const pre = predictMastery(prior, dateAt(3));
    close(after.retentionPerDay, updatedRetention(prior.retentionPerDay, 1, 2, pre));
    const { retentionPerDay, ...other } = after;
    const { retentionPerDay: oldP, ...oldOther } = memory;
    assert.deepEqual(other, oldOther);
    assert.deepEqual(next.memory['cs:F5'], after);
    assert.deepEqual(next.english.articles[0].memory, after);
    assert.deepEqual(next.annual, old.annual); assert.deepEqual(next.weights, old.weights);
    assert.equal(next.wrongQuestions['math:F5'], version >= 8 ? '习题 P028：003' : '');
    assert.deepEqual(old, before);
    assert.equal(next.version, 12);
    assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(next))), next);
    const replaced = review(after, 100, dateAt(4));
    close(replaced.recentPreInterventionMasteries[0], predictMastery(after, dateAt(4)));
    assert.equal(replaced.recentPreInterventionMasteries[1], memory.recentPreInterventionMasteries[0]);
    const invalid = structuredClone(old); invalid.memory['math:F5'].reviewOrigin = null;
    assert.throws(() => migrateState(data, invalid), /缺少最近复习前/);
  }
});

test('lower remaining recall pulls retention toward .5; long gaps approach initial learning', () => {
  const rates = [0, .001, .01, .1, .5, .9, 1].map(pre => updatedRetention(.8, .95, 5, pre));
  assert.equal(rates[0], .5);
  assert.ok(rates.every((p, i) => i === 0 || p > rates[i - 1]));
  const initial = initializeMemory(90, dateAt(0));
  const hundred = review(initial, 95, dateAt(100));
  assert.ok(Math.abs(hundred.retentionPerDay - .5) < 1e-13);
  assert.equal(review(initial, 95, dateAt(10000)).retentionPerDay, .5);
  let studied = initial;
  for (let day = 1; day <= 3; day++) studied = review(studied, 90, dateAt(day));
  const forgotten = review(studied, 95, dateAt(1000));
  assert.ok(Math.abs(forgotten.retentionPerDay - .5) < 1e-13);
  assert.ok(forgotten.retentionPerDay < studied.retentionPerDay);
  for (const pre of [undefined, NaN, -1, 1.1]) assert.throws(() => updatedRetention(.5, .9, 1, pre), /复习前/);
});

test('reviewing from 100 whenever mastery first falls below 50 follows approximate requested gaps', () => {
  let memory = initializeMemory(100, dateAt(0)), day = 0;
  const gaps = [], rates = [];
  for (let n = 0; n < 6; n++) {
    const half = Math.log(.5) / Math.log(memory.retentionPerDay);
    let gap = Math.floor(half) + 1;
    while (predictMastery(memory, dateAt(day + gap)) >= .5) gap++;
    assert.ok(predictMastery(memory, dateAt(day + gap - 1)) >= .5);
    day += gap;
    memory = review(memory, 100, dateAt(day));
    gaps.push(gap); rates.push(memory.retentionPerDay);
  }
  assert.deepEqual(gaps, [2, 3, 8, 14, 32, 100]);
  for (const [i, target] of [2, 3, 8, 15, 30, 100].entries()) assert.ok(Math.abs(gaps[i] - target) <= target * .1);
  close(rates[2], .9493455748946499);
  close(rates[4], .9930894775269557);
  assert.equal(day, 159);
});
