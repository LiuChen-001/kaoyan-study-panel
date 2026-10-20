import { legacyInitial, legacyReview } from './legacy-fixtures.js';
import { test, expect } from '@playwright/test';
import { initializeMemory, review } from '../src/memory.js';

const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
for (const [sheet, address, id] of [['数学-分数面板', 'F5', 'math:F5'], ['408-分数面板', 'F5', 'cs:F5'], ['英语', 'C3', null]]) {
  test(`${sheet}: same-day replacement survives reload`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-08T04:00:00Z') });
    await page.goto('http://127.0.0.1:1420');
    await page.locator('#sheet-select').selectOption(sheet);
    if (!id) {
      await page.locator('#add-article').click();
      await page.locator('#article-title').fill('Daily review');
      await page.locator('#article-form button[type=submit]').click();
    }
    const memory = value => id ? value.memory[id] : value.english.articles[0].memory;
    const input = () => page.locator(`[data-edit="${address}"]`);
    const edit = async value => {
      await input().fill(String(value)); await input().press('Tab');
      await expect(page.locator('#save-status')).toHaveText('已保存到本机');
    };
    await edit(60); await edit(80);
    const initial = initializeMemory(80, '2026-10-08');
    expect(memory(await state(page))).toEqual(initial);
    await page.clock.setSystemTime(new Date('2026-10-09T04:00:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await edit(60);
    await edit(70);
    await page.reload();
    await page.locator('#sheet-select').selectOption(sheet);
    await edit(80);
    expect(memory(await state(page))).toEqual(review(initial, 80, '2026-10-09'));
    await edit(90);
    expect(memory(await state(page))).toEqual(review(initial, 90, '2026-10-09'));
    expect(memory(await state(page)).recentPreInterventionMasteries).toEqual([.4, 0, 0, 0, 0]);
  });
}

test('v4 migration backs up existing records and preserves daily origin across reopening', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-09T04:00:00Z') });
  await page.goto('http://127.0.0.1:1420');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const legacy = { ...await state(page), version: 4 };
  const initial = initializeMemory(80, '2026-10-08');
  const curve = legacyReview(legacyInitial(80, '2026-10-08'), 60, '2026-10-09');
  legacy.memory['math:F5'] = curve;
  await page.evaluate(value => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(value)), legacy);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v4')))).toEqual(legacy);
  expect((await state(page)).version).toBe(12);
  await page.locator('[data-edit="F5"]').fill('90');
  await page.locator('[data-edit="F5"]').press('Tab');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  expect((await state(page)).memory['math:F5']).toEqual(review(initial, 90, '2026-10-09'));
  const saved = await state(page);
  await page.reload();
  expect(await state(page)).toEqual(saved);
});
