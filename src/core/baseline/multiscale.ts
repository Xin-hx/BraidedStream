import type { LayerInput } from "../types";
import { clamp, normalize01, sumAbs } from "../utils";
import { diffSeries, maxAbsStep, meanAbsStep, meanCurvature, movingAverage, removeMean } from "../series";
import { validateTimeLengths } from "../validate";
import { computeSineStreamBaseline } from "./sineStream";
import { sumLayerHeights } from "./compute";
import type {
  BaselineParameters,
  MultiscaleBaselineDiagnostics,
  MultiscaleBaselineResult,
  MultiscaleEnergyBandDiagnostic
} from "./types";

/** Redistribute SineStream centerline derivative bursts through layer-slope multiscale wave bases. */
export function computeMultiscaleDistributedBaseline(
  times: number[],
  layers: LayerInput[],
  strength = 0.45,
  hooks: BaselineParameters = {},
  energyThreshold = 0.08
): MultiscaleBaselineResult {
  validateTimeLengths(times, layers);
  const tLength = times.length;
  const kLength = layers.length;
  const total = sumLayerHeights(tLength, layers);
  const clippedThreshold = clamp(energyThreshold, 0, 1);
  const clippedStrength = clamp(strength, 0, 1.5);
  const emptyDiagnostics = (): MultiscaleBaselineDiagnostics => ({
    method: "haar-dyadic",
    fallbackUsed: true,
    fallbackReason: "degenerate input",
    energyThreshold: clippedThreshold,
    effectiveScaleCount: 0,
    selectedScaleCount: 0,
    selectedScales: [],
    verifiedMultiscale: false,
    localShiftBudget: 0,
    distributedShiftBudget: 0,
    objectiveBefore: 0,
    objectiveAfter: 0,
    meanSlopeBefore: 0,
    meanSlopeAfter: 0,
    maxSlopeBefore: 0,
    maxSlopeAfter: 0,
    curvatureBefore: 0,
    curvatureAfter: 0,
    burstBefore: 0,
    burstAfter: 0,
    derivativeConcentrationBefore: 0,
    derivativeConcentrationAfter: 0,
    centerlineSlopeCoverageBefore: 0,
    centerlineSlopeCoverageAfter: 0,
    globalMeanSlopeGuardrailPassed: false,
    scaleCoefficients: [],
    scaleBands: [],
    uncertaintySaliency: new Array<number>(tLength).fill(0),
    localShiftAbs: new Array<number>(tLength).fill(0),
    distributedShiftAbs: new Array<number>(tLength).fill(0)
  });

  if (kLength === 0 || tLength === 0) {
    return {
      baseline: new Array<number>(tLength).fill(0),
      diagnostics: emptyDiagnostics()
    };
  }

  const anchorBaselineRaw = computeSineStreamBaseline(tLength, layers, { centerType: hooks.centerType ?? "median" });
  const anchorBaseline = recenterBaseline(anchorBaselineRaw, total);
  const anchorCenterline = streamCenterlineFromBaseline(anchorBaseline, total);
  const anchorCenterlineDerivative = diffSeries(anchorCenterline);
  const localShiftAbs = anchorCenterlineDerivative.map((value) => Math.abs(value));

  const slopeSignal = aggregateMultiscaleLayerSlopeSignal(layers, tLength);
  const bands = haarDyadicBands(slopeSignal).map((band) => ({
    ...band,
    saliency: blendScaleSaliencyWithLevel(band.saliency, slopeSignal)
  }));
  if (bands.length === 0) {
    return {
      baseline: anchorBaseline,
      diagnostics: {
        ...emptyDiagnostics(),
        fallbackReason: "layer-slope multiscale signal unavailable",
        localShiftBudget: 0,
        distributedShiftBudget: 0,
        localShiftAbs: localShiftAbs.slice(),
        distributedShiftAbs: new Array<number>(tLength).fill(0),
        globalMeanSlopeGuardrailPassed: true
      }
    };
  }

  let totalEnergy = 0;
  for (const band of bands) {
    totalEnergy += band.energy;
  }
  if (totalEnergy <= 1e-12) {
    return {
      baseline: anchorBaseline,
      diagnostics: {
        ...emptyDiagnostics(),
        fallbackReason: "flat layer-slope multiscale signal",
        localShiftBudget: 0,
        distributedShiftBudget: 0,
        localShiftAbs: localShiftAbs.slice(),
        distributedShiftAbs: new Array<number>(tLength).fill(0),
        globalMeanSlopeGuardrailPassed: true
      }
    };
  }

  const lambda = bands.map((band) => band.energy / totalEnergy);
  const uncertaintySaliency = slopeSignal.slice();

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

  const selected = selectScaleBands(bands, lambda, clippedThreshold, 6);
  const bases = selected.map((item) => ({
    scale: item.band.scale,
    ratio: item.ratio,
    values: buildSlopeWaveShiftBasis(item.band, anchorCenterlineDerivative, clippedStrength)
  }));
  const localShiftBudget = bases.reduce((acc, basis) => acc + sumAbs(basis.values), 0);
  const optimized = optimizeScaleCoefficients(layers, anchorBaseline, bases, localShiftBudget);
  const distributedShiftAligned = optimized.shift;
  const baseline = recenterBaseline(
    anchorBaseline.map((value, i) => value + distributedShiftAligned[i]),
    total
  );
  const distributedShift = baseline.map((value, i) => value - anchorBaseline[i]);
  const distributedShiftAbs = distributedShift.map((v) => Math.abs(v));
  const distributedShiftBudget = sumAbs(distributedShift);
  const effectiveScaleCount = optimized.coefficients.filter((value) => Math.abs(value) > 1e-6).length;
  const verifiedMultiscale =
    selected.length >= 2 &&
    effectiveScaleCount > 0 &&
    optimized.objectiveAfter < optimized.objectiveBefore - 1e-9 &&
    optimized.globalMeanSlopeGuardrailPassed;

  return {
    baseline,
    diagnostics: {
      method: "haar-dyadic",
      fallbackUsed: false,
      fallbackReason: null,
      energyThreshold: clippedThreshold,
      effectiveScaleCount,
      selectedScaleCount: selected.length,
      selectedScales: selected.map((item) => item.band.scale),
      verifiedMultiscale,
      localShiftBudget,
      distributedShiftBudget,
      objectiveBefore: optimized.objectiveBefore,
      objectiveAfter: optimized.objectiveAfter,
      meanSlopeBefore: optimized.metricsBefore.meanSlope,
      meanSlopeAfter: optimized.metricsAfter.meanSlope,
      maxSlopeBefore: optimized.metricsBefore.maxSlope,
      maxSlopeAfter: optimized.metricsAfter.maxSlope,
      curvatureBefore: optimized.metricsBefore.curvature,
      curvatureAfter: optimized.metricsAfter.curvature,
      burstBefore: optimized.metricsBefore.maxBaselineDerivative,
      burstAfter: optimized.metricsAfter.maxBaselineDerivative,
      derivativeConcentrationBefore: optimized.metricsBefore.derivativeConcentration,
      derivativeConcentrationAfter: optimized.metricsAfter.derivativeConcentration,
      centerlineSlopeCoverageBefore: optimized.metricsBefore.centerlineSlopeCoverage,
      centerlineSlopeCoverageAfter: optimized.metricsAfter.centerlineSlopeCoverage,
      globalMeanSlopeGuardrailPassed: optimized.globalMeanSlopeGuardrailPassed,
      scaleCoefficients: bases.map((basis, index) => ({
        scale: basis.scale,
        coefficient: optimized.coefficients[index] ?? 0
      })),
      scaleBands,
      uncertaintySaliency,
      localShiftAbs,
      distributedShiftAbs
    }
  };
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

function streamCenterlineFromBaseline(baseline: number[], total: number[]): number[] {
  return baseline.map((value, index) => value + 0.5 * (total[index] ?? 0));
}

function aggregateMultiscaleLayerSlopeSignal(layers: LayerInput[], tLength: number): number[] {
  const slope = new Array<number>(tLength).fill(0);
  for (let t = 1; t < tLength; t += 1) {
    let acc = 0;
    let mass = 0;
    for (const layer of layers) {
      const previous = Math.max(0, layer.height[t - 1] ?? 0);
      const current = Math.max(0, layer.height[t] ?? 0);
      acc += Math.abs(current - previous);
      mass += 0.5 * (previous + current);
    }
    slope[t] = acc / Math.max(1e-12, mass);
  }
  const variation = new Array<number>(tLength).fill(0);
  for (let t = 1; t < tLength; t += 1) {
    variation[t] = Math.abs(slope[t] - slope[t - 1]);
  }
  const level = normalize01(slope);
  const variationLevel = normalize01(variation);
  return level.map((value, t) => 0.75 * value + 0.25 * variationLevel[t]);
}

function blendScaleSaliencyWithLevel(scaleSaliency: number[], levelSignal: number[]): number[] {
  const detail = normalize01(scaleSaliency);
  const out = new Array<number>(scaleSaliency.length).fill(0);
  for (let t = 0; t < scaleSaliency.length; t += 1) {
    const level = levelSignal[t] ?? 0;
    out[t] = 0.5 * detail[t] + 0.5 * level;
  }
  return out;
}

interface SelectedScaleBand {
  band: HaarBand;
  ratio: number;
}

interface ScaleShiftBasis {
  scale: number;
  ratio: number;
  values: number[];
}

interface BaselineOptimizationMetrics {
  meanSlope: number;
  maxSlope: number;
  curvature: number;
  localMeanSlope: number;
  localCurvature: number;
  centerlineMeanSlope: number;
  maxBaselineDerivative: number;
  derivativeConcentration: number;
  localDerivativeConcentration: number;
  burstMassShare: number;
  localBurstMassShare: number;
  windowDerivativeConcentrations: number[];
  windowBurstMassShares: number[];
  centerlineCurvature: number;
  centerlineSlopeCoverage: number;
}

interface CoefficientOptimizationResult {
  shift: number[];
  coefficients: number[];
  objectiveBefore: number;
  objectiveAfter: number;
  metricsBefore: BaselineOptimizationMetrics;
  metricsAfter: BaselineOptimizationMetrics;
  globalMeanSlopeGuardrailPassed: boolean;
}

function selectScaleBands(bands: HaarBand[], ratios: number[], threshold: number, maxCount: number): SelectedScaleBand[] {
  const ranked = bands
    .map((band, index) => ({ band, ratio: ratios[index] ?? 0 }))
    .filter((item) => Number.isFinite(item.ratio) && item.ratio > 0)
    .sort((a, b) => {
      if (b.ratio !== a.ratio) {
        return b.ratio - a.ratio;
      }
      return a.band.scale - b.band.scale;
    });
  if (ranked.length === 0) {
    return [];
  }

  const selected = ranked.filter((item) => item.ratio >= threshold);
  const thresholded = selected.length > 0 ? selected : [ranked[0]];
  return thresholded.slice(0, Math.max(1, Math.round(maxCount)));
}

function buildSlopeWaveShiftBasis(band: HaarBand, anchorCenterlineDerivative: number[], strength: number): number[] {
  const length = anchorCenterlineDerivative.length;
  const saliency = normalize01(band.saliency);
  const localizedDerivative = new Array<number>(length).fill(0);
  for (let t = 1; t < length; t += 1) {
    localizedDerivative[t] = saliency[t] * anchorCenterlineDerivative[t];
  }

  const redistributed = movingAverage(localizedDerivative, Math.max(3, band.scale * 2 + 1));
  const derivativeBasis = new Array<number>(length).fill(0);
  for (let t = 1; t < length; t += 1) {
    derivativeBasis[t] = redistributed[t] - localizedDerivative[t];
  }

  let derivativeMean = 0;
  for (let t = 1; t < length; t += 1) {
    derivativeMean += derivativeBasis[t];
  }
  derivativeMean /= Math.max(1, length - 1);
  for (let t = 1; t < length; t += 1) {
    derivativeBasis[t] -= derivativeMean;
  }

  const shift = new Array<number>(length).fill(0);
  for (let t = 1; t < length; t += 1) {
    shift[t] = shift[t - 1] + strength * derivativeBasis[t];
  }
  return removeMean(shift);
}

function optimizeScaleCoefficients(
  layers: LayerInput[],
  anchorBaseline: number[],
  bases: ScaleShiftBasis[],
  localShiftBudget: number
): CoefficientOptimizationResult {
  const metricsBefore = baselineOptimizationMetrics(layers, anchorBaseline);
  const objectiveBefore = baselineObjective(metricsBefore, metricsBefore, 0, localShiftBudget);
  let coefficients = new Array<number>(bases.length).fill(0);
  const emptyShift = new Array<number>(anchorBaseline.length).fill(0);
  let bestShift = emptyShift;
  let bestMetrics = metricsBefore;
  let bestObjective = objectiveBefore;
  const coefficientGrid = [-1, -0.75, -0.5, -0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35, 0.5, 0.75, 1];

  const evaluate = (candidateCoefficients: number[]) => {
    const shift = combineBasisShift(bases, candidateCoefficients);
    const baseline = anchorBaseline.map((value, index) => value + shift[index]);
    const metrics = baselineOptimizationMetrics(layers, baseline);
    const objective = baselineObjective(metrics, metricsBefore, sumAbs(shift), localShiftBudget);
    return { shift, metrics, objective };
  };

  const rank = (candidate: { metrics: BaselineOptimizationMetrics; objective: number }) =>
    rankedCoefficientObjective(candidate.objective, candidate.metrics, metricsBefore);
  let bestRank = rank({ metrics: bestMetrics, objective: bestObjective });
  const beamBest = runCoefficientBeamSearch(bases.length, coefficientGrid, evaluate, rank);
  if (beamBest && beamBest.rank < bestRank - 1e-9) {
    coefficients = beamBest.coefficients.slice();
    bestShift = beamBest.shift;
    bestMetrics = beamBest.metrics;
    bestObjective = beamBest.objective;
    bestRank = beamBest.rank;
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (let basisIndex = 0; basisIndex < bases.length; basisIndex += 1) {
      let localBestCoefficient = coefficients[basisIndex];
      let localBestShift = bestShift;
      let localBestMetrics = bestMetrics;
      let localBestObjective = bestObjective;
      let localBestRank = bestRank;

      for (const coefficient of coefficientGrid) {
        if (Math.abs(coefficient - coefficients[basisIndex]) <= 1e-12) {
          continue;
        }
        const candidateCoefficients = coefficients.slice();
        candidateCoefficients[basisIndex] = coefficient;
        const candidate = evaluate(candidateCoefficients);
        const candidateRank = rank(candidate);
        if (candidateRank < localBestRank - 1e-9) {
          localBestCoefficient = coefficient;
          localBestShift = candidate.shift;
          localBestMetrics = candidate.metrics;
          localBestObjective = candidate.objective;
          localBestRank = candidateRank;
        }
      }

      if (localBestRank < bestRank - 1e-9) {
        coefficients[basisIndex] = localBestCoefficient;
        bestShift = localBestShift;
        bestMetrics = localBestMetrics;
        bestObjective = localBestObjective;
        bestRank = localBestRank;
        improved = true;
      }
    }
    if (!improved) {
      break;
    }
  }

  const guarded = applyLayerGeometryGuardrail(coefficients, evaluate, metricsBefore, {
    shift: bestShift,
    metrics: bestMetrics,
    objective: bestObjective
  });
  const guardedCoefficients = guarded.scale === 1 ? coefficients : coefficients.map((value) => value * guarded.scale);

  return {
    shift: removeMean(guarded.shift),
    coefficients: guardedCoefficients,
    objectiveBefore,
    objectiveAfter: guarded.objective,
    metricsBefore,
    metricsAfter: guarded.metrics,
    globalMeanSlopeGuardrailPassed:
      guarded.metrics.meanSlope <= metricsBefore.meanSlope * 1.05 + 1e-9 &&
      guarded.metrics.curvature <= metricsBefore.curvature * 1.05 + 1e-9
  };
}

function runCoefficientBeamSearch(
  length: number,
  coefficientGrid: number[],
  evaluate: (candidateCoefficients: number[]) => { shift: number[]; metrics: BaselineOptimizationMetrics; objective: number },
  rank: (candidate: { metrics: BaselineOptimizationMetrics; objective: number }) => number
):
  | {
      coefficients: number[];
      shift: number[];
      metrics: BaselineOptimizationMetrics;
      objective: number;
      rank: number;
    }
  | null {
  if (length === 0) {
    return null;
  }

  const beamWidth = Math.max(18, Math.min(72, length * 12));
  let beam: Array<{
    coefficients: number[];
    shift: number[];
    metrics: BaselineOptimizationMetrics;
    objective: number;
    rank: number;
  }> = [];

  const zero = new Array<number>(length).fill(0);
  const initial = evaluate(zero);
  beam.push({ coefficients: zero, ...initial, rank: rank(initial) });

  for (let basisIndex = 0; basisIndex < length; basisIndex += 1) {
    const expanded: typeof beam = [];
    for (const item of beam) {
      for (const coefficient of coefficientGrid) {
        const candidateCoefficients = item.coefficients.slice();
        candidateCoefficients[basisIndex] = coefficient;
        const candidate = evaluate(candidateCoefficients);
        expanded.push({
          coefficients: candidateCoefficients,
          ...candidate,
          rank: rank(candidate)
        });
      }
    }
    expanded.sort((a, b) => a.rank - b.rank);
    beam = dedupeCoefficientBeam(expanded).slice(0, beamWidth);
  }

  return beam[0] ?? null;
}

function dedupeCoefficientBeam<T extends { coefficients: number[] }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = item.coefficients.map((value) => value.toFixed(3)).join(",");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function applyLayerGeometryGuardrail(
  coefficients: number[],
  evaluate: (candidateCoefficients: number[]) => { shift: number[]; metrics: BaselineOptimizationMetrics; objective: number },
  reference: BaselineOptimizationMetrics,
  best: { shift: number[]; metrics: BaselineOptimizationMetrics; objective: number }
): { shift: number[]; metrics: BaselineOptimizationMetrics; objective: number; scale: number } {
  const passesGuardrail = (metrics: BaselineOptimizationMetrics) =>
    metrics.meanSlope <= reference.meanSlope * 1.05 + 1e-9 &&
    metrics.curvature <= reference.curvature * 1.05 + 1e-9 &&
    metrics.localMeanSlope <= reference.localMeanSlope * 1.05 + 1e-9 &&
    metrics.localCurvature <= reference.localCurvature * 1.05 + 1e-9;

  if (passesGuardrail(best.metrics)) {
    return { ...best, scale: 1 };
  }

  let guarded: { shift: number[]; metrics: BaselineOptimizationMetrics; objective: number; scale: number } | null = null;
  for (const scale of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0]) {
    const candidate = evaluate(coefficients.map((value) => value * scale));
    if (!passesGuardrail(candidate.metrics)) {
      continue;
    }
    if (!guarded || candidate.objective < guarded.objective) {
      guarded = { ...candidate, scale };
    }
  }

  return guarded ?? { ...best, scale: 1 };
}

