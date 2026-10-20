import { test, expect } from '@playwright/test';
import data from '../src/data.json' with { type: 'json' };
import { initialState, nodesOf } from '../src/model.js';
import { initializeMemory } from '../src/memory.js';
const stored = page => page.evaluate(() => localStorage.getItem('kaoyan-panel-v1'));
const input = (page, id) => page.locator(`[data-node="${id}"]`);
const cell = (page, id) => input(page, id).locator('..');
const colors = { red: 'rgb(255, 217, 223)', orange: 'rgb(255, 224, 178)', unlearned: 'rgb(238, 238, 238)', normal: 'rgb(255, 255, 255)' };
async function seed(page, state, sheet) {
  await page.clock.install({ time: new Date('2026-10-20T04:00:00Z') });
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), state);
  await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
}
for (const [sheet, prefix] of [['数学-分数面板', 'math'], ['408-分数面板', 'cs']]) {
  test(`${sheet}: full-precision threshold boundaries distinguish learned zero from unlearned`, async ({ page }) => {
    const state = initialState(data);
    const nodes = nodesOf(data.subjects.find(s => s.id === prefix)).slice(0, 7);
    const values = [0, 29.999999, 30, 49.999999, 50, 50.000001, null];
    const cues = ['red', 'red', 'orange', 'orange', 'orange', 'normal', 'unlearned'];
    values.forEach((value, i) => { state.memory[nodes[i].id] = value === null ? null : initializeMemory(value || 100, value === 0 ? '2000-01-01' : '2026-10-20'); });
    await seed(page, state, sheet);
    const before = await stored(page);
    for (let i = 0; i < nodes.length; i++) {
      await expect(cell(page, nodes[i].id)).toHaveAttribute('data-review', cues[i]);
      await expect(cell(page, nodes[i].id)).toHaveCSS('background-color', colors[cues[i]]);
    }
    await expect(input(page, nodes[1].id)).toHaveValue('30.00'); // Still red: do not classify the rounded display.
    await expect(input(page, nodes[5].id)).toHaveValue('50.00'); // Still normal: actual value is above 50.
    await expect(input(page, nodes[6].id)).toHaveValue('-');
    await input(page, nodes[6].id).focus();
    await expect(input(page, nodes[6].id)).toHaveValue('0');
    await page.locator('[data-cell="A1"]').click();
    await expect(input(page, nodes[6].id)).toHaveValue('-');
    expect(await stored(page)).toBe(before); // Focus/blur cannot create a first learning record.
    await page.locator('#show-retention').click();
    await expect(cell(page, nodes[6].id).locator('.mastery-readout')).toHaveText('-');
    await expect(cell(page, nodes[0].id).locator('.mastery-readout')).toHaveText('0.00（50.00%）');
    await page.locator('#wrong-index').click();
    for (let i = 0; i < nodes.length; i++) await expect(cell(page, nodes[i].id)).toHaveCSS('background-color', colors[cues[i]]);
    expect(await stored(page)).toBe(before);
    await page.screenshot({ path: `test-results/${prefix}-review-cues.png` });
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
    await expect(input(page, nodes[6].id)).toHaveValue('-');
    expect(await stored(page)).toBe(before);
  });
}
for (const [sheet, id] of [['数学-分数面板', 'math:F5'], ['408-分数面板', 'cs:F5'], ['英语', 'article-one']]) {
  test(`${sheet}: natural-day forgetting recolors cells and review restores normal filling`, async ({ page }) => {
    const state = initialState(data), memory = initializeMemory(80, '2026-10-20');
    if (sheet === '英语') state.english.articles = [{ id, title: 'Reading', memory }, { id: 'not-started', title: 'Not started', memory: null }];
    else state.memory[id] = memory;
    await seed(page, state, sheet);
    const editor = sheet === '英语' ? page.locator('[data-edit="C3"]') : input(page, id);
    const td = editor.locator('..');
    const before = await stored(page);
    await expect(td).toHaveCSS('background-color', colors.normal);
    if (sheet === '英语') {
      await expect(page.locator('[data-edit="C4"]')).toHaveValue('-');
      await expect(page.locator('[data-cell="C4"]')).toHaveCSS('background-color', colors.unlearned);
    }
    for (const [day, color] of [[21, 'orange'], [22, 'red']]) {
      await page.clock.setSystemTime(new Date(Date.UTC(2026, 9, day, 4)));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(td).toHaveCSS('background-color', colors[color]);
      expect(await stored(page)).toBe(before);
    }
    await editor.fill('100'); await editor.press('Tab');
    await expect(page.locator('#save-status')).toHaveText('已保存到本机');
    await expect(td).toHaveCSS('background-color', colors.normal);
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
    await expect(td).toHaveCSS('background-color', colors.normal);
    if (sheet === '英语') await page.screenshot({ path: 'test-results/english-review-cues.png' });
  });
}
