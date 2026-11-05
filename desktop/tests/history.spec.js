import { test, expect } from '@playwright/test';
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
async function globalKey(page, key) {
  await page.locator('[data-cell="A1"]').click();
  await page.keyboard.press(`Control+${key}`);
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
}

test('mastery and manual retention undo restores whole curves; typing has priority; redo clears on new action', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-05T04:00:00Z') });
  await page.goto('http://127.0.0.1:1420');
  const node = page.locator('[data-node="math:F5"]');
  await node.fill('50'); await node.press('Tab');
  const learned = await saved(page);
  await node.click(); await page.locator('#retention-input').fill('80'); await page.locator('#retention-input').press('Enter');
  const manual = await saved(page);
  await globalKey(page, 'z'); expect((await saved(page)).memory).toEqual(learned.memory);
  await globalKey(page, 'y'); expect((await saved(page)).memory).toEqual(manual.memory);
  await node.click(); await node.press('Control+a'); await node.pressSequentially('90');
  await node.press('Control+z');
  expect((await saved(page)).memory).toEqual(manual.memory);
  await node.press('Control+y'); await expect(node).toHaveValue('90');
  await node.press('Tab');
  await globalKey(page, 'z'); expect((await saved(page)).memory).toEqual(manual.memory);
  await globalKey(page, 'z'); expect((await saved(page)).memory).toEqual(learned.memory);
  await node.fill('75'); await node.press('Tab'); const replacement = await saved(page);
  await globalKey(page, 'y'); expect(await saved(page)).toEqual(replacement);
  await globalKey(page, 'z');
  await page.reload(); expect((await saved(page)).memory).toEqual(learned.memory);
  await globalKey(page, 'z'); expect((await saved(page)).memory).toEqual(learned.memory);
});

test('wrong index supports ten actions and native text undo; batch fill and rich formatting restore together', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420'); await page.locator('#wrong-index').click();
  const editor = page.locator('[data-wrong="math:F5"]');
  for (let i = 1; i <= 12; i++) { await editor.fill(String(i)); await editor.press('Tab'); }
  for (let i = 11; i >= 2; i--) { await globalKey(page, 'z'); expect((await saved(page)).wrongQuestions['math:F5']).toBe(String(i)); }
  await globalKey(page, 'z'); expect((await saved(page)).wrongQuestions['math:F5']).toBe('2');
  for (let i = 3; i <= 12; i++) { await globalKey(page, 'y'); expect((await saved(page)).wrongQuestions['math:F5']).toBe(String(i)); }
  await editor.click(); await editor.press('Control+a'); await editor.pressSequentially('P28');
  await editor.press('Control+z'); expect((await saved(page)).wrongQuestions['math:F5']).toBe('12');
  await editor.press('Control+y'); await expect(editor).toHaveText('P28');
  await editor.press('Control+a'); await editor.press('Control+b'); await editor.press('Tab');
  const formatted = await saved(page);
  await editor.click();
  const handle = await page.locator('[data-cell="F5"] .fill-handle').boundingBox();
  const target = await page.locator('[data-cell="H5"]').boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 4); await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 10, { steps: 10 }); await page.mouse.up();
  const filled = await saved(page);
  expect(filled.wrongQuestions['math:H5']).toBe('P28');
  await globalKey(page, 'z'); expect((await saved(page)).wrongQuestions).toEqual(formatted.wrongQuestions);
  expect((await saved(page)).wrongQuestionFormats).toEqual(formatted.wrongQuestionFormats);
  await globalKey(page, 'y'); expect((await saved(page)).wrongQuestionFormats).toEqual(filled.wrongQuestionFormats);
});

test('English mastery undo preserves subsequently added articles and changed titles', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420'); await page.locator('#sheet-select').selectOption('英语');
  for (const title of ['First', 'Second']) {
    await page.locator('#add-article').click(); await page.locator('#article-title').fill(title);
    await page.locator('#article-form button[type=submit]').click();
    if (title === 'First') { await page.locator('[data-edit="C3"]').fill('80'); await page.locator('[data-edit="C3"]').press('Tab'); }
  }
  await page.locator('[data-edit="A3"]').fill('Renamed'); await page.locator('[data-edit="A3"]').press('Tab');
  await globalKey(page, 'z');
  const result = await saved(page);
  expect(result.english.articles).toHaveLength(2);
  expect(result.english.articles[0].title).toBe('Renamed');
  expect(result.english.articles[0].memory).toBeNull();
  await globalKey(page, 'y'); expect((await saved(page)).english.articles[0].memory.baseMastery).toBe(.8);
});
