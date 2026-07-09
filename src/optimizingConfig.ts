import type { OptimizingBaselineMode, OptimizingStage, OrderingScoringMode } from "./core/types";

// ── Types ────────────────────────────────────────────────────────────────────

import type { OrderWeightType, PidUncertaintySource, ROI } from "./core/types";
import type { BaselineParameters } from "./core/baseline/types";
import type { ScourConfig } from "./core/temp";

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
  baselineHooks: BaselineParameters;
  scour: ScourConfig;
  orderRoi: ROI | null;
  sineOrder: SineStreamOrderConfig;
}

// ── Config resolution ────────────────────────────────────────────────────────

export function resolveOptimizingVariantConfig(config: OptimizingVariantConfig): OptimizingVariantConfig {
  if (config.optimizingStage === "byronWattenberg") {
    return {
      ...config,
      orderingScoringMode: "insideOut",
      baselineMode: "l2",
      baselineHooks: { ...config.baselineHooks, weightedWiggle: true, centerAnchorWeight: 0 }
    };
  }
  if (config.optimizingStage === "bartolomeoHu") {
    return {
      ...config,
      orderingScoringMode: "twoOpt",
      baselineMode: "l1",
      baselineHooks: { ...config.baselineHooks, weightedWiggle: true, centerAnchorWeight: 0 }
    };
  }
  if (config.optimizingStage === "buZhang") {
    return {
      ...config,
      orderingScoringMode: "sineStream",
      baselineMode: "sineStream"
    };
  }
  if (config.optimizingStage === "ours") {
    return {
      ...config,
      orderingScoringMode: "input",
      baselineMode: "scour"
    };
  }
  return config;
}

// ── UI labels ────────────────────────────────────────────────────────────────

export function orderingScoringLabel(mode: OrderingScoringMode): string {
  if (mode === "input") {
    return "Original order";
  }
  if (mode === "insideOut") {
    return "Inside-out (late onset)";
  }
  if (mode === "twoOpt") {
    return "2-opt";
  }
  if (mode === "sineStream") {
    return "Hierarchy clustering";
  }
  if (mode === "pidMean") {
    return "PID";
  }
  if (mode === "pidTimeWeighted") {
    return "PID + time trend";
  }
  return "One-way inclusion";
}

export function optimizingStageLabel(stage: OptimizingStage): string {
  if (stage === "byronWattenberg") {
    return "Byron & Wattenberg";
  }
  if (stage === "bartolomeoHu") {
    return "Bartolomeo & Hu";
  }
  if (stage === "buZhang") {
    return "Bu & Zhang";
  }
  if (stage === "ours") {
    return "Ours";
  }
  return "Customer";
}

export function optimizingBaselineModeLabel(mode: OptimizingBaselineMode): string {
  if (mode === "zero") {
    return "Zero";
  }
  if (mode === "center") {
    return "Centered";
  }
  if (mode === "l1") {
    return "Weighted wiggle (L1 norm)";
  }
  if (mode === "l2") {
    return "Weighted wiggle (L2 norm)";
  }
  if (mode === "sineStream") {
    return "Gaussian weighted wiggle";
  }
  if (mode === "scour") {
    return "Common-interface joint optimization";
  }
  return "Multiscale";
}
