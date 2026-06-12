import { computeBaseline } from "../core/baseline/compute";
import { computeMultiscaleDistributedBaseline } from "../core/baseline/multiscale";
import type { BaselineParameters } from "../core/baseline/types";
/**
 * Grid search for multiscale baseline parameters under a fixed layer order.
 */
import { optimizeLayerOrder } from "../core/ordering/sineStream";
import { computeStackedBoundaries, stackToBraidLayout } from "../core/stack";
import { emptyInvariantSummary } from "../core/validate";
import type {
  LayerInput,
  LayoutOptimizationConfig,
  PreparedDataset,
  ROI
} from "../core/types";
import { computeMetrics } from "./metrics";
import {
  discreteValues as discreteSearchValues,
  finiteNumber,
  passReasons,
  regressionReasons,
  runParameterGridSearch,
  sanitizeCenterTypes,
  sanitizeRange as sanitizeSearchRange,
  scopeSummaryFromMetricRows,
  sortKeyFromParams,
  type SearchCandidateDiagnostics,
  type SearchCandidateParams,
  type SearchSummary,
  type ScopeSummary,
  type SearchCenterType as CenterType,
  type SearchRange
} from "./searchUtils";

export interface MultiscaleSearchSpace {
  baselineUncertaintyWeight: SearchRange;
  energyThreshold: SearchRange;
  centerTypes: CenterType[];
  passThresholdPct: number;
  regressionGuardrailPct: number;
  topN: number;
}

export interface MultiscaleCandidateResult {
  params: SearchCandidateParams;
  pass: boolean;
  reasons: string[];
  roi: ScopeSummary;
  global: ScopeSummary;
  diagnostics: SearchCandidateDiagnostics;
  sortKey: string;
}

export interface MultiscaleSearchResult {
  searchSpace: MultiscaleSearchSpace;
  summary: SearchSummary;
  best: MultiscaleCandidateResult | null;
  candidates: MultiscaleCandidateResult[];
  topCandidates: MultiscaleCandidateResult[];
}

export interface MultiscaleSearchInput {
  dataset: PreparedDataset;
  roi: ROI | null;
  orderedLayers: LayerInput[];
  searchSpace: MultiscaleSearchSpace;
  baseHooks?: Omit<BaselineParameters, "centerType">;
}

export function buildFixedOrder(
  dataset: PreparedDataset,
  optimization: LayoutOptimizationConfig,
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
  return optimized.order.slice();
}

export function runMultiscaleSearch(input: MultiscaleSearchInput): MultiscaleSearchResult {
  const searchSpace = sanitizeSearchSpace(input.searchSpace);
  const strengths = discreteSearchValues(searchSpace.baselineUncertaintyWeight);
  const thresholds = discreteSearchValues(searchSpace.energyThreshold);

  const invariant = emptyInvariantSummary();
  const result = runParameterGridSearch<MultiscaleCandidateResult>({
    centerTypes: searchSpace.centerTypes,
    baselineUncertaintyWeights: strengths,
    energyThresholds: thresholds,
    topN: searchSpace.topN,
    buildCandidate: (params) => {
      const centerType = params.baselineCenterType;
      const hooks: BaselineParameters = {
        ...(input.baseHooks ?? {}),
        centerType
      };
      const beforeBaseline = computeBaseline(input.dataset.times, input.orderedLayers, "sineStream", hooks);
      const beforeLayout = computeStackedBoundaries(beforeBaseline, input.orderedLayers);
      const multiscale = computeMultiscaleDistributedBaseline(
        input.dataset.times,
        input.orderedLayers,
        params.baselineUncertaintyWeight,
        hooks,
        params.energyThreshold
      );
      const afterLayout = stackToBraidLayout(computeStackedBoundaries(multiscale.baseline, input.orderedLayers));
      const metrics = computeMetrics(input.dataset, beforeLayout, afterLayout, input.roi, invariant, input.orderedLayers, {
        includeGlobalRows: true
      });
      const roi = scopeSummaryFromMetricRows(metrics.rows);
      const global = scopeSummaryFromMetricRows(metrics.globalRows ?? metrics.rows);
      const reasons = evaluateCandidate(
        roi,
        global,
        searchSpace.passThresholdPct,
        searchSpace.regressionGuardrailPct,
        multiscale.diagnostics.fallbackUsed,
        multiscale.diagnostics.fallbackReason
      );

      return {
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
      };
    }
  });

  return {
    searchSpace,
    ...result
  };
}

function sanitizeSearchSpace(space: MultiscaleSearchSpace): MultiscaleSearchSpace {
  return {
    baselineUncertaintyWeight: sanitizeSearchRange(space.baselineUncertaintyWeight, { min: 0.15, max: 1.2, step: 0.05 }),
    energyThreshold: sanitizeSearchRange(space.energyThreshold, { min: 0.04, max: 0.2, step: 0.02 }, 0, 1),
    centerTypes: sanitizeCenterTypes(space.centerTypes),
    passThresholdPct: finiteNumber(space.passThresholdPct, 5),
    regressionGuardrailPct: Math.max(0, finiteNumber(space.regressionGuardrailPct, 3)),
    topN: Math.max(1, Math.round(finiteNumber(space.topN, 20)))
  };
}

function evaluateCandidate(
  roi: ScopeSummary,
  global: ScopeSummary,
  passThresholdPct: number,
  regressionGuardrailPct: number,
  fallbackUsed: boolean,
  fallbackReason: string | null
): string[] {
  const reasons: string[] = [];

  if (fallbackUsed) {
    reasons.push(`fallback used${fallbackReason ? `: ${fallbackReason}` : ""}`);
    return reasons;
  }

  if (roi.maxImprovementPct < passThresholdPct) {
    reasons.push(`ROI max improvement ${roi.maxImprovementPct.toFixed(2)}% < ${passThresholdPct.toFixed(2)}%`);
  }

  reasons.push(...regressionReasons("ROI", roi, regressionGuardrailPct));
  reasons.push(...regressionReasons("Global", global, regressionGuardrailPct));

  return reasons;
}
