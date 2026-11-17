/** Derived summaries used only by the two non-braided comparison encodings. */
import type { BraidedQuantiles, UncertaintyResult } from "./types";

export function computeUncertainty(
  quantiles: Array<Array<BraidedQuantiles | null>>,
  epsilon = 1e-9,
  threshold = 0.9,
): UncertaintyResult {
  const value = quantiles.map((layer) => layer.map((cell) => cell
    ? Math.max(0, Math.min(1, (cell.qHigh - cell.qLow) / (cell.qHigh + epsilon)))
    : 0));

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
