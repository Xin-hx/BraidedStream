/**
 * Layout quality metrics used by UI panels and search routines.
 */
import type {
  InvariantSummary,
  LayerInput,
  PreparedDataset,
  ROI,
  StackLayout
} from "../core/types";
import { meanFinite, range } from "../core/utils";

export interface MetricRow {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  better: "up" | "down";
}

export interface MetricResult {
  rows: MetricRow[];
  globalRows?: MetricRow[] | null;
  invariant: InvariantSummary;
  scopeText: string;
  globalScopeText?: string;
  multiscale?: MultiscaleDiagnosticsSummary | null;
}

export interface MultiscaleDiagnosticsSummary {
  method: string;
  verified: boolean;
  fallbackUsed: boolean;
  effectiveScaleCount: number;
  selectedScaleCount?: number;
  threshold: number;
  scaleBands: Array<{ scale: number; ratio: number }>;
  scaleCoefficients?: Array<{ scale: number; coefficient: number }>;
  objectiveBefore?: number;
  objectiveAfter?: number;
  meanSlopeBefore?: number;
  meanSlopeAfter?: number;
  maxSlopeBefore?: number;
  maxSlopeAfter?: number;
  curvatureBefore?: number;
  curvatureAfter?: number;
  burstBefore?: number;
  burstAfter?: number;
  derivativeConcentrationBefore?: number;
  derivativeConcentrationAfter?: number;
  centerlineSlopeCoverageBefore?: number;
  centerlineSlopeCoverageAfter?: number;
  globalMeanSlopeGuardrailPassed?: boolean;
}

export interface MetricsComputeOptions {
  includeGlobalRows?: boolean;
  multiscale?: MultiscaleDiagnosticsSummary | null;
}

// ---- Multiscale diagnostics adapter (was diagnostics.ts) ----

interface MultiscaleDiagnosticsLike {
  method: string;
  verifiedMultiscale: boolean;
  fallbackUsed: boolean;
  effectiveScaleCount: number;
  selectedScaleCount?: number;
  energyThreshold: number;
  scaleBands: Array<{ scale: number; ratio: number }>;
  scaleCoefficients?: Array<{ scale: number; coefficient: number }>;
  objectiveBefore?: number;
  objectiveAfter?: number;
  meanSlopeBefore?: number;
  meanSlopeAfter?: number;
  maxSlopeBefore?: number;
  maxSlopeAfter?: number;
  curvatureBefore?: number;
  curvatureAfter?: number;
  burstBefore?: number;
  burstAfter?: number;
  derivativeConcentrationBefore?: number;
  derivativeConcentrationAfter?: number;
  centerlineSlopeCoverageBefore?: number;
  centerlineSlopeCoverageAfter?: number;
  globalMeanSlopeGuardrailPassed?: boolean;
}

export function toMultiscaleDiagnosticsSummary(
  diagnostics: MultiscaleDiagnosticsLike
): MultiscaleDiagnosticsSummary {
  return {
    method: diagnostics.method,
    verified: diagnostics.verifiedMultiscale,
    fallbackUsed: diagnostics.fallbackUsed,
    effectiveScaleCount: diagnostics.effectiveScaleCount,
    selectedScaleCount: diagnostics.selectedScaleCount,
    threshold: diagnostics.energyThreshold,
    scaleBands: diagnostics.scaleBands.map((band) => ({ scale: band.scale, ratio: band.ratio })),
    scaleCoefficients: diagnostics.scaleCoefficients,
    objectiveBefore: diagnostics.objectiveBefore,
    objectiveAfter: diagnostics.objectiveAfter,
    meanSlopeBefore: diagnostics.meanSlopeBefore,
    meanSlopeAfter: diagnostics.meanSlopeAfter,
    maxSlopeBefore: diagnostics.maxSlopeBefore,
    maxSlopeAfter: diagnostics.maxSlopeAfter,
    curvatureBefore: diagnostics.curvatureBefore,
    curvatureAfter: diagnostics.curvatureAfter,
    burstBefore: diagnostics.burstBefore,
    burstAfter: diagnostics.burstAfter,
    derivativeConcentrationBefore: diagnostics.derivativeConcentrationBefore,
    derivativeConcentrationAfter: diagnostics.derivativeConcentrationAfter,
    centerlineSlopeCoverageBefore: diagnostics.centerlineSlopeCoverageBefore,
    centerlineSlopeCoverageAfter: diagnostics.centerlineSlopeCoverageAfter,
    globalMeanSlopeGuardrailPassed: diagnostics.globalMeanSlopeGuardrailPassed
  };
}

// ---- Core metrics computation ----

