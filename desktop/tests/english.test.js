import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, migrateState, validateState } from '../src/model.js';
import { addArticle, englishMetrics, validateEnglish } from '../src/english.js';
import { review } from '../src/memory.js';
import { sheetNames, sheetValues, displayValue } from '../src/workbook.js';
const data = JSON.parse(readFileSync(new URL('../src/data.json', import.meta.url)));

test('articles start unlearned; totals use unrounded curves; integer displays truncate', () => {
  const state = initialState(data);
  state.english = addArticle(state.english, '  how to study  ', 'article-1');
  assert.equal(state.english.articles[0].title, 'how to study');
  assert.equal(state.english.articles[0].memory, null);
  assert.deepEqual(englishMetrics(state.english, '2026-10-08'), { articles: 0, words: 0 });
  state.english.articles[0].memory = review(null, 88.999999, '2026-10-08');
  const values = sheetValues(data, '英语', state, '2026-10-08');
  assert.equal(displayValue('英语', 'B1', values.B1), '0.89');
  assert.equal(displayValue('英语', 'C3', values.C3), '88');
  assert.equal(displayValue('英语', 'D1', values.D1), '355');
  assert.ok(Math.abs(values.D1.value - 355.999996) < 1e-12);
  assert.notEqual(values.D1.value, Number(displayValue('英语', 'B1', values.B1)) * 400);
  assert.equal(displayValue('英语', 'C3', { value: 99.9999 }), '99');
  assert.equal(displayValue('数学-分数面板', 'F5', { value: 88.999999 }), '89.00');
  const later = sheetValues(data, '英语', state, '2026-10-09');
  assert.equal(displayValue('英语', 'C3', later.C3), '44');
  assert.equal(displayValue('英语', 'D1', later.D1), '177');
  state.english = addArticle(state.english, 'second', 'article-2');
  state.english.articles[1].memory = review(null, 12.34567, '2026-10-08');
  assert.equal(englishMetrics(state.english, '2026-10-08').articles, 88.999999 / 100 + 12.34567 / 100);
  validateState(data, state);
});

test('v3 migration adds only empty English state and is idempotent', () => {
  const { english, ...old } = initialState(data); old.version = 3;
  old.memory['math:F5'] = review(null, 73.4567, '2026-10-03');
  old.annual['math:4']['2025'] = 9.87654321;
  const snapshot = structuredClone(old);
  const next = migrateState(data, old);
  assert.equal(next.version, 11);
  assert.deepEqual(next.english, { articles: [] });
  assert.deepEqual(next.memory, old.memory);
  assert.deepEqual(next.annual, old.annual);
  assert.deepEqual(next.weights, old.weights);
  assert.deepEqual(old, snapshot);
  next.english = addArticle(next.english, 'new reading', 'unique-id');
  next.english.articles[0].memory = review(null, 80, '2026-10-08');
  assert.deepEqual(migrateState(data, JSON.parse(JSON.stringify(next))), next);
  const names = sheetNames(data);
  assert.equal(names.length, 39);
  assert.equal(names[names.indexOf('408-分数面板') + 1], '英语');
  assert.deepEqual(names.filter(name => name !== '英语'), data.sheetNames);
});

test('decimal integer boundaries truncate without binary multiplication noise or epsilon rounding', () => {
  const state = initialState(data);
  state.english = addArticle(state.english, 'boundary', 'id');
  for (const percent of [29, 57, 58, 28.99999999999999, 57.9999999999999, 1e-20]) {
    state.english.articles[0].memory = review(null, percent, '2026-10-08');
    const values = sheetValues(data, '英语', state, '2026-10-08');
    assert.equal(displayValue('英语', 'C3', values.C3), String(Math.trunc(percent)));
    if (Number.isInteger(percent)) assert.equal(values.D1.value, percent * 4);
  }
  state.english.articles[0].memory = review(null, 29, '2026-10-08');
  state.english = addArticle(state.english, 'second', 'other-id');
  state.english.articles[1].memory = review(null, 57, '2026-10-08');
  assert.deepEqual(englishMetrics(state.english, '2026-10-08'), { articles: .86, words: 344 });
});

test('English backup validation rejects invalid entries rather than losing records', () => {
  const state = initialState(data);
  assert.throws(() => addArticle(state.english, '  '), /名称/);
  const english = addArticle(state.english, 'one', 'same-id');
  assert.throws(() => addArticle(english, 'two', 'same-id'), /标识/);
  assert.throws(() => validateEnglish({ articles: [{ id: 'x', title: 'bad' }] }));
  assert.throws(() => validateState(data, { ...state, english: undefined }));
  assert.throws(() => validateEnglish({ articles: [{ ...english.articles[0], memory: { invalid: true } }] }));
  assert.equal(english.articles.length, 1);
});
