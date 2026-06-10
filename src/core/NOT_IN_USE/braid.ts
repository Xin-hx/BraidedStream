/**
 * Braid layout construction for ROI-focused streamgraph separation.
 *
 * The algorithm computes a soft ROI window, allocates screen-space gaps, and
 * then reconstructs stack boundaries while preserving original layer thickness.
 * ⚠ currnt version has NO BRADING METHOD
 */
import type { BaselineMode, BraidLayout, GapMode, LayerInput, ROI, RoiSupportWindow, SmoothKernel, StackLayout } from "../types";
import { normalizeROI } from "../../interactions/roi";
import { clamp, clamp01, percentile } from "../utils";
import { boundaryUncertaintyAt } from "../validate";

export interface BraidArgs {
  base: StackLayout;
  orderedLayers: LayerInput[];
  roi: ROI | null;
  baselineMode: BaselineMode;
  gapMode: GapMode;
  gapAlphaPx: number;
  maxExtraHeightPx: number;
  spacingBudgetPx?: number;
  spacingUncertaintyWeight?: number;
  spacingSlopeWeight?: number;
  spacingTemporalWeight?: number;
  spacingIterations?: number;
  boundaryPenalty?: number[];
  smoothKernel: SmoothKernel;
  yScale: (v: number) => number;
}

interface SpacingOptions {
  budgetPx: number;
  uncertaintyWeight: number;
  slopeWeight: number;
  temporalWeight: number;
  iterations: number;
  boundaryPenalty: number[];
}

interface SpacingTerms {
  uncertainty: number;
  slope: number;
  temporal: number;
}

interface GapComputation {
  gapsPx: number[][];
  targetPx: number[][];
  sumGapPx: number[];
  terms: SpacingTerms;
  spacingSamples: number;
  temporalSamples: number;
  objectiveHistory: number[];
}

/** Add ROI-local spacing between layers and return braid geometry plus diagnostics. */
export function computeBraidLayout(args: BraidArgs): BraidLayout {
  const { base, orderedLayers, roi, baselineMode, gapMode, gapAlphaPx, maxExtraHeightPx, smoothKernel, yScale } = args;
  const tLength = base.baseline.length;
  const normalizedROI = normalizeROI(roi, tLength);

  // Omega acts as a soft mask: spacing is concentrated in ROI and smoothly decays outside.
  const omegaResult = computeOmega(tLength, normalizedROI, smoothKernel);
  const omega = omegaResult.omega;
  const roiSupport = omegaResult.roiSupport;

  const spacing = resolveSpacingOptions(args, maxExtraHeightPx);
  const gapResult = computeGapComputation(
    orderedLayers,
    gapMode,
    omega,
    roiSupport,
    gapAlphaPx,
    maxExtraHeightPx,
    spacing
  );

  // Convert spacing back to data units and reconstruct top/bottom envelopes.
  const pxPerValue = estimatePixelsPerValue(yScale);
  const gapsValue = gapResult.gapsPx.map((row) => row.map((v) => v / pxPerValue));
  const boundaries = applyGapValuesToStack(base, orderedLayers, gapsValue, gapResult.sumGapPx, pxPerValue, baselineMode);

  return {
    baseline: base.baseline.slice(),
    yBottom: boundaries.yBottom,
    yTop: boundaries.yTop,
    omega,
    gapsPx: gapResult.gapsPx,
    gapsValue,
    sumGapPx: gapResult.sumGapPx,
    roiSupport,
    diagnostics: {
      spacingObjective:
        (gapResult.terms.uncertainty + gapResult.terms.slope) / Math.max(1, gapResult.spacingSamples) +
        spacing.temporalWeight * gapResult.terms.temporal / Math.max(1, gapResult.temporalSamples),
      spacingUncertaintyTerm: gapResult.terms.uncertainty / Math.max(1, gapResult.spacingSamples),
      spacingSlopeTerm: gapResult.terms.slope / Math.max(1, gapResult.spacingSamples),
      spacingTemporalTerm: gapResult.terms.temporal / Math.max(1, gapResult.temporalSamples),
      spacingIterations: spacing.iterations,
      spacingObjectiveHistory: gapResult.objectiveHistory
    }
  };
}

