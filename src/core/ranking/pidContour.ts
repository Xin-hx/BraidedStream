import { buildCenterOutOrder } from "../displayOrder";
import type { LayerInput, PidUncertaintySource } from "../types";
import { EPSILON, clamp, finiteOr, firstFinite } from "../math";

type QuantileMaskKey = "p025" | "p10" | "p25" | "p50" | "p75" | "p90" | "p975";

interface QuantileMaskMembershipSpec {
  key: QuantileMaskKey;
  membership: number;
}

const QUANTILE_MASK_KEY_ORDER: QuantileMaskKey[] = ["p025", "p10", "p25", "p50", "p75", "p90", "p975"];

// share one membership value, so only the lower side plus p50 is maintained.
const CONTOUR_MASK_SYMMETRIC_MEMBERSHIP: Array<{
  lowerKey: QuantileMaskKey;
  upperKey: QuantileMaskKey;
  membership: number;
}> = [
  { lowerKey: "p025", upperKey: "p975", membership: 0 },
  { lowerKey: "p10", upperKey: "p90", membership: 0.25 },
  { lowerKey: "p25", upperKey: "p75", membership: 0.5 },
  { lowerKey: "p50", upperKey: "p50", membership: 1 }
];

const CONTOUR_MASK_MEMBERSHIP = buildContourMaskMembershipSpec();

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

interface QuantileMaskPointSeries {
  key: QuantileMaskKey;
  membership: number;
  values: number[];
}

interface LayerBandSeries {
  controlPoints: QuantileMaskPointSeries[];
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
  const displayOrder = buildCenterOutOrder(depthOrder);
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
  const zMin = uncertaintySource === "poportion" ? Math.max(0, zMinRaw - zPad) : zMinRaw - zPad;
  const zMax = zMaxRaw + zPad;
  return {
    xBins,
    yBins,
    zMin,
    zMax: zMax > zMin ? zMax : zMin + 1e-6,
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
  const controlPoints = CONTOUR_MASK_MEMBERSHIP.map((item) => ({
    key: item.key,
    membership: item.membership,
    values: new Array<number>(tLength).fill(0)
  }));

  for (let t = 0; t < tLength; t += 1) {
    const mean = layerCenterValue(layer, t, uncertaintySource);
    const values = resolveQuantileMaskValues(layer, t, mean, uncertaintySource);
    for (const point of controlPoints) {
      point.values[t] = values[point.key];
    }
  }

  return { controlPoints };
}

function buildContourMaskMembershipSpec(): QuantileMaskMembershipSpec[] {
  const byKey = new Map<QuantileMaskKey, number>();
  for (const item of CONTOUR_MASK_SYMMETRIC_MEMBERSHIP) {
    const membership = clamp(item.membership, 0, 1);
    byKey.set(item.lowerKey, membership);
    byKey.set(item.upperKey, membership);
  }
  return QUANTILE_MASK_KEY_ORDER.map((key) => ({ key, membership: byKey.get(key) ?? 0 }));
}

function resolveQuantileMaskValues(
  layer: LayerInput,
  timeIndex: number,
  meanValue: number,
  uncertaintySource: PidUncertaintySource
): Record<QuantileMaskKey, number> {
  const quantiles = quantilesForSource(layer, uncertaintySource);
  const uncertainty = Math.max(
    0,
    finiteOr(uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex], 0)
  );

  const p025 = firstFinite(
    quantiles?.p025?.[timeIndex],
    quantiles?.p05?.[timeIndex],
    quantiles?.p10?.[timeIndex],
    uncertaintySource === "poportion" ? layer.poportionLower?.[timeIndex] : layer.lower?.[timeIndex],
    meanValue - 0.5 * uncertainty,
    meanValue
  );
  const p975 = firstFinite(
    quantiles?.p975?.[timeIndex],
    quantiles?.p95?.[timeIndex],
    quantiles?.p90?.[timeIndex],
    uncertaintySource === "poportion" ? layer.poportionUpper?.[timeIndex] : layer.upper?.[timeIndex],
    meanValue + 0.5 * uncertainty,
    meanValue
  );
  const p50 = finiteOr(quantiles?.p50?.[timeIndex], meanValue);
  const p10 = firstFinite(quantiles?.p10?.[timeIndex], quantiles?.p05?.[timeIndex], p025);
  const p90 = firstFinite(quantiles?.p90?.[timeIndex], quantiles?.p95?.[timeIndex], p975);
  const p25 = firstFinite(quantiles?.p25?.[timeIndex], Math.min(p50, meanValue), p10);
  const p75 = firstFinite(quantiles?.p75?.[timeIndex], Math.max(p50, meanValue), p90);

  const sorted = [p025, p10, p25, p50, p75, p90, p975].map((value) => Math.max(0, value));
  sorted.sort((a, b) => a - b);
  return {
    p025: sorted[0],
    p10: sorted[1],
    p25: sorted[2],
    p50: sorted[3],
    p75: sorted[4],
    p90: sorted[5],
    p975: sorted[6]
  };
}

function layerCenterValue(layer: LayerInput, timeIndex: number, uncertaintySource: PidUncertaintySource): number {
  if (uncertaintySource === "poportion") {
    return finiteOr(layer.poportionMean?.[timeIndex], finiteOr(layer.poportionQuantiles?.p50?.[timeIndex], 0));
  }
  return finiteOr(layer.mean[timeIndex], 0);
}

function quantilesForSource(layer: LayerInput, uncertaintySource: PidUncertaintySource) {
  return uncertaintySource === "poportion" ? layer.poportionQuantiles ?? layer.quantiles : layer.quantiles;
}

function rasterizeBand(band: LayerBandSeries, grid: ContourPidGrid): Float32Array {
  const mask = new Float32Array(grid.xBins * grid.yBins);
  const dz = grid.yBins <= 1 ? 1 : (grid.zMax - grid.zMin) / (grid.yBins - 1);
  for (let t = 0; t < grid.xBins; t += 1) {
    const controlPoints = prepareMembershipPoints(
      band.controlPoints.map((point) => [transformValue(point.values[t], grid.valueTransform), point.membership])
    );
    for (let y = 0; y < grid.yBins; y += 1) {
      const z = grid.zMin + y * dz;
      mask[y * grid.xBins + t] = membership(z, controlPoints);
    }
  }
  return mask;
}

function prepareMembershipPoints(points: Array<[number, number]>): Array<[number, number]> {
  const sorted = points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => [x, clamp(y, 0, 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const collapsed: Array<[number, number]> = [];
  for (const [x, y] of sorted) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && Math.abs(x - previous[0]) <= EPSILON) {
      previous[1] = Math.max(previous[1], y);
    } else {
      collapsed.push([x, y]);
    }
  }
  return collapsed;
}

function membership(z: number, points: Array<[number, number]>): number {
  if (!Number.isFinite(z) || points.length === 0) {
    return 0;
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (z < first[0] || z > last[0]) {
    return 0;
  }

  if (points.length === 1) {
    return Math.abs(z - first[0]) <= EPSILON ? first[1] : 0;
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (z <= x1 || i === points.length - 2) {
      const ratio = clamp((z - x0) / Math.max(EPSILON, x1 - x0), 0, 1);
      return y0 + ratio * (y1 - y0);
    }
  }

  return 0;
}

function transformedExtent(bands: LayerBandSeries[], valueTransform: "log1p" | "linear"): [number, number] {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    for (const point of band.controlPoints) {
      for (const value of point.values) {
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

