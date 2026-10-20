// Exercise the actual release WebView and native persistence. Restore prior files afterward.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { initialState, migrateState } from '../src/model.js';
import { today, initializeMemory, review } from '../src/memory.js';
import { recallReview } from '../tests/legacy-fixtures.js';
const appDir = join(process.env.APPDATA, 'cn.kaoyan.study-panel.verification');
const files = ['progress.json', 'progress.bak', 'progress-before-spacing-v10.json'];
const originals = await Promise.all(files.map(async name => {
  try { return await readFile(join(appDir, name)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}));
let child;
let browser;
async function launch() {
  child = spawn(resolve('src-tauri/target/release/kaoyan-panel-desktop.exe'), [], {
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9423', WEBVIEW2_USER_DATA_FOLDER: resolve('test-results/native-webview') },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9423');
      const context = browser.contexts()[0];
      const page = context.pages()[0] ?? await context.waitForEvent('page');
      await page.locator('[data-node]').first().waitFor({ timeout: 10000 });
      return page;
    } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  throw new Error('Native WebView did not become ready');
}
try {
  const data = JSON.parse(await readFile('src/data.json', 'utf8'));
  const date = today();
  const yesterday = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const beforeYesterday = new Date(Date.parse(date + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0, 10);
  const legacy = { ...initialState(data), version: 10 };
  legacy.wrongQuestions['cs:F21'] = '迁移前 P005：002';
  legacy.memory['math:F5'] = recallReview(initializeMemory(80, yesterday), 60, date);
  const prior = recallReview(initializeMemory(100, beforeYesterday), 100, yesterday);
  legacy.memory['cs:F21'] = recallReview(prior, 100, date);
  const migrated = migrateState(data, legacy);
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, 'progress.json'), JSON.stringify(legacy));
  await rm(join(appDir, 'progress-before-spacing-v10.json'), { force: true });
  let page = await launch();
  const identifier = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|identifier'));
  assert.equal(identifier, 'cn.kaoyan.study-panel.verification', 'Build with verification.conf.json first; never test against production records.');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const input = page.locator('[data-node]').first();
  assert.equal(await input.inputValue(), '60.00');
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '已保存到本机', null, { polling: 100 });
  assert.deepEqual(JSON.parse(await readFile(join(appDir, 'progress-before-spacing-v10.json'), 'utf8')), legacy);
  const actualMigration = JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8'));
  // WebView and Node may differ by one ulp in logarithms; all other fields stay exact.
  for (const [id, memory] of Object.entries(migrated.memory)) {
    if (!memory) continue;
    assert.ok(Math.abs(actualMigration.memory[id].retentionPerDay - memory.retentionPerDay) < 1e-14);
    memory.retentionPerDay = actualMigration.memory[id].retentionPerDay;
  }
  assert.deepEqual(actualMigration, migrated);
  assert.equal(await page.locator('#export, #import, #retry').count(), 0);
  await page.locator('#show-retention').click();
  const rate = (migrated.memory['math:F5'].retentionPerDay * 100).toFixed(2);
  assert.equal(await page.locator('[data-cell="F5"] .mastery-readout').textContent(), `60.00（${rate}%）`);
  assert.equal(await page.locator('[data-cell="F5"] .retention-rate').evaluate(el => getComputedStyle(el).color), 'rgb(192, 0, 0)');
  assert.deepEqual(JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8')), migrated);

  await input.fill('73.25'); await input.press('Tab');
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '已保存到本机', null, { timeout: 10000, polling: 100 }).catch(async error => {
    console.log('Native status:', await page.locator('#save-status').textContent());
    console.log('Native input:', await input.inputValue());
    console.log('Native error:', await page.locator('#input-error').textContent());
    throw error;
  });
  const saved = JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8'));
  assert.equal(saved.memory['math:F5'].baseMastery, 0.7325);
  assert.equal(await page.locator('[data-cell="F5"] .mastery-value').textContent(), '73.25');
  assert.equal(saved.version, 11);
  assert.deepEqual(saved.memory['math:F5'], review(initializeMemory(80, yesterday), 73.25, date));
  await page.locator('#wrong-index').click();
  const reference = '高数资料 P028：003、7、12';
  await page.locator('[data-edit="F5"]').fill(reference);
  await page.locator('[data-edit="F5"]').press('Tab');
  await page.locator('[data-edit="F5"]').click();
  assert.ok(await page.locator('[data-edit="F5"]').evaluate(el => el.clientWidth >= el.scrollWidth));
  await page.screenshot({path:'test-results/native-wrong-full.png'});
  const handle = await page.locator('[data-cell="F5"] .fill-handle').boundingBox();
  const end = await page.locator('[data-cell="H5"]').boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 4); await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '已保存到本机');
  const filled = JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8'));
  for (const id of ['math:F5', 'math:G5', 'math:H5']) assert.equal(filled.wrongQuestions[id], reference);
  assert.deepEqual(filled.memory, saved.memory);
  await page.locator('#sheet-select').selectOption('408-分数面板');
  await page.locator('#wrong-index').click();
  await page.locator('[data-edit="F5"]').fill('408资料 P015：0009');
  await page.locator('[data-edit="F5"]').press('Tab');
  await page.locator('#sheet-select').selectOption('数学-分数面板');
  await page.screenshot({ path: 'test-results/native-wrong-index.png' });
  await page.locator('#sheet-select').selectOption('英语');
  await page.locator('#add-article').click();
  await page.locator('#article-title').fill('Native persistence article');
  await page.locator('#article-form button[type=submit]').click();
  await page.locator('[data-edit="C3"]').fill('88.999999');
  await page.locator('[data-edit="C3"]').press('Tab');
  assert.equal(await page.locator('[data-cell="D1"]').textContent(), '355');
  await page.locator('#sheet-select').selectOption('数学-分数面板');
  await page.locator('[data-node]').first().fill('84.5');
  // Native close request must blur the active field and await the resulting write.
  const exit = new Promise(resolve => child.once('exit', resolve));
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(() => {});
  await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Native close timeout')), 10000))]);
  const persisted = JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8'));
  assert.equal(persisted.memory['math:F5'].baseMastery, 0.845);
  assert.equal(persisted.english.articles[0].title, 'Native persistence article');
  assert.equal(persisted.english.articles[0].memory.baseMastery, 88.999999 / 100);
  assert.deepEqual(persisted.memory['math:F5'], review(initializeMemory(80, yesterday), 84.5, date));
  await browser.close().catch(() => {});
  page = await launch();
  await page.locator('[data-node]').first().focus();
  assert.equal(await page.locator('[data-node]').first().inputValue(), '84.5');
  assert.equal(await page.locator('#show-retention').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8')), persisted);
  await page.locator('#wrong-index').click();
  assert.equal(await page.locator('[data-edit="F5"]').inputValue(), reference);
  assert.equal(await page.locator('[data-edit="G5"]').inputValue(), reference);
  assert.equal(await page.locator('[data-edit="H5"]').inputValue(), reference);
  assert.equal(persisted.wrongQuestions['cs:F5'], '408资料 P015：0009');

  await page.locator('[data-node]').first().fill('90');
  await page.locator('[data-node]').first().press('Tab');
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '已保存到本机', null, { polling: 100 });
  const replaced = JSON.parse(await readFile(join(appDir, 'progress.json'), 'utf8'));
  assert.deepEqual(replaced.memory['math:F5'], review(initializeMemory(80, yesterday), 90, date));

  await page.locator('#sheet-select').selectOption('英语');
  assert.equal(await page.locator('[data-edit="A3"]').inputValue(), 'Native persistence article');
  assert.equal(await page.locator('[data-edit="C3"]').inputValue(), '88');
  assert.equal(await page.locator('[data-cell="B1"]').textContent(), '0.89');
  assert.equal(await page.locator('[data-cell="D1"]').textContent(), '355');
  await page.screenshot({ path: 'test-results/native-desktop.png' });
  assert.deepEqual(errors, []);
  console.log('Native release: v10 spacing-corrected migration, backup, math/408 text persistence, horizontal fill, English precision, dual-color rate view, removed controls, close-flush, restart and same-day replacement passed.');
} finally {
  if (child && child.exitCode === null) { const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit; }
  await browser?.close().catch(() => {});
  await mkdir(appDir, { recursive: true });
  for (let i = 0; i < files.length; i++) {
    if (originals[i] === null) await rm(join(appDir, files[i]), { force: true });
    else await writeFile(join(appDir, files[i]), originals[i]);
  }
}
