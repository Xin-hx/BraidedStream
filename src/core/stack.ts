import type { LayerInput, StackLayout } from "./types";

export function computeStackedBoundaries(baseline: number[], orderedLayers: LayerInput[]): StackLayout {
  const tLength = baseline.length;
  const kLength = orderedLayers.length;
  const yBottom = Array.from({ length: kLength }, () => new Array<number>(tLength).fill(0));
  const yTop = Array.from({ length: kLength }, () => new Array<number>(tLength).fill(0));

  for (let t = 0; t < tLength; t += 1) {
    let cumulative = 0;
    for (let k = 0; k < kLength; k += 1) {
      const mean = orderedLayers[k].mean[t];
      const bottom = baseline[t] + cumulative;
      const top = bottom + mean;
      yBottom[k][t] = bottom;
      yTop[k][t] = top;
      cumulative += mean;
    }
  }

  return { baseline: baseline.slice(), yBottom, yTop };
}
