import type {
  AggregationMode,
  BaselineMode,
  DatasetKind,
  GapMode,
  GapSemanticMode,
  InsetViewMode,
  MetricScope,
  PresetMode,
  ROI,
  RenderMode,
  RoiRecommendStrategy,
  SmoothKernel
} from "../core/types";

export interface AppState {
  datasetKind: DatasetKind;
  baseline: BaselineMode;
  gapMode: GapMode;
  renderMode: RenderMode;
  insetViewMode: InsetViewMode;
  metricScope: MetricScope;
  gapSemanticMode: GapSemanticMode;
  ROI: ROI | null;
  insetROI: ROI | null;
  gapAlphaPx: number;
  maxExtraHeightPx: number;
  smoothKernel: SmoothKernel;
  assertEnabled: boolean;
  staticMode: boolean;
  publicationMode: boolean;
  smoothingWindow: number;
  downsamplingStep: number;
  aggregationMode: AggregationMode;
  yZoomInset: number;
  preset: PresetMode;
  recommendStrategy: RoiRecommendStrategy;
}

export function createInitialState(): AppState {
  return {
    datasetKind: "synthetic",
    baseline: "center",
    gapMode: "uncGap",
    renderMode: "mean+gapSemantic",
    insetViewMode: "after",
    metricScope: "roi",
    gapSemanticMode: "uncBand",
    ROI: null,
    insetROI: null,
    gapAlphaPx: 15,
    maxExtraHeightPx: 110,
    smoothKernel: "cubic",
    assertEnabled: true,
    staticMode: false,
    publicationMode: false,
    smoothingWindow: 1,
    downsamplingStep: 1,
    aggregationMode: "none",
    yZoomInset: 1.1,
    preset: "Readability",
    recommendStrategy: "highest uncertainty"
  };
}
