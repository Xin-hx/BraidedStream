import type { LayerInput, PidTimeOrderMode, PidUncertaintySource } from "../types";
import { EPSILON, clamp, finiteOr, firstFinite, median, sortPair, sum } from "../utils";

type QuantileMaskKey = "p025" | "p10" | "p25" | "p50" | "p75" | "p90" | "p975";

interface QuantileMaskMembershipSpec {
  key: QuantileMaskKey;
  membership: number;
}

interface LayerBand {
  low: number[];
  high: number[];
  center: number[];
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
  deepestLayerId: string | null;
  meanMask: Float32Array;
  allUnionMask: Float32Array;
  centralUnionMask: Float32Array;
  centralIntersectionMask: Float32Array;
  deepestMask: Float32Array;
  grid: ContourPidGrid;
}

export interface PidOrderingCompositeScore {
  layerId: string;
  C: number;
  R: number;
  score: number;
}

export interface ComputePidOrderingScoresInput {
  layerIds: string[];
  D_cross: ReadonlyMap<string, number[]>;
  temporalSelfInclusion?: ReadonlyMap<string, number[]>;
  mode: PidTimeOrderMode;
  alpha?: number;
}

const QUANTILE_BAND_PAIRS: Array<readonly [string, string]> = [
  ["p025", "p975"],
  ["p05", "p95"],
  ["p10", "p90"],
  ["p25", "p75"]
];

const QUANTILE_MASK_KEY_ORDER: QuantileMaskKey[] = ["p025", "p10", "p25", "p50", "p75", "p90", "p975"];

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

export abstract class BasePidCalculator<TOptions extends { uncertaintySource?: PidUncertaintySource } = {}> {
  protected readonly uncertaintySource: PidUncertaintySource;

  protected constructor(
    protected readonly layers: LayerInput[],
    protected readonly options: TOptions
  ) {
    this.uncertaintySource = options.uncertaintySource ?? "value";
  }

  protected layerCenterValue(layer: LayerInput, timeIndex: number): number {
    if (this.uncertaintySource === "poportion") {
      return finiteOr(layer.poportionMean?.[timeIndex], finiteOr(layer.poportionQuantiles?.p50?.[timeIndex], 0));
    }
    return finiteOr(layer.height[timeIndex], 0);
  }

  protected quantilesForSource(layer: LayerInput) {
    return this.uncertaintySource === "poportion" ? layer.poportionQuantiles ?? layer.quantiles : layer.quantiles;
  }

  protected resolveBand(layer: LayerInput, timeIndex: number, meanValue: number): [number, number] {
    const quantiles = this.quantilesForSource(layer);

    for (const [lowKey, highKey] of QUANTILE_BAND_PAIRS) {
      const qLow = finiteOr(quantiles?.[lowKey]?.[timeIndex], Number.NaN);
      const qHigh = finiteOr(quantiles?.[highKey]?.[timeIndex], Number.NaN);
      if (Number.isFinite(qLow) && Number.isFinite(qHigh)) {
        return sortPair(qLow, qHigh);
      }
    }

    const lower = finiteOr(
      this.uncertaintySource === "poportion" ? layer.poportionLower?.[timeIndex] : layer.lower?.[timeIndex],
      Number.NaN
    );
    const upper = finiteOr(
      this.uncertaintySource === "poportion" ? layer.poportionUpper?.[timeIndex] : layer.upper?.[timeIndex],
      Number.NaN
    );
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      return sortPair(lower, upper);
    }

