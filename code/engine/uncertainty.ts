/** Resolve a normalized uncertainty input for continuous deformation. */
import type { Layer, UncertaintyResult } from "../types";

export function computeUncertainty(
  layers: Layer[],
  epsilon = 1e-9,
  focusPercent = 10,
): UncertaintyResult {
  const tLen = layers[0].q.p50.length;
  const value = layers.map((layer) => {
    if (layer.uncertainty) {
      if (layer.uncertainty.length !== tLen) {
        throw new Error(`layer ${layer.id}: uncertainty length mismatch`);
      }
      return layer.uncertainty.map((u, t) => {
        if (!Number.isFinite(u) || u < 0 || u > 1) {
          throw new Error(`layer ${layer.id}: uncertainty[${t}] must be in [0, 1]`);
        }
        return u;
      });
    }
    const lo = layer.q.p025;
    const hi = layer.q.p975;
    return Array.from({ length: tLen }, (_, t) => {
      const value = (hi[t] - lo[t]) / (hi[t] + epsilon);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    });
  });

  const rank = percentileRanks(value);
  return { value, rank, exposure: exposureFromRanks(value, rank, focusPercent) };
}

/** Top-p percentile ramp. Zero uncertainty remains unexposed even when all values tie. */
export function exposureFromRanks(
  value: number[][],
  rank: number[][],
  focusPercent: number,
): number[][] {
  if (!Number.isFinite(focusPercent) || focusPercent < 0 || focusPercent > 100) {
    throw new Error("uncertaintyFocusPercent must be in [0, 100]");
  }
  if (focusPercent === 0) return value.map((row) => row.map(() => 0));
  const threshold = 1 - focusPercent / 100;
  return rank.map((row, i) => row.map((r, t) =>
    value[i][t] <= 0 || r < threshold
      ? 0
      : (r - threshold) / (1 - threshold)
  ));
}

function percentileRanks(values: number[][]): number[][] {
  const sorted = values.flat().sort((a, b) => a - b);
  const rank = new Map<number, number>();
  sorted.forEach((value, i) => rank.set(value, (i + 1) / sorted.length));
  return values.map((row) => row.map((value) => rank.get(value)!));
}
