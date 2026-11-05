import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeMemory, setRetention, predictMastery, review, updatedRetention, validateMemory } from '../src/memory.js';
import { initialState, migrateState } from '../src/model.js';
import data from '../src/data.json' with { type: 'json' };

test('manual retention rebases full mastery, floors days, persists and drives next reviews', () => {
  const old = initializeMemory(50, '2026-11-05');
  const next = setRetention(old, 80, '2026-11-05');
  assert.equal(next.manualCurveDate, '2026-11-02');
  assert.equal(next.baseMastery, 1);
  assert.ok(Math.abs(predictMastery(next, '2026-11-05') - .512) < 1e-14);
  assert.equal(next.initialLearnedDate, old.initialLearnedDate);
  validateMemory(next, true, true);
  const restored = JSON.parse(JSON.stringify(next));
  assert.ok(Math.abs(predictMastery(restored, '2026-11-06') - .4096) < 1e-14);
  const first = review(restored, 90, '2026-11-05');
  validateMemory(first, true, true);
  assert.equal(first.retentionPerDay, updatedRetention(.8, .9, 3, Math.pow(.8, 3)));
  const overwrite = review(first, 100, '2026-11-05');
  assert.deepEqual(overwrite, review(restored, 100, '2026-11-05'));
  validateMemory(review(overwrite, 100, '2026-11-06'), true, true);
});

test('manual retention preserves history, supports zero days, rejects invalid and unlearned inputs', () => {
  const old = review(initializeMemory(100, '2026-11-01'), 80, '2026-11-03');
  const next = setRetention(old, 60, '2026-11-03');
  assert.equal(next.manualCurveDate, '2026-11-03');
  assert.equal(predictMastery(next, '2026-11-03'), 1);
  assert.deepEqual(next.recentReviewDates, old.recentReviewDates);
  assert.deepEqual(next.recentPreInterventionMasteries, old.recentPreInterventionMasteries);
  const correctedToday = setRetention(old, 95, '2026-11-03');
  const replacedToday = review(correctedToday, 100, '2026-11-03');
  assert.deepEqual(replacedToday.recentPreInterventionMasteries.slice(1), old.recentPreInterventionMasteries.slice(1));
  assert.deepEqual(replacedToday.recentReviewDates, old.recentReviewDates);
  assert.throws(() => review(next, 100, '2026-11-03'));
  validateMemory(review(next, 100, '2026-11-04'), true, true);
  for (const p of [0, 100, -1, NaN, Infinity]) assert.throws(() => setRetention(old, p, '2026-11-03'));
  assert.throws(() => setRetention(null, 80, '2026-11-03'));
  assert.throws(() => setRetention(old, 80, '9999-01-01'));
});

test('version14 upgrade changes only version and preserves curves on repeated loads', () => {
  const old = { ...initialState(data), version: 14 };
  old.memory['math:F5'] = initializeMemory(77.123456789, '2026-11-01');
  const next = migrateState(data, old);
  assert.deepEqual(next, { ...old, version: 15 });
  next.memory['math:F5'] = setRetention(next.memory['math:F5'], 88, '2026-11-05');
  assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(next))), next);
});
