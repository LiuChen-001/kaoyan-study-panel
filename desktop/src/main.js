/* Original workbook topology: coordinates, merges, row pairs, sheet order.
   Display formatting never feeds back into the calculation model.
   Wrong-index extension: blue spreadsheet cells; toggle two rows into three,
   edit reference text in the middle row, drag its corner right to copy it.
   Stable node IDs own the data; expanded addresses are presentation only. */
import data from './data.json';
import { initialState, validateState, migrateState } from './model.js';
import { today, review } from './memory.js';
import { columnName, coordinates, sheetValues, displayValue, sheetLayout, sheetNames } from './workbook.js';
import { loadState, saveState, loadMigrationHistory } from './storage.js';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ENGLISH_SHEET, addArticle } from './english.js';
import { wrongTextHTML, readWrongEditor, setWrongText } from './wrong-text.js';
import './style.css';

const app = document.querySelector('#app');
const sheets = sheetNames(data);
const isMastery = binding => ['mastery', 'article-mastery'].includes(binding?.type);
const isText = binding => ['article-title', 'wrong-question'].includes(binding?.type);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = initialState(data);
let activeSheet = sheets[0];
let selected = 'A1';
let values = {};
let loadError = '';
let saveError = false;
let saveMessage = '已保存到本机';
let saveChain = Promise.resolve();
let revision = 0;
const scrollPositions = new Map();
const wrongIndexSheets = new Set();
const editingOriginals = new WeakMap();
let displayedDate = today();
let showRetention = false;

const memoryFor = binding => binding?.type === 'article-mastery'
  ? state.english.articles.find(article => article.id === binding.id)?.memory : state.memory[binding?.id];
const retentionText = cell => {
  const memory = memoryFor(cell?.binding);
  return memory ? `${(memory.retentionPerDay * 100).toFixed(2)}%` : '—';
};
function retentionReadout(address, cell) {
  return `<span class="mastery-readout" aria-hidden="true"><span class="mastery-value">${escape(displayValue(activeSheet, address, cell))}</span><span class="retention-rate">（${retentionText(cell)}）</span></span>`;
}
function fitRetentionReadouts() {
  for (const readout of app.querySelectorAll('.mastery-readout')) {
    if (readout.scrollWidth) readout.style.setProperty('--retention-scale', Math.min(1, (readout.parentElement.clientWidth - 8) / readout.scrollWidth));
  }
}

function status() {
  const el = document.querySelector('#save-status');
  if (el) { el.textContent = saveMessage; el.classList.toggle('error', saveError); }
}
function persist() {
  saveMessage = '正在保存…'; saveError = false; status();
  const current = ++revision;
  const snapshot = structuredClone(state);
  saveChain = saveChain.catch(() => {}).then(() => saveState(snapshot)).then(() => {
    if (current === revision) { saveMessage = '已保存到本机'; saveError = false; status(); }
  }).catch(error => {
    if (current === revision) { saveMessage = `保存失败：${String(error)}。请检查本地存储后再次编辑以重试保存。`; saveError = true; status(); }
  });
}
const rawValue = cell => cell?.value == null ? '' : cell.binding?.type === 'weight' ? String(cell.value * 100) : String(cell.value);

