import { test, expect } from '@playwright/test';
const cell = (page, address) => page.locator(`[data-cell="${address}"]`);
const input = (page, address) => page.locator(`[data-edit="${address}"]`);

test('408 matches math density and selected node text overlays without resizing cells', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  const geometry = () => page.locator('.worksheet').evaluate(table => ({
    widths: [...table.querySelectorAll('col')].slice(0, 10).map(el => el.getBoundingClientRect().width),
    rows: [...table.querySelectorAll('tbody tr')].slice(0, 7).map(el => el.getBoundingClientRect().height),
  }));
  const math = await geometry();
  expect(math.widths.slice(1, 8)).toEqual([164, 93, 93, 93, 119, 119, 93]);
  expect(math.rows).toEqual([40, 40, 30, 30, 30, 30, 30]);
  for (const name of ['数学-分数面板', '408-分数面板']) {
    await page.locator('#sheet-select').selectOption(name);
    expect(await geometry()).toEqual(math);
    const address = name.startsWith('数学') ? 'G4' : 'G6';
    const target = cell(page, address);
    const before = await target.boundingBox();
    const text = target.locator('.cell-content');
    expect(await text.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await target.click();
    await expect(target).toHaveClass(/selected/);
    expect((await text.boundingBox()).width).toBeGreaterThan(before.width);
    expect(await target.boundingBox()).toEqual(before);
    await expect(text).toHaveCSS('white-space', 'nowrap');
    await expect(text).toHaveCSS('pointer-events', 'none');
    await page.screenshot({ path: `test-results/${name.startsWith('数学') ? 'math' : 'cs'}-node-expanded.png` });
    // The overlaid text must not swallow clicks on the next cell.
    await cell(page, address.replace('G', 'H')).click();
    await expect(target).not.toHaveClass(/selected/);
    expect((await text.boundingBox()).width).toBeLessThanOrEqual(before.width);
    await target.click(); await target.press('Escape');
    await expect(target).not.toHaveClass(/selected/);
  }
  await expect(page.locator('.worksheet .wrap')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/cs-compact.png' });
});

test('original row pairs and merges, full-precision editing, persistence and all 39 sheets', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:1420');
  await expect(page.locator('[data-sheet]')).toHaveCount(39);
  await expect(cell(page, 'A4')).toHaveAttribute('rowspan', '2');
  await expect(cell(page, 'B1')).toHaveAttribute('colspan', '4');
  await expect(cell(page, 'F4')).toHaveText('函数的概念及表示法');
  await input(page, 'F5').fill('73.123456789'); await input(page, 'F5').press('Tab');
  await expect(input(page, 'F5')).toHaveValue('73.12');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  await input(page, 'F5').focus();
  await expect(input(page, 'F5')).toHaveValue('73.123456789');
  await input(page, 'F5').press('Tab');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
  expect(saved.memory['math:F5'].baseMastery).toBe(73.123456789 / 100);
  await page.reload();
  await input(page, 'F5').focus();
  await expect(input(page, 'F5')).toHaveValue('73.123456789');
  await input(page, 'F5').fill('101'); await input(page, 'F5').press('Tab');
  await expect(page.locator('#input-error')).toContainText('0～100');
  await expect(input(page, 'F5')).toHaveValue('73.12');
  await page.locator('#sheet-select').selectOption('数学-小节得分-2025');
  await input(page, 'B3').fill('7.5123456789'); await input(page, 'B3').press('Tab');
  await input(page, 'B3').focus(); await input(page, 'B3').press('Tab');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')).annual['math:4']['2025'])).toBe(7.5123456789);
  await page.locator('#sheet-select').selectOption('数学-分数面板');
  await cell(page, 'D5').click();
  await expect(page.locator('#formula')).toHaveValue('=B5/C5');
  await page.locator('#sheet-select').selectOption('408-分数面板');
  await input(page, 'B61').fill('9.123456789'); await input(page, 'B61').press('Tab');
  await input(page, 'B61').focus(); await input(page, 'B61').press('Tab');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')).weights.cs['2017'])).toBe(9.123456789 / 100);
  for (const name of await page.locator('#sheet-select option').allTextContents()) {
    await page.locator('#sheet-select').selectOption(name);
    await expect(page.locator('.worksheet')).toHaveAttribute('aria-label', name);
  }
  expect(errors).toEqual([]);
});

test('formula bar, horizontal scrolling, screenshots and corrupt-save protection', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await input(page, 'F5').focus();
  await page.locator('#formula').fill('50.123456789'); await page.locator('#formula').press('Enter');
  expect(Number(await input(page, 'F5').inputValue())).toBeCloseTo(50.123456789, 12);
  await cell(page, 'A1').click();
  await expect(input(page, 'F5')).toHaveValue('50.12');
  await page.screenshot({ path: 'test-results/workbook-math.png' });
  await page.locator('#sheet-select').selectOption('408-分数面板');
  await page.screenshot({ path: 'test-results/workbook-cs.png' });
  const before = await cell(page, 'A4').boundingBox();
  await page.locator('#grid').evaluate(el => el.scrollLeft = 1000);
  const after = await cell(page, 'A4').boundingBox(); expect(after.x).toBeCloseTo(before.x);
  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => localStorage.setItem('kaoyan-panel-v1', '{broken'));
  await page.reload();
  await expect(page.locator('.error-banner')).toBeVisible();
  await expect(page.locator('[data-edit]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kaoyan-panel-v1'))).toBe('{broken');
});
