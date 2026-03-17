export type BaselineMode = "sineStream" | "center" | "zero";
export type GapMode = "none" | "uncGap" | "fixedGap";
export type SmoothKernel = "cubic";
export type RenderMode = "meanOnly" | "mean+uncBandInGap";
export type DatasetKind = "synthetic" | "covid";

export interface LayerInput {
  id: string;
  mean: number[];
  unc?: number[];
  lower?: number[];
  upper?: number[];
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
  renderMode: RenderMode;
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
}

export interface InvariantSummary {
  checked: boolean;
  violations: string[];
  maxThicknessError: number;
}
