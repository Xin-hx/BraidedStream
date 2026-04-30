import type { BaselineMode, LayerInput } from "./types";
import { layerUncertaintyAt, validateTimeLengths } from "./validate";

export interface SineStreamHooks {
  /** Center type for baseline: "median" | "mean" | "geometric" | "harmonic" */
  centerType?: "median" | "mean" | "geometric" | "harmonic";
  /** Use SineStream Gaussian weighting (default: true for sineStream mode) */
  useSineStreamGaussian?: boolean;
  /** Smooth radius for post-processing (used only in legacy mode) */
  smoothRadius?: number;
  /** Gaussian sigma for post-processing (used only in legacy mode) */
  gaussianSigma?: number;
  /** Custom gaussian weights for post-processing */
  gaussianWeights?: number[];
  /** L1 wiggle weight (for mode=l1) */
  wiggleWeightL1?: number;
  /** L2 wiggle weight (for mode=l2) */
  wiggleWeightL2?: number;
  /** Anchor weight toward centered baseline for L1/L2 modes */
  centerAnchorWeight?: number;
  /** IRLS iterations used by L1 mode */
  irlsIterations?: number;
  /** IRLS epsilon used by L1 mode */
  irlsEps?: number;
}

export interface MultiscaleEnergyBandDiagnostic {
  scale: number;
  energy: number;
  ratio: number;
  meanSaliency: number;
  maxSaliency: number;
}

export interface MultiscaleBaselineDiagnostics {
  method: "haar-dyadic";
  fallbackUsed: boolean;
  fallbackReason: string | null;
  energyThreshold: number;
  effectiveScaleCount: number;
  verifiedMultiscale: boolean;
  localShiftBudget: number;
  distributedShiftBudget: number;
  scaleBands: MultiscaleEnergyBandDiagnostic[];
  uncertaintySaliency: number[];
  localShiftAbs: number[];
  distributedShiftAbs: number[];
}

export interface MultiscaleBaselineResult {
  baseline: number[];
  diagnostics: MultiscaleBaselineDiagnostics;
}

export function computeBaseline(
  times: number[],
  layers: LayerInput[],
  mode: BaselineMode,
  hooks: SineStreamHooks = {}
): number[] {
  validateTimeLengths(times, layers);
  if (mode === "zero") {
    return new Array(times.length).fill(0);
  }
  if (mode === "center") {
    const totals = sumLayerMeans(times.length, layers);
    return totals.map((v) => -0.5 * v);
  }
  if (mode === "l2") {
    return computeWiggleBaseline(times.length, layers, "l2", hooks);
  }
  if (mode === "l1") {
    return computeWiggleBaseline(times.length, layers, "l1", hooks);
  }
  // mode === "sineStream"
  return computeSineStreamBaseline(times.length, layers, hooks);
}