function combineBasisShift(bases: ScaleShiftBasis[], coefficients: number[]): number[] {
  const length = bases[0]?.values.length ?? 0;
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < bases.length; i += 1) {
    const coefficient = coefficients[i] ?? 0;
    if (Math.abs(coefficient) <= 1e-12) {
      continue;
    }
    const basis = bases[i].values;
    for (let t = 0; t < length; t += 1) {
      out[t] += coefficient * basis[t];
    }
  }
  return removeMean(out);
}

function rankedCoefficientObjective(
  objective: number,
  metrics: BaselineOptimizationMetrics,
  reference: BaselineOptimizationMetrics
): number {
  const geometryRatios = [
    normalizedRatio(metrics.meanSlope, reference.meanSlope),
    normalizedRatio(metrics.curvature, reference.curvature),
    normalizedRatio(metrics.localMeanSlope, reference.localMeanSlope),
    normalizedRatio(metrics.localCurvature, reference.localCurvature)
  ];
  let geometryPenalty = 0;
  for (const ratioValue of geometryRatios) {
    const excess = Math.max(0, ratioValue - 1.045);
    geometryPenalty += 70 * excess + 180 * excess * excess;
  }

  const centerlineMeanRatio = normalizedRatio(metrics.centerlineMeanSlope, reference.centerlineMeanSlope);
  const underusePenalty = 1.2 * Math.max(0, 0.34 - centerlineMeanRatio);
  return objective + geometryPenalty + underusePenalty;
}

