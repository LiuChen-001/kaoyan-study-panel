import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, migrateState, validateState, nodesOf, subjectMetrics } from '../src/model.js';
import { initializeMemory } from '../src/memory.js';
import { sheetLayout, sheetValues, displayValue } from '../src/workbook.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));

test('v7 migration adds 492 empty text records while preserving all learning data', () => {
  const { wrongQuestions, ...old } = initialState(data);
  old.version = 7;
  old.memory['math:F5'] = initializeMemory(80, '2026-10-13');
  old.english.articles.push({ id: 'reading', title: 'Reading', memory: initializeMemory(60, '2026-10-13') });
  const before = structuredClone(old);
  const next = migrateState(data, old);
  assert.equal(next.version, 11);
  assert.equal(Object.keys(next.wrongQuestions).length, 492);
  assert.ok(Object.values(next.wrongQuestions).every(value => value === ''));
  const { wrongQuestions: added, version, ...preserved } = next;
  const { version: oldVersion, ...oldFields } = old;
  assert.deepEqual(preserved, oldFields);
  assert.deepEqual(old, before);
  assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(next))), next);
});

for (const subject of data.subjects) {
  test(`${subject.id}: expanded rows preserve node identity, calculations and display references`, () => {
    const state = initialState(data);
    const first = nodesOf(subject)[0];
    state.memory[first.id] = initializeMemory(80, '2026-10-13');
    state.wrongQuestions[first.id] = '习题集 P028：003、7；第二册 12-4';
    const before = structuredClone(state);
    const name = subject.prefix + '-分数面板';
    const standard = sheetLayout(data, name, state);
    const expanded = sheetLayout(data, name, state, true);
    const values = sheetValues(data, name, state, '2026-10-13', true);
    assert.deepEqual(expanded.columns, standard.columns);
    assert.ok(expanded.merges.includes('A4:A6'));
    assert.equal(values.E5.value, '错题题号');
    assert.equal(values.F5.value, state.wrongQuestions[first.id]);
    assert.equal(values.F5.binding.id, first.id);
    assert.equal(values.F6.binding.id, first.id);
    assert.equal(values.D6.formula, 'B6/C6');
    assert.equal(Object.values(values).filter(c => c.binding?.type === 'wrong-question').length, nodesOf(subject).length);
    assert.equal(Object.values(values).filter(c => c.binding?.type === 'mastery').length, nodesOf(subject).length);
    assert.deepEqual(subjectMetrics(subject, state, '2026-10-13'), subjectMetrics(subject, before, '2026-10-13'));
    if (subject.id === 'cs') {
      assert.ok(values.B6.formula.includes("'408-小节得分-2017'!B3*$B$85"));
      assert.equal(displayValue(name, 'B85', values.B85), '9.00%');
      assert.equal(displayValue(name, 'B94', values.B94), '100.00%');
    }
    assert.deepEqual(state, before);
    assert.equal(sheetValues(data, name, state, '2026-10-13').F5.binding.type, 'mastery');
  });
}

test('wrong question text preserves precision-like strings and rejects missing or nontext records', () => {
  const state = initialState(data);
  state.wrongQuestions['math:F5'] = '0003；P12-4；1.2300；<题号>'; 
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(validateState(data, reloaded).wrongQuestions['math:F5'], state.wrongQuestions['math:F5']);
  delete reloaded.wrongQuestions['cs:F5'];
  assert.throws(() => validateState(data, reloaded), /错题题号/);
  reloaded.wrongQuestions['cs:F5'] = 3;
  assert.throws(() => validateState(data, reloaded), /错题题号/);
});
