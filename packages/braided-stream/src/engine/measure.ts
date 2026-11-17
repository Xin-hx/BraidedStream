import type { ProbabilityMeasure } from "../input.js";

export interface MeasureMoments {
  readonly mean: number;
  readonly variance: number;
  readonly standardDeviation: number;
}

export interface MeasureDeviations {
  readonly deviationLow: number;
  readonly deviationHigh: number;
  readonly dispersion: number;
}

export function measureCdf(measure: ProbabilityMeasure, value: number): number {
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(value)) throw new Error("CDF value must be finite or infinite");
  return clamp01(compensatedSum(measure.components.map((component) => {
    if (component.kind === "atom") return component.value <= value ? component.mass : 0;
    if (value <= component.low) return 0;
    if (value >= component.high) return component.mass;
    return component.mass * (value - component.low) / (component.high - component.low);
  })));
}

/** Generalized lower inverse inf{x:F(x)>=p}, including jumps and flat CDF intervals. */
export function measureQuantile(measure: ProbabilityMeasure, probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("quantile probability must be in [0, 1]");
  }
  const coordinates = [...new Set(measure.components.flatMap((component) => component.kind === "atom"
    ? [component.value]
    : [component.low, component.high]))].sort((a, b) => a - b);
  if (!coordinates.length) return Number.NaN;
  if (probability === 0) return coordinates[0];
  for (let index = 0; index < coordinates.length; index += 1) {
    const left = coordinates[index];
    const leftCdf = measureCdf(measure, left);
    if (leftCdf >= probability) return left;
    const right = coordinates[index + 1];
    if (right === undefined) return left;
    const slope = compensatedSum(measure.components.map((component) => component.kind === "uniform" &&
      component.low <= left && component.high >= right
      ? component.mass / (component.high - component.low)
      : 0));
    if (slope > 0 && leftCdf + slope * (right - left) >= probability) {
      return Math.min(right, left + (probability - leftCdf) / slope);
    }
  }
  return coordinates.at(-1)!;
}

export function measureMoments(measure: ProbabilityMeasure): MeasureMoments {
  const centers = measure.components.map((component) => component.kind === "atom"
    ? component.value
    : component.low + (component.high - component.low) / 2);
  const mean = compensatedSum(measure.components.map((component, index) => component.mass * centers[index]));
  if (!Number.isFinite(mean)) throw new Error("measure mean is not representable as a finite number");
  const terms = measure.components.map((component, index) => {
    const centered = centers[index] - mean;
    const within = component.kind === "uniform"
      ? ((component.high - component.low) / Math.sqrt(12)) ** 2
      : 0;
    return component.mass * (centered * centered + within);
  });
  const variance = compensatedSum(terms);
  if (!Number.isFinite(variance)) {
    throw new Error("measure variance is not representable as a finite number");
  }
  return { mean, variance, standardDeviation: Math.sqrt(variance) };
}

export function measureDeviations(measure: ProbabilityMeasure, representative: number): MeasureDeviations {
  let deviationLow = 0;
  let deviationHigh = 0;
  for (const component of measure.components) {
    if (component.kind === "atom") {
      deviationLow += component.mass * Math.max(0, representative - component.value);
      deviationHigh += component.mass * Math.max(0, component.value - representative);
      continue;
    }
    const width = component.high - component.low;
    if (representative >= component.high) {
      deviationLow += component.mass * (representative - (component.low + component.high) / 2);
    } else if (representative > component.low) {
      deviationLow += component.mass * (representative - component.low) ** 2 / (2 * width);
    }
    if (representative <= component.low) {
      deviationHigh += component.mass * ((component.low + component.high) / 2 - representative);
    } else if (representative < component.high) {
      deviationHigh += component.mass * (component.high - representative) ** 2 / (2 * width);
    }
  }
  return { deviationLow, deviationHigh, dispersion: deviationLow + deviationHigh };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function compensatedSum(values: readonly number[]): number {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value)
      ? sum - next + value
      : value - next + sum;
    sum = next;
  }
  return sum + correction;
}
