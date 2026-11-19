export interface LayoutLayer {
  readonly id: string;
  readonly magnitude: readonly number[];
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
  kdeMedian: number;
  /** Raw probability-measure mean. */
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
  debug?: BraidedPointDebug[];
};

export type BraidedStreamOptions = {
  /** KDE bandwidth ratio beta in h = beta * raw standard deviation. */
  bandwidthRatio: number;
  debug: boolean;
};

export interface PidResult {
  depth: Record<string, number>;
  inclusionIn: Record<string, number>;
  inclusionOut: Record<string, number>;
  ranking: string[];
  order: string[];
  referenceTimeIndices: number[];
  defined: boolean;
}

export interface BaseLayout {
  baseline: number[];
  yBottom: number[][];
  yTop: number[][];
}

export interface BraidedLayout {
  layers: BraidedLayerGeometry[];
  yBottomStar: number[][];
  yTopStar: number[][];
  actualSpace: number[][];
  totalHeight: number[];
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
  dispersionTotal: number;
}

export interface UncertaintyResult {
  value: number[][];
  rank: number[][];
  exposure: number[][];
}

export interface PipelineResult {
  validation: { ok: true; issues: readonly [] };
  pid: PidResult;
  layoutOrder: string[];
  uncertainty: UncertaintyResult;
  base: BaseLayout;
  braided: BraidedLayout;
  options: BraidedStreamOptions;
  costs: CostReport;
  yExtent: number;
}
