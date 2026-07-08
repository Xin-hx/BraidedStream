import type {
  BaselineMode,
  BaselineCenterType,
  DatasetKind,
  EnhanceTab,
  HorizonFilterMode,
  InsetViewMode,
  OptimizingBaselineMode,
  OptimizingStage,
  OrderingScoringMode,
  PidUncertaintySource,
  ROI,
  LayoutOptimizationConfig,
  OrderWeightType,
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
  scourLambdaTurn: number;
  scourRhoSplit: number;
  scourEtaHeight: number;
  scourBetaBalance: number;
  scourMaxDepth: number;
  scourMinGroupSize: number;
  scourMovingInterfaceLambda: number;
  scourMovingInterfaceAnchorWeight: number;
  scourMovingInterfaceWeight: number;
  scourMovingInterfaceMode: "symmetric" | "optimized" | "fixed";
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
  insetViewMode: InsetViewMode;
  ROI: ROI | null;
  insetROI: ROI | null;
  assertEnabled: boolean;
  yZoomInset: number;
  covidUncertaintyBand: UncertaintyBandMode;
  covidHorizonFilter: HorizonFilterMode;
  generatorLayerCount: number;
  generatorTimeCount: number;
  optimization: LayoutOptimizationConfig;
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
      orderMaxSwapPasses: 20,
      scourLambdaTurn: 0.2,
      scourRhoSplit: 0.05,
      scourEtaHeight: 0.01,
      scourBetaBalance: 0.1,
      scourMaxDepth: 4,
      scourMinGroupSize: 1,
      scourMovingInterfaceLambda: 0.2,
      scourMovingInterfaceAnchorWeight: 0,
      scourMovingInterfaceWeight: 0.25,
      scourMovingInterfaceMode: "optimized"
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
    insetViewMode: "split",
    ROI: null,
    insetROI: null,
    assertEnabled: true,
    yZoomInset: 1.1,
    covidUncertaintyBand: "95",
    covidHorizonFilter: "h1",
    generatorLayerCount: 15,
    generatorTimeCount: 30,
    optimization: {
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
      multiscaleEnergyThreshold: 0.08,
      scourLambdaTurn: 0.2,
      scourRhoSplit: 0.05,
      scourEtaHeight: 0.01,
      scourBetaBalance: 0.1,
      scourMaxDepth: 4,
      scourMinGroupSize: 1,
      scourMovingInterfaceLambda: 0.2,
      scourMovingInterfaceAnchorWeight: 0,
      scourMovingInterfaceWeight: 0.25,
      scourMovingInterfaceMode: "optimized"
    },
    // Keep the knob for future extension, but current release keeps jagged disabled.
    enableJaggedEdge: false,
    insetJaggedAmplitude: 2.4,
    insetJaggedFrequency: 1.6
  };
}
