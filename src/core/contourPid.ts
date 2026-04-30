import type { LayerInput } from "./types";
import { buildPidCenterOutOrder } from "./pidOrdering";

export interface ContourPidOptions {
  yBins?: number;
  valueTransform?: "log1p";
  centralFraction?: number;
  contourThreshold?: number;
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
  valueTransform: "log1p";
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

const EPS = 1e-12;

export function computeContourPid(layers: LayerInput[], options: ContourPidOptions = {}): ContourPidResult {
  const xBins = layers[0]?.mean.length ?? 0;
  const yBins = Math.max(16, Math.round(options.yBins ?? 180));
  const contourThreshold = clamp(options.contourThreshold ?? 0.5, 0, 1);
  const centralFraction = clamp(options.centralFraction ?? 0.5, 0, 1);
  const gridSize = xBins * yBins;
  const emptyMask = new Float32Array(gridSize);
  const emptyGrid: ContourPidGrid = {
    xBins,
    yBins,
    zMin: 0,
    zMax: 1,
    contourThreshold,
    valueTransform: "log1p"
  };

  if (layers.length === 0 || xBins === 0) {
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
      grid: emptyGrid
    };
  }

  const bands = layers.map((layer) => buildLayerBandSeries(layer, xBins));
  const [zMinRaw, zMaxRaw] = transformedExtent(bands);
  const zPad = Math.max(1e-6, (zMaxRaw - zMinRaw) * 0.04);
  const grid: ContourPidGrid = {
    xBins,
    yBins,
    zMin: zMinRaw - zPad,
    zMax: zMaxRaw + zPad,
    contourThreshold,
    valueTransform: "log1p"
  };

  const masks = bands.map((band) => rasterizeBand(band, grid));
  const meanMask = new Float32Array(gridSize);
  for (const mask of masks) {
    for (let i = 0; i < gridSize; i += 1) {
      meanMask[i] += mask[i];
    }
  }
  for (let i = 0; i < gridSize; i += 1) {
    meanMask[i] /= Math.max(1, masks.length);
  }

  const areaMean = sumMask(meanMask);
  const scores: ContourPidScore[] = masks.map((mask, index) => {
    const area = sumMask(mask);
    const dot = dotMask(mask, meanMask);
    const inScore = area > EPS ? dot / area : 0;
    const outScore = areaMean > EPS ? dot / areaMean : 0;
    return {
      id: layers[index].id,
      depth: Math.min(inScore, outScore),
      inScore,
      outScore,
      area
    };
  });

  scores.sort((a, b) => {
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

  const depthOrder = scores.map((score) => score.id);
  const displayOrder = buildPidCenterOutOrder(depthOrder);
  const depthByLayerId = new Map(scores.map((score) => [score.id, score.depth]));
  const scoreByLayerId = new Map(scores.map((score) => [score.id, score]));
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
    scores,
    depthByLayerId,
    scoreByLayerId,
    depthOrder,
    displayOrder,
    deepestLayerId,
    meanMask,
    allUnionMask,
    centralUnionMask,
    centralIntersectionMask,
    deepestMask,
    grid
  };
}

function buildLayerBandSeries(layer: LayerInput, tLength: number): LayerBandSeries {
  const lowOuter = new Array<number>(tLength).fill(0);
  const lowInner = new Array<number>(tLength).fill(0);
  const center = new Array<number>(tLength).fill(0);
  const highInner = new Array<number>(tLength).fill(0);
  const highOuter = new Array<number>(tLength).fill(0);

  for (let t = 0; t < tLength; t += 1) {
    const mean = finiteOr(layer.mean[t], 0);
    const p50 = finiteOr(layer.quantiles?.p50?.[t], mean);
    const outerLow = firstFinite(
      layer.quantiles?.p025?.[t],
      layer.quantiles?.p05?.[t],
      layer.quantiles?.p10?.[t],
      layer.lower?.[t],
      mean - 0.5 * Math.max(0, finiteOr(layer.unc?.[t], 0)),
      mean
    );
    const outerHigh = firstFinite(
      layer.quantiles?.p975?.[t],
      layer.quantiles?.p95?.[t],
      layer.quantiles?.p90?.[t],
      layer.upper?.[t],
      mean + 0.5 * Math.max(0, finiteOr(layer.unc?.[t], 0)),
      mean
    );
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

function rasterizeBand(band: LayerBandSeries, grid: ContourPidGrid): Float32Array {
  const mask = new Float32Array(grid.xBins * grid.yBins);
  const dz = grid.yBins <= 1 ? 1 : (grid.zMax - grid.zMin) / (grid.yBins - 1);
  for (let t = 0; t < grid.xBins; t += 1) {
    const lo = transformValue(band.lowOuter[t]);
    const li = transformValue(band.lowInner[t]);
    const hi = transformValue(band.highInner[t]);
    const ho = transformValue(band.highOuter[t]);
    const c = transformValue(band.center[t]);
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
    return (z - lo) / Math.max(EPS, lowInner - lo);
  }
  return (ho - z) / Math.max(EPS, ho - highInner);
}

function transformedExtent(bands: LayerBandSeries[]): [number, number] {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    for (const series of [band.lowOuter, band.highOuter, band.center]) {
      for (const value of series) {
        const z = transformValue(value);
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

function transformValue(value: number): number {
  return Math.log1p(Math.max(0, finiteOr(value, 0)));
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

function firstFinite(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value as number;
    }
  }
  return 0;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