function baselineObjective(
  metrics: BaselineOptimizationMetrics,
  reference: BaselineOptimizationMetrics,
  shiftBudget: number,
  localShiftBudget: number
): number {
  const budgetRatio = localShiftBudget <= 1e-12 ? 0 : shiftBudget / localShiftBudget;
  const centerlineMeanGrowth = normalizedRatio(metrics.centerlineMeanSlope, reference.centerlineMeanSlope);
  const centerlineMeanPenalty = Math.max(0, centerlineMeanGrowth - 1.8) ** 2;
  const coverageGain = metrics.centerlineSlopeCoverage - reference.centerlineSlopeCoverage;
  const windowConcentrationRatio = highAlignedWindowRatio(
    metrics.windowDerivativeConcentrations,
    reference.windowDerivativeConcentrations
  );
  const windowMassRatio = highAlignedWindowRatio(metrics.windowBurstMassShares, reference.windowBurstMassShares);
  const windowRegressionPenalty =
    7 * Math.max(0, windowConcentrationRatio - 1) + 5 * Math.max(0, windowMassRatio - 1);
  return (
    0.25 * normalizedRatio(metrics.meanSlope, reference.meanSlope) +
    0.6 * normalizedRatio(metrics.maxSlope, reference.maxSlope) +
    0.55 * normalizedRatio(metrics.curvature, reference.curvature) +
    0.45 * normalizedRatio(metrics.centerlineCurvature, reference.centerlineCurvature) +
    1.15 * normalizedRatio(metrics.maxBaselineDerivative, reference.maxBaselineDerivative) +
    0.8 * normalizedRatio(metrics.derivativeConcentration, reference.derivativeConcentration) +
    1.0 * normalizedRatio(metrics.localDerivativeConcentration, reference.localDerivativeConcentration) +
    0.55 * normalizedRatio(metrics.burstMassShare, reference.burstMassShare) +
    0.75 * normalizedRatio(metrics.localBurstMassShare, reference.localBurstMassShare) +
    1.25 * windowConcentrationRatio +
    0.85 * windowMassRatio +
    windowRegressionPenalty +
    0.12 * centerlineMeanPenalty +
    0.05 * budgetRatio -
    0.35 * coverageGain
  );
}

