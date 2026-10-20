import { sectionsOf, sectionMetrics, subjectMetrics } from './model.js';
import { today, currentMastery } from './memory.js';
import { ENGLISH_SHEET, englishLayout } from './english.js';
export function sheetNames(data) {
  const names = [...data.sheetNames];
  names.splice(names.indexOf('408-分数面板') + 1, 0, ENGLISH_SHEET);
  return names;
}
export function columnName(number) {
  let name = '';
  for (; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + (number - 1) % 26) + name;
  return name;
}
export function coordinates(address) {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(address);
  return { column: [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0), row: Number(row) };
}

// Presentation override only: retain the imported workbook and all numeric inputs.
export function sheetLayout(data, name, state, wrongIndex = false) {
  if (name === ENGLISH_SHEET) return englishLayout(data, state);
  const sheet = panelLayout(data, name);
  return wrongIndex && name.endsWith('分数面板') ? expandWrongIndex(data, name, sheet, state) : sheet;
}
function panelLayout(data, name) {
  const sheet = data.sheets[name];
  if (name !== '408-分数面板') return sheet;
  const math = data.sheets['数学-分数面板'];
  const cs = data.subjects.find(subject => subject.id === 'cs');
  const rows = Object.fromEntries(Object.keys(sheet.rows).map(row => [row, math.rows[4]]));
  const cells = { ...sheet.cells };
  const copyStyle = (address, source) => {
    if (cells[address]) cells[address] = { ...cells[address], style: math.cells[source].style };
  };
  rows[1] = math.rows[1];
  copyStyle('A1', 'A1'); copyStyle('B1', 'B1');
  for (const block of cs.blocks) {
    const row = Number(block.id.split(':').at(-1));
    rows[row] = math.rows[2]; rows[row + 1] = math.rows[3];
    copyStyle(`A${row}`, 'A2');
    copyStyle(`A${row + 1}`, 'A3'); copyStyle(`B${row + 1}`, 'B3');
    for (const section of block.sections) {
      const top = Number(section.id.split(':').at(-1));
      for (const col of ['A', 'B', 'C', 'D', 'E']) {
        copyStyle(`${col}${top}`, `${col}4`);
        if (col !== 'A') copyStyle(`${col}${top + 1}`, `${col}5`);
      }
      for (const node of section.nodes) {
        const bottom = node.id.split(':')[1];
        copyStyle(bottom, 'F5');
        copyStyle(bottom.replace(/\d+$/, String(top)), 'F4');
      }
    }
  }
  const columns = math.columns.filter(col => Number(col.min) <= 26);
  columns.push({ min: '27', max: '16384', width: math.columns.find(col => Number(col.min) === 7).width });
  return { ...sheet, columns, rows, cells };
}
function expandWrongIndex(data, name, sheet, state) {
  const subject = data.subjects.find(s => name.startsWith(s.prefix + '-'));
  const sections = sectionsOf(subject);
  const inserted = sections.map(section => Number(section.id.split(':').at(-1)) + 1);
  const rowNumber = row => row + inserted.filter(before => before <= row).length;
  const address = source => { const { column, row } = coordinates(source); return columnName(column) + rowNumber(row); };
  // Shift local references for the expanded view; quoted cross-sheet references
  // keep their original coordinates. Node IDs never use these display addresses.
  const formula = value => value.replace(/('(?:[^']|'')+'!)?(\$?[A-Z]{1,3})(\$?)(\d+)/g,
    (match, external, column, absolute, row) => external ? match : column + absolute + rowNumber(Number(row)));
  const cells = Object.fromEntries(Object.entries(sheet.cells).map(([source, cell]) => [address(source),
    { ...cell, sourceAddress: source, ...(cell.formula ? { formula: formula(cell.formula) } : {}) }]));
  const rows = Object.fromEntries(Object.entries(sheet.rows).map(([row, height]) => [rowNumber(Number(row)), height]));
  const merges = sheet.merges.map(range => range.split(':').map(address).join(':'));
  for (const section of sections) {
    const top = Number(section.id.split(':').at(-1));
    const middle = rowNumber(top) + 1;
    rows[middle] = sheet.rows[top + 1] ?? 22.5;
    cells[`E${middle}`] = { ...sheet.cells[`E${top}`], value: '错题题号' };
    for (const col of ['B', 'C', 'D']) merges.push(`${col}${rowNumber(top)}:${col}${middle}`);
    for (const node of section.nodes) {
      const source = node.id.split(':')[1];
      const column = columnName(coordinates(source).column);
      const style = data.styles[data.sheets['数学-分数面板'].cells.F5.style];
      cells[`${column}${middle}`] = { value: state.wrongQuestions[node.id],
        format: { ...style, alignment: { ...style.alignment, horizontal: 'left', wrapText: '0' } },
        binding: { type: 'wrong-question', id: node.id, label: `${node.name}错题题号` } };
    }
  }
  return { ...sheet, cells, rows, merges, pane: { ...sheet.pane,
    ...(sheet.pane.topLeftCell ? { topLeftCell: address(sheet.pane.topLeftCell) } : {}),
    ...(sheet.pane.ySplit ? { ySplit: rowNumber(Number(sheet.pane.ySplit)) } : {}) } };
}
export function sheetValues(data, name, state, date = today(), wrongIndex = false) {
  if (name === ENGLISH_SHEET) return englishLayout(data, state, date).cells;
  const sheet = data.sheets[name];
  const values = Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => [address, { ...cell }]));
  const subject = data.subjects.find(s => name.startsWith(s.prefix + '-'));
  const put = (address, value, binding, formula) => {
    values[address] = { ...values[address], value, ...(binding ? { binding } : {}), ...(formula ? { formula } : {}) };
  };
  if (name.endsWith('分数面板')) {
    const summary = subjectMetrics(subject, state, date);
    put('B1', summary.earned);
    subject.blocks.forEach((block, index) => {
      put(`B${Number(block.id.split(':').at(-1)) + 1}`, summary.blocks[index].earned);
      for (const section of block.sections) {
        const row = Number(section.id.split(':').at(-1)) + 1;
        const metrics = sectionMetrics(subject, section, state, date);
        put(`B${row}`, metrics.score, null, section.formula.replace(/^ROUND\((.*),1\)$/, '$1'));
        put(`C${row}`, section.nodes.length);
        put(`D${row}`, metrics.unit, null, `B${row}/C${row}`);
        for (const node of section.nodes) {
          const address = node.id.split(':')[1];
          put(address, currentMastery(state, node.id, date), { type: 'mastery', id: node.id, label: node.name });
          const title = address.replace(/\d+$/, String(row - 1));
          values[title] = { ...values[title], nodeName: true };
        }
      }
    });
    if (subject.id === 'cs') {
      for (let row = 61; row <= 69; row++) {
        const year = String(values[`A${row}`].value);
        put(`B${row}`, state.weights.cs[year], { type: 'weight', year, label: `${year} 年权重` });
      }
      put('B70', Object.values(state.weights.cs).reduce((a, b) => a + b, 0));
    }
  } else if (name.includes('-小节得分-')) {
    const year = name.slice(-4);
    for (const section of sectionsOf(subject)) {
      const address = Object.keys(sheet.cells).find(a => a.startsWith('A') && sheet.cells[a].value === section.name);
      put(`B${Number(address.slice(1)) + 1}`, state.annual[section.id][year], state.annual[section.id][year] === null ? null : { type: 'annual', id: section.id, year, label: `${year} ${section.name}年度得分` });
    }
  }
  return wrongIndex && name.endsWith('分数面板') ? expandWrongIndex(data, name, { ...panelLayout(data, name), cells: values }, state).cells : values;
}
export function displayValue(name, address, cell) {
  if (cell?.value == null) return '';
  if (typeof cell.value !== 'number') return String(cell.value);
  address = cell.sourceAddress ?? address;
  if (name === ENGLISH_SHEET && address !== 'B1') return String(Math.trunc(cell.value));
  if (name === '408-分数面板' && /^B(6[1-9]|70)$/.test(address)) return `${(cell.value * 100).toFixed(2)}%`;
  if ((name.endsWith('分数面板') && address.startsWith('C')) || (name === '408-分数面板' && /^A6[1-9]$/.test(address)) || (name.includes('考点分布') && address.startsWith('A'))) return String(cell.value);
  return cell.value.toFixed(2);
}
