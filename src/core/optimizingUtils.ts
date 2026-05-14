import { computeBaseline, computeMultiscaleDistributedBaseline, type SineStreamHooks } from "./baseline";
import {
  computeContourPid,
  computePidOrdering
} from "./pid";
import { buildCenterOutOrder, buildInsideOutOrder, normalizedInputOrder } from "./layerOrdering";
import { computePidOrderingScores, computeTemporalSelfInclusion } from "./layerScoring";
import { optimizeLayerOrder } from "./sineStreamOrder";
import type {
  BaselineMode,
  LayerInput,
  OptimizingBaselineMode,
  OptimizingStage,
  OrderWeightType,
  OrderingScoringMode,
  PidUncertaintySource,
  PreparedDataset,
  ROI
} from "./types";

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
  baselineHooks: SineStreamHooks;
  orderRoi: ROI | null;
  sineOrder: SineStreamOrderConfig;
}

export interface OptimizingOrderResult {
  displayOrder: string[];
  notes: string[];
}

export interface OptimizingBaselineResult {
  baseline: number[];
  multiscaleDiagnostics: ReturnType<typeof computeMultiscaleDistributedBaseline>["diagnostics"] | null;
}

export function computeOptimizingOrder(dataset: PreparedDataset, config: OptimizingVariantConfig): OptimizingOrderResult {
  const resolved = resolveOptimizingVariantConfig(config);
  const uncertaintySource = resolved.pidUncertaintySource;

  if (resolved.orderingScoringMode === "input") {
    return {
      displayOrder: normalizedInputOrder(dataset),
      notes: ["ordering: original dataset order"]
    };
  }

  if (resolved.orderingScoringMode === "insideOut") {
    return {
      displayOrder: buildInsideOutOrder(dataset.layers, normalizedInputOrder(dataset)),
      notes: ["ordering: inside-out layer ordering for streamgraph geometry/aesthetics"]
    };
  }

  if (resolved.orderingScoringMode === "sineStream") {
    const optimized = optimizeLayerOrder(
      dataset.layers,
      resolved.orderRoi,
      {
        clusterAutoCutScale: resolved.sineOrder.clusterAutoCutScale,
        clusterBoundaryPenalty: resolved.sineOrder.clusterBoundaryPenalty,
        similaritySigma: resolved.sineOrder.orderSimilaritySigma,
        maxSwapPasses: resolved.sineOrder.orderMaxSwapPasses,
        weightType: resolved.sineOrder.orderWeightType,
        useThicknessWeight: resolved.sineOrder.orderUseThicknessWeight,
        useLengthWeight: resolved.sineOrder.orderUseLengthWeight,
        lengthWeightThreshold: resolved.sineOrder.orderLengthWeightThreshold,
        useUncertaintyTerm: false,
        uncertaintyWeight: 0,
        shuffleSeed: resolved.sineOrder.fixedSeed
      },
      dataset.order
    );
    return {
      displayOrder: optimized.order,
      notes: [
        "ordering: SineStream hierarchical clustering + optimal leaf ordering",
        `SineStream order objective: ${optimized.diagnostics.objectiveBefore.toFixed(3)} -> ${optimized.diagnostics.objectiveAfter.toFixed(3)}`
      ]
    };
  }

  if (resolved.orderingScoringMode === "pidMean") {
    const contourPid = computeContourPid(dataset.layers, {
      yBins: 180,
      valueTransform: uncertaintySource === "poportion" ? "linear" : "log1p",
      centralFraction: 0.5,
      contourThreshold: 0.5,
      uncertaintySource
    });
    const top = contourPid.scores[0];
    return {
      displayOrder: contourPid.displayOrder,
      notes: [
        "PID scoring: contour PID-Mean over time-value fuzzy masks",
        top ? `top PID layer: ${layerLabel(top.id)} depth=${top.depth.toFixed(3)}` : "top PID layer: N/A"
      ]
    };
  }

  const pid = computePidOrdering(dataset.layers, {
    excludeSelf: true,
    widthPenaltyPower: 1,
    minComparators: 2,
    uncertaintySource
  });

  if (resolved.orderingScoringMode === "pidTimeWeighted") {
    const temporalSelfInclusion = computeTemporalSelfInclusion(pid.depthSeriesByLayerId);
    const scores = computePidOrderingScores({
      layerIds: dataset.layers.map((layer) => layer.id),
      D_cross: pid.depthSeriesByLayerId,
      temporalSelfInclusion,
      mode: "layer_pid_time_weighted",
      alpha: resolved.pidTimeAlpha
    });
    const top = scores[0];
    return {
      displayOrder: buildCenterOutOrder(scores.map((score) => score.layerId)),
      notes: [
        `TPID scoring: alpha=${Math.max(0, Math.min(1, resolved.pidTimeAlpha)).toFixed(2)}`,
        top ? `top PID-time layer: ${layerLabel(top.layerId)} score=${top.score.toFixed(3)}` : "top PID-time layer: N/A"
      ]
    };
  }

  const top = pid.scores[0];
  return {
    displayOrder: buildCenterOutOrder(pid.order),
    notes: [
      "one-way inclusion: interval center covered by peer uncertainty bands",
      top ? `top inclusion layer: ${layerLabel(top.id)} depth=${top.depth.toFixed(3)}` : "top inclusion layer: N/A"
    ]
  };
}

export function computeOptimizingBaseline(
  times: number[],
  orderedLayers: LayerInput[],
  mode: OptimizingBaselineMode,
  hooks: SineStreamHooks,
  waveStrength: number,
  energyThreshold = 0.08
): OptimizingBaselineResult {
  if (mode === "multiscale") {
    const result = computeMultiscaleDistributedBaseline(
      times,
      orderedLayers,
      Math.max(0, waveStrength),
      hooks,
      energyThreshold
    );
    return {
      baseline: result.baseline,
      multiscaleDiagnostics: result.diagnostics
    };
  }
  return {
    baseline: computeBaseline(times, orderedLayers, mode as BaselineMode, hooks),
    multiscaleDiagnostics: null
  };
}

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
  return "Multiscale";
}

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

function layerLabel(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}
