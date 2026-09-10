/**
 * Geometry costs (METHOD.md M9) — report-only, never part of optimization.
 */
import type { BaseLayout, BraidedLayout, CostReport } from "../types";

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

/** The two colored outer boundaries that the renderer exposes to the viewer. */
function renderedBoundaryEnergy(
  metric: (boundaries: number[][]) => number,
  lower: number[][],
  upper: number[][],
): number {
  return metric(lower) + metric(upper);
}

export function computeGeometryCosts(
  base: BaseLayout,
  braided: BraidedLayout,
  h0: number[]
): CostReport {
  const tLen = h0.length;
  let maxRatio = 0;
  let sumRatio = 0;
  let collisionCount = 0;
  let minGap = Infinity;
  let displacement = 0;
  let dispersionTotal = 0;

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
      displacement += Math.abs(braided.yBottomStar[i][t] - base.yBottom[i][t]);
      displacement += Math.abs(braided.yTopStar[i][t] - base.yTop[i][t]);
      dispersionTotal += braided.actualSpace[i][t];
    }
  }

  return {
    maxHeightRatio: maxRatio,
    meanHeightRatio: sumRatio / Math.max(1, tLen),
    collisionCount,
    minGap,
    curvatureBraided: renderedBoundaryEnergy(
      curvatureEnergy,
      braided.yBottomStar,
      braided.yTopStar,
    ),
    curvatureBase: renderedBoundaryEnergy(curvatureEnergy, base.yBottom, base.yTop),
    slopeBraided: renderedBoundaryEnergy(
      slopeEnergy,
      braided.yBottomStar,
      braided.yTopStar,
    ),
    slopeBase: renderedBoundaryEnergy(slopeEnergy, base.yBottom, base.yTop),
    displacement,
    dispersionTotal,
  };
}
