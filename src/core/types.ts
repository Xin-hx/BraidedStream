/**
 * Shared domain types for data preparation, ordering, baselines, and layouts.
 */

export type BaselineMode = "sineStream" | "center" | "zero" | "l1" | "l2";
export type OptimizingBaselineMode = BaselineMode | "multiscale" | "scour";
export type DatasetKind = "synthetic" | "covid" | "sineBank" | "dataGenerator";
export type InsetViewMode = "before" | "after" | "diff" | "split";
export type EnhanceTab = "optimize" | "spaghetti";
export type PidUncertaintySource = "value" | "poportion";
export type PidTimeOrderMode = "layer_pid_centrality" | "layer_pid_time_weighted";
export type OptimizingStage = "plainStream" | "stackedGeometry" | "sineStream" | "tpidMultiscale" | "scour" | "custom";
export type OrderingScoringMode = "input" | "insideOut" | "sineStream" | "intervalInclusion" | "pidMean" | "pidTimeWeighted";
export type BaselineCenterType = "median" | "mean" | "geometric" | "harmonic";
export type OrderWeightType = "max" | "arithmetic" | "geometric" | "harmonic" | "median";
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
  baselineCenterType?: BaselineCenterType;
  /** SineStream layer ordering weight type: "max" | "arithmetic" | "geometric" | "harmonic" | "median" */
  orderWeightType?: OrderWeightType;
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
  /** Minimum normalized Haar-band energy included by multiscale baseline optimization */
  multiscaleEnergyThreshold?: number;
  /** Recursive Scour: chain turning-energy weight. */
  scourLambdaTurn?: number;
  /** Recursive Scour: fixed split penalty. */
  scourRhoSplit?: number;
  /** Recursive Scour: split height-penalty weight. */
  scourEtaHeight?: number;
  /** Recursive Scour: split balance-penalty weight. */
  scourBetaBalance?: number;
  /** Recursive Scour: maximum binary-tree depth. */
  scourMaxDepth?: number;
  /** Recursive Scour: groups with this many layers or fewer remain terminal. */
  scourMinGroupSize?: number;
  /** Recursive Scour: moving-interface second-difference weight. */
  scourMovingInterfaceLambda?: number;
  /** Recursive Scour: local-zero anchor weight for moving interfaces. */
  scourMovingInterfaceAnchorWeight?: number;
  /** Recursive Scour: moving-interface energy weight in split decisions. */
  scourMovingInterfaceWeight?: number;
  /** Recursive Scour: moving-interface solver mode. */
  scourMovingInterfaceMode?: "symmetric" | "optimized" | "fixed";
  /** Seed used by SineStream pre-shuffle in hierarchical ordering */
  shuffleSeed?: number;
}

export interface LayerInput {
  id: string;
  /** Optional source color. Loaders should provide a fallback when source data omits it. */
  fill_color?: string;
  /** Optional per-sample time keys aligned with this layer's series values. */
  timeKeys?: number[];
  height: number[];
  quantiles?: QuantileBands;
  unc?: number[];
  poportionMean?: number[];
  poportionQuantiles?: QuantileBands;
  poportionUnc?: number[];
  poportionLower?: number[];
  poportionUpper?: number[];
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
  yScale: (v: number) => number;
}

export interface StackLayout {
  baseline: number[];
  yBottom: number[][];
  yTop: number[][];
}

export interface InvariantSummary {
  checked: boolean;
  violations: string[];
  maxThicknessError: number;
}
