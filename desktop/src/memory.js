const DAY_MS = 86400000;
const REVIEW_STRENGTH = 28.711284228111044;
const SPACING_DAYS = 20.164273571058075;
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

export function today(now = new Date()) {
  const parts = Object.fromEntries(calendar.formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function dayNumber(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('学习日期无效');
  const value = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('学习日期无效');
  return value / DAY_MS;
}
export function daysBetween(start, end) { return dayNumber(end) - dayNumber(start); }

export function initializeMemory(percent, date = today()) {
  dayNumber(date);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('初学掌握度必须大于 0 且不超过 100');
  if (percent / 100 === 0) throw new Error('初学掌握度小于可保存的浮点精度范围');
  return { initialLearnedDate: date, lastInterventionDate: date, baseMastery: percent / 100, retentionPerDay: 0.5, recentPreInterventionMasteries: [0, 0, 0, 0, 0], recentReviewDates: [], reviewOrigin: null };
}
export function validateMemory(memory, requireOrigin = false, requireDates = false) {
  if (memory === null) return;
  const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  if (!memory || !fraction(memory.baseMastery) || memory.baseMastery === 0 || !fraction(memory.retentionPerDay) || memory.retentionPerDay === 0 || memory.retentionPerDay === 1 || !Array.isArray(memory.recentPreInterventionMasteries) || memory.recentPreInterventionMasteries.length !== 5 || !memory.recentPreInterventionMasteries.every(fraction)) throw new Error('节点遗忘曲线记录无效');
  if (daysBetween(memory.initialLearnedDate, memory.lastInterventionDate) < 0) throw new Error('复习日期不能早于初学日期');
  if (requireOrigin && !Object.hasOwn(memory, 'reviewOrigin')) throw new Error('缺少按日覆盖记录');
  if (requireDates) {
    const dates = memory.recentReviewDates;
    if (!Array.isArray(dates) || dates.length > 5) throw new Error('缺少最近复习日期');
    for (let i = 0; i < dates.length; i++) {
      if (daysBetween(memory.initialLearnedDate, dates[i]) < 1 || daysBetween(dates[i], i ? dates[i - 1] : memory.lastInterventionDate) < (i ? 1 : 0)) throw new Error('复习日期必须按不同自然日倒序保存');
    }
    if (memory.lastInterventionDate !== memory.initialLearnedDate && dates[0] !== memory.lastInterventionDate) throw new Error('缺少最近一次复习日期');
  }
  if (memory.reviewOrigin != null) {
    const origin = memory.reviewOrigin;
    if (Object.hasOwn(origin, 'reviewOrigin')) throw new Error('复习起点不能嵌套历史快照');
    validateMemory(origin, false, requireDates);
    if (origin.initialLearnedDate !== memory.initialLearnedDate || daysBetween(origin.lastInterventionDate, memory.lastInterventionDate) < 1) throw new Error('相邻干预日期必须至少相隔一天');
  }
}
function curveSnapshot(memory) {
  const { initialLearnedDate, lastInterventionDate, baseMastery, retentionPerDay, recentPreInterventionMasteries, recentReviewDates } = memory;
  return { initialLearnedDate, lastInterventionDate, baseMastery, retentionPerDay, recentPreInterventionMasteries: [...recentPreInterventionMasteries], recentReviewDates: [...recentReviewDates] };
}
export function predictMastery(memory, date = today()) {
  if (!memory) return 0;
  // A rolled-back system clock must never extrapolate before the curve origin.
  const elapsed = Math.max(0, daysBetween(memory.lastInterventionDate, date));
  return memory.baseMastery * Math.pow(memory.retentionPerDay, elapsed);
}
export function currentMastery(state, id, date = today()) {
  return predictMastery(state.memory[id], date) * 100;
}
export function review(memory, percent, date = today()) {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('复习后掌握度必须大于当前值且不超过 100');
  if (!memory) return initializeMemory(percent, date);
  validateMemory(memory, true, true);
  const tau = daysBetween(memory.lastInterventionDate, date);
  const total = daysBetween(memory.initialLearnedDate, date);
  if (tau < 0 || total < 0) throw new Error('系统日期早于学习记录，请校正系统日期后再复习');
  const pre = predictMastery(memory, date);
  const next = percent / 100;
  if (percent <= pre * 100 || next <= pre) throw new Error('只能提高当前预测掌握度；降低或保持原值不计为复习');
  if (total === 0) return { ...memory, baseMastery: next, retentionPerDay: 0.5 };
  if (tau === 0) {
    const origin = memory.reviewOrigin;
    if (!origin) throw new Error('旧记录缺少当天修改前的曲线，无法准确覆盖；原记录已保留，次日可继续复习');
    return applyReview(origin, next, date);
  }
  return applyReview(curveSnapshot(memory), next, date);
}

function applyReview(origin, next, date) {
  const tau = daysBetween(origin.lastInterventionDate, date);
  if (tau < 1) throw new Error('相邻干预日期必须至少相隔一天');
  const pre = predictMastery(origin, date);
  const r = pre;
  const history = [r, ...origin.recentPreInterventionMasteries.slice(0, 4)];
  const retention = updatedRetention(origin.retentionPerDay, next, tau, pre);
  return { ...origin, lastInterventionDate: date, baseMastery: next, retentionPerDay: retention, recentPreInterventionMasteries: history, recentReviewDates: [date, ...origin.recentReviewDates].slice(0, 5), reviewOrigin: curveSnapshot(origin) };
}

export function updatedRetention(oldP, next, tau, pre) {
  if (!Number.isFinite(pre) || pre < 0 || pre > 1) throw new Error('复习前预测掌握度无效');
  // Keep short-gap calibration; a long gap must not grant the full spacing bonus.
  const spacingCredit = 0.2 + 0.8 * Math.exp(-Math.pow(Math.max(0, tau - 5), 2));
  const gain = 1 + REVIEW_STRENGTH * (tau / (tau + SPACING_DAYS)) * next * spacingCredit;
  const oldStrength = Math.log(0.5) / Math.log(oldP);
  // Remaining recall retains old gains; forgetting to zero resets strength to 1.
  const strength = 1 + Math.sqrt(pre) * (oldStrength * gain - 1);
  const retention = Math.pow(0.5, 1 / strength);
  // The document leaves unrepresentable p=1 unresolved. Never silently clamp it.
  if (!(retention > 0 && retention < 1)) throw new Error('本次计算超出浮点精度范围，无法得到有效遗忘参数；本次复习未保存，请保留原记录');
  return retention;
}

export function migrateMinimumMemory(memory) {
  if (memory === null) return null;
  validateMemory(memory);
  const total = daysBetween(memory.initialLearnedDate, memory.lastInterventionDate);
  // With T=0 every intervention is pure continuation, independent of the statistic.
  if (total === 0) return { ...memory, recentPreInterventionMasteries: [...memory.recentPreInterventionMasteries] };
  const [pre, ...older] = memory.recentPreInterventionMasteries;
  if (older.every(value => value === 0) && pre > 0) {
    // v2 stores no event log. A single review is recoverable from its pre-value,
    // the initial p=0.5 and the unchanged initial/last dates. Verify the old curve.
    const initial = pre / Math.pow(0.5, total);
    const oldRetention = (0.5 * total + Math.pow(0.5, pre / memory.baseMastery)) / (1 + total);
    if (initial > 0 && initial <= 1 && Math.abs(oldRetention - memory.retentionPerDay) <= 1e-14) {
      const rMean = pre / 5;
      const delta = 1 - 1 / (0.2 * total + 1);
      const a = 1 - delta * rMean;
      const retentionPerDay = (0.5 * a * total + Math.pow(0.5, pre / memory.baseMastery)) / (1 + a * total);
      return { ...memory, retentionPerDay, recentPreInterventionMasteries: [...memory.recentPreInterventionMasteries] };
    }
  }
  throw new Error('旧版记录缺少完整复习日期和输入，无法准确重算平均值算法；原记录未覆盖，请保留备份并补充复习历史');
}
