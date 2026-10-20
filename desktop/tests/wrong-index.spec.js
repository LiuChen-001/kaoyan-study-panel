import { test, expect } from '@playwright/test';
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
const input = (page, address) => page.locator(`[data-edit="${address}"]`);
async function edit(page, address, value) {
  await input(page, address).fill(value); await input(page, address).press('Tab');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
}
async function drag(page, source, target) {
  const sourceCell = await page.locator(`[data-cell="${source}"]`).boundingBox();
  await page.mouse.click(sourceCell.x + 8, sourceCell.y + sourceCell.height / 2);
  const handle = await page.locator(`[data-cell="${source}"] .fill-handle`).boundingBox();
  const end = await page.locator(`[data-cell="${target}"]`).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
  await page.mouse.up();
}
for (const [sheet, row, nextRow, nodeId] of [['数学-分数面板', 5, 8, 'math:F5'], ['408-分数面板', 8, 11, 'cs:F7']]) {
  test(`${sheet}: wrong references edit, fill horizontally, persist, and never change learning records`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') });
    await page.goto('http://127.0.0.1:1420');
    await page.locator('#sheet-select').selectOption(sheet);
    await expect(page.locator('#wrong-index')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-wrong]')).toHaveCount(0);
    const widths = await page.locator('col').evaluateAll(cols => cols.map(c => c.getBoundingClientRect().width));
    await page.locator('#wrong-index').click();
    await expect(page.locator('#wrong-index')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`[data-cell="E${row}"]`)).toHaveText('错题题号');
    expect(await page.locator('col').evaluateAll(cols => cols.map(c => c.getBoundingClientRect().width))).toEqual(widths);
    await expect(page.locator('[data-cell="A4"]')).toHaveAttribute('rowspan', '3');
    await page.locator(`[data-node="${nodeId}"]`).fill('73.123456789');
    await page.locator(`[data-node="${nodeId}"]`).press('Tab');
    const learning = await saved(page);
    const text = '习题集 P028：003、7、12（第二册） <题号> "A"';
    await edit(page, `F${row}`, text);
    const source = page.locator(`[data-cell="F${row}"]`);
    const sourceBox = await source.boundingBox();
    await input(page, `F${row}`).click();
    expect((await input(page, `F${row}`).boundingBox()).width).toBeGreaterThan(sourceBox.width);
    expect(await input(page, `F${row}`).evaluate(el => el.clientWidth >= el.scrollWidth)).toBe(true);
    expect(await source.boundingBox()).toEqual(sourceBox);
    await page.screenshot({path: `test-results/${sheet.startsWith('数学') ? 'math' : 'cs'}-wrong-full.png`});
    // A click in the spilled text still selects the actual cell underneath it.
    const neighbor = await page.locator(`[data-cell="G${row}"]`).boundingBox();
    await page.mouse.click(neighbor.x + neighbor.width / 2, neighbor.y + neighbor.height / 2);
    await expect(page.locator(`[data-cell="G${row}"]`)).toHaveClass(/selected/);
    expect((await input(page, `F${row}`).boundingBox()).width).toBeLessThanOrEqual(sourceBox.width);
    await input(page, `F${row}`).click(); await input(page, `F${row}`).press('Escape');
    await expect(source).not.toHaveClass(/selected/);

    await drag(page, `F${row}`, `H${row}`);
    await expect(input(page, `G${row}`)).toHaveText(text);
    await expect(input(page, `H${row}`)).toHaveText(text);
    const filled = await saved(page);
    expect(filled.memory).toEqual(learning.memory);
    expect(filled.annual).toEqual(learning.annual);
    expect(filled.weights).toEqual(learning.weights);
    expect(filled.english).toEqual(learning.english);
    await drag(page, `F${row}`, `F${nextRow}`); // Vertical drag must not fill.
    expect(await saved(page)).toEqual(filled);
    await expect(input(page, `F${nextRow}`)).toHaveText('');
    // A blank source clears only the horizontally selected wrong-reference cells.
    await edit(page, `I${row}`, 'keep');
    await edit(page, `G${row}`, '');
    await drag(page, `G${row}`, `H${row}`);
    await expect(input(page, `H${row}`)).toHaveText('');
    await expect(input(page, `I${row}`)).toHaveText('keep');
    await input(page, `G${row}`).focus();
    await page.locator('#formula').fill('资料B P030：0008、9');
    await page.locator('#formula').press('Enter');
    const current = await saved(page);
    await page.locator('#wrong-index').click();
    await expect(page.locator('[data-wrong]')).toHaveCount(0);
    expect(await saved(page)).toEqual(current);
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet);
    await page.locator('#wrong-index').click();
    await expect(input(page, `F${row}`)).toHaveText(text);
    await expect(input(page, `G${row}`)).toHaveText('资料B P030：0008、9');
    expect(await saved(page)).toEqual(current);
    await page.screenshot({ path: `test-results/${sheet.startsWith('数学') ? 'math' : 'cs'}-wrong-index.png` });
    await page.setViewportSize({ width: 720, height: 760 });
    await expect(page.locator('#wrong-index')).toBeInViewport();
    expect(await page.locator('#grid').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${sheet.startsWith('数学') ? 'math' : 'cs'}-wrong-index-narrow.png` });
    await page.locator('#sheet-select').selectOption('英语');
    await expect(page.locator('#wrong-index')).toHaveCount(0);
    await page.locator('#sheet-select').selectOption('数学-小节得分-2025');
    await expect(page.locator('#wrong-index')).toHaveCount(0);
  });
}

test('v7 storage migration creates an independent backup and leaves curves untouched', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await edit(page, 'F5', '80');
  const { wrongQuestions, ...legacy } = await saved(page); legacy.version = 7;
  await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), legacy);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const next = await saved(page);
  expect(next.version).toBe(12);
  expect(next.memory).toEqual(legacy.memory);
  expect(Object.values(next.wrongQuestions).every(text => text === '')).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v7')))).toEqual(legacy);
  await page.reload(); expect(await saved(page)).toEqual(next);
});
