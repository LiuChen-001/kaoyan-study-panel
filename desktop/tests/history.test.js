import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/data.json' with { type: 'json' };
import { createHistory } from '../src/history.js';
import { initialState, validateState } from '../src/model.js';
import { initializeMemory, setRetention } from '../src/memory.js';
const validate = state => validateState(data, state);

test('ten actions undo and redo exactly; no-op does not consume capacity; a new edit clears redo', () => {
  const history = createHistory();
  let state = initialState(data);
  for (let i = 1; i <= 12; i++) {
    const before = structuredClone(state);
    state.wrongQuestions['math:F5'] = String(i);
    history.record(before, state);
  }
  history.record(state, state);
  for (let i = 11; i >= 2; i--) {
    state = history.restore(state, 'undo', validate);
    assert.equal(state.wrongQuestions['math:F5'], String(i));
  }
  assert.equal(history.restore(state, 'undo', validate), null);
  for (let i = 3; i <= 12; i++) {
    state = history.restore(state, 'redo', validate);
    assert.equal(state.wrongQuestions['math:F5'], String(i));
  }
  state = history.restore(state, 'undo', validate);
  const before = structuredClone(state);
  state.wrongQuestions['math:F5'] = 'new'; history.record(before, state);
  assert.equal(history.restore(state, 'redo', validate), null);
});

test('undo restores complete curves and formatted batch edits, preserving unrelated edits and articles', () => {
  const history = createHistory();
  let state = initialState(data);
  state.memory['math:F5'] = initializeMemory(50, '2026-11-05');
  const before = structuredClone(state);
  state.memory['math:F5'] = setRetention(state.memory['math:F5'], 80, '2026-11-05');
  for (const id of ['cs:F5', 'cs:G5']) {
    state.wrongQuestions[id] = 'P10';
    state.wrongQuestionFormats[id] = [{ text: 'P10', bold: true }];
  }
  history.record(before, state);
  const expected = structuredClone(state);
  state.english.articles.push({ id: 'new', title: 'Keep this', memory: null });
  state = history.restore(state, 'undo', validate);
  assert.deepEqual(state.memory, before.memory);
  assert.deepEqual(state.wrongQuestions, before.wrongQuestions);
  assert.deepEqual(state.wrongQuestionFormats, before.wrongQuestionFormats);
  assert.equal(state.english.articles.length, 1);
  state = history.restore(state, 'redo', validate);
  assert.deepEqual(state.memory, expected.memory);
  assert.deepEqual(state.wrongQuestionFormats, expected.wrongQuestionFormats);
});

test('English memory restores without reverting title; failed restore leaves stacks unchanged', () => {
  const history = createHistory(); let state = initialState(data);
  state.english.articles.push({ id: 'a', title: 'Original', memory: null });
  const before = structuredClone(state);
  state.english.articles[0].memory = initializeMemory(88, '2026-11-05');
  history.record(before, state);
  state.english.articles[0].title = 'Renamed';
  assert.throws(() => history.restore(state, 'undo', () => { throw new Error('failure'); }));
  state = history.restore(state, 'undo', validate);
  assert.deepEqual(state.english.articles[0], { id: 'a', title: 'Renamed', memory: null });
});
