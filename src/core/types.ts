export type BaselineMode = "sineStream" | "center" | "zero" | "l1" | "l2";
export type GapMode = "none" | "uncGap" | "fixedGap";
export type SmoothKernel = "cubic";
export type DatasetKind = "synthetic" | "covid";
export type InsetViewMode = "before" | "after" | "diff" | "split";
export type EnhanceTab = "optimize" | "braided" | "spaghetti" | "pidOrdering" | "pidNew";
export type OptimizeMethod = "sineStream" | "multiscale";
export type PidBaselineMode = "l1" | "l2" | "sineStream" | "multiscale";
export type RoiRecommendStrategy = "highest uncertainty" | "highest mean slope" | "highest wiggle" | "largest local change";
export type UncertaintyBandMode = "50" | "95";
export type HorizonFilterMode = "h1" | "h2" | "h3" | "h4";

export interface QuantileBands {
  [key: string]: number[];
  p05: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
}

export interface LayoutOptimizationConfig {
  spacingBudgetPx: number;
  spacingUncertaintyWeight: number;
  spacingSlopeWeight: number;
  spacingTemporalWeight: number;
  spacingIterations: number;
  clusterAutoCutScale: number;
  clusterBoundaryPenalty: number;
  orderSimilaritySigma: number;
  orderMaxSwapPasses: number;
  wiggleWeightL1: number;
  wiggleWeightL2: number;
  centerAnchorWeight: number;
  irlsIterations: number;
  irlsEps: number;
  /** SineStream baseline center type: "median" | "mean" | "geometric" | "harmonic" */
  baselineCenterType?: "median" | "mean" | "geometric" | "harmonic";
  /** SineStream layer ordering weight type: "max" | "arithmetic" | "geometric" | "harmonic" | "median" */
  orderWeightType?: "max" | "arithmetic" | "geometric" | "harmonic" | "median";
  /** Enable thickness weighting in layer ordering */
  orderUseThicknessWeight?: boolean;
  /** Enable length weighting in layer ordering */
  orderUseLengthWeight?: boolean;
  /** Length weight threshold (default: 9) */
  orderLengthWeightThreshold?: number;
  /** Auxiliary uncertainty term weight in ordering distance */
  orderUncertaintyWeight?: number;
  /** Uncertainty strength in uncertainty-aware baseline solver */
  baselineUncertaintyWeight?: number;
  /** Seed used by SineStream pre-shuffle in hierarchical ordering */
  shuffleSeed?: number;
}

export interface BraidOptimizationDiagnostics {
  orderObjectiveBefore: number;
  orderObjectiveAfter: number;
  clusterCount: number;
  trunkCluster: number;
  crossClusterBoundaries: number;
  spacingObjective: number;
  spacingUncertaintyTerm: number;
  spacingSlopeTerm: number;
  spacingTemporalTerm: number;
  spacingIterations: number;
  spacingObjectiveHistory: number[];
}

export interface LayerInput {
  id: string;
  mean: number[];
  quantiles?: QuantileBands;
  unc?: number[];
  poportionUnc?: number[];
  lower?: number[];
  upper?: number[];
}

export interface PreparedDataset {
  times: number[];
  layers: LayerInput[];
  order: string[];
}

export interface ROI {
  t0Index: number;
  t1Index: number;
}

export interface LayoutInput {
  times: number[];
  layers: LayerInput[];
  order: string[];
  baseline: BaselineMode;
  ROI: ROI | null;
  gapMode: GapMode;
  gapAlphaPx: number;
  maxExtraHeightPx: number;
  smoothKernel: SmoothKernel;
  yScale: (v: number) => number;
}

export interface StackLayout {
  baseline: number[];
  yBottom: number[][];
  yTop: number[][];
}

export interface RoiSupportWindow {
  tau: number;
  coreStart: number;
  coreEnd: number;
  supportStart: number;
  supportEnd: number;
}

export interface BraidLayout extends StackLayout {
  omega: number[];
  gapsPx: number[][];
  gapsValue: number[][];
  sumGapPx: number[];
  roiSupport: RoiSupportWindow | null;
  diagnostics?: BraidOptimizationDiagnostics;
}

export interface InvariantSummary {
  checked: boolean;
  violations: string[];
  maxThicknessError: number;
}
