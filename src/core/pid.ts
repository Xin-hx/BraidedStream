/**
 * Unified PID module for the project.
 *
 * This file groups the three PID-oriented implementations under one core:
 * - interval-based PID ordering for streamgraph layers
 * - contour-mask PID / PID-Mean for fuzzy layer masks
 * - PID-new scene assembly that combines contour PID with stacked layout
 */
import { computeBaseline, computeMultiscaleDistributedBaseline, type SineStreamHooks } from "./baseline";
import type {
  BaselineMode,
  LayerInput,
  PidBaselineMode,
  PidUncertaintySource,
  PreparedDataset,
  ROI,
  StackLayout
} from "./types";
import { roiBounds } from "./roi";
import { computeStackedBoundaries } from "./stack";
import { orderLayers } from "./validate";
import { EPSILON, clamp, finiteOr, firstFinite, median, sortPair, sum, range } from "./utils";

// ---------------------------------------------------------------------------
// PID ordering over time-series uncertainty bands
// ---------------------------------------------------------------------------

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

/**
 * Interval-inclusion PID ordering for streamgraph layers.
 * A layer is deeper when its central trajectory is often covered by peer bands.
 */
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
  const tLength = layers[0].mean.length;
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
 * Reorder a depth-sorted list so that the deepest layer sits near the center
 * and the rest alternate outward in a center-out stack.
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

function buildLayerBand(layer: LayerInput, tLength: number, uncertaintySource: PidUncertaintySource): LayerBand {
  const low = new Array<number>(tLength).fill(0);
  const high = new Array<number>(tLength).fill(0);
  const center = new Array<number>(tLength).fill(0);

  for (let t = 0; t < tLength; t += 1) {
    const meanValue = finiteOr(layer.mean[t], 0);
    const q50 = finiteOr(layer.quantiles?.p50?.[t], meanValue);
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
  if (uncertaintySource === "poportion") {
    const poportionSpread = finiteOr(layer.poportionUnc?.[timeIndex], Number.NaN);
    if (Number.isFinite(poportionSpread)) {
      const halfWidth = Math.max(0, poportionSpread) * 0.5;
      return sortPair(meanValue - halfWidth, meanValue + halfWidth);
    }
  }

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
    const halfWidth = Math.max(0, unc) * 0.5;
    return sortPair(meanValue - halfWidth, meanValue + halfWidth);
  }

  return [meanValue, meanValue];
}

// ---------------------------------------------------------------------------
// Contour-mask PID-Mean for fuzzy layer masks
// ---------------------------------------------------------------------------

export interface ContourPidOptions {
  yBins?: number;
  valueTransform?: "log1p" | "linear";
  centralFraction?: number;
  contourThreshold?: number;
  uncertaintySource?: PidUncertaintySource;
}

export interface ContourPidScore {
  id: string;
  depth: number;
  inScore: number;
  outScore: number;
  area: number;
}

export interface ContourPidGrid {
  xBins: number;
  yBins: number;
  zMin: number;
  zMax: number;
  contourThreshold: number;
  valueTransform: "log1p" | "linear";
}

export interface ContourPidResult {
  scores: ContourPidScore[];
  depthByLayerId: Map<string, number>;
  scoreByLayerId: Map<string, ContourPidScore>;
  depthOrder: string[];
  displayOrder: string[];
  deepestLayerId: string | null;
  meanMask: Float32Array;
  allUnionMask: Float32Array;
  centralUnionMask: Float32Array;
  centralIntersectionMask: Float32Array;
  deepestMask: Float32Array;
  grid: ContourPidGrid;
}

interface LayerBandSeries {
  lowOuter: number[];
  lowInner: number[];
  center: number[];
  highInner: number[];
  highOuter: number[];
}

interface ContourBoxplotMasks {
  deepestLayerId: string | null;
  allUnionMask: Float32Array;
  centralUnionMask: Float32Array;
  centralIntersectionMask: Float32Array;
  deepestMask: Float32Array;
}

