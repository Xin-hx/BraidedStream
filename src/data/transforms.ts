import type { PreparedDataset, QuantileBands } from "../core/types";

export interface TransformResult {
  dataset: PreparedDataset;
  notes: string[];
}

export function preprocessDataset(source: PreparedDataset): TransformResult {
  const times = source.times.slice();
  const notes: string[] = [];
  const layers = source.layers.map((layer) => normalizeLayerToTimeline(layer, times, notes));

  return {
    dataset: {
      times,
      layers,
      order: source.order.filter((id) => layers.some((layer) => layer.id === id))
    },
    notes
  };
}

function normalizeLayerToTimeline(
  layer: PreparedDataset["layers"][number],
  times: number[],
  notes: string[]
): PreparedDataset["layers"][number] {
  const normalizeRequired = (series: number[]) =>
    normalizeSeriesByTimeKeys(
      series,
      times,
      layer.timeKeys,
      `layer=${layer.id}`,
      notes
    );
  const normalizeOptional = (series?: number[]) =>
    series ? normalizeSeriesByTimeKeys(series, times, layer.timeKeys, `layer=${layer.id}`, notes) : undefined;

  return {
    ...layer,
    timeKeys: undefined,
    height: normalizeRequired(layer.height),
    unc: normalizeOptional(layer.unc),
    poportionMean: normalizeOptional(layer.poportionMean),
    poportionUnc: normalizeOptional(layer.poportionUnc),
    poportionLower: normalizeOptional(layer.poportionLower),
    poportionUpper: normalizeOptional(layer.poportionUpper),
    lower: normalizeOptional(layer.lower),
    upper: normalizeOptional(layer.upper),
    quantiles: layer.quantiles ? normalizeQuantiles(layer.quantiles, times, layer.timeKeys, layer.id, notes) : undefined,
    poportionQuantiles: layer.poportionQuantiles
      ? normalizeQuantiles(layer.poportionQuantiles, times, layer.timeKeys, `${layer.id}|poportion`, notes)
      : undefined
  };
}

function normalizeQuantiles(
  source: QuantileBands,
  times: number[],
  timeKeys: number[] | undefined,
  layerId: string,
  notes: string[]
): QuantileBands {
  const out: QuantileBands = {
    p05: [],
    p25: [],
    p50: [],
    p75: [],
    p95: []
  };
  for (const [key, series] of Object.entries(source)) {
    out[key] = normalizeSeriesByTimeKeys(series, times, timeKeys, `layer=${layerId}|quantile=${key}`, notes);
  }
  return out;
}

function normalizeSeriesByTimeKeys(
  series: number[],
  timeline: number[],
  timeKeys: number[] | undefined,
  label: string,
  notes: string[]
): number[] {
  const targetLength = timeline.length;
  // Preferred path: align by explicit time keys.
  if (timeKeys && timeKeys.length > 0) {
    const byTime = new Map<number, number>();
    const length = Math.min(timeKeys.length, series.length);
    for (let i = 0; i < length; i += 1) {
      const time = timeKeys[i];
      const value = series[i];
      byTime.set(time, Number.isFinite(value) ? value : 0);
    }
    return timeline.map((time) => {
      const value = byTime.get(time);
      return value !== undefined && Number.isFinite(value) ? value : 0;
    });
  }

  // Fallback: positional alignment when upstream data did not provide keys.
  if (series.length !== targetLength) {
    notes.push(`${label}: missing timeKeys, fell back to positional normalization`);
  }
  const out = new Array<number>(targetLength).fill(0);
  const copyLength = Math.min(series.length, targetLength);
  for (let i = 0; i < copyLength; i += 1) {
    const value = series[i];
    out[i] = Number.isFinite(value) ? value : 0;
  }
  return out;
}
