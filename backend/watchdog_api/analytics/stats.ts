/**
 * Computes the ratio, scaled to percentage if percentage = true.
 * Denominators <= 0 return null explicitly.
 */
export function calculateRatio(numerator: number, denominator: number, percentage = true): number | null {
  if (denominator <= 0) return null;
  const r = numerator / denominator;
  return percentage ? r * 100 : r;
}

/**
 * Normalizes an array of values against its maximum, scaled to percentage if percentage = true.
 * If max is 0, throws an explicit failure (valid max > 0 is required).
 */
export function normalizeMax(values: number[], percentage = true): number[] {
  const validValues = values.filter(v => v >= 0);
  if (validValues.length === 0) throw new Error("No valid positive values found.");
  
  const max = Math.max(...validValues);
  if (max <= 0) throw new Error("Maximum valid value must be > 0.");
  
  return values.map(v => {
    if (v < 0) return NaN; // handle invalid separately, using NaN for uncomputable in array returns
    const r = v / max;
    return percentage ? r * 100 : r;
  });
}

export function pearson(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) throw new Error("Arrays must have same length > 0");
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumSqX = x.reduce((a, b) => a + b * b, 0);
  const sumSqY = y.reduce((a, b) => a + b * b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);

  const num = (n * sumXY) - (sumX * sumY);
  const den = Math.sqrt(((n * sumSqX) - (sumX * sumX)) * ((n * sumSqY) - (sumY * sumY)));
  if (den === 0) return 0;
  return num / den;
}

export function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) throw new Error("Arrays must have same length > 0");
  const rank = (arr: number[]) => {
    const sorted = [...arr].map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
    const ranks = new Array(arr.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length - 1 && sorted[j].val === sorted[j + 1].val) j++;
      const avgRank = (i + j + 2) / 2;
      for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  return pearson(rank(x), rank(y));
}
