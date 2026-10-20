import { daysBetween, predictMastery, validateMemory, updatedRetention } from './memory.js';

const close = (a, b) => Math.abs(a - b) <= 1e-14;
function snapshot(memory, dates) {
  return { initialLearnedDate: memory.initialLearnedDate, lastInterventionDate: memory.lastInterventionDate,
    baseMastery: memory.baseMastery, retentionPerDay: memory.retentionPerDay,
    recentPreInterventionMasteries: [...memory.recentPreInterventionMasteries], recentReviewDates: [...dates] };
}
function oldRetention(origin, memory) {
  const tau = daysBetween(origin.lastInterventionDate, memory.lastInterventionDate);
  const total = daysBetween(memory.initialLearnedDate, memory.lastInterventionDate);
  const mean = memory.recentPreInterventionMasteries.reduce((a, b) => a + b, 0) / 5;
  const a = 1 - (1 - 1 / (0.2 * total + 1)) * mean;
  return (0.5 * a * tau + origin.retentionPerDay ** (memory.recentPreInterventionMasteries[0] / memory.baseMastery)) / (1 + a * tau);
}

// Recover only origins verified against the saved old formula and r window.
// Backups supply dates; never infer arbitrary dates from the current rate alone.
function recover(memory, backups) {
  validateMemory(memory);
  if (memory.initialLearnedDate === memory.lastInterventionDate) return { curve: snapshot(memory, []), origin: null };
  const [pre, ...older] = memory.recentPreInterventionMasteries;
  const candidates = [memory.reviewOrigin, ...backups].filter(Boolean);
  const total = daysBetween(memory.initialLearnedDate, memory.lastInterventionDate);
  if (pre > 0 && older.every(r => r === 0)) {
    const initial = pre / 0.5 ** total;
    if (initial > 0 && initial <= 1) candidates.push({ initialLearnedDate: memory.initialLearnedDate,
      lastInterventionDate: memory.initialLearnedDate, baseMastery: initial, retentionPerDay: .5,
      recentPreInterventionMasteries: [0, 0, 0, 0, 0] });
  }
  for (const candidate of candidates) {
    try {
      validateMemory(candidate);
      if (candidate.initialLearnedDate !== memory.initialLearnedDate || daysBetween(candidate.lastInterventionDate, memory.lastInterventionDate) < 1) continue;
      if (!close(predictMastery(candidate, memory.lastInterventionDate), pre) || !close(oldRetention(candidate, memory), memory.retentionPerDay)) continue;
      if (!older.every((r, i) => close(r, candidate.recentPreInterventionMasteries[i]))) continue;
      const origin = recover(candidate, backups).curve;
      return { curve: snapshot(memory, [memory.lastInterventionDate, ...origin.recentReviewDates].slice(0, 5)), origin };
    } catch { /* Try another independently saved snapshot. */ }
  }
  throw new Error('缺少完整复习日期或复习前曲线，无法准确重算；请保留原记录并补充旧备份');
}

export function migrateWindowMemory(memory, backups = []) {
  if (memory === null) return null;
  const { curve, origin } = recover(memory, backups);
  // Historical r values stay byte-for-byte numeric equivalents, even when
  // legacy initial-day edits now collapse to a single initial learning event.
  if (!origin) return { ...curve, retentionPerDay: .5, reviewOrigin: null };
  const tau = daysBetween(origin.lastInterventionDate, curve.lastInterventionDate);
  return { ...curve, retentionPerDay: updatedRetention(origin.retentionPerDay, curve.baseMastery, tau, predictMastery(origin, curve.lastInterventionDate)), reviewOrigin: origin };
}

export function migrateRecallMemory(memory) {
  if (memory === null) return null;
  validateMemory(memory, true, true);
  if (memory.initialLearnedDate === memory.lastInterventionDate) return { ...memory, retentionPerDay: .5 };
  const origin = memory.reviewOrigin;
  if (!origin) throw new Error('缺少最近复习前的曲线，无法准确重算；原记录已保留');
  const tau = daysBetween(origin.lastInterventionDate, memory.lastInterventionDate);
  return { ...memory, retentionPerDay: updatedRetention(origin.retentionPerDay, memory.baseMastery, tau, predictMastery(origin, memory.lastInterventionDate)) };
}
