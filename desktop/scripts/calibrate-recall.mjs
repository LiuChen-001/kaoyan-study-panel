import assert from 'node:assert/strict';

function rates(C, B, gaps) {
  let p = .5;
  return gaps.map(tau => {
    const r = .9 * p ** tau;
    const strength = Math.log(.5) / Math.log(p);
    const credit = .2 + .8 * Math.exp(-(Math.max(0, tau - 5) ** 2));
    const gain = 1 + C * tau / (tau + B) * .9 * credit;
    p = .5 ** (1 / (1 + Math.sqrt(r) * (strength * gain - 1)));
    return p;
  });
}
function bisect(valueAt, target, lower, upper) {
  assert.ok(valueAt(lower) < target && valueAt(upper) > target);
  for (let i = 0; i < 100; i++) {
    const middle = (lower + upper) / 2;
    if (valueAt(middle) < target) lower = middle; else upper = middle;
  }
  return (lower + upper) / 2;
}
// With daily gaps only C/(1+B) matters. Fit that ratio, then the spacing scale.
const ratio = bisect(C => rates(C, 0, [1, 1, 1]).at(-1), .9, 0, 10);
const B = bisect(B => rates(ratio * (1 + B), B, [1, 2, 5]).at(-1), .96, 0, 1000);
const C = ratio * (1 + B);
const daily = rates(C, B, [1, 1, 1]);
const spaced = rates(C, B, [1, 2, 5]);
assert.ok(Math.abs(daily.at(-1) - .9) < 1e-13);
assert.ok(Math.abs(spaced.at(-1) - .96) < 1e-13);
console.log(JSON.stringify({ C, B, daily, spaced }, null, 2));
