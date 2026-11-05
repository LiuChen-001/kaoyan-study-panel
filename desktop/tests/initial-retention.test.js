import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, migrateState, subjectMetrics } from '../src/model.js';
import { initializeMemory, predictMastery, review, updatedRetention } from '../src/memory.js';
import { legacyInitializeMemory } from './legacy-fixtures.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-13, `${actual} != ${expected}`);

test('new learning starts at .55, same-day replacement retains .55 and first review uses the unchanged formula', () => {
  const first = initializeMemory(80, '2026-10-20');
  assert.equal(first.retentionPerDay, .55);
  close(predictMastery(first, '2026-10-21'), .44);
  close(predictMastery(first, '2026-10-22'), .242);
  assert.deepEqual(review(first, 90, '2026-10-20'), initializeMemory(90, '2026-10-20'));
  assert.throws(() => review(first, 44, '2026-10-21'), /只能提高/);
  const next = review(first, 90, '2026-10-21');
  close(next.retentionPerDay, updatedRetention(.55, .9, 1, .8 * .55));
  close(next.recentPreInterventionMasteries[0], .8 * .55);
  assert.equal(next.reviewOrigin.retentionPerDay, .55);
  // The review model's forgetting-to-zero baseline is still .5, not the new initial .55.
  assert.equal(updatedRetention(.8, 1, 10000, 0), .5);
});

test('v12 changes only initial-only rates across both subjects and English, preserving all reviewed history', () => {
  const old = { ...initialState(data), version: 12 };
  const pending = legacyInitializeMemory(80, '2026-10-20');
  pending.recentPreInterventionMasteries = [.1, 0, 0, 0, 0]; // Old initial-day samples are not cross-day reviews.
  const reviewed = review(legacyInitializeMemory(90, '2026-10-20'), 95, '2026-10-22');
  const forgotten = review(legacyInitializeMemory(100, '1900-01-01'), 100, '2026-10-25');
  assert.equal(forgotten.retentionPerDay, .5);
  assert.deepEqual(forgotten.recentPreInterventionMasteries, [0, 0, 0, 0, 0]);
  old.memory['math:F5'] = pending;
  old.memory['math:G5'] = reviewed;
  old.memory['cs:F5'] = structuredClone(pending);
  old.memory['cs:G5'] = forgotten;
  old.english.articles = [{ id: 'pending', title: 'Pending', memory: structuredClone(pending) }, { id: 'reviewed', title: 'Reviewed', memory: structuredClone(reviewed) }, { id: 'unlearned', title: 'Unlearned', memory: null }];
  old.wrongQuestions['math:F5'] = '题号003';
  old.wrongQuestionFormats['math:F5'] = [{ text: '题号' }, { text: '003', bold: true, color: '#c00000' }];
  const before = structuredClone(old);
  const next = migrateState(data, old);
  const expected = structuredClone(old); expected.version = 15;
  for (const id of ['math:F5', 'cs:F5']) expected.memory[id].retentionPerDay = .55;
  expected.english.articles[0].memory.retentionPerDay = .55;
  assert.deepEqual(next, expected);
  assert.deepEqual(old, before);
  close(predictMastery(next.memory['math:F5'], '2026-10-26'), .8 * .55 ** 6);
  assert.deepEqual(next.memory['math:G5'], reviewed);
  assert.equal(next.memory['math:G5'].reviewOrigin.retentionPerDay, .5);
  assert.deepEqual(review(next.memory['math:G5'], 100, '2026-10-22'), review(reviewed, 100, '2026-10-22'));
  const math = data.subjects.find(subject => subject.id === 'math');
  assert.ok(subjectMetrics(math, next, '2026-10-26').earned > subjectMetrics(math, old, '2026-10-26').earned);
  assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(next))), next);
});

test('v11 also preserves reviewed curves and initializes format storage while upgrading only initial rates', () => {
  const { wrongQuestionFormats, ...old } = initialState(data); old.version = 11;
  old.memory['math:F5'] = legacyInitializeMemory(75, '2026-10-20');
  old.memory['cs:F5'] = review(legacyInitializeMemory(100, '2026-10-20'), 100, '2026-10-21');
  const next = migrateState(data, old);
  assert.deepEqual(next.memory['math:F5'], { ...old.memory['math:F5'], retentionPerDay: .55 });
  assert.deepEqual(next.memory['cs:F5'], old.memory['cs:F5']);
  assert.deepEqual(next.wrongQuestionFormats, {});
  assert.equal(next.version, 15);
});

test('v13 lowers only unreviewed 60% curves to 55%, preserving every reviewed field and same-day origin', () => {
  const old = { ...initialState(data), version: 13 };
  const pending = { ...legacyInitializeMemory(80, '2026-10-20'), retentionPerDay: .6 };
  const reviewed = review(pending, 95, '2026-10-26');
  old.memory['math:F5'] = pending;
  old.memory['math:G5'] = reviewed;
  old.memory['cs:F5'] = structuredClone(pending);
  old.english.articles = [{ id: 'initial', title: 'Initial', memory: structuredClone(pending) }, { id: 'reviewed', title: 'Reviewed', memory: structuredClone(reviewed) }];
  const before = structuredClone(old), expected = structuredClone(old);
  expected.version = 15;
  expected.memory['math:F5'].retentionPerDay = .55;
  expected.memory['cs:F5'].retentionPerDay = .55;
  expected.english.articles[0].memory.retentionPerDay = .55;
  const next = migrateState(data, old);
  assert.deepEqual(next, expected);
  assert.deepEqual(old, before);
  assert.equal(next.memory['math:G5'].reviewOrigin.retentionPerDay, .6);
  assert.deepEqual(review(next.memory['math:G5'], 100, '2026-10-26'), review(reviewed, 100, '2026-10-26'));
  const math = data.subjects.find(subject => subject.id === 'math');
  assert.ok(subjectMetrics(math, next, '2026-10-26').earned < subjectMetrics(math, old, '2026-10-26').earned);
  assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(next))), next);
});

test('new initial rate uses the shared current evaluation data without retuning review coefficients', () => {
  const dataset = JSON.parse(readFileSync(new URL('./fixtures/forgetting-evaluation.json', import.meta.url)));
  for (const scenario of dataset.schedules) {
    let memory = initializeMemory(scenario.initialMastery * 100, '2026-10-01'), day = 1;
    scenario.gaps.forEach((gap, i) => {
      day += gap;
      memory = review(memory, scenario.reviewMastery * 100, new Date(Date.UTC(2026, 9, day)).toISOString().slice(0, 10));
      close(memory.retentionPerDay, scenario.retentions[i]);
    });
  }
});
