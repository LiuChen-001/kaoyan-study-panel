import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, validateState, sectionsOf, nodesOf, sectionMetrics, subjectMetrics } from '../src/model.js';
import { initializeMemory, today } from '../src/memory.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('all workbook sheets, sections, nodes and exam rows are preserved', () => {
  assert.equal(data.sheetNames.length, 38);
  assert.deepEqual(data.subjects.map(s => [s.blocks.length, sectionsOf(s).length, nodesOf(s).length, Object.values(s.exams).reduce((n, e) => n + e.rows.length, 0)]), [[3, 22, 226, 183], [4, 24, 266, 553]]);
});

for (const subject of data.subjects) {
  test(`${subject.id}: annual data and question allocations reconcile`, () => {
    for (const [year, exam] of Object.entries(subject.exams)) {
      close(exam.rows.reduce((sum, row) => sum + row.score, 0), 150);
      const allocation = {};
      for (const row of exam.rows) {
        const names = row.sections.split('；');
        assert.ok(names.length >= 1 && names.length <= 2);
        for (const name of names) allocation[name] = (allocation[name] ?? 0) + row.score / names.length;
      }
      for (const section of sectionsOf(subject)) close(allocation[section.name] ?? 0, section.annual[year]);
      close(sectionsOf(subject).reduce((sum, section) => sum + section.annual[year], 0), 150);
    }
  });
  test(`${subject.id}: zero, one node at 50/100, all nodes at 100`, () => {
    const state = initialState(data);
    nodesOf(subject).forEach(n => state.memory[n.id] = null);
    close(subjectMetrics(subject, state).earned, 0);
    const section = sectionsOf(subject)[0];
    const unit = sectionMetrics(subject, section, state).unit;
    state.memory[section.nodes[0].id] = initializeMemory(50, today());
    close(subjectMetrics(subject, state).earned, unit / 2);
    subjectMetrics(subject, state).blocks.slice(1).forEach(b => close(b.earned, 0));
    state.memory[section.nodes[0].id] = initializeMemory(100, today());
    close(subjectMetrics(subject, state).earned, unit);
    nodesOf(subject).forEach(n => state.memory[n.id] = initializeMemory(100, today()));
    close(subjectMetrics(subject, state).earned, 150);
  });
  test(`${subject.id}: every fully mastered section equals its full-precision section score`, () => {
    const state = initialState(data);
    for (const section of sectionsOf(subject)) {
      section.nodes.forEach(node => state.memory[node.id] = initializeMemory(100, today()));
      const result = sectionMetrics(subject, section, state);
      close(result.earned, result.score);
    }
  });
  test(`${subject.id}: no intermediate rounding; annual edits propagate only to their section`, () => {
    const state = initialState(data);
    const [first, second] = sectionsOf(subject);
    const year = Object.keys(subject.weights)[0];
    const before = sectionMetrics(subject, first, state);
    const unaffected = sectionMetrics(subject, second, state);
    state.annual[first.id][year] += 0.12345;
    const after = sectionMetrics(subject, first, state);
    close(after.score - before.score, 0.12345 * subject.weights[year]);
    close(after.unit, after.score / first.nodes.length);
    assert.deepEqual(sectionMetrics(subject, second, state), unaffected);
    if (subject.id === 'math') assert.notEqual(before.unit, first.cachedUnit);
    else close(before.unit, first.cachedUnit);
  });
}

test('408 weights normalize and invalid persisted values are rejected', () => {
  const state = initialState(data);
  const subject = data.subjects[1];
  const first = sectionsOf(subject)[0];
  const before = sectionMetrics(subject, first, state);
  Object.keys(state.weights.cs).forEach(y => state.weights.cs[y] *= 2);
  close(sectionMetrics(subject, first, state).score, before.score);
  validateState(data, state);
  for (const invalid of [-1, 101, NaN, null, '80']) {
    const bad = structuredClone(state); bad.memory[first.nodes[0].id] = { ...initializeMemory(80), baseMastery: invalid };
    assert.throws(() => validateState(data, bad));
  }
  Object.keys(state.weights.cs).forEach(y => state.weights.cs[y] = 0);
  assert.throws(() => validateState(data, state));
});

test('blank reserved years remain null and do not enter the weighted average', () => {
  const state = initialState(data);
  const s = data.subjects[0]; const section = sectionsOf(s)[0];
  assert.equal(section.annual['2016'], null);
  const before = sectionMetrics(s, section, state);
  state.annual[section.id]['2016'] = 1000;
  assert.deepEqual(sectionMetrics(s, section, state), before);
  assert.deepEqual(validateState(data, JSON.parse(JSON.stringify(state))), state);
});