let wrongSelection = null;
function updateFormatControls() {
  const enabled = !loadError && values[selected]?.binding?.type === 'wrong-question';
  const bold = document.querySelector('#wrong-bold');
  const color = document.querySelector('#wrong-color');
  if (bold) { bold.disabled = !enabled; bold.setAttribute('aria-pressed', String(enabled && document.queryCommandState('bold'))); }
  if (color) color.disabled = !enabled;
}
function rememberWrongSelection() {
  const selection = window.getSelection();
  const element = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection?.anchorNode?.parentElement;
  const editor = element?.closest('[data-wrong]');
  if (editor && selection.rangeCount && editor.contains(selection.focusNode)) {
    wrongSelection = { editor, range: selection.getRangeAt(0).cloneRange() };
    updateFormatControls();
  }
}
function commitWrongEditor(editor) {
  if (loadError || !editor.isConnected) return;
  const { text, runs } = readWrongEditor(editor);
  const id = editor.dataset.wrong;
  const formatted = runs.some(run => run.bold || run.color) ? runs : undefined;
  if (state.wrongQuestions[id] === text && JSON.stringify(state.wrongQuestionFormats[id]) === JSON.stringify(formatted)) return;
  const before = structuredClone(state);
  try {
    setWrongText(state, id, text, runs);
    validateState(data, state); refreshValues(); persist();
    document.querySelector('#input-error').textContent = '';
  } catch (error) { state = before; document.querySelector('#input-error').textContent = error.message; }
}
function formatWrongText(command, color) {
  const remembered = wrongSelection;
  if (!remembered?.editor.isConnected || remembered.editor.dataset.edit !== selected || loadError) return;
  const { editor, range } = remembered;
  editor.focus();
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  // Native editing commands preserve range formatting, IME and the browser undo stack.
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(command, false, color);
  rememberWrongSelection(); commitWrongEditor(editor); updateFormatControls();
}
document.addEventListener('selectionchange', rememberWrongSelection);
app.addEventListener('pointerdown', event => {
  if (event.target.closest('#wrong-bold')) event.preventDefault();
  if (event.target.closest('#wrong-color')) rememberWrongSelection();
});
app.addEventListener('click', event => {
  if (event.target.closest('#wrong-bold')) formatWrongText('bold');
});
app.addEventListener('input', event => {
  if (event.target.id === 'wrong-color') formatWrongText('foreColor', event.target.value);
  if (event.target.dataset.wrong) document.querySelector('#formula').value = event.target.textContent;
});
app.addEventListener('paste', event => {
  if (!event.target.closest('[data-wrong]')) return;
  event.preventDefault();
  document.execCommand('insertText', false, event.clipboardData.getData('text/plain').replace(/\r?\n/g, ' '));
});
app.addEventListener('drop', event => {
  if (event.target.closest('[data-wrong]')) event.preventDefault();
});

function refreshValues(date = today()) {
  displayedDate = date;
  values = sheetValues(data, activeSheet, state, date, wrongIndexSheets.has(activeSheet));
  for (const [address, item] of Object.entries(values)) {
    const td = document.querySelector(`[data-cell="${address}"]`);
    if (!td) continue;
    const input = td.querySelector('input');
    if (input && input !== document.activeElement) input.value = displayValue(activeSheet, address, item);
    if (input && item.binding) input.setAttribute('aria-label', item.binding.label + (isMastery(item.binding) ? '掌握度' : ''));
    if (showRetention && isMastery(item.binding)) {
      td.querySelector('.mastery-readout')?.remove();
      td.insertAdjacentHTML('beforeend', retentionReadout(address, item));
      input?.setAttribute('aria-description', `每日记忆率 ${retentionText(item)}`);
    }
    const rich = td.querySelector('[data-wrong]');
    if (rich && rich !== document.activeElement && rich !== wrongSelection?.editor) rich.innerHTML = wrongTextHTML(String(item.value ?? ''), state.wrongQuestionFormats[item.binding.id]);
    if (!input && !rich) td.querySelector('.cell-content').textContent = displayValue(activeSheet, address, item);
    td.title = displayValue(activeSheet, address, item);
  }
  const bar = document.querySelector('#formula');
  if (bar && !document.activeElement?.matches('[data-edit], #formula')) bar.value = values[selected]?.formula ? '=' + values[selected].formula : rawValue(values[selected]);
  const dateLabel = document.querySelector('#memory-date');
  if (dateLabel) dateLabel.textContent = `${date} · 北京时间每日遗忘`;
  fitRetentionReadouts();
}

