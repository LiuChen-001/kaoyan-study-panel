import { test, expect } from '@playwright/test';
import data from '../src/data.json' with { type: 'json' };
import { initialState } from '../src/model.js';
import { initializeMemory, predictMastery } from '../src/memory.js';
const stored = page => page.evaluate(() => localStorage.getItem('kaoyan-panel-v1'));
const readout = (page, address) => page.locator(`[data-cell="${address}"] .mastery-readout`);

for (const [sheet, prefix] of [['数学-分数面板', 'math'], ['408-分数面板', 'cs']]) {
  test(`${sheet}: two-color rate view fits cells, preserves precision and works with wrong-index rows`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-19T04:00:00Z') });
    const state = initialState(data);
    // Saved-curve fixtures exercise the user's exact display example and the widest string.
    const memory = { ...initializeMemory(40.55123456789, '2026-10-19'), retentionPerDay: .601123456789 };
    state.memory[`${prefix}:F5`] = memory;
    state.memory[`${prefix}:G5`] = { ...initializeMemory(100, '2026-10-19'), retentionPerDay: 1 - Number.EPSILON };
    await page.goto('http://127.0.0.1:1420');
    await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), state);
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
    const before = await stored(page);
    const width = await page.locator('[data-cell="F5"]').evaluate(el => el.clientWidth);
    await expect(page.locator('#show-retention')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.mastery-readout')).toHaveCount(0);
    await page.locator('#show-retention').click();
    await expect(readout(page, 'F5')).toHaveText('40.55（60.11%）');
    await expect(readout(page, 'F5').locator('.mastery-value')).toHaveCSS('color', 'rgb(0, 0, 0)');
    await expect(readout(page, 'F5').locator('.retention-rate')).toHaveCSS('color', 'rgb(192, 0, 0)');
    await expect(readout(page, 'G5')).toHaveText('100.00（100.00%）');
    for (const address of ['F5', 'G5']) {
      const box = await readout(page, address).boundingBox();
      const td = await page.locator(`[data-cell="${address}"]`).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(td.x + 3);
      expect(box.x + box.width).toBeLessThanOrEqual(td.x + td.width - 3);
    }
    await expect(readout(page, 'F7')).toHaveText('0.00（—）');
    await page.locator('[data-edit="F5"]').focus();
    await expect(page.locator('[data-edit="F5"]')).toHaveValue(String(memory.baseMastery * 100));
    await expect(readout(page, 'F5')).not.toBeVisible();
    await page.locator('[data-cell="A1"]').click();
    await expect(readout(page, 'F5')).toBeVisible();
    expect(await stored(page)).toBe(before);
    await page.locator('#wrong-index').click();
    await expect(readout(page, 'F6')).toHaveText('40.55（60.11%）');
    expect(await page.locator('[data-cell="F6"]').evaluate(el => el.clientWidth)).toBe(width);
    await expect(page.locator('[data-cell="F5"] .mastery-readout')).toHaveCount(0);
    await page.clock.setSystemTime(new Date('2026-10-20T04:00:00Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(readout(page, 'F6')).toHaveText(`${(predictMastery(memory, '2026-10-20') * 100).toFixed(2)}（60.11%）`);
    expect(await stored(page)).toBe(before);
    await page.screenshot({ path: `test-results/${prefix}-retention.png` });
    await page.locator('#show-retention').click();
    await expect(page.locator('.mastery-readout')).toHaveCount(0);
    expect(await stored(page)).toBe(before);
    await page.reload();
    await expect(page.locator('#show-retention')).toHaveAttribute('aria-pressed', 'false');
    expect(await stored(page)).toBe(before);
  });
}

test('English rate view preserves integer mastery and updates after review; removed controls stay absent', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T04:00:00Z') });
  await page.goto('http://127.0.0.1:1420');
  await page.locator('#sheet-select').selectOption('英语');
  await page.locator('#add-article').click(); await page.locator('#article-title').fill('Rate test');
  await page.locator('#article-form button[type=submit]').click();
  await page.locator('[data-edit="C3"]').fill('88.999999');
  await page.locator('[data-edit="C3"]').press('Tab');
  await page.locator('#show-retention').click();
  await expect(readout(page, 'C3')).toHaveText('88（50.00%）');
  await page.clock.setSystemTime(new Date('2026-10-20T04:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-edit="C3"]').fill('75.123456789');
  await page.locator('[data-edit="C3"]').press('Tab');
  await page.locator('[data-cell="A1"]').click();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const state = JSON.parse(await stored(page));
  await expect(readout(page, 'C3')).toHaveText(`75（${(state.english.articles[0].memory.retentionPerDay * 100).toFixed(2)}%）`);
  expect(state.english.articles[0].memory.baseMastery).toBe(75.123456789 / 100);
  for (const sheet of await page.locator('#sheet-select option').allTextContents()) {
    await page.locator('#sheet-select').selectOption(sheet);
    await expect(page.locator('#export, #import, #retry, #restore-dialog')).toHaveCount(0);
    if (!sheet.endsWith('分数面板') && sheet !== '英语') await expect(page.locator('#show-retention')).toHaveCount(0);
  }
  await page.locator('#sheet-select').selectOption('英语');
  await page.screenshot({ path: 'test-results/english-retention.png' });
});
