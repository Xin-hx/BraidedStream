import { computeBaseline, computeMultiscaleDistributedBaseline, type SineStreamHooks } from "../core/baseline";
/**
 * Search experiment comparing PID-new ordering against SineStream control ordering.
 */
import { buildCenterOutOrder, normalizeOrderForComparison, optimizeLayerOrder } from "../core/ordering";
import { computePidOrdering } from "../core/ranking";
import { computeStackedBoundaries } from "../core/stack";
import type {
  LayerInput,
  LayoutOptimizationConfig,
  PreparedDataset,
  ROI
} from "../core/types";
import { orderLayers } from "../core/validate";
import { computeMetrics } from "./metrics";
import {
  compareSearchCandidates,
  discreteValues as discreteSearchValues,
  emptyInvariantSummary,
  finiteNumber,
  passReasons,
  regressionReasons,
  sanitizeCenterTypes,
  sanitizeRange as sanitizeSearchRange,
  scopeSummaryFromMetricRows,
  sortKeyFromParams,
  stackToBraidLayout,
  type CoreMetricDelta,
  type CoreMetricKey,
  type ScopeSummary,
  type SearchCenterType as CenterType,
  type SearchRange
} from "./searchUtils";

export interface PidVsSineSearchRange extends SearchRange {}

export interface PidVsSineSearchSpace {
  baselineUncertaintyWeight: PidVsSineSearchRange;
  energyThreshold: PidVsSineSearchRange;
  centerTypes: CenterType[];
  regressionGuardrailPct: number;
  topN: number;
}

export interface PidVsSineCandidateParams {
  baselineUncertaintyWeight: number;
  energyThreshold: number;
  baselineCenterType: CenterType;
}

export interface PidVsSineCoreMetricDelta extends CoreMetricDelta {}

export interface PidVsSineScopeSummary extends ScopeSummary {}

export interface PidVsSineCandidateResult {
  params: PidVsSineCandidateParams;
  pass: boolean;
  reasons: string[];
  roi: PidVsSineScopeSummary;
  global: PidVsSineScopeSummary;
  diagnostics: {
    fallbackUsed: boolean;
    fallbackReason: string | null;
    verified: boolean;
    effectiveScaleCount: number;
    threshold: number;
  };
  sortKey: string;
}

export interface PidVsSineSearchSummary {
  totalCandidates: number;
  passCount: number;
  failCount: number;
}

export interface PidVsSineSearchResult {
  summary: PidVsSineSearchSummary;
  best: PidVsSineCandidateResult | null;
  candidates: PidVsSineCandidateResult[];
  topCandidates: PidVsSineCandidateResult[];
  controlOrder: string[];
  experimentOrder: string[];
}

export interface PidVsSineSearchInput {
  dataset: PreparedDataset;
  roi: ROI | null;
  searchSpace: PidVsSineSearchSpace;
  optimizationConfig: LayoutOptimizationConfig;
  shuffleSeed?: number;
  controlBaselineHooks?: Omit<SineStreamHooks, "centerType">;
  experimentBaselineHooks?: Omit<SineStreamHooks, "centerType">;
  controlCenterType?: CenterType;
}

