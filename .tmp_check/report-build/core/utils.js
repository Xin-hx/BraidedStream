/**
 * Shared dependency-free numeric helpers for core algorithms.
 */
export const EPSILON = 1e-12;
export const FIXED_SEED = 40; // 随机数
/** Prefix a caller-provided seed with the project fixed seed. */
export function withFixedSeed(seedLike, fixedSeed = FIXED_SEED) {
    return `${fixedSeed}:${seedLike}`;
}
/** Return deterministically shuffled indices [0, length) for a numeric seed. */
export function seededShuffleIndices(length, seed) {
    const indices = range(0, length);
    let state = seed >>> 0;
    for (let i = indices.length - 1; i > 0; i -= 1) {
        state = nextRandomState(state);
        const j = state % (i + 1);
        const tmp = indices[i];
        indices[i] = indices[j];
        indices[j] = tmp;
    }
    return indices;
}
function nextRandomState(state) {
    return (Math.imul(1664525, state) + 1013904223) >>> 0;
}
/** Clamp a value into the inclusive [low, high] interval. */
export function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}
/** Clamp a value into [0, 1]. */
export function clamp01(value) {
    return clamp(value, 0, 1);
}
/** Return a finite number or the provided fallback. */
export function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}
/** Return the first finite number in a candidate list, or 0 if none exists. */
export function firstFinite(...values) {
    for (const value of values) {
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return 0;
}
/** Return two values in ascending order. */
export function sortPair(a, b) {
    return a <= b ? [a, b] : [b, a];
}
/** Sum a numeric array without pulling in a rendering dependency. */
export function sum(values) {
    let out = 0;
    for (const value of values) {
        out += value;
    }
    return out;
}
/** Sum absolute values. */
export function sumAbs(values) {
    let out = 0;
    for (const value of values) {
        out += Math.abs(value);
    }
    return out;
}
/** Compute the arithmetic mean, returning 0 for empty arrays. */
export function mean(values) {
    return values.length === 0 ? 0 : sum(values) / values.length;
}
/** Compute the arithmetic mean of finite values only. */
export function meanFinite(values) {
    const finite = values.filter((value) => Number.isFinite(value));
    return finite.length === 0 ? 0 : mean(finite);
}
/** Compute the median of a copy of the input array. */
export function median(values) {
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
export function percentile(values, q) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[idx];
}
/** Normalize a series into [0, 1], returning zeros for flat input. */
export function normalize01(values) {
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
        return new Array(values.length).fill(0);
    }
    return values.map((value) => (value - minValue) / range);
}
/** Round to a fixed number of decimal digits. */
export function round(value, digits) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}
/** Build an integer half-open range [start, endExclusive). */
export function range(start, endExclusive) {
    const out = [];
    for (let value = start; value < endExclusive; value += 1) {
        out.push(value);
    }
    return out;
}
/** Parse a finite number from unknown CSV/user input. */
export function toFiniteNumber(value) {
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
export function nearlyEqual(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}
/** Return whether at least one value is finite. */
export function hasFinite(values) {
    return values.some((value) => Number.isFinite(value));
}