export function computeUncertaintyAwareBaseline(
  times: number[],
  layers: LayerInput[],
  strength = 0.45
): number[] {
  validateTimeLengths(times, layers);
  const tLength = times.length;
  const kLength = layers.length;
  if (kLength === 0 || tLength === 0) {
    return new Array<number>(tLength).fill(0);
  }

  const total = sumLayerMeans(tLength, layers);
  if (tLength < 2) {
    return total.map((v) => -0.5 * v);
  }

  const clippedStrength = Math.max(0, Math.min(1.5, strength));
  const unc = layers.map((layer) => {
    const arr = new Array<number>(tLength).fill(0);
    for (let t = 0; t < tLength; t += 1) {
      arr[t] = Math.max(0, layerUncertaintyAt(layer, t));
    }
    return arr;
  });

  let uncMin = Number.POSITIVE_INFINITY;
  let uncMax = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < kLength; k += 1) {
    for (let t = 0; t < tLength; t += 1) {
      uncMin = Math.min(uncMin, unc[k][t]);
      uncMax = Math.max(uncMax, unc[k][t]);
    }
  }
  const uncRange = uncMax - uncMin;

  const weights = Array.from({ length: kLength }, () => new Array<number>(tLength).fill(0));
  for (let k = 0; k < kLength; k += 1) {
    for (let t = 0; t < tLength; t += 1) {
      const uNorm = uncRange <= 1e-12 ? 0 : (unc[k][t] - uncMin) / (uncRange + 1e-12);
      const thickness = Math.max(layers[k].mean[t], 1e-12);
      weights[k][t] = thickness * (1 + clippedStrength * uNorm);
    }
  }

  const fPrime = Array.from({ length: kLength }, () => new Array<number>(tLength).fill(0));
  for (let k = 0; k < kLength; k += 1) {
    for (let t = 1; t < tLength; t += 1) {
      fPrime[k][t] = layers[k].mean[t] - layers[k].mean[t - 1];
    }
  }

  const gPrime = new Array<number>(tLength).fill(0);
  for (let t = 1; t < tLength; t += 1) {
    let numerator = 0;
    let denominator = 0;
    let prefix = 0;
    for (let k = 0; k < kLength; k += 1) {
      const d = fPrime[k][t];
      const q = prefix + 0.5 * d;
      const w = weights[k][t];
      numerator += w * q;
      denominator += w;
      prefix += d;
    }
    gPrime[t] = denominator > 1e-12 ? -(numerator / denominator) : 0;
  }

  const baseline = new Array<number>(tLength).fill(0);
  baseline[0] = -0.5 * total[0];
  for (let t = 1; t < tLength; t += 1) {
    baseline[t] = baseline[t - 1] + gPrime[t];
  }

  // Keep average center aligned for visual comparability.
  let centerOffset = 0;
  for (let t = 0; t < tLength; t += 1) {
    centerOffset += baseline[t] + 0.5 * total[t];
  }
  centerOffset /= Math.max(1, tLength);
  for (let t = 0; t < tLength; t += 1) {
    baseline[t] -= centerOffset;
  }

  return baseline;
}

