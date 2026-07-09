import {
  computeContourPid,
  computePidOrdering,
  computePidOrderingScores,
  computeTemporalSelfInclusion
} from "../core/ordering/pid";
import type { PreparedDataset } from "../core/types";
import { resolveOptimizingVariantConfig, type OptimizingVariantConfig } from "../optimizingConfig";
import { buildCenterOutOrder, buildInsideOutOrder, buildTwoOptOrder, normalizedInputOrder } from "../core/ordering/display";
import { optimizeLayerOrder } from "../core/ordering/sineStream";

export interface OptimizingOrderResult {
  displayOrder: string[];
  notes: string[];
}

export function computeOptimizingOrder(dataset: PreparedDataset, config: OptimizingVariantConfig): OptimizingOrderResult {
  const resolved = resolveOptimizingVariantConfig(config);

  if (resolved.orderingScoringMode === "input") {
    return {
      displayOrder: normalizedInputOrder(dataset),
      notes: ["ordering: original dataset order"]
    };
  }

  if (resolved.orderingScoringMode === "insideOut") {
    return {
      displayOrder: buildInsideOutOrder(dataset.layers, normalizedInputOrder(dataset)),
      notes: ["ordering: inside-out layer ordering with late-onset layers near the center"]
    };
  }

  if (resolved.orderingScoringMode === "twoOpt") {
    return {
      displayOrder: buildTwoOptOrder(dataset.layers, normalizedInputOrder(dataset)),
      notes: ["ordering: 2-opt adjacent counter-motion ordering"]
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
        "ordering: hierarchical clustering + optimal leaf ordering",
        `hierarchy order objective: ${optimized.diagnostics.objectiveBefore.toFixed(3)} -> ${optimized.diagnostics.objectiveAfter.toFixed(3)}`
      ]
    };
  }

  if (resolved.orderingScoringMode === "pidMean") {
    const contourPid = computeContourPid(dataset.layers, {
      yBins: 180,
      valueTransform: resolved.pidUncertaintySource === "poportion" ? "linear" : "log1p",
      centralFraction: 0.5,
      contourThreshold: 0.5,
      uncertaintySource: resolved.pidUncertaintySource
    });
    const top = contourPid.scores[0];
    return {
      displayOrder: buildCenterOutOrder(contourPid.depthOrder),
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
    uncertaintySource: resolved.pidUncertaintySource
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
        `TPID scoring: alpha=${clampUnit(resolved.pidTimeAlpha).toFixed(2)}`,
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

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function layerLabel(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}
