import type {
  BaselineMode,
  BaselineCenterType,
  DatasetKind,
  EnhanceTab,
  GapMode,
  HorizonFilterMode,
  InsetViewMode,
  OptimizingBaselineMode,
  OptimizingStage,
  OrderingScoringMode,
  PidUncertaintySource,
  ROI,
  LayoutOptimizationConfig,
  OrderWeightType,
  SmoothKernel,
  UncertaintyBandMode
} from "../core/types";
import { FIXED_SEED } from "../core/utils";

export interface OptimizingCompareState {
  optimizingStage: OptimizingStage;
  orderingScoringMode: OrderingScoringMode;
  baselineMode: OptimizingBaselineMode;
  pidUncertaintySource: PidUncertaintySource;
  pidTimeAlpha: number;
  baselineCenterType: BaselineCenterType;
  baselineUncertaintyWeight: number;
  multiscaleEnergyThreshold: number;
  wiggleWeightL1: number;
  wiggleWeightL2: number;
  centerAnchorWeight: number;
  irlsIterations: number;
  irlsEps: number;
  sineOrderWeightType: OrderWeightType;
  sineOrderUseThicknessWeight: boolean;
  sineOrderUseLengthWeight: boolean;
  sineOrderLengthWeightThreshold: number;
  sineOrderUncertaintyWeight: number;
  clusterAutoCutScale: number;
  clusterBoundaryPenalty: number;
  orderSimilaritySigma: number;
  orderMaxSwapPasses: number;
}

export interface AppState {
  datasetKind: DatasetKind;
  enhanceTab: EnhanceTab;
  compareExpanded: boolean;
  optimizingStage: OptimizingStage;
  orderingScoringMode: OrderingScoringMode;
  compare: OptimizingCompareState;
  optimizingBaselineMode: OptimizingBaselineMode;
  pidTimeAlpha: number;
  pidUncertaintySource: PidUncertaintySource;
  showContourBoxplot: boolean;
  contourBoxplotYBins: number;
  contourBoxplotThreshold: number;
  contourBoxplotCentralFraction: number;
  contourBoxplotOpacity: number;
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
  covidUncertaintyBand: UncertaintyBandMode;
  covidHorizonFilter: HorizonFilterMode;
  generatorLayerCount: number;
  generatorTimeCount: number;
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
    compareExpanded: false,
    optimizingStage: "tpidMultiscale",
    orderingScoringMode: "pidTimeWeighted",
    compare: {
      optimizingStage: "sineStream",
      orderingScoringMode: "sineStream",
      baselineMode: "sineStream",
      pidUncertaintySource: "value",
      pidTimeAlpha: 0.8,
      baselineCenterType: "median",
      baselineUncertaintyWeight: 0.45,
      multiscaleEnergyThreshold: 0.08,
      wiggleWeightL1: 1,
      wiggleWeightL2: 1,
      centerAnchorWeight: 0.35,
      irlsIterations: 12,
      irlsEps: 1e-3,
      sineOrderWeightType: "max",
      sineOrderUseThicknessWeight: true,
      sineOrderUseLengthWeight: true,
      sineOrderLengthWeightThreshold: 9,
      sineOrderUncertaintyWeight: 0.35,
      clusterAutoCutScale: 1,
      clusterBoundaryPenalty: 0.5,
      orderSimilaritySigma: 0.75,
      orderMaxSwapPasses: 20
    },
    optimizingBaselineMode: "multiscale",
    pidTimeAlpha: 0.8,
    pidUncertaintySource: "value",
    showContourBoxplot: true,
    contourBoxplotYBins: 180,
    contourBoxplotThreshold: 0.5,
    contourBoxplotCentralFraction: 0.5,
    contourBoxplotOpacity: 0.82,
    spaghettiAllStates: false,
    spaghettiSelectedStates: [],
    fixedSeed: FIXED_SEED,
    baseline: "center",
    gapMode: "uncGap",
    insetViewMode: "split",
    ROI: null,
    insetROI: null,
    gapAlphaPx: 22,
    maxExtraHeightPx: 160,
    smoothKernel: "cubic",
    assertEnabled: true,
    yZoomInset: 1.1,
    covidUncertaintyBand: "95",
    covidHorizonFilter: "h1",
    generatorLayerCount: 15,
    generatorTimeCount: 30,
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
      baselineUncertaintyWeight: 0.45,
      multiscaleEnergyThreshold: 0.08
    },
    enableUncertaintyGap: true,
    // Keep the knob for future extension, but current release keeps jagged disabled.
    enableJaggedEdge: false,
    insetJaggedAmplitude: 2.4,
    insetJaggedFrequency: 1.6
  };
}
