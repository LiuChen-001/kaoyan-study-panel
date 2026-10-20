import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, migrateState, validateState } from '../src/model.js';
import { initializeMemory, review } from '../src/memory.js';
import { setWrongText, wrongTextHTML } from '../src/wrong-text.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));

test('v11 rich-text upgrade preserves every curve and old text without recalculating memory', () => {
  const { wrongQuestionFormats, ...old } = initialState(data); old.version = 11;
  old.memory['math:F5'] = review(initializeMemory(100, '2026-10-01'), 100, '2026-10-09');
  old.wrongQuestions['math:F5'] = '资料 P028：003、7、12';
  const next = migrateState(data, old);
  assert.deepEqual(next, { ...old, version: 12, wrongQuestionFormats: {} });
  assert.deepEqual(migrateState(data, structuredClone(next)), next);
});

test('formatted references serialize and copy independently, clearing or replacing text removes old formats', () => {
  const state = initialState(data);
  const runs = [{ text: '资料 ' }, { text: '003', bold: true, color: '#c00000' }];
  setWrongText(state, 'math:F5', '资料 003', runs);
  setWrongText(state, 'math:G5', state.wrongQuestions['math:F5'], state.wrongQuestionFormats['math:F5']);
  state.wrongQuestionFormats['math:G5'][1].color = '#0070c0';
  assert.equal(state.wrongQuestionFormats['math:F5'][1].color, '#c00000');
  validateState(data, JSON.parse(JSON.stringify(state)));
  setWrongText(state, 'math:G5', '');
  assert.equal(state.wrongQuestionFormats['math:G5'], undefined);
  setWrongText(state, 'math:F5', '新资料');
  assert.equal(state.wrongQuestionFormats['math:F5'], undefined);
});

test('rich text renders literal content and rejects mismatched text, invalid colors and missing format storage', () => {
  assert.ok(wrongTextHTML('<img src=x onerror=alert(1)>').includes('&lt;img'));
  for (const runs of [[{ text: 'other' }], [{ text: 'x', color: 'red;background:url(x)' }], [{ text: 'x', bold: 'yes' }], [{ text: '' }]]) {
    const state = initialState(data); state.wrongQuestions['math:F5'] = 'x'; state.wrongQuestionFormats['math:F5'] = runs;
    assert.throws(() => validateState(data, state), /错题文字格式/);
  }
  const state = initialState(data); delete state.wrongQuestionFormats;
  assert.throws(() => validateState(data, state), /错题文字格式/);
});
