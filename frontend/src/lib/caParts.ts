// The parts of continuous assessment a school can weight, in the order teachers think of them: key, short label, long label.
export const caPartLabels = [['exercises', 'Class exercises', 'Class exercises and quizzes'], ['homework', 'Homework', 'Homework'], ['tests', 'Class tests', 'Class tests'], ['projects', 'Projects', 'Projects']] as const;
export type CaPartKey = typeof caPartLabels[number][0];
export type CaPartValues = Record<CaPartKey, number>;

// The server keeps each part as its share of the CA out of 100, and every mark is recorded out of 100. People set the scheme
// in points of the final score (exercises 15 + homework 15 + class tests 20 = a CA of 50), so the form converts both ways.
// Splits `total` across the parts in proportion to `weights` to `decimals` places, the largest part taking any rounding
// remainder so the parts always add up to the total exactly.
export function distribute(weights: CaPartValues, total: number, decimals: number): CaPartValues {
  const keys = caPartLabels.map(([key]) => key), unit = 10 ** decimals, sum = keys.reduce((n, key) => n + weights[key], 0);
  if (!(sum > 0)) return { ...weights };
  const out = { ...weights };
  let used = 0, largest = keys[0];
  for (const key of keys) { out[key] = Math.round(weights[key] / sum * total * unit); used += out[key]; if (weights[key] > weights[largest]) largest = key; }
  out[largest] += Math.round(total * unit) - used;
  for (const key of keys) out[key] = out[key] / unit;
  return out;
}
// A part's points of the final score, to one decimal.
export const pointsOfFinal = (share: number, caWeight: number) => Math.round(share * caWeight / 10) / 10;