    const unc = finiteOr(
      this.uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex],
      Number.NaN
    );
    if (Number.isFinite(unc)) {
      const halfWidth = Math.max(0, unc) * 0.5;
      return sortPair(meanValue - halfWidth, meanValue + halfWidth);
    }

    return [meanValue, meanValue];
  }

  protected resolveQuantileMaskValues(layer: LayerInput, timeIndex: number, meanValue: number): Record<QuantileMaskKey, number> {
    const quantiles = this.quantilesForSource(layer);
    const uncertainty = Math.max(
      0,
      finiteOr(this.uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex], 0)
    );

    const p025 = firstFinite(
      quantiles?.p025?.[timeIndex],
      quantiles?.p05?.[timeIndex],
      quantiles?.p10?.[timeIndex],
      this.uncertaintySource === "poportion" ? layer.poportionLower?.[timeIndex] : layer.lower?.[timeIndex],
      meanValue - 0.5 * uncertainty,
      meanValue
    );
    const p975 = firstFinite(
      quantiles?.p975?.[timeIndex],
      quantiles?.p95?.[timeIndex],
      quantiles?.p90?.[timeIndex],
      this.uncertaintySource === "poportion" ? layer.poportionUpper?.[timeIndex] : layer.upper?.[timeIndex],
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
}

export class IntervalPidCalculator extends BasePidCalculator<PidOrderingOptions> {
  constructor(layers: LayerInput[], options: PidOrderingOptions = {}) {
    super(layers, options);
  }

