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
  if (config.optimizingStage === "plainStream") {
    return {
      ...config,
      orderingScoringMode: "input",
      baselineMode: "center"
    };
  }
  if (config.optimizingStage === "stackedGeometry") {
    return {
      ...config,
      orderingScoringMode: "insideOut",
      baselineMode: "l2"
    };
  }
  if (config.optimizingStage === "sineStream") {
    return {
      ...config,
      orderingScoringMode: "sineStream",
      baselineMode: "sineStream"
    };
  }
  if (config.optimizingStage === "tpidMultiscale") {
    return {
      ...config,
      orderingScoringMode: "pidTimeWeighted",
      baselineMode: "multiscale"
    };
  }
  if (config.optimizingStage === "scour") {
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
    return "Inside-out";
  }
  if (mode === "sineStream") {
    return "SineStream";
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
  if (stage === "plainStream") {
    return "Plain stream";
  }
  if (stage === "stackedGeometry") {
    return "Stacked Graphs geometry/aesthetics";
  }
  if (stage === "sineStream") {
    return "SineStream readability";
  }
  if (stage === "tpidMultiscale") {
    return "TPID + multiscale";
  }
  if (stage === "scour") {
    return "Recursive Scour";
  }
  return "Custom";
}

export function optimizingBaselineModeLabel(mode: OptimizingBaselineMode): string {
  if (mode === "zero") {
    return "Zero";
  }
  if (mode === "center") {
    return "Centered";
  }
  if (mode === "l1") {
    return "L1";
  }
  if (mode === "l2") {
    return "L2";
  }
  if (mode === "sineStream") {
    return "SineStream";
  }
  if (mode === "scour") {
    return "Recursive Scour";
  }
  return "Multiscale";
}
