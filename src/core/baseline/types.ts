import type { BaselineCenterType } from "../types";

export interface BaselineParameters {
  /** Center type for baseline: "median" | "mean" | "geometric" | "harmonic" */
  centerType?: BaselineCenterType;
  /** L1 wiggle weight (for mode=l1) */
  wiggleWeightL1?: number;
  /** L2 wiggle weight (for mode=l2) */
  wiggleWeightL2?: number;
  /** Use height-weighted centerline wiggle for mode=l1/l2 */
  weightedWiggle?: boolean;
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
  selectedScaleCount: number;
  selectedScales: number[];
  verifiedMultiscale: boolean;
  localShiftBudget: number;
  distributedShiftBudget: number;
  objectiveBefore: number;
  objectiveAfter: number;
  meanSlopeBefore: number;
  meanSlopeAfter: number;
  maxSlopeBefore: number;
  maxSlopeAfter: number;
  curvatureBefore: number;
  curvatureAfter: number;
  burstBefore: number;
  burstAfter: number;
  derivativeConcentrationBefore: number;
  derivativeConcentrationAfter: number;
  centerlineSlopeCoverageBefore: number;
  centerlineSlopeCoverageAfter: number;
  globalMeanSlopeGuardrailPassed: boolean;
  scaleCoefficients: Array<{ scale: number; coefficient: number }>;
  scaleBands: MultiscaleEnergyBandDiagnostic[];
  uncertaintySaliency: number[];
  localShiftAbs: number[];
  distributedShiftAbs: number[];
}

export interface MultiscaleBaselineResult {
  baseline: number[];
  diagnostics: MultiscaleBaselineDiagnostics;
}