  compute(): PidOrderingResult {
    if (this.layers.length === 0) {
      return {
        order: [],
        scores: [],
        depthByLayerId: new Map<string, number>(),
        depthSeriesByLayerId: new Map<string, number[]>()
      };
    }

    const excludeSelf = this.options.excludeSelf !== false;
    const widthPenaltyPower = Math.max(0, this.options.widthPenaltyPower ?? 1);
    const minComparators = Math.max(1, Math.floor(this.options.minComparators ?? 2));
    const tLength = this.layers[0].height.length;
    const bands = this.layers.map((layer) => this.buildLayerBand(layer, tLength));
    const scores: PidOrderingScore[] = [];
    const depthByLayerId = new Map<string, number>();
    const depthSeriesByLayerId = new Map<string, number[]>();

    for (let i = 0; i < this.layers.length; i += 1) {
      const series = new Array<number>(tLength).fill(Number.NaN);
      let validTimeCount = 0;
      let depthSum = 0;

      for (let t = 0; t < tLength; t += 1) {
        const center = bands[i].center[t];
        if (!Number.isFinite(center)) {
          continue;
        }

        const widths: number[] = [];
        for (let j = 0; j < this.layers.length; j += 1) {
          if (excludeSelf && i === j) {
            continue;
          }
          const low = bands[j].low[t];
          const high = bands[j].high[t];
          if (Number.isFinite(low) && Number.isFinite(high)) {
            widths.push(Math.max(1e-9, high - low));
          }
        }
        if (widths.length < minComparators) {
          continue;
        }

        const widthRef = Math.max(1e-9, median(widths));
        let covered = 0;
        let total = 0;

        for (let j = 0; j < this.layers.length; j += 1) {
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
      const totalMean = sum(this.layers[i].height);
      const score: PidOrderingScore = { id: this.layers[i].id, depth, totalMean, validTimeCount };
      scores.push(score);
      depthByLayerId.set(this.layers[i].id, depth);
      depthSeriesByLayerId.set(this.layers[i].id, series);
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

  private buildLayerBand(layer: LayerInput, tLength: number): LayerBand {
    const low = new Array<number>(tLength).fill(0);
    const high = new Array<number>(tLength).fill(0);
    const center = new Array<number>(tLength).fill(0);

    for (let t = 0; t < tLength; t += 1) {
      const meanValue = this.layerCenterValue(layer, t);
      const quantiles = this.quantilesForSource(layer);
      const q50 = finiteOr(quantiles?.p50?.[t], meanValue);
      const [lo, hi] = this.resolveBand(layer, t, meanValue);
      low[t] = lo;
      high[t] = hi;
      center[t] = clamp(q50, lo, hi);
    }

    return { low, high, center };
  }
}

export class ContourPidCalculator extends BasePidCalculator<ContourPidOptions> {
  constructor(layers: LayerInput[], options: ContourPidOptions = {}) {
    super(layers, options);
  }

  compute(): ContourPidResult {
    const xBins = this.layers[0]?.height.length ?? 0;
    const yBins = Math.max(16, Math.round(this.options.yBins ?? 180));
    const contourThreshold = clamp(this.options.contourThreshold ?? 0.5, 0, 1);
    const centralFraction = clamp(this.options.centralFraction ?? 0.5, 0, 1);
    const gridSize = xBins * yBins;

    if (this.layers.length === 0 || xBins === 0) {
      return this.emptyContourPidResult(xBins, yBins, contourThreshold);
    }

    const bands = this.layers.map((layer) => this.buildLayerBandSeries(layer, xBins));
    const grid = this.buildContourGrid(bands, xBins, yBins, contourThreshold);
    const masks = bands.map((band) => this.rasterizeBand(band, grid));
    const meanMask = this.averageMasks(masks, gridSize);
    const scores = this.sortContourScores(this.scoreMasks(masks, meanMask));

    const depthOrder = scores.map((score) => score.id);
    const depthByLayerId = new Map(scores.map((score) => [score.id, score.depth]));
    const scoreByLayerId = new Map(scores.map((score) => [score.id, score]));
    const boxplotMasks = this.buildContourBoxplotMasks(masks, scores, centralFraction, gridSize);

    return {
      scores,
      depthByLayerId,
      scoreByLayerId,
      depthOrder,
      deepestLayerId: boxplotMasks.deepestLayerId,
      meanMask,
      allUnionMask: boxplotMasks.allUnionMask,
      centralUnionMask: boxplotMasks.centralUnionMask,
      centralIntersectionMask: boxplotMasks.centralIntersectionMask,
      deepestMask: boxplotMasks.deepestMask,
      grid
    };
  }

  private emptyContourPidResult(xBins: number, yBins: number, contourThreshold: number): ContourPidResult {
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
      deepestLayerId: null,
      meanMask: emptyMask,
      allUnionMask: emptyMask,
      centralUnionMask: emptyMask,
      centralIntersectionMask: emptyMask,
      deepestMask: emptyMask,
      grid
    };
  }

  private buildContourGrid(
    bands: LayerBandSeries[],
    xBins: number,
    yBins: number,
    contourThreshold: number
  ): ContourPidGrid {
    const valueTransform = this.uncertaintySource === "poportion" ? "linear" : "log1p";
    const [zMinRaw, zMaxRaw] = transformedExtent(bands, valueTransform);
    const zPad = Math.max(1e-6, (zMaxRaw - zMinRaw) * 0.04);
    const zMin = this.uncertaintySource === "poportion" ? Math.max(0, zMinRaw - zPad) : zMinRaw - zPad;
    const zMax = zMaxRaw + zPad;
    return {
      xBins,
      yBins,
      zMin,
      zMax: zMax > zMin ? zMax : zMin + 1e-6,
      contourThreshold,
      valueTransform
    };
  }

  private averageMasks(masks: Float32Array[], gridSize: number): Float32Array {
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

  private scoreMasks(masks: Float32Array[], meanMask: Float32Array): ContourPidScore[] {
    const areaMean = sumMask(meanMask);
    return masks.map((mask, index) => {
      const area = sumMask(mask);
      const dot = dotMask(mask, meanMask);
      const inScore = area > EPSILON ? dot / area : 0;
      const outScore = areaMean > EPSILON ? dot / areaMean : 0;
      return {
        id: this.layers[index].id,
        depth: Math.min(inScore, outScore),
        inScore,
        outScore,
        area
      };
    });
  }

  private sortContourScores(scores: ContourPidScore[]): ContourPidScore[] {
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

  private buildContourBoxplotMasks(
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

    for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex += 1) {
      const mask = masks[layerIndex];
      const isCentral = centralIds.has(this.layers[layerIndex].id);
      for (let i = 0; i < gridSize; i += 1) {
        allUnionMask[i] = Math.max(allUnionMask[i], mask[i]);
        if (isCentral) {
          centralUnionMask[i] = Math.max(centralUnionMask[i], mask[i]);
          centralIntersectionMask[i] = Math.min(centralIntersectionMask[i], mask[i]);
        }
      }
    }

    const deepestLayerId = scores[0]?.id ?? null;
    const deepestIndex = deepestLayerId ? this.layers.findIndex((layer) => layer.id === deepestLayerId) : -1;
    const deepestMask = deepestIndex >= 0 ? masks[deepestIndex].slice() : new Float32Array(gridSize);

    return {
      deepestLayerId,
      allUnionMask,
      centralUnionMask,
      centralIntersectionMask,
      deepestMask
    };
  }

  private buildLayerBandSeries(layer: LayerInput, tLength: number): LayerBandSeries {
    const controlPoints = CONTOUR_MASK_MEMBERSHIP.map((item) => ({
      key: item.key,
      membership: item.membership,
      values: new Array<number>(tLength).fill(0)
    }));

    for (let t = 0; t < tLength; t += 1) {
      const mean = this.layerCenterValue(layer, t);
      const values = this.resolveQuantileMaskValues(layer, t, mean);
      for (const point of controlPoints) {
        point.values[t] = values[point.key];
      }
    }

    return { controlPoints };
  }

  private rasterizeBand(band: LayerBandSeries, grid: ContourPidGrid): Float32Array {
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
}

export class TimePidCalculator extends BasePidCalculator {
  constructor() {
    super([], {});
  }

  computeTemporalSelfInclusion(depthSeriesByLayerId: ReadonlyMap<string, number[]>): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const [layerId, series] of depthSeriesByLayerId.entries()) {
      const tsi: number[] = [];
      for (let t = 1; t < series.length; t += 1) {
        const prev = series[t - 1];
        const next = series[t];
        if (!Number.isFinite(prev) || !Number.isFinite(next)) {
          tsi.push(Number.NaN);
          continue;
        }
        tsi.push(clamp(1 - Math.abs(next - prev), 0, 1));
      }
      out.set(layerId, tsi);
    }
    return out;
  }

  computeOrderingScores(input: ComputePidOrderingScoresInput): PidOrderingCompositeScore[] {
    const alpha = clamp(input.alpha ?? 0.8, 0, 1);
    const out: PidOrderingCompositeScore[] = [];

    for (const layerId of input.layerIds) {
      const dSeries = input.D_cross.get(layerId) ?? [];
      const cValues = dSeries.filter((value) => Number.isFinite(value));
      const C = cValues.length > 0 ? sum(cValues) / cValues.length : 0;

      const tsiSeries = input.temporalSelfInclusion?.get(layerId) ?? [];
      const rValues = tsiSeries.filter((value) => Number.isFinite(value));
      const R = rValues.length > 0 ? sum(rValues) / rValues.length : 0;

      const score = input.mode === "layer_pid_time_weighted" ? alpha * C + (1 - alpha) * R : C;
      out.push({ layerId, C, R, score });
    }

    out.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.C !== a.C) {
        return b.C - a.C;
      }
      if (b.R !== a.R) {
        return b.R - a.R;
      }
      return a.layerId.localeCompare(b.layerId);
    });

    return out;
  }
}

export function computePidOrdering(layers: LayerInput[], options: PidOrderingOptions = {}): PidOrderingResult {
  return new IntervalPidCalculator(layers, options).compute();
}

export function computeContourPid(layers: LayerInput[], options: ContourPidOptions = {}): ContourPidResult {
  return new ContourPidCalculator(layers, options).compute();
}

export function computeTemporalSelfInclusion(
  depthSeriesByLayerId: ReadonlyMap<string, number[]>
): Map<string, number[]> {
  return new TimePidCalculator().computeTemporalSelfInclusion(depthSeriesByLayerId);
}

export function computePidOrderingScores(input: ComputePidOrderingScoresInput): PidOrderingCompositeScore[] {
  return new TimePidCalculator().computeOrderingScores(input);
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
