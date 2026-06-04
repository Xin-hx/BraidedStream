import { computeBaseline, computeMultiscaleDistributedBaseline } from "../core/baseline";
/**
 * Grid search for multiscale baseline parameters under a fixed layer order.
 */
import { optimizeLayerOrder } from "../core/ordering";
import { computeStackedBoundaries } from "../core/stack";
import { computeMetrics } from "./metrics";
import { compareSearchCandidates, discreteValues as discreteSearchValues, emptyInvariantSummary, finiteNumber, passReasons, regressionReasons, sanitizeCenterTypes, sanitizeRange as sanitizeSearchRange, scopeSummaryFromMetricRows, sortKeyFromParams, stackToBraidLayout } from "./searchUtils";
export function buildFixedOrder(dataset, optimization, shuffleSeed) {
    const optimized = optimizeLayerOrder(dataset.layers, null, {
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
    }, dataset.order);
    return optimized.order.slice();
}
export function runMultiscaleSearch(input) {
    const searchSpace = sanitizeSearchSpace(input.searchSpace);
    const strengths = discreteSearchValues(searchSpace.baselineUncertaintyWeight);
    const thresholds = discreteSearchValues(searchSpace.energyThreshold);
    const candidates = [];
    const invariant = emptyInvariantSummary();
    for (const centerType of searchSpace.centerTypes) {
        const hooks = {
            ...(input.baseHooks ?? {}),
            centerType
        };
        const beforeBaseline = computeBaseline(input.dataset.times, input.orderedLayers, "sineStream", hooks);
        const beforeLayout = computeStackedBoundaries(beforeBaseline, input.orderedLayers);
        for (const baselineUncertaintyWeight of strengths) {
            for (const energyThreshold of thresholds) {
                const params = {
                    baselineCenterType: centerType,
                    baselineUncertaintyWeight,
                    energyThreshold
                };
                const multiscale = computeMultiscaleDistributedBaseline(input.dataset.times, input.orderedLayers, baselineUncertaintyWeight, hooks, energyThreshold);
                const afterLayout = stackToBraidLayout(computeStackedBoundaries(multiscale.baseline, input.orderedLayers));
                const metrics = computeMetrics(input.dataset, beforeLayout, afterLayout, input.roi, invariant, input.orderedLayers, {
                    includeGlobalRows: true
                });
                const roi = scopeSummaryFromMetricRows(metrics.rows);
                const global = scopeSummaryFromMetricRows(metrics.globalRows ?? metrics.rows);
                const reasons = evaluateCandidate(roi, global, searchSpace.passThresholdPct, searchSpace.regressionGuardrailPct, multiscale.diagnostics.fallbackUsed, multiscale.diagnostics.fallbackReason);
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
    const summary = {
        totalCandidates: candidates.length,
        passCount: candidates.filter((item) => item.pass).length,
        failCount: candidates.filter((item) => !item.pass).length
    };
    return {
        searchSpace,
        summary,
        best: candidates[0] ?? null,
        candidates,
        topCandidates: candidates.slice(0, topN)
    };
}
function sanitizeSearchSpace(space) {
    return {
        baselineUncertaintyWeight: sanitizeSearchRange(space.baselineUncertaintyWeight, { min: 0.15, max: 1.2, step: 0.05 }),
        energyThreshold: sanitizeSearchRange(space.energyThreshold, { min: 0.04, max: 0.2, step: 0.02 }, 0, 1),
        centerTypes: sanitizeCenterTypes(space.centerTypes),
        passThresholdPct: finiteNumber(space.passThresholdPct, 5),
        regressionGuardrailPct: Math.max(0, finiteNumber(space.regressionGuardrailPct, 3)),
        topN: Math.max(1, Math.round(finiteNumber(space.topN, 20)))
    };
}
function evaluateCandidate(roi, global, passThresholdPct, regressionGuardrailPct, fallbackUsed, fallbackReason) {
    const reasons = [];
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
