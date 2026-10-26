import { test, expect } from '@playwright/test';
import data from '../src/data.json' with { type: 'json' };
import { initialState, subjectMetrics } from '../src/model.js';
import { initializeMemory, review } from '../src/memory.js';
import { legacyInitializeMemory } from './legacy-fixtures.js';
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
const waitSaved = page => expect(page.locator('#save-status')).toHaveText('已保存到本机');

test('v12 migration updates only never-reviewed curves from their original dates across all three subjects', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T04:00:00Z') });
  const legacy = { ...initialState(data), version: 12 };
  const neverReviewed = legacyInitializeMemory(90, '2026-10-24');
  const reviewed = review(legacyInitializeMemory(100, '2026-10-24'), 95, '2026-10-25');
  legacy.memory['math:F5'] = neverReviewed;
  legacy.memory['math:G5'] = reviewed;
  legacy.memory['cs:F5'] = legacyInitializeMemory(80, '2026-10-24');
  legacy.memory['cs:G5'] = structuredClone(reviewed);
  legacy.english.articles = [
    { id: 'initial', title: 'Initial reading', memory: legacyInitializeMemory(80, '2026-10-25') },
    { id: 'reviewed', title: 'Reviewed reading', memory: structuredClone(reviewed) },
    { id: 'unlearned', title: 'Not yet learned', memory: null },
  ];
  legacy.wrongQuestions['math:F5'] = 'P028：003';
  legacy.wrongQuestionFormats['math:F5'] = [{ text: 'P028：' }, { text: '003', bold: true, color: '#c00000' }];
  legacy.annual['math:4']['2025'] = 6.789;
  legacy.weights.cs['2025'] = .175;
  const expected = structuredClone(legacy); expected.version = 13;
  expected.memory['math:F5'].retentionPerDay = .6;
  expected.memory['cs:F5'].retentionPerDay = .6;
  expected.english.articles[0].memory.retentionPerDay = .6;
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), legacy);
  await page.reload(); await waitSaved(page);
  expect(await saved(page)).toEqual(expected);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-initial-sixty-v12')))).toEqual(legacy);
  await expect(page.locator('[data-edit="F5"]')).toHaveValue('32.40');
  await expect(page.locator('[data-cell="F5"]')).toHaveCSS('background-color', 'rgb(255, 224, 178)');
  const math = data.subjects.find(subject => subject.id === 'math');
  const score = subjectMetrics(math, expected, '2026-10-26').earned;
  expect(score).toBeGreaterThan(subjectMetrics(math, legacy, '2026-10-26').earned);
  await expect(page.locator('[data-cell="B1"]')).toHaveText(score.toFixed(2));
  await page.locator('#show-retention').click();
  await expect(page.locator('[data-cell="F5"] .mastery-readout')).toHaveText('32.40（60.00%）');
  await page.locator('#sheet-select').selectOption('408-分数面板');
  await expect(page.locator('[data-cell="F5"] .mastery-readout')).toHaveText('28.80（60.00%）');
  await page.locator('#sheet-select').selectOption('英语');
  await expect(page.locator('[data-cell="C3"] .mastery-readout')).toHaveText('48（60.00%）');
  await expect(page.locator('[data-edit="C5"]')).toHaveValue('-');
  await page.reload();
  expect(await saved(page)).toEqual(expected);
  await page.clock.setSystemTime(new Date('2026-10-27T04:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-edit="F5"]')).toHaveValue('19.44');
  await expect(page.locator('[data-cell="F5"]')).toHaveCSS('background-color', 'rgb(255, 217, 223)');
  expect(await saved(page)).toEqual(expected);
});

for (const [sheet, address, id] of [['数学-分数面板', 'F5', 'math:F5'], ['408-分数面板', 'F5', 'cs:F5'], ['英语', 'C3', null]]) {
  test(`${sheet}: initial-day increases retain 60%, midnight decays to 54%, and first review starts from that curve`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-26T15:50:00Z') });
    await page.goto('http://127.0.0.1:1420');
    await page.locator('#sheet-select').selectOption(sheet);
    if (!id) {
      await page.locator('#add-article').click(); await page.locator('#article-title').fill('Learning at 60%');
      await page.locator('#article-form button[type=submit]').click();
    }
    const editor = page.locator(`[data-edit="${address}"]`);
    const memory = state => id ? state.memory[id] : state.english.articles[0].memory;
    const edit = async value => { await editor.fill(String(value)); await editor.press('Tab'); await waitSaved(page); };
    await edit(80); await edit(90);
    const initial = initializeMemory(90, '2026-10-26');
    expect(initial.retentionPerDay).toBe(.6);
    expect(memory(await saved(page))).toEqual(initial);
    await page.locator('#show-retention').click();
    await expect(page.locator(`[data-cell="${address}"] .mastery-readout`)).toHaveText(`${id ? '90.00' : '90'}（60.00%）`);
    const before = await saved(page);
    await editor.focus();
    await page.clock.setSystemTime(new Date('2026-10-26T16:10:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('[data-cell="A1"]').click();
    await expect(editor).toHaveValue(id ? '54.00' : '54');
    expect(await saved(page)).toEqual(before);
    await editor.fill('53.99'); await editor.press('Tab');
    await expect(page.locator('#input-error')).toContainText('只能提高');
    expect(await saved(page)).toEqual(before);
    await edit(60); await edit(70);
    const after = await saved(page), actual = memory(after), direct = review(initial, 70, '2026-10-27');
    expect(actual.retentionPerDay).toBeCloseTo(direct.retentionPerDay, 13);
    direct.retentionPerDay = actual.retentionPerDay;
    expect(actual).toEqual(direct);
    expect(actual.reviewOrigin.retentionPerDay).toBe(.6);
    expect(actual.recentPreInterventionMasteries[0]).toBe(.54);
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
    expect(await saved(page)).toEqual(after);
  });
}