export function runPidVsSineSearch(input: PidVsSineSearchInput): PidVsSineSearchResult {
  const searchSpace = sanitizeSearchSpace(input.searchSpace);
  const strengths = discreteSearchValues(searchSpace.baselineUncertaintyWeight);
  const thresholds = discreteSearchValues(searchSpace.energyThreshold);
  const layerIds = input.dataset.layers.map((layer) => layer.id);

  const controlOrder = buildControlOrder(input.dataset, input.optimizationConfig, layerIds, input.shuffleSeed);
  const experimentOrder = buildExperimentOrder(input.dataset, layerIds);
  const controlLayers = orderLayers(input.dataset.layers, controlOrder);
  const experimentLayers = orderLayers(input.dataset.layers, experimentOrder);

  const controlHooks: SineStreamHooks = {
    ...(input.controlBaselineHooks ?? {}),
    centerType: input.controlCenterType ?? "median"
  };
  const controlBaseline = computeBaseline(input.dataset.times, controlLayers, "sineStream", controlHooks);
  const controlLayout = computeStackedBoundaries(controlBaseline, controlLayers);

  const invariant = emptyInvariantSummary();

  const candidates: PidVsSineCandidateResult[] = [];

  for (const centerType of searchSpace.centerTypes) {
    const experimentHooks: SineStreamHooks = {
      ...(input.experimentBaselineHooks ?? {}),
      centerType
    };

    for (const baselineUncertaintyWeight of strengths) {
      for (const energyThreshold of thresholds) {
        const params: PidVsSineCandidateParams = {
          baselineCenterType: centerType,
          baselineUncertaintyWeight,
          energyThreshold
        };

        const multiscale = computeMultiscaleDistributedBaseline(
          input.dataset.times,
          experimentLayers,
          baselineUncertaintyWeight,
          experimentHooks,
          energyThreshold
        );
        const experimentLayout = stackToBraidLayout(computeStackedBoundaries(multiscale.baseline, experimentLayers));

        const metrics = computeMetrics(input.dataset, controlLayout, experimentLayout, input.roi, invariant, experimentLayers, {
          includeGlobalRows: true
        });
        const roi = scopeSummaryFromMetricRows(metrics.rows);
        const global = scopeSummaryFromMetricRows(metrics.globalRows ?? metrics.rows);

        const reasons = evaluateCandidate(
          roi,
          global,
          searchSpace.regressionGuardrailPct,
          multiscale.diagnostics.fallbackUsed,
          multiscale.diagnostics.fallbackReason
        );

        candidates.push({
          params,
          pass: reasons.length === 0,
          reasons: reasons.length === 0 ? passReasons(roi, global) : reasons,
          roi,
          global,
          diagnostics: {
            fallbackUsed: multiscale.diagnostics.fallbackUsed,
            fallbackReason: multiscale.diagnostics.fallbackReason,
            verified: multiscale.diagnostics.verifiedMultiscale,
            effectiveScaleCount: multiscale.diagnostics.effectiveScaleCount,
            threshold: multiscale.diagnostics.energyThreshold
          },
          sortKey: sortKeyFromParams(params)
        });
      }
    }
  }

  candidates.sort(compareSearchCandidates);
  const topN = Math.max(1, Math.round(searchSpace.topN));

  return {
    summary: {
      totalCandidates: candidates.length,
      passCount: candidates.filter((candidate) => candidate.pass).length,
      failCount: candidates.filter((candidate) => !candidate.pass).length
    },
    best: candidates[0] ?? null,
    candidates,
    topCandidates: candidates.slice(0, topN),
    controlOrder,
    experimentOrder
  };
}

function buildControlOrder(
  dataset: PreparedDataset,
  optimization: LayoutOptimizationConfig,
  layerIds: string[],
  shuffleSeed?: number
): string[] {
  const optimized = optimizeLayerOrder(
    dataset.layers,
    null,
    {
      clusterAutoCutScale: optimization.clusterAutoCutScale,
      clusterBoundaryPenalty: optimization.clusterBoundaryPenalty,
      similaritySigma: optimization.orderSimilaritySigma,
      maxSwapPasses: optimization.orderMaxSwapPasses,
      weightType: optimization.orderWeightType ?? "max",
      useThicknessWeight: optimization.orderUseThicknessWeight !== false,
      useLengthWeight: optimization.orderUseLengthWeight !== false,
      lengthWeightThreshold: optimization.orderLengthWeightThreshold ?? 9,
      shuffleSeed: Number.isFinite(shuffleSeed) ? shuffleSeed : optimization.shuffleSeed,
      useUncertaintyTerm: false,
      uncertaintyWeight: 0
    },
    dataset.order
  );
  return normalizeOrderForComparison(optimized.order, layerIds, dataset.order);
}

function buildExperimentOrder(dataset: PreparedDataset, layerIds: string[]): string[] {
  const pid = computePidOrdering(dataset.layers, {
    excludeSelf: true,
    widthPenaltyPower: 1,
    minComparators: 2
  });
  const depthOrder = normalizeOrderForComparison(pid.order, layerIds, dataset.order);
  const centerOut = buildCenterOutOrder(depthOrder);
  return normalizeOrderForComparison(centerOut, layerIds, dataset.order);
}

function sanitizeSearchSpace(space: PidVsSineSearchSpace): PidVsSineSearchSpace {
  return {
    baselineUncertaintyWeight: sanitizeSearchRange(space.baselineUncertaintyWeight, { min: 0.15, max: 1.2, step: 0.05 }),
    energyThreshold: sanitizeSearchRange(space.energyThreshold, { min: 0.04, max: 0.2, step: 0.02 }, 0, 1),
    centerTypes: sanitizeCenterTypes(space.centerTypes),
    regressionGuardrailPct: Math.max(0, finiteNumber(space.regressionGuardrailPct, 3)),
    topN: Math.max(1, Math.round(finiteNumber(space.topN, 20)))
  };
}

function evaluateCandidate(
  roi: PidVsSineScopeSummary,
  global: PidVsSineScopeSummary,
  regressionGuardrailPct: number,
  fallbackUsed: boolean,
  fallbackReason: string | null
): string[] {
  const reasons: string[] = [];

  if (fallbackUsed) {
    reasons.push(`fallback used${fallbackReason ? `: ${fallbackReason}` : ""}`);
    return reasons;
  }

  if (roi.maxImprovementPct <= 0) {
    reasons.push(`ROI has no positive readability gain (max=${roi.maxImprovementPct.toFixed(2)}%)`);
  }

  reasons.push(...regressionReasons("ROI", roi, regressionGuardrailPct));
  reasons.push(...regressionReasons("Global", global, regressionGuardrailPct));

  return reasons;
}