function resolveSpacingOptions(args: BraidArgs, maxExtraHeightPx: number): SpacingOptions {
  return {
    budgetPx: Math.max(0, args.spacingBudgetPx ?? maxExtraHeightPx),
    uncertaintyWeight: Math.max(0, args.spacingUncertaintyWeight ?? 1),
    slopeWeight: Math.max(0, args.spacingSlopeWeight ?? 0),
    temporalWeight: clamp(args.spacingTemporalWeight ?? 0, 0, 0.95),
    iterations: Math.max(1, Math.floor(args.spacingIterations ?? 1)),
    boundaryPenalty: args.boundaryPenalty ?? []
  };
}

function computeGapComputation(
  orderedLayers: LayerInput[],
  gapMode: GapMode,
  omega: number[],
  roiSupport: RoiSupportWindow | null,
  gapAlphaPx: number,
  maxExtraHeightPx: number,
  spacing: SpacingOptions
): GapComputation {
  const tLength = omega.length;
  const gapCount = Math.max(0, orderedLayers.length - 1);
  const gapsPx = Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0));
  const targetPx = Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0));
  const sumGapPx = new Array<number>(tLength).fill(0);
  const terms: SpacingTerms = { uncertainty: 0, slope: 0, temporal: 0 };
  const objectiveHistory: number[] = [];
  let spacingSamples = 0;
  let temporalSamples = 0;

  if (gapMode !== "none" && roiSupport) {
    const scales = computeGapScales(orderedLayers, tLength, roiSupport, gapMode, gapAlphaPx);
    const samples = fillInitialGaps(
      orderedLayers,
      gapMode,
      omega,
      gapsPx,
      targetPx,
      sumGapPx,
      terms,
      scales,
      spacing,
      gapAlphaPx,
      maxExtraHeightPx
    );
    spacingSamples = samples.spacingSamples;
    temporalSamples = samples.temporalSamples;
    smoothGapTimeline(gapsPx, targetPx, objectiveHistory, spacing, maxExtraHeightPx);
  }

  return {
    gapsPx,
    targetPx,
    sumGapPx,
    terms,
    spacingSamples,
    temporalSamples,
    objectiveHistory
  };
}

function computeGapScales(
  orderedLayers: LayerInput[],
  tLength: number,
  roiSupport: RoiSupportWindow | null,
  gapMode: GapMode,
  gapAlphaPx: number
): { uncScale: number; slopeScale: number; boundaryThicknessScale: number; minVisibleGapPx: number } {
  return {
    // Robust quantile scales prevent outliers from dominating uncertainty/slope normalization.
    uncScale: gapMode === "uncGap" ? robustTermScale(orderedLayers, tLength, roiSupport, "uncertainty") : 1,
    slopeScale: gapMode === "uncGap" ? robustTermScale(orderedLayers, tLength, roiSupport, "slope") : 1,
    boundaryThicknessScale:
      gapMode === "uncGap" ? robustBoundaryThicknessScale(orderedLayers, tLength, roiSupport) : 1,
    minVisibleGapPx: gapMode === "uncGap" ? Math.max(1.2, 0.22 * gapAlphaPx) : 0
  };
}