function normalizedRatio(value: number, reference: number): number {
  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(reference) || Math.abs(reference) <= 1e-12) {
    return Math.max(0, value);
  }
  return value / Math.max(1e-12, Math.abs(reference));
}

function highAlignedWindowRatio(values: number[], reference: number[]): number {
  const length = Math.min(values.length, reference.length);
  if (length === 0) {
    return 1;
  }

  const ratios: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const value = values[i];
    const ref = reference[i];
    if (!Number.isFinite(value) || !Number.isFinite(ref) || Math.abs(ref) <= 1e-12) {
      continue;
    }
    ratios.push(value / Math.max(1e-12, Math.abs(ref)));
  }
  if (ratios.length === 0) {
    return 1;
  }
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(0.9 * (ratios.length - 1))];
}

function baselineOptimizationMetrics(layers: LayerInput[], baseline: number[]): BaselineOptimizationMetrics {
  const total = sumLayerHeights(baseline.length, layers);
  const centerline = streamCenterlineFromBaseline(baseline, total);
  const centers = layerCenterSeries(layers, baseline);
  const centerlineWindows = derivativeWindowMetrics(centerline, 0.05);
  return {
    meanSlope: centerMeanSlope(centers),
    maxSlope: centerMaxSlope(centers),
    curvature: centerCurvature(centers),
    localMeanSlope: localCenterMeanSlope(centers),
    localCurvature: localCenterCurvature(centers),
    centerlineMeanSlope: meanAbsStep(centerline),
    maxBaselineDerivative: maxAbsStep(centerline),
    derivativeConcentration: derivativeConcentration(centerline),
    localDerivativeConcentration: localDerivativeConcentration(centerline),
    burstMassShare: burstMassShare(centerline, 0.05),
    localBurstMassShare: localBurstMassShare(centerline, 0.05),
    windowDerivativeConcentrations: centerlineWindows.concentrations,
    windowBurstMassShares: centerlineWindows.massShares,
    centerlineCurvature: meanCurvature(centerline),
    centerlineSlopeCoverage: slopeCoverage(centerline)
  };
}

