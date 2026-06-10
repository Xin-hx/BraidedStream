import type {
  OptimizingBaselineMode,
  OptimizingStage,
  OrderWeightType,
  OrderingScoringMode,
  PidUncertaintySource,
  ROI
} from "../types";
import type { SineStreamParams } from "../baseline";

export interface SineStreamOrderConfig {
  clusterAutoCutScale: number;
  clusterBoundaryPenalty: number;
  orderSimilaritySigma: number;
  orderMaxSwapPasses: number;
  orderWeightType: OrderWeightType;
  orderUseThicknessWeight: boolean;
  orderUseLengthWeight: boolean;
  orderLengthWeightThreshold: number;
  orderUncertaintyWeight: number;
  fixedSeed: number;
}

export interface OptimizingVariantConfig {
  optimizingStage: OptimizingStage;
  orderingScoringMode: OrderingScoringMode;
  baselineMode: OptimizingBaselineMode;
  pidUncertaintySource: PidUncertaintySource;
  pidTimeAlpha: number;
  baselineUncertaintyWeight: number;
  multiscaleEnergyThreshold: number;
  baselineHooks: SineStreamParams;
  orderRoi: ROI | null;
  sineOrder: SineStreamOrderConfig;
}
