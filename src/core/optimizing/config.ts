import type { OptimizingVariantConfig } from "./types";

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
  return config;
}