function selectCell(address, focus = false) {
  const cell = document.querySelector(`[data-cell="${address}"]`);
  if (!cell) return;
  document.querySelector('.selected')?.classList.remove('selected');
  selected = address; cell.classList.add('selected');
  document.querySelector('#address').value = address;
  const item = values[address];
  const bar = document.querySelector('#formula');
  bar.readOnly = !item?.binding || !!loadError;
  bar.value = item?.formula ? '=' + item.formula : rawValue(item);
  const memory = memoryFor(item?.binding);
  document.querySelector('#cell-hint').textContent = item?.binding ? isMastery(item.binding) ? memory ? `仅可提高掌握度 · 上次学习 ${memory.lastInterventionDate} · 每日保留 ${(memory.retentionPerDay * 100).toFixed(2)}%` : '尚未初学 · 首次输入大于 0 的掌握度后开始遗忘' : item.binding.type === 'wrong-question' ? '错题题号：可填写资料名、页码和题号 · 拖动右下角向右填充同一行' : item.binding.type === 'article-title' ? '文章名称：修改名称不会重置学习记录' : item.binding.type === 'weight' ? '权重：按百分数输入，例如 9 表示 9%' : '年度小节得分：修改后自动计算' : item?.formula ? '公式单元格 · 自动计算' : activeSheet === ENGLISH_SHEET && state.english.articles.length === 0 ? '点击“增加文章”填写名称，初始掌握度为 0' : '只读单元格 · 完整内容见编辑栏';
  updateFormatControls();
  if (focus) { (cell.querySelector('input, [contenteditable]') ?? cell).focus(); cell.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

function renderGrid() {
  displayedDate = today();
  values = sheetValues(data, activeSheet, state, displayedDate, wrongIndexSheets.has(activeSheet));
  const sheet = sheetLayout(data, activeSheet, state, wrongIndexSheets.has(activeSheet));
  const compactPanel = activeSheet === '408-分数面板';
  const nodeNames = new Set(Object.entries(values).filter(([, cell]) => cell.nodeName).map(([address]) => address));
  const addresses = Object.keys(values).map(coordinates);
  const maxRow = Math.max(35, ...addresses.map(a => a.row), ...Object.keys(sheet.rows).map(Number));
  const maxColumn = Math.max(16, ...addresses.map(a => a.column));
  const widths = Array.from({ length: maxColumn }, (_, i) => {
    const col = sheet.columns.find(c => i + 1 >= Number(c.min) && i + 1 <= Number(c.max));
    return Math.round(Number(col?.width ?? 13.72) * 7 + 5);
  });
  const merged = new Map(); const covered = new Set();
  for (const range of sheet.merges) {
    const [start, end] = range.split(':').map(coordinates);
    if (start.row > maxRow || start.column > maxColumn) continue;
    merged.set(columnName(start.column) + start.row, { rows: end.row - start.row + 1, cols: end.column - start.column + 1 });
    for (let r = start.row; r <= end.row; r++) for (let c = start.column; c <= end.column; c++) if (r !== start.row || c !== start.column) covered.add(columnName(c) + r);
  }
  let left = 43;
  const frozen = Number(sheet.pane.xSplit ?? 0);
  const frozenRows = Number(sheet.pane.ySplit ?? 0);
  const offsets = widths.map(width => { const offset = left; left += width; return offset; });
  const html = `<table class="worksheet" aria-label="${escape(activeSheet)}" style="width:${43 + widths.reduce((a, b) => a + b, 0)}px"><colgroup><col style="width:43px">${widths.map(w => `<col style="width:${w}px">`).join('')}</colgroup><thead><tr><th class="corner"></th>${widths.map((_, i) => `<th scope="col" ${i < frozen ? `class="frozen" style="left:${offsets[i]}px"` : ''}>${columnName(i + 1)}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: maxRow }, (_, index) => {
    const row = index + 1;
    const frozenTop = 27 + Array.from({ length: row - 1 }, (_, r) => (sheet.rows[r + 1] ?? 22.5) * 4 / 3).reduce((a, b) => a + b, 0);
    return `<tr style="height:${(sheet.rows[row] ?? 22.5) * 4 / 3}px"><th class="row-number" scope="row" ${row <= frozenRows ? `style="top:${frozenTop}px;z-index:6"` : ''}>${row}</th>${widths.map((_, i) => {
      const address = columnName(i + 1) + row;
      if (covered.has(address)) return '';
      const cell = values[address]; const merge = merged.get(address);
      const style = sheet.cells[address]?.format ?? data.styles[sheet.cells[address]?.style ?? 0];
      const align = style.alignment.horizontal ?? (typeof cell?.value === 'number' ? 'right' : 'left');
      const frozenCell = i < frozen;
      const css = `background:${style.fill ?? '#ffffff'};color:${style.color};font-size:${style.size * 4 / 3}px;font-weight:${style.bold ? 700 : 400};text-align:${align};${frozenCell ? `left:${offsets[i]}px;` : ''}${row <= frozenRows ? `position:sticky;top:${frozenTop}px;z-index:3;` : ''}`;
      const editable = cell?.binding && !loadError;
      const node = isMastery(cell?.binding);
      const wrong = cell?.binding?.type === 'wrong-question';
      return `<td tabindex="-1" data-cell="${address}" class="${frozenCell ? 'frozen ' : ''}${!compactPanel && style.alignment.wrapText === '1' ? 'wrap ' : ''}${nodeNames.has(address) ? 'node-name ' : ''}${wrong ? 'wrong-question ' : ''}${showRetention && node ? 'show-retention ' : ''}${editable ? 'editable ' : ''}${selected === address ? 'selected' : ''}" ${merge ? `rowspan="${merge.rows}" colspan="${merge.cols}"` : ''} style="${css}" title="${escape(displayValue(activeSheet, address, cell))}">${editable ? wrong ? `<div class="wrong-editor" contenteditable="true" role="textbox" aria-multiline="false" data-edit="${address}" data-wrong="${cell.binding.id}" aria-label="${escape(cell.binding.label)}" spellcheck="false">${wrongTextHTML(String(cell.value ?? ''), state.wrongQuestionFormats[cell.binding.id])}</div><span class="fill-handle" aria-hidden="true" title="向右拖动，复制错题题号"></span>` : `<input type="text" inputmode="${isText(cell.binding) ? 'text' : 'decimal'}" data-edit="${address}" ${node ? `data-node="${cell.binding.id}"` : ''} ${showRetention && node ? `aria-description="每日记忆率 ${retentionText(cell)}"` : ''} ${wrong ? `data-wrong="${cell.binding.id}"` : ''} aria-label="${escape(cell.binding.label)}${node ? '掌握度' : ''}" value="${escape(displayValue(activeSheet, address, cell))}" spellcheck="false">${wrong ? '<span class="fill-handle" aria-hidden="true" title="向右拖动，复制错题题号"></span>' : ''}` : `<span class="cell-content">${escape(displayValue(activeSheet, address, cell))}</span>`}${showRetention && node ? retentionReadout(address, cell) : ''}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table>`;
  const viewport = document.querySelector('#grid');
  const x = viewport.scrollLeft, y = viewport.scrollTop;
  viewport.innerHTML = html;
  viewport.scrollLeft = x; viewport.scrollTop = y;
  document.querySelector('#sheet-info').textContent = `${activeSheet} · ${sheets.indexOf(activeSheet) + 1} / ${sheets.length} 张工作表`;
  selectCell(selected);
  fitRetentionReadouts();
}

function render() {
  app.innerHTML = `<header class="titlebar"><span class="app-icon" aria-hidden="true">▦</span><h1>考研综合面板</h1><span class="filename">考研综合面板.xlsx · 桌面版</span><span id="save-status" role="status"></span></header>
    <div class="toolbar"><label>工作表 <select id="sheet-select" aria-label="选择工作表">${sheets.map(name => `<option ${name === activeSheet ? 'selected' : ''}>${escape(name)}</option>`).join('')}</select></label><span class="separator"></span>${activeSheet.endsWith('分数面板') ? `<button id="wrong-index" aria-pressed="${wrongIndexSheets.has(activeSheet)}" aria-expanded="${wrongIndexSheets.has(activeSheet)}" aria-controls="grid">错题索引</button>` : ''}${activeSheet.endsWith('分数面板') ? `<span class="wrong-format-controls" role="group" aria-label="错题文字格式"><button id="wrong-bold" aria-label="加粗选中的错题文字（Ctrl+B）" title="加粗（Ctrl+B）" aria-pressed="false" disabled><b>B</b></button><label class="color-control" title="修改选中的错题文字颜色">字体颜色<input id="wrong-color" type="color" value="#c00000" aria-label="错题文字颜色" disabled></label></span>` : ''}${activeSheet === ENGLISH_SHEET ? `<button id="add-article" ${loadError ? 'disabled' : ''}>增加文章</button>` : ''}${activeSheet.endsWith('分数面板') || activeSheet === ENGLISH_SHEET ? `<button id="show-retention" aria-pressed="${showRetention}" aria-controls="grid">显示记忆率</button>` : ''}<span class="precision">${activeSheet === ENGLISH_SHEET ? '完整精度计算 · 掌握度和词数截去小数' : '完整精度计算 · 显示两位小数'}</span></div>
    ${loadError ? `<div class="error-banner" role="alert">无法读取记录：${escape(loadError)}。编辑已停用，请关闭程序后检查本地 progress.json 或恢复有效文件备份。</div>` : ''}
    <div class="formula-bar"><input id="address" aria-label="单元格地址" value="${selected}"><span class="fx">fx</span><input id="formula" aria-label="单元格内容或公式" readonly></div>
    <div id="input-error" role="alert"></div><main id="grid" aria-label="工作表网格"></main>
    <div class="sheet-strip"><span class="sheet-symbol" aria-hidden="true">☷</span><nav aria-label="工作表标签">${sheets.map(name => `<button data-sheet="${escape(name)}" class="${name === activeSheet ? 'active' : ''}" aria-pressed="${name === activeSheet}">${escape(name)}</button>`).join('')}</nav></div>
    <footer><span id="sheet-info"></span><span id="memory-date">${displayedDate} · 北京时间每日遗忘</span><span id="cell-hint"></span></footer>
    <dialog id="article-dialog" aria-labelledby="article-dialog-title"><form id="article-form"><h2 id="article-dialog-title">增加文章</h2><label for="article-title">文章名称</label><input id="article-title" name="title" type="text" required autocomplete="off"><p>初始掌握度为 0，首次提高后开始计算遗忘。</p><p id="article-error" role="alert"></p><button type="button" id="cancel-article">取消</button><button type="submit">增加文章</button></form></dialog>`;
  renderGrid(); status();
}
function switchSheet(name) {
  const grid = document.querySelector('#grid');
  scrollPositions.set(activeSheet, [grid.scrollLeft, grid.scrollTop]);
  activeSheet = name; selected = 'A1'; render();
  const [x, y] = scrollPositions.get(name) ?? [0, 0];
  document.querySelector('#grid').scrollTo(x, y);
  document.querySelector('.sheet-strip .active').scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function commit(address, raw, original) {
  // No edit is not a review, including an editor left open across midnight.
  if (original === raw) return;
  refreshValues();
  const cell = values[address];
  if (!cell?.binding || loadError) return;
  const binding = cell.binding;
  const before = structuredClone(state);
  try {
    // An unchanged editor must not round-trip percentage conversion or display rounding.
    if (raw === rawValue(cell)) { document.querySelector('#input-error').textContent = ''; return; }
    if (binding.type === 'wrong-question') {
      wrongSelection = null;
      setWrongText(state, binding.id, raw);
      validateState(data, state); refreshValues();
      document.querySelector('#input-error').textContent = ''; persist(); return;
    }
    if (binding.type === 'article-title') {
      const title = raw.trim();
      if (!title) throw new Error('文章名称不能为空');
      state.english.articles.find(article => article.id === binding.id).title = title;
      validateState(data, state); refreshValues();
      document.querySelector('#input-error').textContent = ''; persist(); return;
    }
    let value = raw.trim() === '' ? NaN : Number(raw.replace(/%$/, ''));
    if (binding.type === 'weight') value /= 100;
    if (!Number.isFinite(value) || value < 0 || (isMastery(binding) && value > 100)) throw new Error(isMastery(binding) ? '掌握度必须为 0～100 的数字，原记录未改变。' : '请输入大于或等于 0 的有效数字。');
    if (value === cell.value) { document.querySelector('#input-error').textContent = ''; return; }
    if (binding.type === 'mastery') state.memory[binding.id] = review(state.memory[binding.id], value, today());
    if (binding.type === 'article-mastery') {
      const article = state.english.articles.find(article => article.id === binding.id);
      article.memory = review(article.memory, value, today());
    }
    if (binding.type === 'annual') state.annual[binding.id][binding.year] = value;
    if (binding.type === 'weight') state.weights.cs[binding.year] = value;
    validateState(data, state);
    refreshValues();
    document.querySelector('#input-error').textContent = ''; persist();
  } catch (error) { state = before; document.querySelector('#input-error').textContent = error.message; }
}
let fillDrag = null;
let fillFrame = 0;
function clearFillPreview() {
  app.querySelectorAll('.fill-target').forEach(cell => cell.classList.remove('fill-target'));
}
function cellAtPoint(x, y) {
  let target = document.elementFromPoint(x, y);
  // Ignore the spilled part of a text editor when selecting or filling cells.
  if (target?.closest('[data-wrong]') && x >= target.closest('td').getBoundingClientRect().right) {
    const editor = target.closest('[data-wrong]');
    editor.style.pointerEvents = 'none';
    target = document.elementFromPoint(x, y);
    editor.style.pointerEvents = '';
  }
  return target?.closest('[data-cell]');
}
function updateFillPreview() {
  const target = cellAtPoint(fillDrag.x, fillDrag.y);
  const end = target?.dataset.cell;
  const start = coordinates(fillDrag.source);
  const finish = end ? coordinates(end) : null;
  fillDrag.targets = finish && finish.row === start.row && finish.column > start.column
    ? Object.entries(values).filter(([address, cell]) => {
      const point = coordinates(address);
      return cell.binding?.type === 'wrong-question' && point.row === start.row && point.column > start.column && point.column <= finish.column;
    }).map(([address]) => address) : [];
  clearFillPreview();
  for (const address of fillDrag.targets) app.querySelector(`[data-cell="${address}"]`).classList.add('fill-target');
}
function scrollFill() {
  if (!fillDrag) return;
  const grid = document.querySelector('#grid');
  const bounds = grid.getBoundingClientRect();
  const row = app.querySelector(`[data-cell="${fillDrag.source}"]`).getBoundingClientRect();
  if (fillDrag.y >= row.top && fillDrag.y < row.bottom) {
    const delta = fillDrag.x > bounds.right - 24 ? 12 : fillDrag.x < bounds.left + 24 ? -12 : 0;
    if (delta) { grid.scrollLeft += delta; updateFillPreview(); }
  }
  fillFrame = requestAnimationFrame(scrollFill);
}
function cancelFill() {
  fillDrag = null; cancelAnimationFrame(fillFrame); clearFillPreview();
}
app.addEventListener('pointerdown', event => {
  const handle = event.target.closest('.fill-handle');
  if (!handle || event.button !== 0) return;
  event.preventDefault(); document.activeElement?.blur();
  const source = handle.closest('[data-cell]').dataset.cell;
  selectCell(source);
  fillDrag = { source, value: values[source].value, runs: structuredClone(state.wrongQuestionFormats[values[source].binding.id]), targets: [], x: event.clientX, y: event.clientY };
  handle.setPointerCapture(event.pointerId);
  fillFrame = requestAnimationFrame(scrollFill);
});
app.addEventListener('pointermove', event => {
  if (!fillDrag) return;
  fillDrag.x = event.clientX; fillDrag.y = event.clientY; updateFillPreview();
});
app.addEventListener('pointerup', event => {
  if (!fillDrag) return;
  fillDrag.x = event.clientX; fillDrag.y = event.clientY; updateFillPreview();
  const { targets, value, runs } = fillDrag;
  const changed = targets.some(address => state.wrongQuestions[values[address].binding.id] !== value || JSON.stringify(state.wrongQuestionFormats[values[address].binding.id]) !== JSON.stringify(runs));
  for (const address of targets) setWrongText(state, values[address].binding.id, value, runs);
  cancelFill();
  if (changed) {
    refreshValues(); document.querySelector('#input-error').textContent = ''; persist();
  }
});
app.addEventListener('pointercancel', cancelFill);
app.addEventListener('lostpointercapture', cancelFill);
app.addEventListener('click', event => {
  let td = event.target.closest('[data-cell]');
  if (event.target.closest('[data-wrong]') && window.getSelection()?.isCollapsed && event.clientX >= td.getBoundingClientRect().right) {
    td = cellAtPoint(event.clientX, event.clientY);
    if (td) selectCell(td.dataset.cell, true);
  } else if (td) { selectCell(td.dataset.cell); if (!td.querySelector('input, [contenteditable]')) td.focus(); }
  const button = event.target.closest('button');
  if (button?.id === 'wrong-index') {
    document.activeElement?.blur();
    if (wrongIndexSheets.has(activeSheet)) wrongIndexSheets.delete(activeSheet);
    else wrongIndexSheets.add(activeSheet);
    selected = 'A1'; renderGrid();
    button.setAttribute('aria-pressed', String(wrongIndexSheets.has(activeSheet)));
    button.setAttribute('aria-expanded', String(wrongIndexSheets.has(activeSheet)));
  }
  if (button?.dataset.sheet) switchSheet(button.dataset.sheet);
  if (button?.id === 'add-article') {
    document.querySelector('#article-form').reset();
    document.querySelector('#article-error').textContent = '';
    document.querySelector('#article-dialog').showModal();
    document.querySelector('#article-title').focus();
  }
  if (button?.id === 'cancel-article') document.querySelector('#article-dialog').close();
  if (button?.id === 'show-retention') {
    document.activeElement?.blur();
    showRetention = !showRetention; renderGrid();
    button.setAttribute('aria-pressed', String(showRetention));
  }
});
app.addEventListener('submit', event => {
  if (event.target.id !== 'article-form') return;
  event.preventDefault();
  if (loadError) return;
  try {
    const english = addArticle(state.english, document.querySelector('#article-title').value);
    const next = validateState(data, { ...state, english });
    state = next;
    document.querySelector('#article-dialog').close();
    renderGrid(); selectCell(`C${state.english.articles.length + 2}`, true); persist();
  } catch (error) { document.querySelector('#article-error').textContent = error.message; }
});
app.addEventListener('focusin', event => {
  const address = event.target.dataset.edit;
  if (event.target.dataset.wrong) { selectCell(address); return; }
  if (address) { refreshValues(); selectCell(address); event.target.value = rawValue(values[address]); event.target.select(); }
  if (address || event.target.id === 'formula') editingOriginals.set(event.target, event.target.value);
});
app.addEventListener('focusout', event => {
  const address = event.target.dataset.edit;
  if (event.target.dataset.wrong) { commitWrongEditor(event.target); return; }
  if (address) { event.target.value = displayValue(activeSheet, address, values[address]); fitRetentionReadouts(); }
});
app.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.edit && !input.dataset.wrong) commit(input.dataset.edit, input.value, editingOriginals.get(input));
  if (input.id === 'formula') commit(selected, input.value, editingOriginals.get(input));
  if (input.id === 'sheet-select') switchSheet(input.value);
  if (input.id === 'address') {
    const address = input.value.trim().toUpperCase();
    if (/^[A-Z]+[1-9]\d*$/.test(address)) selectCell(address, true);
    input.value = selected;
  }

});
app.addEventListener('keydown', event => {
  if (event.key === 'Escape' && fillDrag) { cancelFill(); return; }
  if (event.key === 'Escape' && event.target.matches('td.node-name')) {
    event.target.classList.remove('selected'); event.target.blur(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && event.target.dataset.wrong) {
    event.preventDefault(); rememberWrongSelection(); formatWrongText('bold'); return;
  }
  if (event.key === 'Escape' && event.target.dataset.wrong) {
    commitWrongEditor(event.target);
    event.target.closest('td').classList.remove('selected'); event.target.blur(); return;
  }
  if (event.key === 'Escape' && event.target.dataset.edit) {
    event.target.value = rawValue(values[event.target.dataset.edit]);
    if (event.target.dataset.wrong) event.target.closest('td').classList.remove('selected');
    event.target.blur(); return;
  }
  if (event.key === 'Enter' && event.target.id === 'formula') { event.target.blur(); selectCell(selected, true); return; }
  const cell = event.target.closest('[data-cell]');
  if (!cell) return;
  const move = { Enter: [0, event.shiftKey ? -1 : 1], ArrowDown: [0, 1], ArrowUp: [0, -1], ...(event.target.matches('td') ? { ArrowLeft: [-1, 0], ArrowRight: [1, 0] } : {}) }[event.key];
  if (!move) return;
  event.preventDefault(); event.target.blur();
  const point = coordinates(cell.dataset.cell);
  selectCell(columnName(Math.max(1, point.column + move[0])) + Math.max(1, point.row + move[1]), true);
});
let needsSave = false;
try {
  const saved = await loadState();
  if (saved) { state = migrateState(data, saved, saved.version < 6 ? await loadMigrationHistory() : []); needsSave = saved.version !== state.version; }
  else needsSave = true;
}
catch (error) { loadError = String(error); saveMessage = '记录读取失败'; saveError = true; }
render();
if (needsSave && !loadError) persist();
const refreshDay = () => { if (!loadError && today() !== displayedDate) refreshValues(); };
setInterval(refreshDay, 30000);
window.addEventListener('focus', refreshDay);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
if (isTauri()) {
  await getCurrentWindow().onCloseRequested(async event => {
    document.activeElement?.blur();
    await saveChain;
    if (saveError && !loadError) event.preventDefault();
  });
} else {
  window.addEventListener('beforeunload', event => {
    if (saveMessage === '正在保存…' || saveError) { event.preventDefault(); event.returnValue = ''; }
  });
}