function layerCenterSeries(layers: LayerInput[], baseline: number[]): number[][] {
  const tLength = baseline.length;
  const prefix = new Array<number>(tLength).fill(0);
  const centers: number[][] = [];
  for (const layer of layers) {
    const center = new Array<number>(tLength).fill(0);
    for (let t = 0; t < tLength; t += 1) {
      center[t] = baseline[t] + prefix[t] + 0.5 * layer.height[t];
    }
    centers.push(center);
    for (let t = 0; t < tLength; t += 1) {
      prefix[t] += layer.height[t];
    }
  }
  return centers;
}

function centerMeanSlope(series: number[][]): number {
  let acc = 0;
  let count = 0;
  for (const row of series) {
    for (let t = 1; t < row.length; t += 1) {
      acc += Math.abs(row[t] - row[t - 1]);
      count += 1;
    }
  }
  return count > 0 ? acc / count : 0;
}

function centerMaxSlope(series: number[][]): number {
  let out = 0;
  for (const row of series) {
    for (let t = 1; t < row.length; t += 1) {
      out = Math.max(out, Math.abs(row[t] - row[t - 1]));
    }
  }
  return out;
}

function centerCurvature(series: number[][]): number {
  let acc = 0;
  let count = 0;
  for (const row of series) {
    for (let t = 2; t < row.length; t += 1) {
      acc += Math.abs(row[t] - 2 * row[t - 1] + row[t - 2]);
      count += 1;
    }
  }
  return count > 0 ? acc / count : 0;
}

