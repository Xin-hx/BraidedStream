/** Resolve normalized values used only by non-braided comparison encodings. */
import type { Layer, UncertaintyResult } from "../types";

export function computeUncertainty(
  layers: Layer[],
  epsilon = 1e-9,
  threshold = 0.9,
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
  return { value, rank, exposure: exposureFromRanks(value, rank, threshold) };
}

/** Midrank ramp for comparison encodings; it is not used by braided geometry. */
export function exposureFromRanks(
  value: number[][],
  rank: number[][],
  threshold: number,
): number[][] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("uncertaintyThreshold must be in [0, 1]");
  }
  if (threshold === 1) return value.map((row) => row.map(() => 0));
  return rank.map((row, i) => row.map((r, t) =>
    value[i][t] <= 0 || r <= threshold
      ? 0
      : (r - threshold) / (1 - threshold)
  ));
}

function percentileRanks(values: number[][]): number[][] {
  const sorted = values.flat().sort((a, b) => a - b);
  const rank = new Map<number, number>();
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end] === sorted[start]) end += 1;
    rank.set(sorted[start], ((start + 1) + end) / (2 * sorted.length));
    start = end;
  }
  return values.map((row) => row.map((value) => rank.get(value)!));
}
