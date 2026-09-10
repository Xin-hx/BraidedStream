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
  q: QuantileMatrix;
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

/** Uncertainty normalization mode. See DECISIONS.md D1. */
export type NormalizeMode = "per-layer" | "global";

export interface UncertaintyOptions {
  /** 80% interval bounds: p_low = p10, p_high = p90. Fixed by METHOD.md M3. */
  lowKey?: QuantileKey;
  highKey?: QuantileKey;
  normalize?: NormalizeMode;
  /** Optional diagnostic smoothing (0 disables smoothing). Default 0. */
  smoothWindow?: number;
}

export interface UncertaintyResult {
  /** w_i(t): interval width. */
  width: number[][];
  /** u_i(t) in [0,1]. */
  u: number[][];
}

/** PID proxy depth, see METHOD.md M2. */
export interface PidResult {
  /** depth per layer id, in [0,1]. */
  depth: Record<string, number>;
  /** inside-out order: deepest first in the middle. */
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
  /** final boundaries (stack order). */
  yBottomStar: number[][];
  yTopStar: number[][];
  /** layout displacement s_i(t) (cascade). */
  s: number[][];
  /** oscillation displacement o_i(t). */
  o: number[][];
  /** allocated amplitude a_i^alloc(t) after budget compression. */
  aAlloc: number[][];
  /** allocated/displayed adjacent seam width d_j(t), exactly nonnegative. */
  seam: number[][];
  /** per-time compression ratio rho(t) in [0,1]. */
  rho: number[];
  /** total envelope height H*(t). */
  totalHeight: number[];
  /** conflict components at each time (report only): list of component sizes. */
  components: number[][];
  /** final total envelope of each layer: E_high = U+s+aAlloc (data units). */
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
  costs: CostReport;
  /** y extent used for parameter scaling (data units). */
  yExtent: number;
}

export type ViewMode = "base" | "pid" | "braided";
export type PresentationMode = "diagnostic" | "publication";
