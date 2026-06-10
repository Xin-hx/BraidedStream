import type { LayerInput, PidUncertaintySource } from "../types";
import { clamp, finiteOr, median, sortPair, sum } from "../utils";

export interface PidOrderingScore {
  id: string;
  depth: number;
  totalMean: number;
  validTimeCount: number;
}

export interface PidOrderingResult {
  order: string[];
  scores: PidOrderingScore[];
  depthByLayerId: Map<string, number>;
  depthSeriesByLayerId: Map<string, number[]>;
}

interface LayerBand {
  low: number[];
  high: number[];
  center: number[];
}

export interface PidOrderingOptions {
  /** Exclude self interval from depth denominator. */
  excludeSelf?: boolean;
  /** Penalize wide intervals in inclusion voting. */
  widthPenaltyPower?: number;
  /** Minimum number of comparator intervals required at a time step. */
  minComparators?: number;
  /** Select value-based or poportion-based uncertainty bands. */
  uncertaintySource?: PidUncertaintySource;
}

const QUANTILE_BAND_PAIRS: Array<readonly [string, string]> = [
  ["p025", "p975"],
  ["p05", "p95"],
  ["p10", "p90"],
  ["p25", "p75"]
];

export function computePidOrdering(layers: LayerInput[], options: PidOrderingOptions = {}): PidOrderingResult {
  if (layers.length === 0) {
    return {
      order: [],
      scores: [],
      depthByLayerId: new Map<string, number>(),
      depthSeriesByLayerId: new Map<string, number[]>()
    };
  }

  const excludeSelf = options.excludeSelf !== false;
  const widthPenaltyPower = Math.max(0, options.widthPenaltyPower ?? 1);
  const minComparators = Math.max(1, Math.floor(options.minComparators ?? 2));
  const uncertaintySource = options.uncertaintySource ?? "value";
  const tLength = layers[0].height.length;
  const bands = layers.map((layer) => buildLayerBand(layer, tLength, uncertaintySource));
  const scores: PidOrderingScore[] = [];
  const depthByLayerId = new Map<string, number>();
  const depthSeriesByLayerId = new Map<string, number[]>();

  for (let i = 0; i < layers.length; i += 1) {
    const series = new Array<number>(tLength).fill(Number.NaN);
    let validTimeCount = 0;
    let depthSum = 0;

    for (let t = 0; t < tLength; t += 1) {
      const center = bands[i].center[t];
      if (!Number.isFinite(center)) {
        continue;
      }

      const widths: number[] = [];
      for (let j = 0; j < layers.length; j += 1) {
        if (excludeSelf && i === j) {
          continue;
        }
        const low = bands[j].low[t];
        const high = bands[j].high[t];
        if (!Number.isFinite(low) || !Number.isFinite(high)) {
          continue;
        }
        widths.push(Math.max(1e-9, high - low));
      }
      if (widths.length < minComparators) {
        continue;
      }

      const widthRef = Math.max(1e-9, median(widths));
      let covered = 0;
      let total = 0;

      for (let j = 0; j < layers.length; j += 1) {
        if (excludeSelf && i === j) {
          continue;
        }
        const low = bands[j].low[t];
        const high = bands[j].high[t];
        if (!Number.isFinite(low) || !Number.isFinite(high)) {
          continue;
        }
        const width = Math.max(1e-9, high - low);
        const widthRatio = width / widthRef;
        const weight = widthPenaltyPower <= 0 ? 1 : 1 / Math.pow(1 + widthRatio, widthPenaltyPower);
        total += weight;
        if (center >= low && center <= high) {
          covered += weight;
        }
      }
      if (total <= 1e-12) {
        continue;
      }

      const pointDepth = covered / total;
      series[t] = pointDepth;
      depthSum += pointDepth;
      validTimeCount += 1;
    }

    const depth = validTimeCount > 0 ? depthSum / validTimeCount : 0;
    const totalMean = sum(layers[i].height);
    const score: PidOrderingScore = { id: layers[i].id, depth, totalMean, validTimeCount };
    scores.push(score);
    depthByLayerId.set(layers[i].id, depth);
    depthSeriesByLayerId.set(layers[i].id, series);
  }

  scores.sort((a, b) => {
    if (b.depth !== a.depth) {
      return b.depth - a.depth;
    }
    if (b.validTimeCount !== a.validTimeCount) {
      return b.validTimeCount - a.validTimeCount;
    }
    if (b.totalMean !== a.totalMean) {
      return b.totalMean - a.totalMean;
    }
    return a.id.localeCompare(b.id);
  });

  return {
    order: scores.map((score) => score.id),
    scores,
    depthByLayerId,
    depthSeriesByLayerId
  };
}

function buildLayerBand(layer: LayerInput, tLength: number, uncertaintySource: PidUncertaintySource): LayerBand {
  const low = new Array<number>(tLength).fill(0);
  const high = new Array<number>(tLength).fill(0);
  const center = new Array<number>(tLength).fill(0);

  for (let t = 0; t < tLength; t += 1) {
    const meanValue = layerCenterValue(layer, t, uncertaintySource);
    const quantiles = quantilesForSource(layer, uncertaintySource);
    const q50 = finiteOr(quantiles?.p50?.[t], meanValue);
    const [lo, hi] = resolveBand(layer, t, meanValue, uncertaintySource);
    low[t] = lo;
    high[t] = hi;
    center[t] = clamp(q50, lo, hi);
  }

  return { low, high, center };
}

/** Resolve the preferred uncertainty interval at a time sample. */
function resolveBand(
  layer: LayerInput,
  timeIndex: number,
  meanValue: number,
  uncertaintySource: PidUncertaintySource
): [number, number] {
  const quantiles = quantilesForSource(layer, uncertaintySource);

  for (const [lowKey, highKey] of QUANTILE_BAND_PAIRS) {
    const qLow = finiteOr(quantiles?.[lowKey]?.[timeIndex], Number.NaN);
    const qHigh = finiteOr(quantiles?.[highKey]?.[timeIndex], Number.NaN);
    if (Number.isFinite(qLow) && Number.isFinite(qHigh)) {
      return sortPair(qLow, qHigh);
    }
  }

  const lower = finiteOr(
    uncertaintySource === "poportion" ? layer.poportionLower?.[timeIndex] : layer.lower?.[timeIndex],
    Number.NaN
  );
  const upper = finiteOr(
    uncertaintySource === "poportion" ? layer.poportionUpper?.[timeIndex] : layer.upper?.[timeIndex],
    Number.NaN
  );
  if (Number.isFinite(lower) && Number.isFinite(upper)) {
    return sortPair(lower, upper);
  }

  const unc = finiteOr(
    uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex],
    Number.NaN
  );
  if (Number.isFinite(unc)) {
    const halfWidth = Math.max(0, unc) * 0.5;
    return sortPair(meanValue - halfWidth, meanValue + halfWidth);
  }

  return [meanValue, meanValue];
}

function layerCenterValue(layer: LayerInput, timeIndex: number, uncertaintySource: PidUncertaintySource): number {
  if (uncertaintySource === "poportion") {
    return finiteOr(layer.poportionMean?.[timeIndex], finiteOr(layer.poportionQuantiles?.p50?.[timeIndex], 0));
  }
  return finiteOr(layer.height[timeIndex], 0);
}

function quantilesForSource(layer: LayerInput, uncertaintySource: PidUncertaintySource) {
  return uncertaintySource === "poportion" ? layer.poportionQuantiles ?? layer.quantiles : layer.quantiles;
}

