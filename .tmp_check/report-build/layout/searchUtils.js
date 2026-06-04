import { clamp, round } from "../core/utils";
export const CORE_METRIC_KEYS = ["meanSlope", "wiggle", "illusion"];
/** Normalize user-provided center type sets. */
export function sanitizeCenterTypes(values) {
    const centerTypes = Array.from(new Set(values)).filter((value) => value === "median" || value === "mean" || value === "geometric" || value === "harmonic");
    return centerTypes.length > 0 ? centerTypes : ["median"];
}
/** Sanitize numeric search range bounds and step size. */
export function sanitizeRange(range, fallback, hardMin = Number.NEGATIVE_INFINITY, hardMax = Number.POSITIVE_INFINITY) {
    const minRaw = finiteNumber(range.min, fallback.min);
    const maxRaw = finiteNumber(range.max, fallback.max);
    const stepRaw = finiteNumber(range.step, fallback.step);
    const min = clamp(Math.min(minRaw, maxRaw), hardMin, hardMax);
    const max = clamp(Math.max(minRaw, maxRaw), hardMin, hardMax);
    const step = Math.max(1e-6, Math.abs(stepRaw));
    return { min, max, step };
}
/** Expand a sanitized range into deterministic rounded values. */
export function discreteValues(range) {
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
/** Summarize the core readability metrics used by search ranking. */
export function scopeSummaryFromMetricRows(rows) {
    const metrics = CORE_METRIC_KEYS.map((key) => {
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
/** Reasons for metric regressions beyond the accepted guardrail. */
export function regressionReasons(scopeName, scope, regressionGuardrailPct) {
    return scope.metrics
        .filter((metric) => metric.improvementPct < -regressionGuardrailPct)
        .map((metric) => `${scopeName} ${metric.key} regressed ${(-metric.improvementPct).toFixed(2)}% > ${regressionGuardrailPct.toFixed(2)}%`);
}
/** Standard success summary for passing search candidates. */
export function passReasons(roi, global) {
    return [
        `ROI max improvement ${roi.maxImprovementPct.toFixed(2)}%`,
        `ROI avg improvement ${roi.avgImprovementPct.toFixed(2)}%`,
        `Global avg improvement ${global.avgImprovementPct.toFixed(2)}%`
    ];
}
/** Common candidate ordering: pass first, then ROI/global quality. */
export function compareSearchCandidates(a, b) {
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
/** Stable sort key for parameter combinations. */
export function sortKeyFromParams(params) {
    return [
        params.baselineCenterType,
        params.baselineUncertaintyWeight.toFixed(6),
        params.energyThreshold.toFixed(6)
    ].join("|");
}
/** Empty invariant placeholder for search-only layouts. */
export function emptyInvariantSummary() {
    return {
        checked: false,
        violations: [],
        maxThicknessError: 0
    };
}
/** Wrap a plain stack layout in the BraidLayout shape expected by metrics. */
export function stackToBraidLayout(layout) {
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
export function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}
function relativeImprovementDown(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return 0;
    }
    const denominator = Math.max(1e-9, Math.abs(before));
    return ((before - after) / denominator) * 100;
}