/** Compute contour-mask PID-Mean and the associated contour-boxplot masks. */
export function computeContourPid(layers: LayerInput[], options: ContourPidOptions = {}): ContourPidResult {
  const xBins = layers[0]?.mean.length ?? 0;
  const yBins = Math.max(16, Math.round(options.yBins ?? 180));
  const contourThreshold = clamp(options.contourThreshold ?? 0.5, 0, 1);
  const centralFraction = clamp(options.centralFraction ?? 0.5, 0, 1);
  const uncertaintySource = options.uncertaintySource ?? "value";
  const gridSize = xBins * yBins;

  if (layers.length === 0 || xBins === 0) {
    return emptyContourPidResult(xBins, yBins, contourThreshold);
  }

  const bands = layers.map((layer) => buildLayerBandSeries(layer, xBins, uncertaintySource));
  const grid = buildContourGrid(bands, xBins, yBins, contourThreshold, uncertaintySource);
  const masks = bands.map((band) => rasterizeBand(band, grid));
  const meanMask = averageMasks(masks, gridSize);
  const scores = sortContourScores(scoreMasks(layers, masks, meanMask));

  const depthOrder = scores.map((score) => score.id);
  const displayOrder = buildPidCenterOutOrder(depthOrder);
  const depthByLayerId = new Map(scores.map((score) => [score.id, score.depth]));
  const scoreByLayerId = new Map(scores.map((score) => [score.id, score]));
  const boxplotMasks = buildContourBoxplotMasks(layers, masks, scores, centralFraction, gridSize);

  return {
    scores,
    depthByLayerId,
    scoreByLayerId,
    depthOrder,
    displayOrder,
    deepestLayerId: boxplotMasks.deepestLayerId,
    meanMask,
    allUnionMask: boxplotMasks.allUnionMask,
    centralUnionMask: boxplotMasks.centralUnionMask,
    centralIntersectionMask: boxplotMasks.centralIntersectionMask,
    deepestMask: boxplotMasks.deepestMask,
    grid
  };
}

function emptyContourPidResult(xBins: number, yBins: number, contourThreshold: number): ContourPidResult {
  const emptyMask = new Float32Array(xBins * yBins);
  const grid: ContourPidGrid = {
    xBins,
    yBins,
    zMin: 0,
    zMax: 1,
    contourThreshold,
    valueTransform: "linear"
  };
  return {
    scores: [],
    depthByLayerId: new Map(),
    scoreByLayerId: new Map(),
    depthOrder: [],
    displayOrder: [],
    deepestLayerId: null,
    meanMask: emptyMask,
    allUnionMask: emptyMask,
    centralUnionMask: emptyMask,
    centralIntersectionMask: emptyMask,
    deepestMask: emptyMask,
    grid
  };
}

function buildContourGrid(
  bands: LayerBandSeries[],
  xBins: number,
  yBins: number,
  contourThreshold: number,
  uncertaintySource: PidUncertaintySource
): ContourPidGrid {
  const [zMinRaw, zMaxRaw] = transformedExtent(bands, uncertaintySource === "poportion" ? "linear" : "log1p");
  const zPad = Math.max(1e-6, (zMaxRaw - zMinRaw) * 0.04);
  return {
    xBins,
    yBins,
    zMin: zMinRaw - zPad,
    zMax: zMaxRaw + zPad,
    contourThreshold,
    valueTransform: uncertaintySource === "poportion" ? "linear" : "log1p"
  };
}

function averageMasks(masks: Float32Array[], gridSize: number): Float32Array {
  const meanMask = new Float32Array(gridSize);
  for (const mask of masks) {
    for (let i = 0; i < gridSize; i += 1) {
      meanMask[i] += mask[i];
    }
  }
  for (let i = 0; i < gridSize; i += 1) {
    meanMask[i] /= Math.max(1, masks.length);
  }
  return meanMask;
}

function scoreMasks(layers: LayerInput[], masks: Float32Array[], meanMask: Float32Array): ContourPidScore[] {
  const areaMean = sumMask(meanMask);
  return masks.map((mask, index) => {
    const area = sumMask(mask);
    const dot = dotMask(mask, meanMask);
    const inScore = area > EPSILON ? dot / area : 0;
    const outScore = areaMean > EPSILON ? dot / areaMean : 0;
    return {
      id: layers[index].id,
      depth: Math.min(inScore, outScore),
      inScore,
      outScore,
      area
    };
  });
}

function sortContourScores(scores: ContourPidScore[]): ContourPidScore[] {
  return scores.sort((a, b) => {
    if (b.depth !== a.depth) {
      return b.depth - a.depth;
    }
    if (b.inScore !== a.inScore) {
      return b.inScore - a.inScore;
    }
    if (b.outScore !== a.outScore) {
      return b.outScore - a.outScore;
    }
    return a.id.localeCompare(b.id);
  });
}

function buildContourBoxplotMasks(
  layers: LayerInput[],
  masks: Float32Array[],
  scores: ContourPidScore[],
  centralFraction: number,
  gridSize: number
): ContourBoxplotMasks {
  const centralCount = Math.max(1, Math.floor(scores.length * centralFraction));
  const centralIds = new Set(scores.slice(0, centralCount).map((score) => score.id));
  const allUnionMask = new Float32Array(gridSize);
  const centralUnionMask = new Float32Array(gridSize);
  const centralIntersectionMask = new Float32Array(gridSize);
  centralIntersectionMask.fill(1);

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const mask = masks[layerIndex];
    const isCentral = centralIds.has(layers[layerIndex].id);
    for (let i = 0; i < gridSize; i += 1) {
      allUnionMask[i] = Math.max(allUnionMask[i], mask[i]);
      if (isCentral) {
        centralUnionMask[i] = Math.max(centralUnionMask[i], mask[i]);
        centralIntersectionMask[i] = Math.min(centralIntersectionMask[i], mask[i]);
      }
    }
  }

  const deepestLayerId = scores[0]?.id ?? null;
  const deepestIndex = deepestLayerId ? layers.findIndex((layer) => layer.id === deepestLayerId) : -1;
  const deepestMask = deepestIndex >= 0 ? masks[deepestIndex].slice() : new Float32Array(gridSize);

  return {
    deepestLayerId,
    allUnionMask,
    centralUnionMask,
    centralIntersectionMask,
    deepestMask
  };
}

