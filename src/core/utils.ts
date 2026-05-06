/**
 * Shared, dependency-free helpers for core algorithms.
 *
 * Keep this file limited to small pure utilities so the algorithm modules can
 * stay focused on their own layout, ordering, and data-preparation logic.
 */

export const EPSILON = 1e-12;

/** Clamp a value into the inclusive [low, high] interval. */
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Clamp a value into [0, 1]. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Return a finite number or the provided fallback. */
export function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

/** Return the first finite number in a candidate list, or 0 if none exists. */
export function firstFinite(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value as number;
    }
  }
  return 0;
}

/** Return two values in ascending order. */
export function sortPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** Sum a numeric array without pulling in a rendering dependency. */
export function sum(values: number[]): number {
  let out = 0;
  for (const value of values) {
    out += value;
  }
  return out;
}

/** Sum absolute values. */
export function sumAbs(values: number[]): number {
  let out = 0;
  for (const value of values) {
    out += Math.abs(value);
  }
  return out;
}

/** Compute the arithmetic mean, returning 0 for empty arrays. */
export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/** Compute the arithmetic mean of finite values only. */
export function meanFinite(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? 0 : mean(finite);
}

/** Compute the median of a copy of the input array. */
export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return 0.5 * (sorted[mid - 1] + sorted[mid]);
}

/** Return a nearest-rank quantile from a copy of the input array. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

/** Normalize a series into [0, 1], returning zeros for flat input. */
export function normalize01(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }
  const range = maxValue - minValue;
  if (range <= EPSILON) {
    return new Array<number>(values.length).fill(0);
  }
  return values.map((value) => (value - minValue) / range);
}

/** Round to a fixed number of decimal digits. */
export function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Build an integer half-open range [start, endExclusive). */
export function range(start: number, endExclusive: number): number[] {
  const out: number[] = [];
  for (let value = start; value < endExclusive; value += 1) {
    out.push(value);
  }
  return out;
}

/** Parse a finite number from unknown CSV/user input. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/** Test finite numeric closeness with a small tolerance. */
export function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

/** Return whether at least one value is finite. */
export function hasFinite(values: number[]): boolean {
  return values.some((value) => Number.isFinite(value));
}

/** Deterministically shuffle integer indices with a small seeded PRNG. */
export function seededShuffleIndices(count: number, seed: number): number[] {
  const out = Array.from({ length: count }, (_value, index) => index);
  const random = mulberry32(normalizeSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 1;
  }
  return (Math.floor(seed) >>> 0) || 1;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
