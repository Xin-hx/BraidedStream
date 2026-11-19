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
  return measureQuantiles(measure, [probability])[0];
}

/** Sweep atoms and interval endpoints once, preserving jumps and lower inverses. */
export function measureQuantiles(measure: ProbabilityMeasure, probabilities: readonly number[]): number[] {
  if (probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) {
    throw new Error("quantile probability must be in [0, 1]");
  }
  const events = measure.components.flatMap(component => component.kind === "atom"
    ? [{ x: component.value, mass: component.mass, slope: 0, count: 0 }]
    : [
      { x: component.low, mass: 0, slope: component.mass / (component.high - component.low), count: 1 },
      { x: component.high, mass: 0, slope: -component.mass / (component.high - component.low), count: -1 },
    ]).sort((a, b) => a.x - b.x);
  // Extreme interval widths can overflow or underflow a density; invert the CDF directly instead.
  if (events.some(event => event.count !== 0 && (!Number.isFinite(event.slope) || event.slope === 0))) {
    const coordinates = [...new Set(events.map(event => event.x))];
    return probabilities.map(p => {
      if (p === 0) return coordinates[0];
      let left = 0;
      let right = coordinates.length - 1;
      while (left < right) {
        const mid = (left + right) >>> 1;
        if (measureCdf(measure, coordinates[mid]) >= p) right = mid; else left = mid + 1;
      }
      let low = coordinates[Math.max(0, left - 1)];
      let high = coordinates[left];
      for (;;) {
        const mid = low + (high - low) / 2;
        if (mid === low || mid === high) return high;
        if (measureCdf(measure, mid) >= p) high = mid; else low = mid;
      }
    });
  }
  const queries = probabilities.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const values = new Array<number>(probabilities.length).fill(events.at(-1)?.x ?? Number.NaN);
  const mass = accumulator();
  let slope = accumulator();
  let active = 0;
  let previous = events[0]?.x ?? 0;
  let query = 0;
  for (let index = 0; index < events.length;) {
    const x = events[index].x;
    const before = mass.value();
    const density = Math.max(0, slope.value());
    mass.add(density * (x - previous));
    while (query < queries.length && queries[query].p <= mass.value()) {
      const { p, index: output } = queries[query++];
      values[output] = density > 0 ? Math.min(x, previous + Math.max(0, p - before) / density) : previous;
    }
    do {
      const event = events[index++];
      mass.add(event.mass); slope.add(event.slope); active += event.count;
    } while (index < events.length && events[index].x === x);
    if (!active) slope = accumulator();
    while (query < queries.length && queries[query].p <= mass.value()) {
      values[queries[query++].index] = x;
    }
    previous = x;
  }
  return values;
}

function accumulator() {
  let sum = 0;
  let correction = 0;
  return {
    add(value: number) {
      const next = sum + value;
      correction += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    },
    value: () => sum + correction,
  };
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