export function computeMultiscaleDistributedBaseline(
  times: number[],
  layers: LayerInput[],
  strength = 0.45,
  hooks: SineStreamHooks = {},
  energyThreshold = 0.08
): MultiscaleBaselineResult {
  validateTimeLengths(times, layers);
  const tLength = times.length;
  const kLength = layers.length;
  const total = sumLayerMeans(tLength, layers);
  const clippedThreshold = Math.max(0, Math.min(1, energyThreshold));
  const localBaseline = computeUncertaintyAwareBaseline(times, layers, strength);
  const emptyDiagnostics = (): MultiscaleBaselineDiagnostics => ({
    method: "haar-dyadic",
    fallbackUsed: true,
    fallbackReason: "degenerate input",
    energyThreshold: clippedThreshold,
    effectiveScaleCount: 0,
    verifiedMultiscale: false,
    localShiftBudget: 0,
    distributedShiftBudget: 0,
    scaleBands: [],
    uncertaintySaliency: new Array<number>(tLength).fill(0),
    localShiftAbs: new Array<number>(tLength).fill(0),
    distributedShiftAbs: new Array<number>(tLength).fill(0)
  });

  if (kLength === 0 || tLength === 0) {
    return {
      baseline: localBaseline,
      diagnostics: emptyDiagnostics()
    };
  }

  const anchorBaselineRaw = computeSineStreamBaseline(tLength, layers, { centerType: hooks.centerType ?? "median" });
  const anchorBaseline = recenterBaseline(anchorBaselineRaw, total);
  const localBaselineCentered = recenterBaseline(localBaseline, total);
  const localShift = localBaselineCentered.map((v, i) => v - anchorBaseline[i]);
  const localShiftAbs = localShift.map((v) => Math.abs(v));
  const localShiftBudget = sumAbs(localShift);

  const uncertaintyVariation = aggregateUncertaintyVariation(layers, tLength);
  const bands = haarDyadicBands(uncertaintyVariation);
  if (bands.length === 0) {
    return {
      baseline: localBaselineCentered,
      diagnostics: {
        ...emptyDiagnostics(),
        fallbackReason: "uncertainty variation unavailable",
        localShiftBudget,
        distributedShiftBudget: localShiftBudget,
        localShiftAbs: localShiftAbs.slice(),
        distributedShiftAbs: localShiftAbs.slice()
      }
    };
  }

  let totalEnergy = 0;
  for (const band of bands) {
    totalEnergy += band.energy;
  }
  if (totalEnergy <= 1e-12) {
    return {
      baseline: localBaselineCentered,
      diagnostics: {
        ...emptyDiagnostics(),
        fallbackReason: "flat uncertainty variation",
        localShiftBudget,
        distributedShiftBudget: localShiftBudget,
        localShiftAbs: localShiftAbs.slice(),
        distributedShiftAbs: localShiftAbs.slice()
      }
    };
  }

  const saliencyDenom = new Array<number>(tLength).fill(0);
  for (const band of bands) {
    for (let t = 0; t < tLength; t += 1) {
      saliencyDenom[t] += band.saliency[t];
    }
  }

  const lambda = bands.map((band) => band.energy / totalEnergy);
  const uncertaintySaliencyRaw = new Array<number>(tLength).fill(0);
  for (let b = 0; b < bands.length; b += 1) {
    const saliency = bands[b].saliency;
    const w = lambda[b];
    for (let t = 0; t < tLength; t += 1) {
      uncertaintySaliencyRaw[t] += w * saliency[t];
    }
  }
  const uncertaintySaliency = normalize01(uncertaintySaliencyRaw);

  const distributedShift = new Array<number>(tLength).fill(0);
  for (let b = 0; b < bands.length; b += 1) {
    const band = bands[b];
    const weighted = new Array<number>(tLength).fill(0);
    for (let t = 0; t < tLength; t += 1) {
      const beta = band.saliency[t] / Math.max(1e-12, saliencyDenom[t]);
      weighted[t] = beta * localShift[t];
    }
    const smoothed = movingAverage(weighted, band.scale);
    const w = lambda[b];
    for (let t = 0; t < tLength; t += 1) {
      distributedShift[t] += w * smoothed[t];
    }
  }

  const distributedShiftZeroMean = removeMean(distributedShift);
  const distributedShiftAligned = scaleToBudget(distributedShiftZeroMean, localShiftBudget);
  const baseline = anchorBaseline.map((v, i) => v + distributedShiftAligned[i]);
  const distributedShiftAbs = distributedShiftAligned.map((v) => Math.abs(v));
  const distributedShiftBudget = sumAbs(distributedShiftAligned);

  const scaleBands: MultiscaleEnergyBandDiagnostic[] = bands.map((band, i) => {
    const saliency = band.saliency;
    let maxSaliency = 0;
    let meanSaliency = 0;
    for (const value of saliency) {
      meanSaliency += value;
      maxSaliency = Math.max(maxSaliency, value);
    }
    meanSaliency /= Math.max(1, saliency.length);
    return {
      scale: band.scale,
      energy: band.energy,
      ratio: lambda[i],
      meanSaliency,
      maxSaliency
    };
  });

  const effectiveScaleCount = scaleBands.filter((band) => band.ratio >= clippedThreshold).length;
  const verifiedMultiscale = effectiveScaleCount >= 3;

  return {
    baseline,
    diagnostics: {
      method: "haar-dyadic",
      fallbackUsed: false,
      fallbackReason: null,
      energyThreshold: clippedThreshold,
      effectiveScaleCount,
      verifiedMultiscale,
      localShiftBudget,
      distributedShiftBudget,
      scaleBands,
      uncertaintySaliency,
      localShiftAbs,
      distributedShiftAbs
    }
  };
}

function sumLayerMeans(tLength: number, layers: LayerInput[]): number[] {
  const totals = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 0; t < tLength; t += 1) {
      totals[t] += layer.mean[t];
    }
  }
  return totals;
}