function fillInitialGaps(
  orderedLayers: LayerInput[],
  gapMode: GapMode,
  omega: number[],
  gapsPx: number[][],
  targetPx: number[][],
  sumGapPx: number[],
  terms: SpacingTerms,
  scales: { uncScale: number; slopeScale: number; boundaryThicknessScale: number; minVisibleGapPx: number },
  spacing: SpacingOptions,
  gapAlphaPx: number,
  maxExtraHeightPx: number
): { spacingSamples: number; temporalSamples: number } {
  const tLength = omega.length;
  const gapCount = gapsPx.length;
  let spacingSamples = 0;
  let temporalSamples = 0;

  // Stage 1: estimate target gaps from local uncertainty/slope and apply one-step temporal damping.
  for (let t = 0; t < tLength; t += 1) {
    let totalGapPx = 0;
    for (let k = 0; k < gapCount; k += 1) {
      const rawGapPx = rawGapAt(orderedLayers, gapMode, omega[t], k, t, terms, scales, spacing, gapAlphaPx);
      if (gapMode === "uncGap") {
        spacingSamples += 1;
      }
      targetPx[k][t] = Math.max(0, rawGapPx);
      const prev = t > 0 ? gapsPx[k][t - 1] : rawGapPx;
      gapsPx[k][t] = Math.max(0, (1 - spacing.temporalWeight) * rawGapPx + spacing.temporalWeight * prev);
      if (t > 0) {
        const dt = gapsPx[k][t] - gapsPx[k][t - 1];
        terms.temporal += dt * dt;
        temporalSamples += 1;
      }
      totalGapPx += gapsPx[k][t];
    }
    sumGapPx[t] = capGapsAtTime(gapsPx, t, totalGapPx, maxExtraHeightPx, spacing.budgetPx);
  }

  return { spacingSamples, temporalSamples };
}

function rawGapAt(
  orderedLayers: LayerInput[],
  gapMode: GapMode,
  omegaValue: number,
  boundaryIndex: number,
  timeIndex: number,
  terms: SpacingTerms,
  scales: { uncScale: number; slopeScale: number; boundaryThicknessScale: number; minVisibleGapPx: number },
  spacing: SpacingOptions,
  gapAlphaPx: number
): number {
  if (gapMode === "fixedGap") {
    return omegaValue * gapAlphaPx;
  }
  if (gapMode !== "uncGap") {
    return 0;
  }

  const layerA = orderedLayers[boundaryIndex];
  const layerB = orderedLayers[boundaryIndex + 1];
  const uncertainty = boundaryUncertaintyAt(layerA, layerB, timeIndex);
  const slopeA = timeIndex > 0 ? Math.abs(layerA.height[timeIndex] - layerA.height[timeIndex - 1]) : 0;
  const slopeB = timeIndex > 0 ? Math.abs(layerB.height[timeIndex] - layerB.height[timeIndex - 1]) : 0;
  const slopeTerm = 0.5 * (slopeA + slopeB);
  const localThickness = 0.5 * (Math.max(1e-9, layerA.height[timeIndex]) + Math.max(1e-9, layerB.height[timeIndex]));
  const uNorm = clamp01(uncertainty / scales.uncScale);
  const slopeNorm = clamp01(slopeTerm / scales.slopeScale);
  const thinnessNorm = clamp01(scales.boundaryThicknessScale / Math.max(1e-9, localThickness));
  const edgeBoost = spacing.boundaryPenalty[boundaryIndex] ?? 1;
  const aggressiveUncertainty = Math.pow(uNorm, 1.35);
  const thinDriftBoost = 1 + 1.1 * aggressiveUncertainty * thinnessNorm;
  const slopeDrive = 0.6 * slopeNorm;
  const signal = spacing.uncertaintyWeight * aggressiveUncertainty * thinDriftBoost + spacing.slopeWeight * slopeDrive;
  const visibility = clamp01(0.2 + 0.8 * aggressiveUncertainty + 0.6 * thinnessNorm);

  terms.uncertainty += spacing.uncertaintyWeight * uncertainty;
  terms.slope += spacing.slopeWeight * slopeTerm;
  return omegaValue * edgeBoost * (gapAlphaPx * signal + scales.minVisibleGapPx * visibility);
}

function capGapsAtTime(
  gapsPx: number[][],
  timeIndex: number,
  totalGapPx: number,
  maxExtraHeightPx: number,
  spacingBudgetPx: number
): number {
  const cap = Math.min(maxExtraHeightPx, spacingBudgetPx);
  if (totalGapPx <= cap || totalGapPx <= 0) {
    return totalGapPx;
  }
  const scale = cap / totalGapPx;
  for (let k = 0; k < gapsPx.length; k += 1) {
    gapsPx[k][timeIndex] *= scale;
  }
  return cap;
}

