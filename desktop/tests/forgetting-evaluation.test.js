import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INITIAL_RETENTION, initializeMemory, predictMastery, review } from '../src/memory.js';
const dataset = JSON.parse(readFileSync(new URL('./fixtures/forgetting-evaluation.json', import.meta.url)));
const dateAt = day => new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-13, `${actual} != ${expected}`);

test('current evaluation baseline starts at 60% and predicts no-review mastery without changing the curve', () => {
  assert.equal(dataset.initialRetention, .6);
  assert.equal(INITIAL_RETENTION, dataset.initialRetention);
  assert.equal(dataset.masteryUnit, 'fraction');
  const { initialMastery, days, masteries } = dataset.predictions;
  const memory = initializeMemory(initialMastery * 100, dateAt(0));
  const before = structuredClone(memory);
  days.forEach((day, i) => close(predictMastery(memory, dateAt(day)), masteries[i]));
  assert.deepEqual(memory, before);
});

for (const scenario of dataset.schedules) {
  test(`initial 60% evaluation: ${scenario.id}`, () => {
    let memory = initializeMemory(scenario.initialMastery * 100, dateAt(0)), day = 0;
    assert.equal(memory.retentionPerDay, dataset.initialRetention);
    assert.equal(scenario.gaps.length, scenario.retentions.length);
    assert.equal(scenario.gaps.length, scenario.preMasteries.length);
    scenario.gaps.forEach((gap, i) => {
      assert.ok(Number.isInteger(gap) && gap >= 1);
      day += gap;
      close(predictMastery(memory, dateAt(day)), scenario.preMasteries[i]);
      memory = review(memory, scenario.reviewMastery * 100, dateAt(day));
      close(memory.retentionPerDay, scenario.retentions[i]);
      close(memory.baseMastery, scenario.reviewMastery);
    });
  });
}

test('initial 60% evaluation: ten reviews trigger on the first natural day strictly below 50%', () => {
  const scenario = dataset.threshold;
  let memory = initializeMemory(scenario.initialMastery * 100, dateAt(0)), day = 0;
  for (const [index, expected] of scenario.reviews.entries()) {
    assert.equal(expected.review, index + 1);
    assert.ok(predictMastery(memory, dateAt(day + expected.gap - 1)) >= scenario.below);
    const pre = predictMastery(memory, dateAt(day + expected.gap));
    assert.ok(pre < scenario.below);
    close(pre, expected.preMastery);
    day += expected.gap;
    assert.equal(day, expected.day);
    memory = review(memory, scenario.reviewMastery * 100, dateAt(day));
    close(memory.retentionPerDay, expected.retention);
    assert.ok(predictMastery(memory, dateAt(day + expected.nextGap - 1)) >= scenario.below);
    assert.ok(predictMastery(memory, dateAt(day + expected.nextGap)) < scenario.below);
  }
});

test('initial 60% evaluation: a first review after 100 days still approaches the unchanged 50% formula baseline', () => {
  const expected = dataset.longGap;
  const memory = initializeMemory(expected.initialMastery * 100, dateAt(0));
  const pre = predictMastery(memory, dateAt(expected.gap));
  assert.ok(pre > 0);
  assert.ok(Math.abs(pre / expected.preMastery - 1) < 1e-12);
  const next = review(memory, expected.reviewMastery * 100, dateAt(expected.gap));
  close(next.retentionPerDay, expected.retention);
});