function computeWiggleBaseline(
  tLength: number,
  layers: LayerInput[],
  mode: "l1" | "l2",
  hooks: SineStreamHooks
): number[] {
  if (layers.length === 0 || tLength === 0) {
    return new Array<number>(tLength).fill(0);
  }
  const centers = centeredBaselineFromLayers(tLength, layers);
  const offsets = buildCenterLineDerivativeOffsets(tLength, layers);
  const deltas = new Array<number>(tLength).fill(0);

  if (mode === "l2") {
    for (let t = 1; t < tLength; t += 1) {
      const arr = offsets[t];
      if (arr.length === 0) {
        deltas[t] = 0;
        continue;
      }
      let sum = 0;
      for (const v of arr) {
        sum += v;
      }
      deltas[t] = -(sum / arr.length);
    }
  } else {
    const iterations = Math.max(1, Math.round(hooks.irlsIterations ?? 12));
    const eps = Math.max(1e-9, hooks.irlsEps ?? 1e-3);
    // Initialize with robust L1 minimizer per time step.
    for (let t = 1; t < tLength; t += 1) {
      const arr = offsets[t];
      deltas[t] = arr.length === 0 ? 0 : -median(arr);
    }
    // IRLS refinement keeps solver deterministic while approximating global L1 optimum.
    for (let it = 0; it < iterations; it += 1) {
      for (let t = 1; t < tLength; t += 1) {
        const arr = offsets[t];
        if (arr.length === 0) {
          deltas[t] = 0;
          continue;
        }
        let wSum = 0;
        let wdSum = 0;
        for (const d of arr) {
          const w = 1 / Math.max(eps, Math.abs(deltas[t] + d));
          wSum += w;
          wdSum += w * d;
        }
        if (wSum > 0) {
          deltas[t] = -(wdSum / wSum);
        }
      }
    }
  }

  const baseline = new Array<number>(tLength).fill(0);
  baseline[0] = centers[0];
  for (let t = 1; t < tLength; t += 1) {
    baseline[t] = baseline[t - 1] + deltas[t];
  }

  const anchor = Math.max(0, hooks.centerAnchorWeight ?? 0.35);
  const wiggle = Math.max(0, mode === "l1" ? hooks.wiggleWeightL1 ?? 1 : hooks.wiggleWeightL2 ?? 1);
  const denom = wiggle + anchor;
  if (denom <= 0) {
    return baseline;
  }
  return baseline.map((v, i) => (wiggle * v + anchor * centers[i]) / denom);
}

function centeredBaselineFromLayers(tLength: number, layers: LayerInput[]): number[] {
  const totals = sumLayerMeans(tLength, layers);
  return totals.map((v) => -0.5 * v);
}

function buildCenterLineDerivativeOffsets(tLength: number, layers: LayerInput[]): number[][] {
  const offsets: number[][] = Array.from({ length: tLength }, () => []);
  if (tLength <= 1 || layers.length === 0) {
    return offsets;
  }
  const prefix = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 1; t < tLength; t += 1) {
      const centerNow = prefix[t] + 0.5 * layer.mean[t];
      const centerPrev = prefix[t - 1] + 0.5 * layer.mean[t - 1];
      offsets[t].push(centerNow - centerPrev);
    }
    for (let t = 0; t < tLength; t += 1) {
      prefix[t] += layer.mean[t];
    }
  }
  return offsets;
}

interface HaarBand {
  level: number;
  scale: number;
  energy: number;
  saliency: number[];
}

function recenterBaseline(baseline: number[], total: number[]): number[] {
  if (baseline.length === 0) {
    return [];
  }
  let centerOffset = 0;
  for (let t = 0; t < baseline.length; t += 1) {
    centerOffset += baseline[t] + 0.5 * total[t];
  }
  centerOffset /= Math.max(1, baseline.length);
  return baseline.map((value) => value - centerOffset);
}

