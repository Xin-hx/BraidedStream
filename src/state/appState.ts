import type {
  BaselineMode,
  DatasetKind,
  EnhanceTab,
  GapMode,
  HorizonFilterMode,
  InsetViewMode,
  OptimizeMethod,
  ROI,
  LayoutOptimizationConfig,
  RoiRecommendStrategy,
  SmoothKernel,
  UncertaintyBandMode
} from "../core/types";
import { FIXED_SEED } from "../core/seed";

export interface AppState {
  datasetKind: DatasetKind;
  enhanceTab: EnhanceTab;
  metricsExpanded: boolean;
  optimizeMethod: OptimizeMethod;
  optimizeWithinROI: boolean;
  spaghettiAllStates: boolean;
  spaghettiSelectedStates: string[];
  fixedSeed: number;
  baseline: BaselineMode;
  gapMode: GapMode;
  insetViewMode: InsetViewMode;
  ROI: ROI | null;
  insetROI: ROI | null;
  gapAlphaPx: number;
  maxExtraHeightPx: number;
  smoothKernel: SmoothKernel;
  assertEnabled: boolean;
  yZoomInset: number;
  recommendStrategy: RoiRecommendStrategy;
  covidUncertaintyBand: UncertaintyBandMode;
  covidHorizonFilter: HorizonFilterMode;
  optimization: LayoutOptimizationConfig;
  enableUncertaintyGap: boolean;
  enableJaggedEdge: boolean;
  insetJaggedAmplitude: number;
  insetJaggedFrequency: number;
}

export function createInitialState(): AppState {
  return {
    datasetKind: "covid",
    enhanceTab: "optimize",
    metricsExpanded: false,
    optimizeMethod: "sineStream",
    optimizeWithinROI: true,
    spaghettiAllStates: false,
    spaghettiSelectedStates: [],
    fixedSeed: FIXED_SEED,
    baseline: "sineStream",
    gapMode: "uncGap",
    insetViewMode: "split",
    ROI: null,
    insetROI: null,
    gapAlphaPx: 22,
    maxExtraHeightPx: 160,
    smoothKernel: "cubic",
    assertEnabled: true,
    yZoomInset: 1.1,
    recommendStrategy: "highest uncertainty",
    covidUncertaintyBand: "95",
    covidHorizonFilter: "h1",
    optimization: {
      spacingBudgetPx: 320,
      spacingUncertaintyWeight: 1.6,
      spacingSlopeWeight: 0.65,
      spacingTemporalWeight: 0.1,
      spacingIterations: 2,
      clusterAutoCutScale: 1,
      clusterBoundaryPenalty: 0.5,
      orderSimilaritySigma: 0.75,
      orderMaxSwapPasses: 20,
      wiggleWeightL1: 1,
      wiggleWeightL2: 1,
      centerAnchorWeight: 0.35,
      irlsIterations: 12,
      irlsEps: 1e-3,
      // SineStream configuration
      baselineCenterType: "median",
      orderWeightType: "max",
      orderUseThicknessWeight: true,
      orderUseLengthWeight: true,
      orderLengthWeightThreshold: 9,
      orderUncertaintyWeight: 0.35,
      baselineUncertaintyWeight: 0.45
    },
    enableUncertaintyGap: true,
    // Keep the knob for future extension, but current release keeps jagged disabled.
    enableJaggedEdge: false,
    insetJaggedAmplitude: 2.4,
    insetJaggedFrequency: 1.6
  };
}
