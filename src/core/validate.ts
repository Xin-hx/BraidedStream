import type { LayerInput } from "./types";

const EPS = 1e-12;

export function validateTimeLengths(times: number[], layers: LayerInput[]): void {
  if (times.length === 0) {
    throw new Error("times must not be empty");
  }
  for (const layer of layers) {
    if (layer.mean.length !== times.length) {
      throw new Error(`Layer ${layer.id} mean length mismatch: expected ${times.length}`);
    }
    if (layer.unc && layer.unc.length !== times.length) {
      throw new Error(`Layer ${layer.id} unc length mismatch: expected ${times.length}`);
    }
    if (layer.poportionUnc && layer.poportionUnc.length !== times.length) {
      throw new Error(`Layer ${layer.id} poportionUnc length mismatch: expected ${times.length}`);
    }
    if (layer.lower && layer.lower.length !== times.length) {
      throw new Error(`Layer ${layer.id} lower length mismatch: expected ${times.length}`);
    }
    if (layer.upper && layer.upper.length !== times.length) {
      throw new Error(`Layer ${layer.id} upper length mismatch: expected ${times.length}`);
    }
    if (layer.quantiles) {
      for (const [quantileKey, series] of Object.entries(layer.quantiles)) {
        if (series.length !== times.length) {
          throw new Error(
            `Layer ${layer.id} quantile length mismatch (${quantileKey}): expected ${times.length}, got ${series.length}`
          );
        }
      }
    }
  }
}

export function orderLayers(layers: LayerInput[], order: string[]): LayerInput[] {
  const byId = new Map<string, LayerInput>(layers.map((layer) => [layer.id, layer]));
  const seen = new Set<string>();
  const ordered: LayerInput[] = [];
  for (const id of order) {
    const layer = byId.get(id);
    if (!layer) {
      throw new Error(`order references unknown layer id: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`order contains duplicate id: ${id}`);
    }
    seen.add(id);
    ordered.push(layer);
  }
  if (ordered.length !== layers.length) {
    throw new Error("order length must match layers length");
  }
  return ordered;
}

export function layerUncertaintyAt(layer: LayerInput, t: number): number {
  if (layer.quantiles) {
    const values = Object.values(layer.quantiles)
      .map((series) => series[t])
      .filter((v): v is number => Number.isFinite(v));
    if (values.length >= 2) {
      const minV = Math.min(...values);
      const maxV = Math.max(...values);
      return Math.max(0, maxV - minV);
    }
  }
  if (layer.unc) {
    return Math.max(0, layer.unc[t] ?? 0);
  }
  if (layer.lower && layer.upper) {
    return Math.max(0, (layer.upper[t] - layer.lower[t]) * 0.5);
  }
  return 0;
}

export function boundaryUncertaintyAt(a: LayerInput, b: LayerInput, t: number): number {
  return layerUncertaintyAt(a, t) + layerUncertaintyAt(b, t);
}

export function almostEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}
