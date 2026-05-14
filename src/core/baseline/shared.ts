import type { LayerInput } from "../types";

export function sumLayerMeans(tLength: number, layers: LayerInput[]): number[] {
  const totals = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 0; t < tLength; t += 1) {
      totals[t] += layer.mean[t];
    }
  }
  return totals;
}

export function centeredBaselineFromLayers(tLength: number, layers: LayerInput[]): number[] {
  const totals = sumLayerMeans(tLength, layers);
  return totals.map((v) => -0.5 * v);
}

export function buildCenterLineDerivativeOffsets(tLength: number, layers: LayerInput[]): number[][] {
  const offsets: number[][] = Array.from({ length: tLength }, () => []);
  if (tLength <= 1 || layers.length === 0) {
    return offsets;
  }
  const prefix = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 1; t < tLength; t += 1) {
      const centerNow = prefix[t] + 0.5 * layer.mean[t];
      const centerPrev = prefix[t - 1] + 0.5 * layer.mean[t - 1];
      offsets[t].push(centerNow - centerPrev);
    }
    for (let t = 0; t < tLength; t += 1) {
      prefix[t] += layer.mean[t];
    }
  }
  return offsets;
}

