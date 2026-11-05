import { test, expect } from '@playwright/test';
import data from '../src/data.json' with { type: 'json' };
import { initialState } from '../src/model.js';
import { initializeMemory, updatedRetention } from '../src/memory.js';

for (const [sheet, prefix] of [['数学-分数面板', 'math'], ['408-分数面板', 'cs'], ['英语', 'article']]) {
  test(`${sheet}: selected mastery allows persisted manual retention and subsequent review`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-05T04:00:00Z') });
    const state = { ...initialState(data), version: 14 };
    const memory = initializeMemory(50, '2026-11-05');
    if (prefix === 'article') state.english.articles = [{ id: 'article-test', title: 'Test article', memory }];
    else state.memory[`${prefix}:F5`] = memory;
    await page.goto('http://127.0.0.1:1420');
    await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), state);
    await page.reload();
    await page.locator('#sheet-select').selectOption(sheet);
    const cell = prefix === 'article' ? 'C3' : 'F5';
    await page.locator(`[data-edit="${cell}"]`).click();
    const rate = page.locator('#retention-input');
    await expect(rate).toHaveValue('55.00000000000001');
    await rate.fill('80'); await rate.press('Enter');
    await expect(page.locator('#input-error')).toBeEmpty();
    await expect(page.locator('#curve-days')).toHaveText('τ = 3 天');
    await expect(page.locator(`[data-edit="${cell}"]`)).toHaveValue(prefix === 'article' ? '51' : '51.20');
    await page.screenshot({ path: `test-results/manual-retention-${prefix}.png` });
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
    await page.locator(`[data-edit="${cell}"]`).click();
    await expect(rate).toHaveValue('80');
    await rate.fill('100'); await rate.press('Enter');
    await expect(page.locator('#input-error')).toContainText('小于100%');
    await page.locator('#formula').fill('100'); await page.locator('#formula').press('Enter');
    await expect(page.locator('#input-error')).toBeEmpty();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
    const result = prefix === 'article' ? saved.english.articles[0].memory : saved.memory[`${prefix}:F5`];
    expect(result.retentionPerDay).toBe(updatedRetention(.8, 1, 3, Math.pow(.8, 3)));
    expect(result.manualCurveDate).toBeUndefined();
  });
}