function localCenterMeanSlope(series: number[][]): number {
  const length = series[0]?.length ?? 0;
  const windowSize = localDerivativeWindowSize(Math.max(0, length - 1));
  if (length <= 1 || windowSize <= 0 || length - 1 <= windowSize) {
    return centerMeanSlope(series);
  }

  let out = 0;
  for (let left = 1; left <= length - windowSize; left += 1) {
    let acc = 0;
    let count = 0;
    const right = left + windowSize - 1;
    for (const row of series) {
      for (let t = left; t <= right; t += 1) {
        acc += Math.abs(row[t] - row[t - 1]);
        count += 1;
      }
    }
    out = Math.max(out, count > 0 ? acc / count : 0);
  }
  return out;
}

function localCenterCurvature(series: number[][]): number {
  const length = series[0]?.length ?? 0;
  const windowSize = localDerivativeWindowSize(Math.max(0, length - 2));
  if (length <= 2 || windowSize <= 0 || length - 2 <= windowSize) {
    return centerCurvature(series);
  }

  let out = 0;
  for (let left = 2; left <= length - windowSize; left += 1) {
    let acc = 0;
    let count = 0;
    const right = left + windowSize - 1;
    for (const row of series) {
      for (let t = left; t <= right; t += 1) {
        acc += Math.abs(row[t] - 2 * row[t - 1] + row[t - 2]);
        count += 1;
      }
    }
    out = Math.max(out, count > 0 ? acc / count : 0);
  }
  return out;
}

