/**
 * Shared one-dimensional time-series helpers for core algorithms.
 */

/** First difference with a zero at index 0. */
export function diffSeries(values: number[]): number[] {
  const out = new Array<number>(values.length).fill(0);
  for (let t = 1; t < values.length; t += 1) {
    out[t] = values[t] - values[t - 1];
  }
  return out;
}

/** Centered moving average with clamped endpoints. */
export function movingAverage(values: number[], window: number): number[] {
  const n = values.length;
  if (n === 0) {
    return [];
  }
  const w = Math.max(1, Math.round(window));
  const half = Math.floor(w / 2);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const left = Math.max(0, i - half);
    const right = Math.min(n - 1, i + half);
    let acc = 0;
    let count = 0;
    for (let j = left; j <= right; j += 1) {
      acc += values[j];
      count += 1;
    }
    out[i] = acc / Math.max(1, count);
  }
  return out;
}

/** Remove the arithmetic mean from a series. */
export function removeMean(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let meanValue = 0;
  for (const value of values) {
    meanValue += value;
  }
  meanValue /= Math.max(1, values.length);
  return values.map((value) => value - meanValue);
}

/** Mean absolute first step of a series. */
export function meanAbsStep(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  let acc = 0;
  for (let t = 1; t < values.length; t += 1) {
    acc += Math.abs(values[t] - values[t - 1]);
  }
  return acc / Math.max(1, values.length - 1);
}

/** Maximum absolute first step of a series. */
export function maxAbsStep(values: number[]): number {
  let out = 0;
  for (let t = 1; t < values.length; t += 1) {
    out = Math.max(out, Math.abs(values[t] - values[t - 1]));
  }
  return out;
}

/** Mean absolute second difference of a series. */
export function meanCurvature(values: number[]): number {
  if (values.length <= 2) {
    return 0;
  }
  let acc = 0;
  for (let t = 2; t < values.length; t += 1) {
    acc += Math.abs(values[t] - 2 * values[t - 1] + values[t - 2]);
  }
  return acc / Math.max(1, values.length - 2);
}
