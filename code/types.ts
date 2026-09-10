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
  sourceKind?: "empirical" | "quantile" | "hybrid";
  q: QuantileMatrix;
}

export interface EmpiricalDistributionCell {
  kind: "empirical";
  observations: Array<{ memberId: string; value: number; weight?: number }>;
  /** Representative value when the cell has no observed members. */
  emptyValue?: number;
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

export type DistributionAtTime = EmpiricalDistribution | QuantileDistribution;

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
  sourceKind: "empirical" | "quantile" | "hybrid";
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
  /** Normalized uncertainty signal, supplied by the analyst or derived from quantile width. */
  value: number[][];
  /** Global upper empirical-CDF percentile rank of the uncertainty signal. */
  rank: number[][];
  /** Visual exposure lambda after the top-p percentile ramp. */
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
  q25: number;
  q50: number;
  q75: number;
  /** Selected representative statistic Q^rho. */
  qRepresentative: number;
  qEnvelope: number;
  qHigh: number;
};

export type BraidedPointDebug = BraidedQuantiles & {
  H: number;
  HEnvelope: number;
  uncertainty: number;
  uncertaintyRank: number;
  exposure: number;
  active: boolean;
  rawBranchCount: 1 | 2 | 3;
  persistentBranchCount: 1 | 2 | 3;
  modeLocations: number[];
  branchMasses: number[];
  branchCenters: number[];
  envelopeLow: number;
  envelopeHigh: number;
  branchIntervals: Array<{ y0: number; y1: number }>;
  visibleBranchCount: 1 | 2 | 3;
};

export type SpaceGeometry = {
  ownerLayerId: string;
  kind: "internal";
  gapIndex: number;
  y0: number[];
  y1: number[];
};

export type BraidedLayerGeometry = {
  layerId: string;
  /** Mathematical topology; subpixel branches naturally appear merged. */
  branchCount: Array<1 | 2 | 3>;
  active: boolean[];
  branches: BranchGeometry[];
  spaces: SpaceGeometry[];
  visualEnvelopeY0: number[];
  visualEnvelopeY1: number[];
  slotY0: number[];
  slotY1: number[];
  uncertainty: number[];
  uncertaintyRank: number[];
  exposure: number[];
  requestedSpace: number[];
  allocatedSpace: number[];
  /** Present only when debug=true; the same geometry used for rendering. */
  debug?: BraidedPointDebug[];
};

export type BraidedStreamOptions = {
  /** Representative statistic Q^rho; rho must be in [0.025, envelopeQuantile). */
  representativeQuantile: number;
  /** Upper quantile Q^eta used as the external slot contour; eta must be in (0.5, 0.975]. */
  envelopeQuantile: number;
  /** Percentage of globally highest uncertainty ranks exposed; 0 disables deformation. */
  uncertaintyFocusPercent: number;
  epsilon: number;
  debug: boolean;
};

export type CollisionRelaxationStats = {
  beforeCount: number;
  afterCount: number;
  maxOverlapBefore: number;
  maxOverlapAfter: number;
  passes: number;
};

/** Temporal probabilistic inclusion depth used by the existing pipeline API. */
export interface PidResult {
  /** TPID score per layer id. */
  depth: Record<string, number>;
  /** Layer ids sorted by descending TPID score. */
  ranking: string[];
  /** Stack order with the highest TPID layers nearest the center. */
  order: string[];
}

export interface BaseLayout {
  /** Baseline offset per time step. */
  baseline: number[];
  /** yBottom[i][t], yTop[i][t] for layer index i (stack order). */
  yBottom: number[][];
  yTop: number[][];
}

/** Encoding mode: which channels carry u. See METHOD.md M5. */
export type EncodingMode = "both" | "amplitude" | "frequency";

/** Phase optimizer selection. See METHOD.md M8. */
export type PhaseMode = "sine" | "l2";

export interface CorridorOptions {
  /** Shared event close threshold on u. Default 0.3. */
  participationThreshold: number;
  /** Explicit shared event close threshold; overrides participationThreshold. */
  eventCloseThreshold?: number;
  /** Shared event open threshold on u. Defaults to close + windowSmooth/100. */
  eventOpenThreshold?: number;
  /** Max requested half-corridor amplitude, in data units. Default: 3% of y extent. */
  amplitudeMax: number;
  /** Min clearance between envelopes, data units. Default: 0.2% of y extent. */
  clearance: number;
  /** Amplitude shaping exponent s_a(u)=u^gamma. Default 1. */
  gamma?: number;
  /** Encoding mode. Default "both". */
  encoding?: EncodingMode;
  /** Frequency min/max in cycles per full span. Default 0.5/4. */
  frequencyMin: number;
  frequencyMax: number;
  /** Gate transition width in hundredths of normalized u. Default 5. */
  windowSmooth: number;
  /** Budget multiplier: B(t) = eta * H0(t). Default 1.6. */
  budgetEta: number;
  /** Phase optimizer. Default "sine". */
  phaseMode?: PhaseMode;
  /** L2 optimizer weights (phaseMode="l2"). */
  l2CollisionWeight?: number;
  l2SmoothWeight?: number;
  /** L2 optimizer: coordinate-descent rounds / grid points. Deterministic. */
  l2Rounds?: number;
  l2GridPoints?: number;
  /** Optional per-layer participation override: null=auto. */
  layerOverride?: Record<string, boolean> | null;
}

export interface RequestedCorridors {
  /** a_i^req(t). */
  aReq: number[][];
  /** Compact pointwise event gate g_i(t) in [0,1]. */
  gate: number[][];
  /** Adjacent displayed seam request d_j^req(t). */
  seamReq: number[][];
  /** Backward-compatible alias of gate. */
  window: number[][];
  /** instantaneous frequency f_i(t) in cycles per span. */
  freq: number[][];
  /** integrated phase theta_i(t) (radians). */
  theta: number[][];
  /** per-layer mean requested amplitude (for frequency-only mode). */
  ampConst: number[];
}

export interface PhaseOptimizerResult {
  /** per-layer phase offset phi_i (radians). */
  phi: number[];
}

export interface BraidedLayout {
  /** Owner-explicit layer-slot geometry used by the renderer. */
  layers: BraidedLayerGeometry[];
  /** final boundaries (stack order). */
  yBottomStar: number[][];
  yTopStar: number[][];
  /** layout displacement s_i(t) (cascade). */
  s: number[][];
  /** oscillation displacement o_i(t). */
  o: number[][];
  /** Compatibility alias of the full, uncompressed envelope extent. */
  aAlloc: number[][];
  /** allocated/displayed adjacent seam width d_j(t), exactly nonnegative. */
  seam: number[][];
  /** Compatibility field: faithful envelopes always use 1. */
  rho: number[];
  /** total envelope height H*(t). */
  totalHeight: number[];
  /** conflict components at each time (report only): list of component sizes. */
  components: number[][];
  /** Final active external-envelope bounds, including layer translation. */
  envelopeHigh: number[][];
  envelopeLow: number[][];
  collisionRelaxation: CollisionRelaxationStats;
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
  allocRatio: number;
  phaseContinuityMax: number;
  requestedTotal: number;
  allocatedTotal: number;
}

export interface PipelineResult {
  validation: ValidationResult;
  pid: PidResult;
  uncertainty: UncertaintyResult;
  base: BaseLayout;
  corridors: RequestedCorridors;
  phases: PhaseOptimizerResult;
  braided: BraidedLayout;
  options: BraidedStreamOptions;
  costs: CostReport;
  /** y extent used for parameter scaling (data units). */
  yExtent: number;
}