function aggregateUncertaintyVariation(layers: LayerInput[], tLength: number): number[] {
  const uncertainty = new Array<number>(tLength).fill(0);
  for (let t = 0; t < tLength; t += 1) {
    let acc = 0;
    for (const layer of layers) {
      acc += Math.max(0, layerUncertaintyAt(layer, t));
    }
    uncertainty[t] = acc / Math.max(1, layers.length);
  }
  const variation = new Array<number>(tLength).fill(0);
  for (let t = 1; t < tLength; t += 1) {
    variation[t] = Math.abs(uncertainty[t] - uncertainty[t - 1]);
  }
  return variation;
}

function movingAverage(values: number[], window: number): number[] {
  const n = values.length;
  if (n === 0) {
    return [];
  }
  const w = Math.max(1, Math.round(window));
  const half = Math.floor(w / 2);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const left = Math.max(0, i - half);
    const right = Math.min(n - 1, i + half);
    let acc = 0;
    let count = 0;
    for (let j = left; j <= right; j += 1) {
      acc += values[j];
      count += 1;
    }
    out[i] = acc / Math.max(1, count);
  }
  return out;
}

function removeMean(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let meanValue = 0;
  for (const value of values) {
    meanValue += value;
  }
  meanValue /= Math.max(1, values.length);
  return values.map((value) => value - meanValue);
}

function scaleToBudget(values: number[], targetBudget: number): number[] {
  const current = sumAbs(values);
  if (current <= 1e-12 || targetBudget <= 1e-12) {
    return new Array<number>(values.length).fill(0);
  }
  const scale = targetBudget / current;
  return values.map((value) => value * scale);
}

function normalize01(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    minV = Math.min(minV, value);
    maxV = Math.max(maxV, value);
  }
  const range = maxV - minV;
  if (range <= 1e-12) {
    return new Array<number>(values.length).fill(0);
  }
  return values.map((value) => (value - minV) / range);
}

function sumAbs(values: number[]): number {
  let acc = 0;
  for (const value of values) {
    acc += Math.abs(value);
  }
  return acc;
}

function haarDyadicBands(signal: number[]): HaarBand[] {
  const n = signal.length;
  if (n < 2) {
    return [];
  }
  let paddedLength = 1;
  while (paddedLength < n) {
    paddedLength *= 2;
  }
  const padded = new Array<number>(paddedLength).fill(signal[n - 1] ?? 0);
  for (let i = 0; i < n; i += 1) {
    padded[i] = signal[i];
  }

  const bands: HaarBand[] = [];
  let current = padded.slice();
  let level = 1;
  while (current.length >= 2) {
    const next = new Array<number>(Math.floor(current.length / 2)).fill(0);
    const detail = new Array<number>(Math.floor(current.length / 2)).fill(0);
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      const outIndex = i / 2;
      next[outIndex] = (a + b) / Math.sqrt(2);
      detail[outIndex] = (a - b) / Math.sqrt(2);
    }

    let energy = 0;
    for (const value of detail) {
      energy += value * value;
    }
    const scale = 2 ** level;
    const saliency = new Array<number>(paddedLength).fill(0);
    for (let i = 0; i < detail.length; i += 1) {
      const magnitude = Math.abs(detail[i]);
      const start = i * scale;
      const end = Math.min(paddedLength, start + scale);
      for (let t = start; t < end; t += 1) {
        saliency[t] = magnitude;
      }
    }
    bands.push({
      level,
      scale,
      energy,
      saliency: saliency.slice(0, n)
    });
    current = next;
    level += 1;
  }
  return bands;
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

/**
 * SineStream Baseline Computation using Gaussian-weighted adjustments
 * Following: StreamLayout_2norm_Gauss from SineStream paper
 * 
 * The baseline is computed iteratively, where at each time step t,
 * we compute a Gaussian-weighted adjustment based on layer thickness changes.
 */