function buildLayerBandSeries(
  layer: LayerInput,
  tLength: number,
  uncertaintySource: PidUncertaintySource
): LayerBandSeries {
  const lowOuter = new Array<number>(tLength).fill(0);
  const lowInner = new Array<number>(tLength).fill(0);
  const center = new Array<number>(tLength).fill(0);
  const highInner = new Array<number>(tLength).fill(0);
  const highOuter = new Array<number>(tLength).fill(0);

  for (let t = 0; t < tLength; t += 1) {
    const mean = finiteOr(layer.mean[t], 0);
    const p50 = finiteOr(layer.quantiles?.p50?.[t], mean);
    const [outerLow, outerHigh] = resolveOuterBand(layer, t, mean, uncertaintySource);
    const innerLow = firstFinite(layer.quantiles?.p25?.[t], Math.min(p50, mean), outerLow);
    const innerHigh = firstFinite(layer.quantiles?.p75?.[t], Math.max(p50, mean), outerHigh);
    const sorted = [outerLow, innerLow, p50, innerHigh, outerHigh].map((value) => Math.max(0, value));
    sorted.sort((a, b) => a - b);
    lowOuter[t] = sorted[0];
    lowInner[t] = sorted[1];
    center[t] = sorted[2];
    highInner[t] = sorted[3];
    highOuter[t] = sorted[4];
  }

  return { lowOuter, lowInner, center, highInner, highOuter };
}

function resolveOuterBand(
  layer: LayerInput,
  timeIndex: number,
  meanValue: number,
  uncertaintySource: PidUncertaintySource
): [number, number] {
  if (uncertaintySource === "poportion") {
    const poportionSpread = finiteOr(layer.poportionUnc?.[timeIndex], Number.NaN);
    if (Number.isFinite(poportionSpread)) {
      const halfWidth = Math.max(0, poportionSpread) * 0.5;
      return sortPair(meanValue - halfWidth, meanValue + halfWidth);
    }
  }

  const outerLow = firstFinite(
    layer.quantiles?.p025?.[timeIndex],
    layer.quantiles?.p05?.[timeIndex],
    layer.quantiles?.p10?.[timeIndex],
    layer.lower?.[timeIndex],
    meanValue - 0.5 * Math.max(0, finiteOr(layer.unc?.[timeIndex], 0)),
    meanValue
  );
  const outerHigh = firstFinite(
    layer.quantiles?.p975?.[timeIndex],
    layer.quantiles?.p95?.[timeIndex],
    layer.quantiles?.p90?.[timeIndex],
    layer.upper?.[timeIndex],
    meanValue + 0.5 * Math.max(0, finiteOr(layer.unc?.[timeIndex], 0)),
    meanValue
  );
  return sortPair(outerLow, outerHigh);
}

function rasterizeBand(band: LayerBandSeries, grid: ContourPidGrid): Float32Array {
  const mask = new Float32Array(grid.xBins * grid.yBins);
  const dz = grid.yBins <= 1 ? 1 : (grid.zMax - grid.zMin) / (grid.yBins - 1);
  for (let t = 0; t < grid.xBins; t += 1) {
    const lo = transformValue(band.lowOuter[t], grid.valueTransform);
    const li = transformValue(band.lowInner[t], grid.valueTransform);
    const hi = transformValue(band.highInner[t], grid.valueTransform);
    const ho = transformValue(band.highOuter[t], grid.valueTransform);
    const c = transformValue(band.center[t], grid.valueTransform);
    for (let y = 0; y < grid.yBins; y += 1) {
      const z = grid.zMin + y * dz;
      mask[y * grid.xBins + t] = membership(z, lo, li, c, hi, ho);
    }
  }
  return mask;
}

function membership(z: number, lo: number, li: number, c: number, hi: number, ho: number): number {
  const lowInner = Math.max(lo, Math.min(li, c));
  const highInner = Math.min(ho, Math.max(hi, c));
  if (z < lo || z > ho) {
    return 0;
  }
  if (z >= lowInner && z <= highInner) {
    return 1;
  }
  if (z < lowInner) {
    return (z - lo) / Math.max(EPSILON, lowInner - lo);
  }
  return (ho - z) / Math.max(EPSILON, ho - highInner);
}

