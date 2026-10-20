import { test, expect } from '@playwright/test';
import { initialState } from '../src/model.js';
import { initializeMemory, review } from '../src/memory.js';
import data from '../src/data.json' with { type: 'json' };
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
const editor = (page, address = 'F5') => page.locator(`[data-edit="${address}"]`);
async function selectText(page, text, address = 'F5') {
  await editor(page, address).focus();
  await editor(page, address).evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const start = el.textContent.indexOf(text), end = start + text.length;
    const range = document.createRange(); let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode, finish = offset + node.length;
      if (start >= offset && start < finish) range.setStart(node, start - offset);
      if (end > offset && end <= finish) { range.setEnd(node, end - offset); break; }
      offset = finish;
    }
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, text);
}
for (const sheet of ['数学-分数面板', '408-分数面板']) {
  test(`${sheet}: partial bold and color persist, expand, undo and fill without touching curves`, async ({ page }) => {
    const row = sheet.startsWith('数学') ? 5 : 8;
    const source = `F${row}`;
    await page.goto('http://127.0.0.1:1420');
    await page.locator('#sheet-select').selectOption(sheet);
    await expect(page.locator('#wrong-bold')).toBeDisabled();
    await page.locator('#wrong-index').click();
    const before = await saved(page);
    const text = '高数资料 P028：003、7、12（第二册）';
    await editor(page, source).fill(text);
    await selectText(page, '003', source); await page.keyboard.press('Control+b');
    await expect(page.locator('#save-status')).toHaveText('已保存到本机');
    await expect(editor(page, source).locator('[style*="bold"], [style*="700"]')).toContainText('003');
    await page.locator('#wrong-color').evaluate(el => {
      el.focus(); el.value = '#c00000'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#save-status')).toHaveText('已保存到本机');
    const id = sheet.startsWith('数学') ? 'math:F5' : 'cs:F7';
    const formatted = (await saved(page)).wrongQuestionFormats[id];
    expect(formatted).toEqual([{ text: '高数资料 P028：' }, { text: '003', bold: true, color: '#c00000' }, { text: '、7、12（第二册）' }]);
    await selectText(page, '003', source); await page.locator('#wrong-bold').click();
    expect((await saved(page)).wrongQuestionFormats[id][1].bold).toBeUndefined();
    await page.keyboard.press('Control+b');
    expect((await saved(page)).wrongQuestionFormats[id][1].bold).toBe(true);
    const widths = await page.locator('col').evaluateAll(cols => cols.map(el => el.getBoundingClientRect().width));
    expect(await editor(page, source).evaluate(el => el.clientWidth >= el.scrollWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${id.startsWith('math') ? 'math' : 'cs'}-rich-text.png` });
    const handle = await page.locator(`[data-cell="F${row}"] .fill-handle`).boundingBox();
    const target = await page.locator(`[data-cell="H${row}"]`).boundingBox();
    await page.mouse.move(handle.x + 4, handle.y + 4); await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 }); await page.mouse.up();
    await expect(page.locator('#save-status')).toHaveText('已保存到本机');
    const after = await saved(page);
    expect(after.wrongQuestionFormats[id.replace(':F', ':G')]).toEqual(after.wrongQuestionFormats[id]);
    expect(after.wrongQuestionFormats[id.replace(':F', ':H')]).toEqual(after.wrongQuestionFormats[id]);
    for (const key of ['memory', 'english', 'annual', 'weights']) expect(after[key]).toEqual(before[key]);
    expect(await page.locator('col').evaluateAll(cols => cols.map(el => el.getBoundingClientRect().width))).toEqual(widths);
    await page.reload(); await page.locator('#sheet-select').selectOption(sheet); await page.locator('#wrong-index').click();
    expect(await saved(page)).toEqual(after);
    await expect(editor(page, source)).toHaveText(text);
    await expect(editor(page, source).locator('span[style*="#c00000"]')).toHaveText('003');
    await selectText(page, '003', source); await page.keyboard.press('Backspace'); await editor(page, source).press('Tab');
    expect((await saved(page)).wrongQuestionFormats[id]).toBeUndefined();
    await page.setViewportSize({ width: 720, height: 760 });
    await expect(page.locator('#wrong-bold')).toBeInViewport();
    await expect(page.locator('#wrong-color')).toBeInViewport();
  });
}

test('v11 upgrade preserves plain text and all existing memory without recalculation', async ({ page }) => {
  const { wrongQuestionFormats, ...legacy } = initialState(data); legacy.version = 11;
  legacy.memory['math:F5'] = review(initializeMemory(100, '2026-10-01'), 100, '2026-10-09');
  legacy.wrongQuestions['math:F5'] = '资料 P028：003';
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), legacy);
  await page.reload(); await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  expect(await saved(page)).toEqual({ ...legacy, version: 12, wrongQuestionFormats: {} });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v11')))).toEqual(legacy);
});
