/**
 * Basic stack geometry construction from a baseline and ordered layers.
 */
import type { BraidLayout, BraidOptimizationDiagnostics, LayerInput, StackLayout } from "./types";

/** Convert layer thickness series into bottom/top boundaries. */
export function computeStackedBoundaries(baseline: number[], orderedLayers: LayerInput[]): StackLayout {
  const tLength = baseline.length;
  const kLength = orderedLayers.length;
  const yBottom = Array.from({ length: kLength }, () => new Array<number>(tLength).fill(0));
  const yTop = Array.from({ length: kLength }, () => new Array<number>(tLength).fill(0));

  for (let t = 0; t < tLength; t += 1) {
    // Build a vertical stack at each time sample: baseline + cumulative layer thickness.
    let cumulative = 0;
    for (let k = 0; k < kLength; k += 1) {
      const mean = orderedLayers[k].height[t];
      const bottom = baseline[t] + cumulative;
      const top = bottom + mean;
      yBottom[k][t] = bottom;
      yTop[k][t] = top;
      cumulative += mean;
    }
  }

  // Keep baseline immutable to avoid accidental downstream mutation.
  return { baseline: baseline.slice(), yBottom, yTop };
}

/** Wrap a plain stack layout in the BraidLayout shape expected by comparison code. */
export function stackToBraidLayout(layout: StackLayout, diagnostics?: BraidOptimizationDiagnostics): BraidLayout {
  const tLength = layout.baseline.length;
  const gapCount = Math.max(0, layout.yBottom.length - 1);
  return {
    baseline: layout.baseline.slice(),
    yBottom: layout.yBottom.map((row) => row.slice()),
    yTop: layout.yTop.map((row) => row.slice()),
    omega: new Array<number>(tLength).fill(0),
    gapsPx: Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0)),
    gapsValue: Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0)),
    sumGapPx: new Array<number>(tLength).fill(0),
    roiSupport: null,
    ...(diagnostics ? { diagnostics } : {})
  };
}
