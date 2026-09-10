/**
 * Geometry costs (METHOD.md M9) — report-only, never part of optimization.
 */
import type { BaseLayout, BraidedLayout, CostReport } from "./types";

/** second difference energy (curvature proxy) of a boundary series */
function curvatureEnergy(y: number[][]): number {
  let e = 0;
  for (const series of y) {
    for (let t = 1; t + 1 < series.length; t += 1) {
      const d2 = series[t + 1] - 2 * series[t] + series[t - 1];
      e += d2 * d2;
    }
  }
  return e;
}

/** first difference energy (slope proxy) */
function slopeEnergy(y: number[][]): number {
  let e = 0;
  for (const series of y) {
    for (let t = 1; t < series.length; t += 1) {
      const d = series[t] - series[t - 1];
      e += d * d;
    }
  }
  return e;
}

export function computeGeometryCosts(
  base: BaseLayout,
  braided: BraidedLayout,
  aReq: number[][],
  h0: number[]
): CostReport {
  const tLen = h0.length;
  let maxRatio = 0;
  let sumRatio = 0;
  let collisionCount = 0;
  let minGap = Infinity;
  let displacement = 0;
  let requestedTotal = 0;
  let allocatedTotal = 0;
  let phaseContinuityMax = 0;

  for (let t = 0; t < tLen; t += 1) {
    const ratio = h0[t] > 0 ? braided.totalHeight[t] / h0[t] : 1;
    if (ratio > maxRatio) maxRatio = ratio;
    sumRatio += ratio;
  }

  const n = base.yBottom.length;
  for (let t = 0; t < tLen; t += 1) {
    for (let i = 0; i + 1 < n; i += 1) {
      const gap = braided.envelopeLow[i + 1][t] - braided.envelopeHigh[i][t];
      if (gap < minGap) minGap = gap;
      if (gap < 0) collisionCount += 1;
    }
  }

  for (let i = 0; i < n; i += 1) {
    for (let t = 0; t < tLen; t += 1) {
      displacement += Math.abs(braided.s[i][t]);
      requestedTotal += aReq[i][t];
      allocatedTotal += braided.aAlloc[i][t];
    }
  }

  return {
    maxHeightRatio: maxRatio,
    meanHeightRatio: sumRatio / Math.max(1, tLen),
    collisionCount,
    minGap,
    curvatureBraided: curvatureEnergy(braided.yTopStar),
    curvatureBase: curvatureEnergy(base.yTop),
    slopeBraided: slopeEnergy(braided.yTopStar),
    slopeBase: slopeEnergy(base.yTop),
    displacement,
    allocRatio: requestedTotal > 0 ? allocatedTotal / requestedTotal : 1,
    phaseContinuityMax,
    requestedTotal,
    allocatedTotal,
  };
}
