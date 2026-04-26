import type { LayerInput } from "./types";

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
  /**
   * Exclude self interval from depth denominator.
   * Default=true for unbiased inter-layer inclusion depth.
   */
  excludeSelf?: boolean;
  /**
   * Penalize wide intervals in inclusion voting.
   * 0 means no penalty; 1 means moderate penalty.
   */
  widthPenaltyPower?: number;
  /**
   * Minimum number of comparator intervals required at a time step.
   * Time points below this threshold are ignored in depth averaging.
   */
  minComparators?: number;
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
  const tLength = layers[0].mean.length;
  const bands = layers.map((layer) => buildLayerBand(layer, tLength));
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
    const totalMean = sum(layers[i].mean);
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

/**
 * Reorder a depth-sorted list so that:
 * 1) deepest layer is placed near center,
 * 2) remaining layers are inserted alternating upper/lower around center,
 * 3) shallow layers drift toward both sides.
 *
 * Input should be sorted by depth descending.
 * Output is bottom-to-top stack order.
 */
export function buildPidCenterOutOrder(depthSortedOrder: string[]): string[] {
  const n = depthSortedOrder.length;
  if (n <= 2) {
    return depthSortedOrder.slice();
  }

  const out = new Array<string>(n);
  const centerLeft = Math.floor((n - 1) / 2);
  let left = centerLeft;
  let right = centerLeft + 1;

  for (let i = 0; i < n; i += 1) {
    const id = depthSortedOrder[i];
    if (i === 0) {
      out[centerLeft] = id;
      left -= 1;
      continue;
    }

    const placeUpper = i % 2 === 1;
    if (placeUpper) {
      if (right < n) {
        out[right] = id;
        right += 1;
      } else if (left >= 0) {
        out[left] = id;
        left -= 1;
      }
    } else {
      if (left >= 0) {
        out[left] = id;
        left -= 1;
      } else if (right < n) {
        out[right] = id;
        right += 1;
      }
    }
  }

  return out.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function buildLayerBand(layer: LayerInput, tLength: number): LayerBand {
  const low = new Array<number>(tLength).fill(0);
  const high = new Array<number>(tLength).fill(0);
  const center = new Array<number>(tLength).fill(0);

  for (let t = 0; t < tLength; t += 1) {
    const meanValue = finiteOr(layer.mean[t], 0);
    const q50 = finiteOr(layer.quantiles?.p50?.[t], meanValue);
    const [lo, hi] = resolveBand(layer, t, meanValue);
    low[t] = lo;
    high[t] = hi;
    center[t] = clamp(q50, lo, hi);
  }

  return { low, high, center };
}

function resolveBand(layer: LayerInput, timeIndex: number, meanValue: number): [number, number] {
  for (const [lowKey, highKey] of QUANTILE_BAND_PAIRS) {
    const qLow = finiteOr(layer.quantiles?.[lowKey]?.[timeIndex], Number.NaN);
    const qHigh = finiteOr(layer.quantiles?.[highKey]?.[timeIndex], Number.NaN);
    if (Number.isFinite(qLow) && Number.isFinite(qHigh)) {
      return sortPair(qLow, qHigh);
    }
  }

  const lower = finiteOr(layer.lower?.[timeIndex], Number.NaN);
  const upper = finiteOr(layer.upper?.[timeIndex], Number.NaN);
  if (Number.isFinite(lower) && Number.isFinite(upper)) {
    return sortPair(lower, upper);
  }

  const unc = finiteOr(layer.unc?.[timeIndex], Number.NaN);
  if (Number.isFinite(unc)) {
    // Treat unc as full spread when semantics are ambiguous.
    const halfWidth = Math.max(0, unc) * 0.5;
    return sortPair(meanValue - halfWidth, meanValue + halfWidth);
  }

  return [meanValue, meanValue];
}

function sortPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return 0.5 * (sorted[mid - 1] + sorted[mid]);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function sum(values: number[]): number {
  let out = 0;
  for (const value of values) {
    out += value;
  }
  return out;
}
