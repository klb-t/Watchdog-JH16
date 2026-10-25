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

/**
 * Pearson product-moment correlation coefficient.
 * Returns null when the coefficient is undefined (zero variance in x or y),
 * rather than the misleading value 0.
 */
export function pearson(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length === 0) throw new Error("Arrays must have same length > 0");
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumSqX = x.reduce((a, b) => a + b * b, 0);
  const sumSqY = y.reduce((a, b) => a + b * b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);

  const num = (n * sumXY) - (sumX * sumY);
  const den = Math.sqrt(((n * sumSqX) - (sumX * sumX)) * ((n * sumSqY) - (sumY * sumY)));
  if (den === 0) return null;
  return num / den;
}

/**
 * Equal for ranking: values that differ only by floating-point noise (relative
 * 1e-12) are one value. Mathematically equal quantities computed along
 * different paths (e.g. a ratio after a common scale factor) must tie, or the
 * rank correlation depends on the order of arithmetic.
 */
export const RANK_TIE_RELATIVE_TOLERANCE = 1e-12;
function sameValue(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= RANK_TIE_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length === 0) throw new Error("Arrays must have same length > 0");
  const rank = (arr: number[]) => {
    const sorted = [...arr].map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
    const ranks = new Array(arr.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length - 1 && sameValue(sorted[i].val, sorted[j + 1].val)) j++;
      const avgRank = (i + j + 2) / 2;
      for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  return pearson(rank(x), rank(y));
}

/** Natural log of the gamma function (Lanczos, g = 7). */
function logGamma(z: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued fraction for the regularized incomplete beta function. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; c = 1 + aa / c; d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; c = 1 + aa / c; d = 1 / d;
    const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betaContinuedFraction(a, b, x) / a
    : 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

/**
 * Two-sided p-value of a correlation coefficient under H0: rho = 0, from the
 * t statistic with n - 2 degrees of freedom. Null when it is undefined
 * (fewer than three pairs, or |r| = 1).
 */
export function correlationPValueTwoSided(r: number | null, n: number): number | null {
  if (r === null || !Number.isFinite(r) || n < 3 || Math.abs(r) >= 1) return null;
  const df = n - 2, t = r * Math.sqrt(df / (1 - r * r));
  return regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5);
}