function transformedExtent(bands: LayerBandSeries[], valueTransform: "log1p" | "linear"): [number, number] {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    for (const series of [band.lowOuter, band.highOuter, band.center]) {
      for (const value of series) {
        const z = transformValue(value, valueTransform);
        minValue = Math.min(minValue, z);
        maxValue = Math.max(maxValue, z);
      }
    }
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
    return [0, 1];
  }
  return [minValue, maxValue];
}

function transformValue(value: number, valueTransform: "log1p" | "linear"): number {
  const finite = Math.max(0, finiteOr(value, 0));
  return valueTransform === "linear" ? finite : Math.log1p(finite);
}

function sumMask(mask: Float32Array): number {
  let out = 0;
  for (const value of mask) {
    out += value;
  }
  return out;
}

function dotMask(a: Float32Array, b: Float32Array): number {
  let out = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    out += a[i] * b[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// PID-new scene assembly helpers
// ---------------------------------------------------------------------------

export interface PidNewSceneOptions {
  dataset: PreparedDataset;
  roi: ROI | null;
  baselineMode: PidBaselineMode;
  baselineHooks: SineStreamHooks;
  uncertaintyStrength: number;
  uncertaintySource?: PidUncertaintySource;
  contourOptions?: ContourPidOptions;
}

export interface PidNewScene {
  dataset: PreparedDataset;
  contourPid: ContourPidResult;
  orderedLayers: LayerInput[];
  layout: StackLayout;
  activeIndices: number[];
  activeTimes: number[];
  uncertaintySource: PidUncertaintySource;
}

/** Build the data, ordering, and stack geometry needed by the PID-new renderer. */
export function buildPidNewScene(options: PidNewSceneOptions): PidNewScene | null {
  const { dataset, roi, baselineMode, baselineHooks, uncertaintyStrength } = options;
  if (dataset.layers.length === 0 || dataset.times.length === 0) {
    return null;
  }

  const uncertaintySource = options.uncertaintySource ?? "value";

  const [left, right] = roiBounds(dataset.times.length, roi);
  const activeIndices = range(left, right + 1);
  const activeTimes = activeIndices.map((index) => dataset.times[index]);
  const contourPid = computeContourPid(dataset.layers, {
    yBins: 180,
    valueTransform: uncertaintySource === "poportion" ? "linear" : "log1p",
    centralFraction: 0.5,
    contourThreshold: 0.5,
    uncertaintySource,
    ...options.contourOptions
  });
  const orderedLayers = orderLayers(dataset.layers, contourPid.displayOrder);
  const baseline = computePidNewBaseline(
    dataset.times,
    orderedLayers,
    baselineMode,
    baselineHooks,
    Math.max(0, uncertaintyStrength)
  );
  const layout = computeStackedBoundaries(baseline, orderedLayers);

  return {
    dataset,
    contourPid,
    orderedLayers,
    layout,
    activeIndices,
    activeTimes,
    uncertaintySource
  };
}

/** Select the baseline solver used by the PID-new ordered river panel. */
export function computePidNewBaseline(
  times: number[],
  orderedLayers: LayerInput[],
  mode: PidBaselineMode,
  hooks: SineStreamHooks,
  uncertaintyStrength: number
): number[] {
  if (mode === "multiscale") {
    return computeMultiscaleDistributedBaseline(times, orderedLayers, uncertaintyStrength, hooks, 0.08).baseline;
  }
  return computeBaseline(times, orderedLayers, mode as BaselineMode, hooks);
}

/** Compute the y-domain of a layout over a selected time-index subset. */
export function layoutExtent(layout: StackLayout, indices: number[]): [number, number] {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const row of layout.yBottom) {
    for (const t of indices) {
      minValue = Math.min(minValue, row[t]);
      maxValue = Math.max(maxValue, row[t]);
    }
  }
  for (const row of layout.yTop) {
    for (const t of indices) {
      minValue = Math.min(minValue, row[t]);
      maxValue = Math.max(maxValue, row[t]);
    }
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
    return [-1, 1];
  }
  return [minValue, maxValue];
}

/** Pick the topmost layer containing a y-value at the given time index. */
export function pickLayerAtY(
  timeIndex: number,
  yValue: number,
  layout: StackLayout,
  orderedLayers: LayerInput[]
): LayerInput | null {
  for (let k = orderedLayers.length - 1; k >= 0; k -= 1) {
    if (yValue >= layout.yBottom[k][timeIndex] && yValue <= layout.yTop[k][timeIndex]) {
      return orderedLayers[k];
    }
  }
  return null;
}

/** Find the nearest value in a sorted or unsorted numeric series. */
export function nearestByValue(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const distance = Math.abs(values[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}