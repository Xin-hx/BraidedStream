import type { PreparedDataset, QuantileBands } from "../core/types";

export interface TransformResult {
  dataset: PreparedDataset;
  notes: string[];
}

export function preprocessDataset(source: PreparedDataset): TransformResult {
  const times = source.times.slice();
  const layers = source.layers.map((layer) => ({
    ...layer,
    mean: layer.mean.slice(),
    unc: layer.unc?.slice(),
    poportionUnc: layer.poportionUnc?.slice(),
    lower: layer.lower?.slice(),
    upper: layer.upper?.slice(),
    quantiles: layer.quantiles ? cloneQuantiles(layer.quantiles) : undefined
  }));

  return {
    dataset: {
      times,
      layers,
      order: source.order.filter((id) => layers.some((layer) => layer.id === id))
    },
    notes: []
  };
}

function cloneQuantiles(source: QuantileBands): QuantileBands {
  const out: QuantileBands = {
    p05: source.p05.slice(),
    p25: source.p25.slice(),
    p50: source.p50.slice(),
    p75: source.p75.slice(),
    p95: source.p95.slice()
  };
  for (const [key, series] of Object.entries(source)) {
    out[key] = series.slice();
  }
  return out;
}
