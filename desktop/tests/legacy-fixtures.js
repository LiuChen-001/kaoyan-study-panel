// Released v3/v4 algorithm, retained solely for migration fixtures.
export function legacyInitial(percent, date) {
  return { initialLearnedDate: date, lastInterventionDate: date, baseMastery: percent / 100,
    retentionPerDay: .5, recentPreInterventionMasteries: [0, 0, 0, 0, 0] };
}
export function legacyReview(origin, percent, date) {
  const tau = (Date.parse(date) - Date.parse(origin.lastInterventionDate)) / 86400000;
  const total = (Date.parse(date) - Date.parse(origin.initialLearnedDate)) / 86400000;
  const pre = origin.baseMastery * origin.retentionPerDay ** tau;
  const history = [pre, ...origin.recentPreInterventionMasteries.slice(0, 4)];
  const a = 1 - (1 - 1 / (.2 * total + 1)) * history.reduce((a, b) => a + b, 0) / 5;
  return { ...origin, lastInterventionDate: date, baseMastery: percent / 100,
    retentionPerDay: (.5 * a * tau + origin.retentionPerDay ** (pre / (percent / 100))) / (1 + a * tau), recentPreInterventionMasteries: history };
}

// Released v6: midpoint r and a fixed denominator of five.
export function windowReview(memory, percent, date) {
  const { reviewOrigin, ...origin } = structuredClone(memory);
  const tau = (Date.parse(date) - Date.parse(origin.lastInterventionDate)) / 86400000;
  const total = (Date.parse(date) - Date.parse(origin.recentReviewDates[4] ?? origin.initialLearnedDate)) / 86400000;
  const next = percent / 100;
  const r = (origin.baseMastery * origin.retentionPerDay ** tau + next) / 2;
  const history = [r, ...origin.recentPreInterventionMasteries.slice(0, 4)];
  const a = 1 - (1 - 1 / (.4 * total + 1)) * history.reduce((a, b) => a + b, 0) / 5;
  return { ...origin, lastInterventionDate: date, baseMastery: next,
    retentionPerDay: (.5 * a * tau + origin.retentionPerDay ** (r / next)) / (1 + a * tau),
    recentPreInterventionMasteries: history, recentReviewDates: [date, ...origin.recentReviewDates].slice(0, 5), reviewOrigin: origin };
}

// Released v7/v8: raw predicted r and the nonzero mean.
export function nonzeroReview(memory, percent, date) {
  const { reviewOrigin, ...origin } = structuredClone(memory);
  const tau = (Date.parse(date) - Date.parse(origin.lastInterventionDate)) / 86400000;
  const total = (Date.parse(date) - Date.parse(origin.recentReviewDates[4] ?? origin.initialLearnedDate)) / 86400000;
  const next = percent / 100;
  const r = origin.baseMastery * origin.retentionPerDay ** tau;
  const history = [r, ...origin.recentPreInterventionMasteries.slice(0, 4)];
  const samples = history.filter(value => value !== 0);
  const mean = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
  const a = 1 - (1 - 1 / (.4 * total + 1)) * mean;
  return { ...origin, lastInterventionDate: date, baseMastery: next,
    retentionPerDay: (.5 * a * tau + origin.retentionPerDay ** (r / next)) / (1 + a * tau),
    recentPreInterventionMasteries: history, recentReviewDates: [date, ...origin.recentReviewDates].slice(0, 5), reviewOrigin: origin };
}

// Released v9: cumulative gains without a pre-review recall correction.
export function cumulativeReview(memory, percent, date) {
  const { reviewOrigin, ...origin } = structuredClone(memory);
  const tau = (Date.parse(date) - Date.parse(origin.lastInterventionDate)) / 86400000;
  const next = percent / 100;
  const pre = origin.baseMastery * origin.retentionPerDay ** tau;
  return { ...origin, lastInterventionDate: date, baseMastery: next,
    retentionPerDay: origin.retentionPerDay ** (1 / (1 + 5.853012470071296 * tau / (tau + 5.028728658482397) * next)),
    recentPreInterventionMasteries: [pre, ...origin.recentPreInterventionMasteries.slice(0, 4)],
    recentReviewDates: [date, ...origin.recentReviewDates].slice(0, 5), reviewOrigin: origin };
}

// Released v10: recall correction with no long-gap spacing discount.
export function recallReview(memory, percent, date) {
  const { reviewOrigin, ...origin } = structuredClone(memory);
  const tau = (Date.parse(date) - Date.parse(origin.lastInterventionDate)) / 86400000;
  const next = percent / 100;
  const pre = origin.baseMastery * origin.retentionPerDay ** tau;
  const strength = Math.log(.5) / Math.log(origin.retentionPerDay);
  const gain = 1 + 28.711284228111044 * tau / (tau + 20.164273571058075) * next;
  return { ...origin, lastInterventionDate: date, baseMastery: next,
    retentionPerDay: .5 ** (1 / (1 + Math.sqrt(pre) * (strength * gain - 1))),
    recentPreInterventionMasteries: [pre, ...origin.recentPreInterventionMasteries.slice(0, 4)],
    recentReviewDates: [date, ...origin.recentReviewDates].slice(0, 5), reviewOrigin: origin };
}
