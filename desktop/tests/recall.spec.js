import { test, expect } from '@playwright/test';
import { initialState, migrateState } from '../src/model.js';
import { initializeMemory } from '../src/memory.js';
import { cumulativeReview, recallReview } from './legacy-fixtures.js';
import data from '../src/data.json' with { type: 'json' };
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-v1')));
const edit = async (page, value) => {
  await page.locator('[data-node="math:F5"]').fill(String(value));
  await page.locator('[data-node="math:F5"]').press('Tab');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
};

test('v9 upgrade corrects a 100-day review immediately, preserving history and backup across restart', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T04:00:00Z') });
  const legacy = { ...initialState(data), version: 9 };
  const old = cumulativeReview(initializeMemory(90, '2026-07-12'), 95, '2026-10-20');
  legacy.memory['math:F5'] = old;
  legacy.memory['cs:F5'] = structuredClone(old);
  legacy.english.articles = [{ id: 'reading', title: 'Reading', memory: structuredClone(old) }];
  legacy.wrongQuestions['math:F5'] = '资料 P028：003';
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), legacy);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const next = await state(page);
  expect(next.version).toBe(12);
  expect(next.memory['math:F5'].retentionPerDay).toBeCloseTo(.5, 13);
  expect(next.memory['math:F5'].recentPreInterventionMasteries).toEqual(old.recentPreInterventionMasteries);
  expect(next.memory['math:F5'].reviewOrigin).toEqual(old.reviewOrigin);
  expect(next.wrongQuestions).toEqual(legacy.wrongQuestions);
  expect(next.annual).toEqual(legacy.annual); expect(next.weights).toEqual(legacy.weights);
  expect(next.english.articles[0].memory).toEqual(next.memory['math:F5']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v9')))).toEqual(legacy);
  await page.locator('#show-retention').click();
  await expect(page.locator('[data-cell="F5"] .mastery-readout')).toHaveText('95.00（50.00%）');
  await page.clock.setSystemTime(new Date('2026-10-21T04:00:00Z'));
  await page.reload(); await page.locator('#show-retention').click();
  await expect(page.locator('[data-cell="F5"] .mastery-readout')).toHaveText('47.50（50.00%）');
  expect(await state(page)).toEqual(next);
});

for (const [gaps, expected] of [[[1, 1, 1], '90.00'], [[1, 2, 5], '96.00']]) {
  test(`interactive reviews ${gaps} retain the ${expected}% calibration`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-01T04:00:00Z') });
    await page.goto('http://127.0.0.1:1420'); await edit(page, 90);
    let day = 1;
    for (const gap of gaps) {
      day += gap;
      await page.clock.setSystemTime(new Date(Date.UTC(2026, 9, day, 4)));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await edit(page, 90);
    }
    await page.locator('#show-retention').click();
    await expect(page.locator('[data-cell="F5"] .mastery-readout')).toHaveText(`90.00（${expected}%）`);
  });
}

test('six threshold reviews use the requested approximate gaps and persist across reopening', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T04:00:00Z') });
  await page.goto('http://127.0.0.1:1420'); await edit(page, 100);
  let day = 1;
  for (const gap of [2, 3, 8, 14, 32, 100]) {
    const prior = (await state(page)).memory['math:F5'];
    expect(prior.retentionPerDay ** (gap - 1)).toBeGreaterThanOrEqual(.5);
    expect(prior.retentionPerDay ** gap).toBeLessThan(.5);
    day += gap;
    await page.clock.setSystemTime(new Date(Date.UTC(2026, 9, day, 4)));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await edit(page, 100);
  }
  const saved = await state(page);
  expect(saved.memory['math:F5'].retentionPerDay).toBeCloseTo(.998305314942519, 12);
  await page.reload();
  expect(await state(page)).toEqual(saved);
});

test('v10 spacing upgrade corrects the last long-gap review and preserves history once', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T04:00:00Z') });
  const legacy = { ...initialState(data), version: 10 };
  const prior = recallReview(initializeMemory(100, '2026-10-01'), 100, '2026-10-03');
  legacy.memory['math:F5'] = recallReview(prior, 100, '2026-10-20');
  const expected = migrateState(data, legacy);
  expect(expected.memory['math:F5'].retentionPerDay).toBeLessThan(legacy.memory['math:F5'].retentionPerDay);
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(s => localStorage.setItem('kaoyan-panel-v1', JSON.stringify(s)), legacy);
  await page.reload();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const saved = await state(page);
  expect(saved.memory['math:F5'].retentionPerDay).toBeCloseTo(expected.memory['math:F5'].retentionPerDay, 13);
  expected.memory['math:F5'].retentionPerDay = saved.memory['math:F5'].retentionPerDay;
  expect(saved).toEqual(expected);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kaoyan-panel-before-rich-text-v10')))).toEqual(legacy);
  await page.reload(); expect(await state(page)).toEqual(expected);
  await edit(page, 100);
  // Unchanged 100 must not invent another review; the original day's snapshot survives.
  expect(await state(page)).toEqual(saved);
});
