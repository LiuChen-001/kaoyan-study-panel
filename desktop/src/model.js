import { today, validateMemory, currentMastery, migrateMinimumMemory } from './memory.js';
import { migrateWindowMemory, migrateRecallMemory } from './memory-migration.js';
import { validateEnglish } from './english.js';

export const sectionsOf = subject => subject.blocks.flatMap(block => block.sections);
export const nodesOf = subject => sectionsOf(subject).flatMap(section => section.nodes);

export function initialState(data) {
  return {
    version: 11,
    wrongQuestions: Object.fromEntries(data.subjects.flatMap(nodesOf).map(node => [node.id, ''])),
    english: { articles: [] },
    memory: Object.fromEntries(data.subjects.flatMap(nodesOf).map(node => [node.id, null])),
    annual: Object.fromEntries(data.subjects.flatMap(sectionsOf).map(section => [section.id, { ...section.annual }])),
    weights: Object.fromEntries(data.subjects.map(subject => [subject.id, { ...subject.weights }])),
  };
}

export function validateState(data, state) {
  if (!state || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(state.version)) throw new Error('记录版本不受支持');
  if (state.version >= 4) validateEnglish(state.english, state.version >= 5, state.version >= 6);
  const finite = (v, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  for (const subject of data.subjects) {
    const weights = state.weights?.[subject.id];
    if (!weights || !Object.keys(subject.weights).every(year => finite(weights[year])) || Object.keys(subject.weights).reduce((sum, year) => sum + weights[year], 0) <= 0) throw new Error('年份权重无效');
    for (const section of sectionsOf(subject)) {
      for (const year of Object.keys(section.annual)) {
        const value = state.annual?.[section.id]?.[year];
        if (!(value === null && !(year in subject.weights)) && !finite(value)) throw new Error('年度小节得分无效');
      }
      for (const node of section.nodes) {
        if (state.version >= 8 && typeof state.wrongQuestions?.[node.id] !== 'string') throw new Error('缺少节点错题题号或格式无效');
        if (state.version === 1) {
          if (!finite(state.mastery?.[node.id], 100)) throw new Error('掌握度必须是 0～100 的数字');
        } else {
          if (!state.memory || !(node.id in state.memory)) throw new Error('缺少节点遗忘曲线记录');
          validateMemory(state.memory[node.id], state.version >= 5, state.version >= 6);
        }
      }
    }
  }
  return state;
}

export function migrateState(data, state, backups = []) {
  validateState(data, state);
  if (state.version === 11) return state;
  const wrongQuestions = state.version >= 8 ? state.wrongQuestions : Object.fromEntries(data.subjects.flatMap(nodesOf).map(node => [node.id, '']));
  if (state.version >= 6) return validateState(data, { ...state, version: 11, wrongQuestions,
    memory: Object.fromEntries(Object.entries(state.memory).map(([id, memory]) => [id, migrateRecallMemory(memory)])),
    english: { articles: state.english.articles.map(article => ({ ...article, memory: migrateRecallMemory(article.memory) })) },
  });
  const previous = backups.filter(s => s && [3, 4, 5].includes(s.version));
  const migrate = (memory, candidates, label) => {
    try { return migrateWindowMemory(memory, candidates); }
    catch (error) { throw new Error(`${label}：${error.message}`); }
  };
  if (state.version === 4 || state.version === 5) return validateState(data, { ...state, version: 11, wrongQuestions,
    memory: Object.fromEntries(Object.entries(state.memory).map(([id, memory]) => [id, migrate(memory, previous.map(s => s.memory?.[id]), id)])),
    english: { articles: state.english.articles.map(article => ({ ...article, memory: migrate(article.memory, previous.map(s => s.english?.articles?.find(a => a.id === article.id)?.memory), article.title) })) },
  });
  if (state.version === 3) return migrateState(data, { ...state, version: 4, english: { articles: [] } }, backups);
  if (state.version === 2) return migrateState(data, { ...state, version: 4, english: { articles: [] }, memory: Object.fromEntries(Object.entries(state.memory).map(([id, memory]) => [id, migrateMinimumMemory(memory)])) }, backups);
  const { mastery, ...oldFields } = state;
  // User decision: all legacy nodes start unlearned; never invent study dates.
  return migrateState(data, validateState(data, { ...oldFields, version: 7, english: { articles: [] }, memory: Object.fromEntries(data.subjects.flatMap(nodesOf).map(node => [node.id, null])) }), backups);
}

export function sectionMetrics(subject, section, state, date = today()) {
  const years = Object.keys(subject.weights);
  const weightSum = years.reduce((sum, year) => sum + state.weights[subject.id][year], 0);
  // Both subjects retain full precision. Round only when formatting the UI.
  const score = years.reduce((sum, year) => sum + state.annual[section.id][year] * state.weights[subject.id][year], 0) / weightSum;
  const unit = score / section.nodes.length;
  const mastery = section.nodes.reduce((sum, node) => sum + currentMastery(state, node.id, date), 0);
  return { score, unit, earned: mastery * unit / 100, mastery: mastery / section.nodes.length };
}

export function subjectMetrics(subject, state, date = today()) {
  const blocks = subject.blocks.map(block => {
    const sections = block.sections.map(section => sectionMetrics(subject, section, state, date));
    return { id: block.id, earned: sections.reduce((sum, section) => sum + section.earned, 0), max: sections.reduce((sum, section) => sum + section.score, 0) };
  });
  return { blocks, earned: blocks.reduce((sum, block) => sum + block.earned, 0), max: blocks.reduce((sum, block) => sum + block.max, 0) };
}

export const formatScore = value => value.toFixed(2);