function smoothGapTimeline(
  gapsPx: number[][],
  targetPx: number[][],
  objectiveHistory: number[],
  spacing: SpacingOptions,
  maxExtraHeightPx: number
): void {
  const gapCount = gapsPx.length;
  const tLength = gapsPx[0]?.length ?? 0;
  // Stage 2: iterative temporal smoothing under per-time total extra-height cap.
  for (let iter = 0; iter < spacing.iterations; iter += 1) {
    const nextGaps = gapsPx.map((row) => row.slice());
    for (let k = 0; k < gapCount; k += 1) {
      for (let t = 0; t < tLength; t += 1) {
        const prev = t > 0 ? gapsPx[k][t - 1] : gapsPx[k][t];
        const next = t < tLength - 1 ? gapsPx[k][t + 1] : gapsPx[k][t];
        const smoothTarget = 0.5 * (prev + next);
        const blended = (1 - spacing.temporalWeight) * targetPx[k][t] + spacing.temporalWeight * smoothTarget;
        nextGaps[k][t] = Math.max(0, blended);
      }
    }
    for (let t = 0; t < tLength; t += 1) {
      let total = 0;
      for (let k = 0; k < gapCount; k += 1) {
        total += nextGaps[k][t];
      }
      capGapsAtTime(nextGaps, t, total, maxExtraHeightPx, spacing.budgetPx);
    }
    for (let k = 0; k < gapCount; k += 1) {
      for (let t = 0; t < tLength; t += 1) {
        gapsPx[k][t] = nextGaps[k][t];
      }
    }
    objectiveHistory.push(computeSpacingObjective(gapsPx, targetPx, spacing.temporalWeight));
  }
}

function applyGapValuesToStack(
  base: StackLayout,
  orderedLayers: LayerInput[],
  gapsValue: number[][],
  sumGapPx: number[],
  pxPerValue: number,
  baselineMode: BaselineMode
): Pick<StackLayout, "yBottom" | "yTop"> {
  const tLength = base.baseline.length;
  const gapCount = Math.max(0, orderedLayers.length - 1);
  const yBottom = base.yBottom.map((row) => row.slice());
  const yTop = base.yTop.map((row) => row.slice());

  for (let t = 0; t < tLength; t += 1) {
    // Center baseline keeps added spacing visually balanced around the stream centerline.
    const totalExtraValue = sumGapPx[t] / pxPerValue;
    const centerShift = baselineMode === "center" ? -0.5 * totalExtraValue : 0;
    let extra = 0;
    for (let k = 0; k < orderedLayers.length; k += 1) {
      yBottom[k][t] = base.yBottom[k][t] + centerShift + extra;
      yTop[k][t] = yBottom[k][t] + orderedLayers[k].height[t];
      if (k < gapCount) {
        extra += gapsValue[k][t];
      }
    }
  }

  return { yBottom, yTop };
}

function computeSpacingObjective(gapsPx: number[][], targetPx: number[][], temporalWeight: number): number {
  const kLength = gapsPx.length;
  if (kLength === 0) {
    return 0;
  }
  const tLength = gapsPx[0].length;
  let fit = 0;
  let smooth = 0;
  let fitN = 0;
  let smoothN = 0;
  for (let k = 0; k < kLength; k += 1) {
    for (let t = 0; t < tLength; t += 1) {
      const d = gapsPx[k][t] - targetPx[k][t];
      fit += d * d;
      fitN += 1;
      if (t > 0) {
        const dt = gapsPx[k][t] - gapsPx[k][t - 1];
        smooth += dt * dt;
        smoothN += 1;
      }
    }
  }
  return fit / Math.max(1, fitN) + temporalWeight * smooth / Math.max(1, smoothN);
}

