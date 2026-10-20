import { predictMastery, today, validateMemory } from './memory.js';

export const ENGLISH_SHEET = '英语';

// Sum/scale the full round-trippable decimal values, with no fixed-place
// rounding. Binary *100 can turn 0.29 into 28.999999999999996 before truncation.
function decimalTotal(values, multiplier = 1) {
  const terms = values.map(value => {
    const [mantissa, power = '0'] = String(value).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    return { coefficient: BigInt(whole + fraction), exponent: Number(power) - fraction.length };
  });
  const exponent = terms.reduce((min, term) => Math.min(min, term.exponent), 0);
  const coefficient = terms.reduce((sum, term) => sum + term.coefficient * 10n ** BigInt(term.exponent - exponent), 0n) * BigInt(multiplier);
  return Number(`${coefficient}e${exponent}`);
}

export function validateEnglish(english, requireOrigin = false, requireDates = false) {
  if (!english || !Array.isArray(english.articles)) throw new Error('英语文章记录无效');
  const ids = new Set();
  for (const article of english.articles) {
    if (!article || typeof article.id !== 'string' || !article.id || ids.has(article.id) || typeof article.title !== 'string' || !article.title.trim() || article.memory === undefined) throw new Error('英语文章名称、标识或学习记录无效');
    ids.add(article.id);
    validateMemory(article.memory, requireOrigin, requireDates);
  }
}

export function addArticle(english, title, id = crypto.randomUUID()) {
  const name = title.trim();
  if (!name) throw new Error('请输入文章名称');
  const next = { articles: [...english.articles, { id, title: name, memory: null }] };
  validateEnglish(next);
  return next;
}

export function englishMetrics(english, date = today()) {
  const articles = decimalTotal(english.articles.map(article => predictMastery(article.memory, date)));
  return { articles, words: decimalTotal([articles], 400) };
}

export function englishLayout(data, state, date = today()) {
  const math = data.sheets['数学-分数面板'];
  const style = address => data.styles[math.cells[address].style];
  const title = style('A2'), header = style('A3');
  const text = { ...style('F5'), alignment: { horizontal: 'left' } };
  const numeric = { ...style('C5'), bold: true };
  const totals = englishMetrics(state.english, date);
  const cells = {
    A1: { value: '总掌握文章数', format: title },
    B1: { value: totals.articles, format: numeric },
    C1: { value: '总阅读词数', format: title },
    D1: { value: totals.words, format: numeric },
    A2: { value: '文章', format: header },
    C2: { value: '掌握度', format: header },
  };
  state.english.articles.forEach((article, index) => {
    const row = index + 3;
    cells[`A${row}`] = { value: article.title, format: text, binding: { type: 'article-title', id: article.id, label: '文章名称' } };
    cells[`C${row}`] = { value: decimalTotal([predictMastery(article.memory, date)], 100), format: numeric, binding: { type: 'article-mastery', id: article.id, label: article.title } };
  });
  const maxRow = Math.max(35, state.english.articles.length + 3);
  return { cells, columns: [{ min: 1, max: 1, width: 26 }, { min: 2, max: 3, width: 20 }, { min: 4, max: 4, width: 18 }], rows: { 1: 30, 2: 30, [maxRow]: 22.5 }, merges: Array.from({ length: maxRow - 1 }, (_, i) => `A${i + 2}:B${i + 2}`), pane: {} };
}