function derivativeConcentration(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  let maxValue = 0;
  let meanValue = 0;
  let count = 0;
  for (let t = 1; t < values.length; t += 1) {
    const value = Math.abs(values[t] - values[t - 1]);
    maxValue = Math.max(maxValue, value);
    meanValue += value;
    count += 1;
  }
  meanValue /= Math.max(1, count);
  return meanValue <= 1e-12 ? 0 : maxValue / meanValue;
}

function derivativeMagnitudes(values: number[]): number[] {
  const out: number[] = [];
  for (let t = 1; t < values.length; t += 1) {
    out.push(Math.abs(values[t] - values[t - 1]));
  }
  return out;
}

function localDerivativeWindowSize(derivativeCount: number): number {
  if (derivativeCount <= 0) {
    return 0;
  }
  return Math.max(6, Math.min(48, Math.round(derivativeCount * 0.1)));
}

function concentrationFromMagnitudes(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let maxValue = 0;
  let meanValue = 0;
  for (const value of values) {
    maxValue = Math.max(maxValue, value);
    meanValue += value;
  }
  meanValue /= Math.max(1, values.length);
  return meanValue <= 1e-12 ? 0 : maxValue / meanValue;
}

function localDerivativeConcentration(values: number[]): number {
  const derivatives = derivativeMagnitudes(values);
  const windowSize = localDerivativeWindowSize(derivatives.length);
  if (windowSize <= 0 || derivatives.length <= windowSize) {
    return concentrationFromMagnitudes(derivatives);
  }

  let out = 0;
  for (let left = 0; left <= derivatives.length - windowSize; left += 1) {
    out = Math.max(out, concentrationFromMagnitudes(derivatives.slice(left, left + windowSize)));
  }
  return out;
}

