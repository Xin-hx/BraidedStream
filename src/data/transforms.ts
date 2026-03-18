import type { AggregationMode, LayerInput, PreparedDataset } from "../core/types";

export interface TransformResult {
  dataset: PreparedDataset;
  notes: string[];
}

export function preprocessDataset(
  source: PreparedDataset,
  smoothingWindow: number,
  downsamplingStep: number,
  aggregationMode: AggregationMode
): TransformResult {
  const notes: string[] = [];
  const smooth = Math.max(1, Math.round(smoothingWindow));
  const step = Math.max(1, Math.round(downsamplingStep));

  let times = source.times.slice();
  let layers = source.layers.map((layer) => ({ ...layer, mean: layer.mean.slice(), unc: layer.unc?.slice() }));

  if (smooth > 1) {
    notes.push(`smoothing=${smooth}`);
    layers = layers.map((layer) => ({
      ...layer,
      mean: movingAverage(layer.mean, smooth),
      unc: layer.unc ? movingAverage(layer.unc, smooth) : undefined
    }));
  }

  if (aggregationMode !== "none") {
    notes.push(`aggregation=${aggregationMode}`);
    layers = layers.map((layer) => ({
      ...layer,
      mean: aggregateSeries(layer.mean, smooth, aggregationMode),
      unc: layer.unc ? aggregateSeries(layer.unc, smooth, aggregationMode) : undefined
    }));
  }

  if (step > 1) {
    notes.push(`downsample=${step}`);
    const indices = [] as number[];
    for (let i = 0; i < times.length; i += step) {
      indices.push(i);
    }
    if (indices[indices.length - 1] !== times.length - 1) {
      indices.push(times.length - 1);
    }
    times = indices.map((i) => times[i]);
    layers = layers.map((layer) => ({
      ...layer,
      mean: indices.map((i) => layer.mean[i]),
      unc: layer.unc ? indices.map((i) => layer.unc![i]) : undefined
    }));
  }

  return {
    dataset: {
      times,
      layers,
      order: source.order.filter((id) => layers.some((layer) => layer.id === id))
    },
    notes
  };
}

function movingAverage(values: number[], window: number): number[] {
  const radius = Math.max(1, Math.floor(window / 2));
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    const left = Math.max(0, i - radius);
    const right = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let j = left; j <= right; j += 1) {
      sum += values[j];
    }
    out[i] = sum / (right - left + 1);
  }
  return out;
}

function aggregateSeries(values: number[], window: number, mode: AggregationMode): number[] {
  if (mode === "rollingAvg") {
    return movingAverage(values, window);
  }
  if (mode === "mean" || mode === "sum") {
    const block = Math.max(1, Math.floor(window));
    const out = values.slice();
    for (let i = 0; i < values.length; i += block) {
      const right = Math.min(values.length, i + block);
      let sum = 0;
      for (let j = i; j < right; j += 1) {
        sum += values[j];
      }
      const agg = mode === "sum" ? sum : sum / (right - i);
      for (let j = i; j < right; j += 1) {
        out[j] = agg;
      }
    }
    return out;
  }
  return values.slice();
}
