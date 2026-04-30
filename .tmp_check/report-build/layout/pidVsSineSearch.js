import { computeBaseline, computeMultiscaleDistributedBaseline } from "../core/baseline.js";
import { normalizeOrderForComparison } from "../core/orderCompare.js";
import { optimizeLayerOrder } from "../core/optimizeOrder.js";
import { buildPidCenterOutOrder, computePidOrdering } from "../core/pidOrdering.js";
import { computeStackedBoundaries } from "../core/stack.js";
import { orderLayers } from "../core/validate.js";
import { computeMetrics } from "./metrics.js";
const CORE_KEYS = ["meanSlope", "wiggle", "illusion"];
export function runPidVsSineSearch(input) {
    const searchSpace = sanitizeSearchSpace(input.searchSpace);
    const strengths = discreteValues(searchSpace.baselineUncertaintyWeight);
    const thresholds = discreteValues(searchSpace.energyThreshold);
    const layerIds = input.dataset.layers.map((layer) => layer.id);
    const controlOrder = buildControlOrder(input.dataset, input.optimizationConfig, layerIds, input.shuffleSeed);
    const experimentOrder = buildExperimentOrder(input.dataset, layerIds);
    const controlLayers = orderLayers(input.dataset.layers, controlOrder);
    const experimentLayers = orderLayers(input.dataset.layers, experimentOrder);
    const controlHooks = {
        ...(input.controlBaselineHooks ?? {}),
        centerType: input.controlCenterType ?? "median"
    };
    const controlBaseline = computeBaseline(input.dataset.times, controlLayers, "sineStream", controlHooks);
    const controlLayout = computeStackedBoundaries(controlBaseline, controlLayers);
    const invariant = {
        checked: false,
        violations: [],
        maxThicknessError: 0
    };
    const candidates = [];
    for (const centerType of searchSpace.centerTypes) {
        const experimentHooks = {
            ...(input.experimentBaselineHooks ?? {}),
            centerType
        };
        for (const baselineUncertaintyWeight of strengths) {
            for (const energyThreshold of thresholds) {
                const params = {
                    baselineCenterType: centerType,
                    baselineUncertaintyWeight,
                    energyThreshold
                };
                const multiscale = computeMultiscaleDistributedBaseline(input.dataset.times, experimentLayers, baselineUncertaintyWeight, experimentHooks, energyThreshold);
                const experimentLayout = stackToBraidLayout(computeStackedBoundaries(multiscale.baseline, experimentLayers));
                const metrics = computeMetrics(input.dataset, controlLayout, experimentLayout, input.roi, invariant, experimentLayers, {
                    includeGlobalRows: true
                });
                const roi = scopeSummaryFromRows(metrics.rows);
                const global = scopeSummaryFromRows(metrics.globalRows ?? metrics.rows);
                const reasons = evaluateCandidate(roi, global, searchSpace.regressionGuardrailPct, multiscale.diagnostics.fallbackUsed, multiscale.diagnostics.fallbackReason);
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
    candidates.sort(compareCandidates);
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
function buildControlOrder(dataset, optimization, layerIds, shuffleSeed) {
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
    return normalizeOrderForComparison(optimized.order, layerIds, dataset.order);
}
function buildExperimentOrder(dataset, layerIds) {
    const pid = computePidOrdering(dataset.layers, {
        excludeSelf: true,
        widthPenaltyPower: 1,
        minComparators: 2
    });
    const depthOrder = normalizeOrderForComparison(pid.order, layerIds, dataset.order);
    const centerOut = buildPidCenterOutOrder(depthOrder);
    return normalizeOrderForComparison(centerOut, layerIds, dataset.order);
}
function sanitizeSearchSpace(space) {
    const centerTypes = Array.from(new Set(space.centerTypes)).filter((v) => v === "median" || v === "mean" || v === "geometric" || v === "harmonic");
    return {
        baselineUncertaintyWeight: sanitizeRange(space.baselineUncertaintyWeight, { min: 0.15, max: 1.2, step: 0.05 }),
        energyThreshold: sanitizeRange(space.energyThreshold, { min: 0.04, max: 0.2, step: 0.02 }, 0, 1),
        centerTypes: centerTypes.length > 0 ? centerTypes : ["median"],
        regressionGuardrailPct: Math.max(0, finiteNumber(space.regressionGuardrailPct, 3)),
        topN: Math.max(1, Math.round(finiteNumber(space.topN, 20)))
    };
}
function sanitizeRange(range, fallback, hardMin = Number.NEGATIVE_INFINITY, hardMax = Number.POSITIVE_INFINITY) {
    const minRaw = finiteNumber(range.min, fallback.min);
    const maxRaw = finiteNumber(range.max, fallback.max);
    const stepRaw = finiteNumber(range.step, fallback.step);
    const min = clamp(Math.min(minRaw, maxRaw), hardMin, hardMax);
    const max = clamp(Math.max(minRaw, maxRaw), hardMin, hardMax);
    const step = Math.max(1e-6, Math.abs(stepRaw));
    return { min, max, step };
}
function discreteValues(range) {
    const values = [];
    const maxLoops = 5000;
    let loops = 0;
    for (let value = range.min; value <= range.max + range.step * 1e-6 && loops < maxLoops; value += range.step) {
        values.push(round(value, 6));
        loops += 1;
    }
    const dedup = Array.from(new Set(values.map((value) => round(value, 6))));
    dedup.sort((a, b) => a - b);
    return dedup.length > 0 ? dedup : [round(range.min, 6)];
}
function scopeSummaryFromRows(rows) {
    const metrics = CORE_KEYS.map((key) => {
        const row = rows.find((item) => item.key === key);
        const before = row?.before ?? 0;
        const after = row?.after ?? 0;
        const delta = after - before;
        const improvementPct = relativeImprovementDown(before, after);
        return {
            key,
            label: row?.label ?? key,
            before,
            after,
            delta,
            improvementPct
        };
    });
    const improvements = metrics.map((metric) => metric.improvementPct);
    return {
        metrics,
        maxImprovementPct: Math.max(...improvements),
        avgImprovementPct: improvements.reduce((sum, value) => sum + value, 0) / Math.max(1, improvements.length)
    };
}
function evaluateCandidate(roi, global, regressionGuardrailPct, fallbackUsed, fallbackReason) {
    const reasons = [];
    if (fallbackUsed) {
        reasons.push(`fallback used${fallbackReason ? `: ${fallbackReason}` : ""}`);
        return reasons;
    }
    if (roi.maxImprovementPct <= 0) {
        reasons.push(`ROI has no positive readability gain (max=${roi.maxImprovementPct.toFixed(2)}%)`);
    }
    const roiRegression = roi.metrics.filter((metric) => metric.improvementPct < -regressionGuardrailPct);
    for (const metric of roiRegression) {
        reasons.push(`ROI ${metric.key} regressed ${(-metric.improvementPct).toFixed(2)}% > ${regressionGuardrailPct.toFixed(2)}%`);
    }
    const globalRegression = global.metrics.filter((metric) => metric.improvementPct < -regressionGuardrailPct);
    for (const metric of globalRegression) {
        reasons.push(`Global ${metric.key} regressed ${(-metric.improvementPct).toFixed(2)}% > ${regressionGuardrailPct.toFixed(2)}%`);
    }
    return reasons;
}
function passReasons(roi, global) {
    return [
        `ROI max improvement ${roi.maxImprovementPct.toFixed(2)}%`,
        `ROI avg improvement ${roi.avgImprovementPct.toFixed(2)}%`,
        `Global avg improvement ${global.avgImprovementPct.toFixed(2)}%`
    ];
}
function compareCandidates(a, b) {
    if (a.pass !== b.pass) {
        return a.pass ? -1 : 1;
    }
    if (a.roi.maxImprovementPct !== b.roi.maxImprovementPct) {
        return b.roi.maxImprovementPct - a.roi.maxImprovementPct;
    }
    if (a.roi.avgImprovementPct !== b.roi.avgImprovementPct) {
        return b.roi.avgImprovementPct - a.roi.avgImprovementPct;
    }
    if (a.global.avgImprovementPct !== b.global.avgImprovementPct) {
        return b.global.avgImprovementPct - a.global.avgImprovementPct;
    }
    return a.sortKey.localeCompare(b.sortKey);
}
function sortKeyFromParams(params) {
    return [
        params.baselineCenterType,
        params.baselineUncertaintyWeight.toFixed(6),
        params.energyThreshold.toFixed(6)
    ].join("|");
}
function relativeImprovementDown(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return 0;
    }
    const denominator = Math.max(1e-9, Math.abs(before));
    return ((before - after) / denominator) * 100;
}
function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function round(value, digits) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}
function stackToBraidLayout(layout) {
    const tLength = layout.baseline.length;
    const gapCount = Math.max(0, layout.yBottom.length - 1);
    return {
        baseline: layout.baseline.slice(),
        yBottom: layout.yBottom.map((row) => row.slice()),
        yTop: layout.yTop.map((row) => row.slice()),
        omega: new Array(tLength).fill(0),
        gapsPx: Array.from({ length: gapCount }, () => new Array(tLength).fill(0)),
        gapsValue: Array.from({ length: gapCount }, () => new Array(tLength).fill(0)),
        sumGapPx: new Array(tLength).fill(0),
        roiSupport: null
    };
}