function burstMassShare(values: number[], topFraction: number): number {
  return massShareFromMagnitudes(derivativeMagnitudes(values), topFraction);
}

function localBurstMassShare(values: number[], topFraction: number): number {
  const derivatives = derivativeMagnitudes(values);
  const windowSize = localDerivativeWindowSize(derivatives.length);
  if (windowSize <= 0 || derivatives.length <= windowSize) {
    return massShareFromMagnitudes(derivatives, topFraction);
  }

  let out = 0;
  for (let left = 0; left <= derivatives.length - windowSize; left += 1) {
    out = Math.max(out, massShareFromMagnitudes(derivatives.slice(left, left + windowSize), topFraction));
  }
  return out;
}

function derivativeWindowMetrics(
  values: number[],
  topFraction: number
): { concentrations: number[]; massShares: number[] } {
  const derivatives = derivativeMagnitudes(values);
  const windowSize = localDerivativeWindowSize(derivatives.length);
  if (windowSize <= 0) {
    return { concentrations: [], massShares: [] };
  }
  if (derivatives.length <= windowSize) {
    return {
      concentrations: [concentrationFromMagnitudes(derivatives)],
      massShares: [massShareFromMagnitudes(derivatives, topFraction)]
    };
  }

  const concentrations: number[] = [];
  const massShares: number[] = [];
  for (let left = 0; left <= derivatives.length - windowSize; left += 1) {
    const window = derivatives.slice(left, left + windowSize);
    concentrations.push(concentrationFromMagnitudes(window));
    massShares.push(massShareFromMagnitudes(window, topFraction));
  }
  return { concentrations, massShares };
}

function massShareFromMagnitudes(values: number[], topFraction: number): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  const total = clean.reduce((acc, value) => acc + value, 0);
  if (clean.length === 0 || total <= 1e-12) {
    return 0;
  }
  const count = Math.max(1, Math.ceil(clean.length * clamp(topFraction, 0, 1)));
  clean.sort((a, b) => b - a);
  let top = 0;
  for (let i = 0; i < count; i += 1) {
    top += clean[i];
  }
  return top / total;
}

function slopeCoverage(values: number[]): number {
  const maxValue = maxAbsStep(values);
  if (values.length <= 1 || maxValue <= 1e-12) {
    return 0;
  }
  const threshold = Math.max(1e-12, 0.05 * maxValue);
  let acc = 0;
  for (let t = 1; t < values.length; t += 1) {
    acc += Math.min(1, Math.abs(values[t] - values[t - 1]) / threshold);
  }
  return acc / Math.max(1, values.length - 1);
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
