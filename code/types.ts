/**
 * Shared types for the braided streamgraph core.
 * Pure data types — no DOM dependencies.
 */

/** Quantile keys in increasing order (matches COVIDhub ensemble quantiles). */
export const QUANTILE_KEYS = [
  "p025",
  "p10",
  "p25",
  "p50",
  "p75",
  "p90",
  "p975",
] as const;
export type QuantileKey = (typeof QUANTILE_KEYS)[number];

export interface QuantileMatrix {
  p025: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
  p975: number[];
}

export interface Layer {
  id: string;
  /** Optional stable color (hex). Renderer falls back to palette by index. */
  color?: string;
  /** Per-capita value (optional, shown in hover detail). */
  perCapita?: number[];
  /** Streamgraph thickness. Distinct from distribution quantiles. */
  magnitude?: number[];
  /** Raw distribution at each time; missing cells are represented by null. */
  distribution?: Array<DistributionAtTime | null>;
  /** Number of empirical members; null when only quantiles are supplied. */
  sampleSize?: Array<number | null>;
  /** Optional analyst-supplied uncertainty signal in [0, 1], one value per time. */
  uncertainty?: number[];
  sourceKind?: "empirical" | "quantile" | "quantile-mixture";
  q: QuantileMatrix;
}

export interface EmpiricalDistributionCell {
  kind: "empirical";
  observations: Array<{ memberId: string; value: number; weight?: number }>;
}

export interface QuantileDistributionCell {
  kind: "quantile";
  probabilities: number[];
  quantiles: number[];
  pointValue?: number;
}

export type DistributionCell = EmpiricalDistributionCell | QuantileDistributionCell;

export type EmpiricalDistribution = {
  kind: "samples";
  values: number[];
  weights?: number[];
};

export type QuantileDistribution = {
  kind: "quantiles";
  probabilities: number[];
  values: number[];
};

export type QuantileMixtureDistribution = {
  kind: "quantile-mixture";
  members: Array<{
    probabilities: number[];
    values: number[];
    weight: number;
  }>;
};

export type DistributionAtTime = EmpiricalDistribution | QuantileDistribution | QuantileMixtureDistribution;

export type WeightedPoint = {
  value: number;
  weight: number;
};

export interface DistributionalLayer {
  id: string;
  cells: Array<DistributionCell | null>;
  /** Optional analyst-supplied uncertainty signal in [0, 1], one value per time. */
  uncertainty?: number[];
}

export interface DistributionalTemporalDataset {
  times: string[];
  layers: DistributionalLayer[];
  magnitudePolicy: "empirical-mean" | "point" | "median";
}

export interface CanonicalLayer extends Omit<Layer, "magnitude" | "distribution" | "sampleSize" | "sourceKind"> {
  magnitude: number[];
  distribution: Array<DistributionAtTime | null>;
  sampleSize: Array<number | null>;
  sourceKind: "empirical" | "quantile" | "quantile-mixture";
}

export interface ForecastData {
  /** Time labels (e.g. dates or indices). Length T. */
  times: string[];
  layers: Layer[];
}

export interface ValidationIssue {
  layerId: string;
  timeIndex: number;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface UncertaintyResult {
  /** Normalized signal retained for non-braided comparison encodings. */
  value: number[][];
  /** Global upper empirical-CDF percentile rank of the uncertainty signal. */
  rank: number[][];
  /** Comparison-view exposure after the dataset-wide midrank ramp. */
  exposure: number[][];
}

export type BranchGeometry = {
  layerId: string;
  branchIndex: number;
  mass: number;
  masses: number[];
  y0: number[];
  y1: number[];
};

export type BraidedQuantiles = {
  qLow: number;
  q10: number;
  q25: number;
  q50: number;
  q75: number;
  q90: number;
  qHigh: number;
};

export type BraidedPointDebug = BraidedQuantiles & {
  H: number;
  /** Median of the KDE-smoothed analysis distribution; not the representative thickness. */
  kdeMedian: number;
  mean: number;
  deviationLow: number;
  deviationHigh: number;
  dispersion: number;
  bandwidth: number;
  bandwidthRatio: number;
  active: boolean;
  missing: boolean;
  branchCount: number;
  modeLocations: number[];
  branchMasses: number[];
  separations: number[];
  gaps: number[];
  branchCenters: number[];
  envelopeLow: number;
  envelopeHigh: number;
  balance: number;
  actualSpace: number;
  branchIntervals: Array<{ y0: number; y1: number }>;
  visibleBranchCount: number;
};

export type SpaceGeometry = {
  ownerLayerId: string;
  kind: "lower" | "internal" | "upper";
  gapIndex: number;
  y0: number[];
  y1: number[];
};

export type BraidedLayerGeometry = {
  layerId: string;
  /** Mathematical topology; subpixel branches naturally appear merged. */
  branchCount: number[];
  missing: boolean[];
  active: boolean[];
  branches: BranchGeometry[];
  spaces: SpaceGeometry[];
  visualEnvelopeY0: number[];
  visualEnvelopeY1: number[];
  slotY0: number[];
  slotY1: number[];
  actualSpace: number[];
  balance: number[];
  /** Present only when debug=true; the same geometry used for rendering. */
  debug?: BraidedPointDebug[];
};

export type BraidedStreamOptions = {
  /** KDE bandwidth ratio beta in h = beta * standard deviation. */
  bandwidthRatio: number;
  epsilon: number;
  debug: boolean;
};

/** Temporal probabilistic inclusion depth used by the existing pipeline API. */
export interface PidResult {
  /** TPID score per layer id. */
  depth: Record<string, number>;
  /** Mean directional inclusion u_i subset_p u_j, including the official self term. */
  inclusionIn: Record<string, number>;
  /** Mean directional inclusion u_j subset_p u_i, including the official self term. */
  inclusionOut: Record<string, number>;
  /** Layer ids sorted by descending TPID score. */
  ranking: string[];
  /** Bottom-to-top stack order with higher TPID assigned to more interior ordinal shells. */
  order: string[];
  /** Common observed time indices used by every pairwise comparison. */
  referenceTimeIndices: number[];
  /** False when fewer than two layers or no common observed time exists. */
  defined: boolean;
}

export interface BaseLayout {
  /** Baseline offset per time step. */
  baseline: number[];
  /** yBottom[i][t], yTop[i][t] for layer index i (stack order). */
  yBottom: number[][];
  yTop: number[][];
}

export interface BraidedLayout {
  /** Owner-explicit layer-slot geometry used by the renderer. */
  layers: BraidedLayerGeometry[];
  /** Final colored outer boundaries (first and last retained branch). */
  yBottomStar: number[][];
  yTopStar: number[][];
  /** Actual dynamic space D per layer and time. */
  actualSpace: number[][];
  /** Total dynamic-slot height, including exterior and internal space. */
  totalHeight: number[];
  /** Final dynamic-slot bounds, including layer translation. */
  envelopeHigh: number[][];
  envelopeLow: number[][];
}

export interface CostReport {
  maxHeightRatio: number;
  meanHeightRatio: number;
  collisionCount: number;
  minGap: number;
  curvatureBraided: number;
  curvatureBase: number;
  slopeBraided: number;
  slopeBase: number;
  displacement: number;
  /** Sum of cellwise D=U deformation budgets. */
  dispersionTotal: number;
}

export interface PipelineResult {
  validation: ValidationResult;
  pid: PidResult;
  uncertainty: UncertaintyResult;
  base: BaseLayout;
  braided: BraidedLayout;
  options: BraidedStreamOptions;
  costs: CostReport;
  /** y extent used for parameter scaling (data units). */
  yExtent: number;
}
