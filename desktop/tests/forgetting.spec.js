import { test, expect } from '@playwright/test';
import data from '../src/data.json' with { type: 'json' };
const input = page => page.locator('[data-edit="F5"]');
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));

test('Shanghai midnight refresh, strict increases, idle editor, offline reload with full curve persistence', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-03T15:50:00Z') });
  await page.goto('http://127.0.0.1:1420');
  await input(page).fill('80'); await input(page).press('Tab');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const first = await state(page);
  expect(first.memory['math:F5'].initialLearnedDate).toBe('2026-10-03');
  expect(first.memory['math:F5'].recentPreInterventionMasteries).toEqual([0, 0, 0, 0, 0]);
  await input(page).fill('79'); await input(page).press('Tab');
  await expect(page.locator('#input-error')).toContainText('只能提高');
  expect(await state(page)).toEqual(first);
  await input(page).focus(); // An unchanged editor spanning midnight must not become a review.
  await page.clock.setSystemTime(new Date('2026-10-03T16:10:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-cell="A1"]').click();
  await expect(input(page)).toHaveValue('40.00');
  expect(await state(page)).toEqual(first);
  await expect(page.locator('[data-cell="B1"]')).toHaveText('0.22');
  await input(page).fill('39'); await input(page).press('Tab');
  await expect(page.locator('#input-error')).toContainText('只能提高');
  await input(page).focus();
  await page.locator('#formula').fill('60'); await page.locator('#formula').press('Enter');
  await page.locator('[data-cell="A1"]').click();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const reviewed = await state(page);
  expect(reviewed.memory['math:F5'].recentPreInterventionMasteries).toEqual([0.4, 0, 0, 0, 0]);
  expect(reviewed.memory['math:F5'].initialLearnedDate).toBe('2026-10-03');
  const expected = 60 * reviewed.memory['math:F5'].retentionPerDay;
  await page.clock.setSystemTime(new Date('2026-10-04T16:10:00Z'));
  await page.reload();
  await expect(input(page)).toHaveValue(expected.toFixed(2));
  expect(await state(page)).toEqual(reviewed);

});

test('v1 migration resets only legacy mastery once, backs it up, and never invents learning dates', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const current = await state(page);
  const legacy = { version: 1, mastery: Object.fromEntries(Object.keys(current.memory).map(id => [id, 80])), annual: current.annual, weights: current.weights };
  legacy.annual['math:4']['2025'] = 9.87654321;
  await page.evaluate(old => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(old)), legacy);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  expect(Object.values((await state(page)).memory).every(value => value === null)).toBe(true);
  expect((await state(page)).annual['math:4']['2025']).toBe(9.87654321);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v1')))).toEqual(legacy);
  await input(page).fill('80'); await input(page).press('Tab');
  const learned = await state(page);
  await page.reload(); expect(await state(page)).toEqual(learned);
  // Source hash remains compatible for existing backups.
  expect(data.sha256).toHaveLength(64);
});

test('v2 upgrade recalculates the current curve once and preserves a recoverable backup', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-07T04:00:00Z') });
  await page.goto('http://127.0.0.1:1420');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const previous = { ...await state(page), version: 2 };
  previous.memory['math:F5'] = { initialLearnedDate: '2026-10-05', lastInterventionDate: '2026-10-06', baseMastery: 1, retentionPerDay: 0.6035533905932737, recentPreInterventionMasteries: [0.5, 0, 0, 0, 0] };
  await page.evaluate(old => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(old)), previous);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  await expect(input(page)).toHaveValue('70.20');
  const migrated = await state(page);
  expect(migrated.version).toBe(12);
  expect(migrated.memory['math:F5'].retentionPerDay).toBeCloseTo(0.7020287504089231, 14);
  expect(migrated.memory['math:F5'].lastInterventionDate).toBe('2026-10-06');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v2')))).toEqual(previous);
  await page.reload(); expect(await state(page)).toEqual(migrated);
  await page.clock.setSystemTime(new Date('2026-10-08T04:00:00Z'));
  await page.reload();
  await expect(input(page)).toHaveValue((100 * 0.7020287504089231 ** 2).toFixed(2));
  expect(await state(page)).toEqual(migrated);
  const ambiguous = structuredClone(previous);
  ambiguous.memory['math:F5'].recentPreInterventionMasteries[1] = .4;
  await page.evaluate(old => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(old)), ambiguous);
  await page.reload();
  await expect(page.locator('.error-banner')).toContainText('缺少完整复习');
  expect(await state(page)).toEqual(ambiguous);
});