export function computeMetrics(
  dataset: PreparedDataset,
  beforeLayout: StackLayout,
  afterLayout: StackLayout,
  roi: ROI | null,
  invariant: InvariantSummary,
  layers: LayerInput[],
  options: MetricsComputeOptions = {}
): MetricResult {
  const idx = computeIndices(dataset.times.length, roi);
  const idxGlobal = range(0, dataset.times.length);
  const centersBefore = centers(beforeLayout);
  const centersAfter = centers(afterLayout);
  const rows = buildRowsForIndices(idx, beforeLayout, afterLayout, centersBefore, centersAfter, layers);
  const includeGlobalRows = options.includeGlobalRows === true;
  const globalRows = includeGlobalRows
    ? buildRowsForIndices(idxGlobal, beforeLayout, afterLayout, centersBefore, centersAfter, layers)
    : null;

  return {
    rows,
    globalRows,
    invariant,
    scopeText: roi ? "ROI" : "Global",
    globalScopeText: includeGlobalRows ? "Global" : undefined,
    multiscale: options.multiscale ?? null
  };
}

function buildRowsForIndices(
  idx: number[],
  beforeLayout: StackLayout,
  afterLayout: StackLayout,
  centersBefore: number[][],
  centersAfter: number[][],
  layers: LayerInput[]
): MetricRow[] {
  const centerlineBefore = streamCenterline(beforeLayout);
  const centerlineAfter = streamCenterline(afterLayout);
  return [
    row("meanSlope", "Mean slope", meanSlope(centersBefore, idx), meanSlope(centersAfter, idx), "down"),
    row("maxSlope", "Max slope", maxSlope(centersBefore, idx), maxSlope(centersAfter, idx), "down"),
    row(
      "centerlineMaxDerivative",
      "Centerline max derivative",
      maxBaselineDerivative(centerlineBefore, idx),
      maxBaselineDerivative(centerlineAfter, idx),
      "down"
    ),
    row(
      "centerlineDerivativeConcentration",
      "Centerline derivative concentration",
      baselineDerivativeConcentration(centerlineBefore, idx),
      baselineDerivativeConcentration(centerlineAfter, idx),
      "down"
    ),
    row(
      "centerlineSlopeCoverage",
      "Centerline slope coverage",
      baselineSlopeCoverage(centerlineBefore, idx),
      baselineSlopeCoverage(centerlineAfter, idx),
      "up"
    ),
    row(
      "baselineBurst",
      "Max baseline derivative",
      maxBaselineDerivative(beforeLayout.baseline, idx),
      maxBaselineDerivative(afterLayout.baseline, idx),
      "down"
    ),
    row(
      "baselineDerivativeConcentration",
      "Baseline derivative concentration",
      baselineDerivativeConcentration(beforeLayout.baseline, idx),
      baselineDerivativeConcentration(afterLayout.baseline, idx),
      "down"
    ),
    row("wiggle", "Wiggle energy", wiggleEnergy(centersBefore, idx), wiggleEnergy(centersAfter, idx), "down"),
    row("illusion", "Sine-illusion proxy", curvatureEnergy(centersBefore, idx), curvatureEnergy(centersAfter, idx), "down"),
    row("sepMean", "Mean layer separation", meanSeparation(beforeLayout, idx), meanSeparation(afterLayout, idx), "up"),
    row("sepMin", "Min layer separation", minSeparation(beforeLayout, idx), minSeparation(afterLayout, idx), "up"),
    row("compact", "Compactness loss", compactness(beforeLayout, idx), compactness(afterLayout, idx), "down"),
    row("boundary", "Boundary distortion", 0, roiBoundaryDistortion(beforeLayout, afterLayout, idx), "down"),
    row("thickness", "Thickness invariance error", 0, thicknessError(layers, afterLayout, idx), "down"),
    row("order", "Order stability", 1, orderStability(afterLayout, idx), "up")
  ];
}

function row(key: string, label: string, before: number, after: number, better: "up" | "down"): MetricRow {
  return { key, label, before, after, delta: after - before, better };
}

function computeIndices(length: number, roi: ROI | null): number[] {
  if (!roi) {
    return range(0, length);
  }
  const left = Math.max(0, roi.t0Index);
  const right = Math.min(length - 1, roi.t1Index);
  return range(left, right + 1);
}

function centers(layout: StackLayout): number[][] {
  return layout.yBottom.map((row, k) => row.map((v, t) => 0.5 * (v + layout.yTop[k][t])));
}

function streamCenterline(layout: StackLayout): number[] {
  if (layout.yBottom.length === 0 || layout.yTop.length === 0) {
    return layout.baseline.slice();
  }
  const last = layout.yTop.length - 1;
  return layout.yBottom[0].map((value, t) => 0.5 * (value + layout.yTop[last][t]));
}

function meanSlope(series: number[][], idx: number[]): number {
  const values: number[] = [];
  for (const row of series) {
    for (let i = 1; i < idx.length; i += 1) {
      values.push(Math.abs(row[idx[i - 1]] - row[idx[i]]));
    }
  }
  return mean(values);
}