export function computeOmega(
  tLength: number,
  roi: ROI | null,
  smoothKernel: SmoothKernel
): { omega: number[]; roiSupport: RoiSupportWindow | null } {
  const omega = new Array<number>(tLength).fill(0);
  if (!roi) {
    return { omega, roiSupport: null };
  }
  const span = roi.t1Index - roi.t0Index + 1;
  if (span <= 0) {
    return { omega, roiSupport: null };
  }
  const tau = Math.max(5, Math.floor(0.25 * (roi.t1Index - roi.t0Index)));
  const supportStart = clamp(Math.floor(roi.t0Index - tau), 0, tLength - 1);
  const supportEnd = clamp(Math.ceil(roi.t1Index + tau), 0, tLength - 1);

  // Raised-cosine ramps reduce visual discontinuities at ROI support boundaries.
  for (let t = supportStart; t <= supportEnd; t += 1) {
    omega[t] = raisedCosineWindow(t, roi.t0Index, roi.t1Index, tau, smoothKernel);
  }
  return {
    omega,
    roiSupport: {
      tau,
      coreStart: roi.t0Index,
      coreEnd: roi.t1Index,
      supportStart,
      supportEnd
    }
  };
}

function estimatePixelsPerValue(yScale: (v: number) => number): number {
  const p0 = yScale(0);
  const p1 = yScale(1);
  const slope = Math.abs(p1 - p0);
  if (!Number.isFinite(slope) || slope <= 1e-12) {
    throw new Error("yScale must be linear with non-zero slope");
  }
  return slope;
}

function raisedCosineWindow(t: number, t0: number, t1: number, tau: number, smoothKernel: SmoothKernel): number {
  if (t < t0 - tau || t > t1 + tau) {
    return 0;
  }
  if (t >= t0 && t <= t1) {
    return 1;
  }
  if (tau <= 0) {
    return t >= t0 && t <= t1 ? 1 : 0;
  }
  if (t < t0) {
    const u = clamp01((t - (t0 - tau)) / tau);
    if (smoothKernel === "cubic") {
      return 0.5 - 0.5 * Math.cos(Math.PI * u);
    }
  }
  const u = clamp01(((t1 + tau) - t) / tau);
  if (smoothKernel === "cubic") {
    return 0.5 - 0.5 * Math.cos(Math.PI * u);
  }
  return 0;
}

function robustTermScale(
  orderedLayers: LayerInput[],
  tLength: number,
  roiSupport: RoiSupportWindow | null,
  term: "uncertainty" | "slope"
): number {
  const values: number[] = [];
  const gapCount = Math.max(0, orderedLayers.length - 1);
  const tStart = roiSupport ? roiSupport.supportStart : 0;
  const tEnd = roiSupport ? roiSupport.supportEnd : Math.max(0, tLength - 1);
  for (let t = tStart; t <= tEnd; t += 1) {
    for (let k = 0; k < gapCount; k += 1) {
      if (term === "uncertainty") {
        values.push(boundaryUncertaintyAt(orderedLayers[k], orderedLayers[k + 1], t));
      } else {
        const slopeA = t > 0 ? Math.abs(orderedLayers[k].height[t] - orderedLayers[k].height[t - 1]) : 0;
        const slopeB = t > 0 ? Math.abs(orderedLayers[k + 1].height[t] - orderedLayers[k + 1].height[t - 1]) : 0;
        values.push(0.5 * (slopeA + slopeB));
      }
    }
  }
  if (values.length === 0) {
    return 1;
  }
  return Math.max(1e-6, percentile(values, 0.9));
}

function robustBoundaryThicknessScale(
  orderedLayers: LayerInput[],
  tLength: number,
  roiSupport: RoiSupportWindow | null
): number {
  const values: number[] = [];
  const gapCount = Math.max(0, orderedLayers.length - 1);
  const tStart = roiSupport ? roiSupport.supportStart : 0;
  const tEnd = roiSupport ? roiSupport.supportEnd : Math.max(0, tLength - 1);
  for (let t = tStart; t <= tEnd; t += 1) {
    for (let k = 0; k < gapCount; k += 1) {
      const meanA = Math.max(0, orderedLayers[k].height[t]);
      const meanB = Math.max(0, orderedLayers[k + 1].height[t]);
      values.push(0.5 * (meanA + meanB));
    }
  }
  if (values.length === 0) {
    return 1;
  }
  return Math.max(1e-6, percentile(values, 0.5));
}