function computeSineStreamBaseline(tLength: number, layers: LayerInput[], hooks: SineStreamHooks): number[] {
  const centerType = hooks.centerType ?? "median";
  const baseline = new Array<number>(tLength).fill(0);

  // First time point: center centered on total mean
  let totalSize = 0;
  for (const layer of layers) {
    totalSize += layer.mean[0];
  }
  baseline[0] = -0.5 * totalSize;

  // Iteratively compute baseline for each subsequent time point
  for (let i = 1; i < tLength; i += 1) {
    // Compute C: the thickness change metric (median/mean of |dF_j|)
    const thicknessChanges = layers.map((layer) => Math.abs(layer.mean[i] - layer.mean[i - 1]));
    const c = computeThicknessChangeMetric(thicknessChanges, centerType);

    // Compute delta baseline adjustment using Gaussian weighting
    const deltaG = computeGaussianWeightedAdjustment(layers, i, c);
    baseline[i] = baseline[i - 1] + deltaG;
  }

  return baseline;
}

/**
 * Compute the thickness change metric (C value) based on the specified center type
 */
function computeThicknessChangeMetric(changes: number[], centerType: string): number {
  if (changes.length === 0) {
    return 1;
  }

  let curC = 1;
  let nonZeroCount = 0;

  switch (centerType) {
    case "median": {
      const sorted = changes.slice().sort((a, b) => a - b);
      if (sorted.length % 2 !== 0) {
        return sorted[(sorted.length - 1) / 2];
      }
      return 0.5 * (sorted[sorted.length / 2] + sorted[sorted.length / 2 - 1]);
    }
    case "geometric": {
      for (const value of changes) {
        if (value !== 0) {
          nonZeroCount += 1;
        }
      }
      if (nonZeroCount === 0) {
        return curC;
      }
      for (const value of changes) {
        if (value !== 0) {
          curC *= Math.pow(value, 1 / nonZeroCount);
        }
      }
      return curC;
    }
    case "harmonic": {
      curC = 0;
      for (const value of changes) {
        if (value !== 0) {
          curC += 1 / value;
          nonZeroCount += 1;
        }
      }
      if (nonZeroCount === 0 || curC === 0) {
        // Degenerate all-zero changes: keep the baseline update stable.
        return 0;
      }
      return nonZeroCount / curC;
    }
    case "mean": {
      for (const value of changes) {
        if (value !== 0) {
          curC += value;
        }
      }
      return curC / changes.length;
    }
    default:
      return curC;
  }
}
/**
 * Compute Gaussian-weighted baseline adjustment at time step i
 * 
 * Formula: 螖g_i = -危(w_j 脳 Q_i^j) / 危(w_j)
 * where:
 *   w_j = exp(-(dF_i^j)虏 / (2c虏))  [Gaussian weight penalizing large changes]
 *   dF_i^j = thickness change of layer j at time i
 *   Q_i^j = cumulative contribution term
 *   c = thickness change metric
 */
function computeGaussianWeightedAdjustment(layers: LayerInput[], i: number, c: number): number {
  const n = layers.length;
  const dFi = new Array<number>(n);
  const Fi = new Array<number>(n);
  const Qi = new Array<number>(n);

  for (let j = 0; j < n; j += 1) {
    const current = layers[j].mean[i];
    const previous = layers[j].mean[i - 1];
    Fi[j] = current;
    dFi[j] = current - previous;
  }

  for (let j = 0; j < n; j += 1) {
    let p = 0;
    for (let k = 0; k <= j; k += 1) {
      p += 2 * dFi[k];
    }
    Qi[j] = (p - dFi[j]) / 2;
  }

  let numerator = 0;
  let denominator = 0;
  for (let j = 0; j < n; j += 1) {
    let gaussianWeight = 1;
    if (c !== 0 && Number.isFinite(c)) {
      gaussianWeight = Math.exp(-((dFi[j] * dFi[j]) / (2 * c * c)));
    }
    const contribution = gaussianWeight * Fi[j];
    denominator += contribution;
    numerator += contribution * Qi[j];
  }

  if (Number.isFinite(denominator) === false || Math.abs(denominator) <= 1e-12) {
    let totalSizePrev = 0;
    for (let j = 0; j < n; j += 1) {
      totalSizePrev += layers[j].mean[i - 1];
    }
    return totalSizePrev / 2;
  }

  return -(numerator / denominator);
}