function maxSlope(series: number[][], idx: number[]): number {
  let m = 0;
  for (const row of series) {
    for (let i = 1; i < idx.length; i += 1) {
      m = Math.max(m, Math.abs(row[idx[i - 1]] - row[idx[i]]));
    }
  }
  return m;
}

function maxBaselineDerivative(values: number[], idx: number[]): number {
  let m = 0;
  for (let i = 1; i < idx.length; i += 1) {
    m = Math.max(m, Math.abs(values[idx[i - 1]] - values[idx[i]]));
  }
  return m;
}

function baselineDerivativeConcentration(values: number[], idx: number[]): number {
  if (idx.length <= 1) return 0;
  const derivatives: number[] = [];
  for (let i = 1; i < idx.length; i += 1) {
    derivatives.push(Math.abs(values[idx[i - 1]] - values[idx[i]]));
  }
  const meanValue = mean(derivatives);
  if (meanValue <= 1e-12) return 0;
  return Math.max(...derivatives) / meanValue;
}

function baselineSlopeCoverage(values: number[], idx: number[]): number {
  if (idx.length <= 1) return 0;
  const derivatives: number[] = [];
  for (let i = 1; i < idx.length; i += 1) {
    derivatives.push(Math.abs(values[idx[i - 1]] - values[idx[i]]));
  }
  const peak = Math.max(...derivatives);
  if (peak <= 1e-12) return 0;
  const threshold = 0.05 * peak;
  return mean(derivatives.map((v) => Math.min(1, v / Math.max(1e-12, threshold))));
}

function wiggleEnergy(series: number[][], idx: number[]): number {
  let acc = 0;
  for (const row of series) {
    for (let i = 2; i < idx.length; i += 1) {
      const d = row[idx[i]] - 2 * row[idx[i - 1]] + row[idx[i - 2]];
      acc += d * d;
    }
  }
  return acc / Math.max(1, series.length);
}

function curvatureEnergy(series: number[][], idx: number[]): number {
  const values: number[] = [];
  for (const row of series) {
    for (let i = 2; i < idx.length; i += 1) {
      values.push(Math.abs(row[idx[i]] - 2 * row[idx[i - 1]] + row[idx[i - 2]]));
    }
  }
  return mean(values);
}

function meanSeparation(layout: StackLayout, idx: number[]): number {
  if (layout.yBottom.length < 2) return 0;
  const values: number[] = [];
  for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
    for (const t of idx) {
      values.push(Math.max(0, layout.yBottom[k + 1][t] - layout.yTop[k][t]));
    }
  }
  return mean(values);
}

function minSeparation(layout: StackLayout, idx: number[]): number {
  if (layout.yBottom.length < 2) return 0;
  let minV = Number.POSITIVE_INFINITY;
  for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
    for (const t of idx) {
      minV = Math.min(minV, layout.yBottom[k + 1][t] - layout.yTop[k][t]);
    }
  }
  return Number.isFinite(minV) ? minV : 0;
}

function compactness(layout: StackLayout, idx: number[]): number {
  const heights = idx.map((t) => layout.yTop[layout.yTop.length - 1][t] - layout.yBottom[0][t]);
  return mean(heights);
}

function roiBoundaryDistortion(before: StackLayout, after: StackLayout, idx: number[]): number {
  if (idx.length < 2) return 0;
  const endpoints = [idx[0], idx[idx.length - 1]];
  const values: number[] = [];
  for (const t of endpoints) {
    for (let k = 0; k < before.yBottom.length; k += 1) {
      values.push(Math.abs(after.yBottom[k][t] - before.yBottom[k][t]));
    }
  }
  return mean(values);
}

function thicknessError(layers: LayerInput[], after: StackLayout, idx: number[]): number {
  let maxErr = 0;
  for (let k = 0; k < layers.length; k += 1) {
    for (const t of idx) {
      maxErr = Math.max(maxErr, Math.abs(after.yTop[k][t] - after.yBottom[k][t] - layers[k].height[t]));
    }
  }
  return maxErr;
}

function orderStability(layout: StackLayout, idx: number[]): number {
  if (layout.yBottom.length < 2) return 1;
  let overlaps = 0;
  let total = 0;
  for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
    for (const t of idx) {
      total += 1;
      if (layout.yBottom[k + 1][t] < layout.yTop[k][t]) overlaps += 1;
    }
  }
  return 1 - overlaps / Math.max(1, total);
}

function mean(values: number[], idx?: number[]): number {
  if (idx) {
    const picked = idx.map((i) => values[i]).filter((v) => Number.isFinite(v));
    return meanFinite(picked);
  }
  return meanFinite(values);
}
