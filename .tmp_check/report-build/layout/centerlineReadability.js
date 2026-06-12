import { roiBounds } from "../interactions/roi.js";
export const CENTERLINE_READABILITY_DIRECTIONS = {
    sampleCount: "up",
    derivativeCount: "up",
    meanAbsSlope: "down",
    maxAbsSlope: "down",
    derivativeConcentration: "down",
    burstMassShare: "down",
    slopeCoverage: "up",
    curvature: "down",
    curvatureConcentration: "down",
    endpointDriftRatio: "down",
    amplitudeRatioP95: "down",
    corridorViolation: "down",
    layerMeanSlope: "down",
    layerMaxSlope: "down",
    layerCurvature: "down",
    readabilityScore: "down"
};
const DEFAULT_WEIGHTS = {
    layerMeanSlope: 0.25,
    layerMaxSlope: 0.25,
    layerCurvature: 0.35,
    centerlinePeak: 1.1,
    derivativeConcentration: 0.85,
    burstMassShare: 0.9,
    centerlineCurvature: 0.45,
    endpointDrift: 0.2,
    corridorViolation: 1.25,
    slopeCoverage: 0.45
};
export function streamTotal(layers, length) {
    const total = new Array(length).fill(0);
    for (const layer of layers) {
        for (let t = 0; t < length; t += 1) {
            total[t] += Math.max(0, layer.height[t] ?? 0);
        }
    }
    return total;
}
export function streamCenterlineFromBaseline(layers, baseline) {
    const total = streamTotal(layers, baseline.length);
    return baseline.map((value, index) => value + 0.5 * (total[index] ?? 0));
}
export function computeCenterlineReadability(layers, baseline, roi = null, options = {}) {
    const length = baseline.length;
    const [left, right] = roiBounds(length, roi);
    const sampleCount = right >= left ? right - left + 1 : 0;
    const centerline = streamCenterlineFromBaseline(layers, baseline);
    const total = streamTotal(layers, length);
    const derivatives = derivativeSamples(centerline, left, right);
    const absDerivatives = derivatives.map((value) => Math.abs(value));
    const curvatures = curvatureSamples(centerline, left, right).map((value) => Math.abs(value));
    const layerGeometry = layerGeometryMetrics(layers, baseline, left, right);
    const meanAbsSlope = mean(absDerivatives);
    const maxAbsSlope = max(absDerivatives);
    const meanCurvature = mean(curvatures);
    const maxCurvature = max(curvatures);
    const corridor = Math.max(0, options.corridorFraction ?? 0.18);
    const centered = centeredWindow(centerline, left, right);
    const amplitudeRatios = [];
    const corridorViolations = [];
    for (let i = 0; i < centered.length; i += 1) {
        const t = left + i;
        const scale = Math.max(1e-12, total[t] ?? 0);
        const ratio = Math.abs(centered[i]) / scale;
        amplitudeRatios.push(ratio);
        corridorViolations.push(Math.max(0, ratio - corridor));
    }
    const metricsWithoutScore = {
        sampleCount,
        derivativeCount: absDerivatives.length,
        meanAbsSlope,
        maxAbsSlope,
        derivativeConcentration: meanAbsSlope <= 1e-12 ? 0 : maxAbsSlope / meanAbsSlope,
        burstMassShare: topMassShare(absDerivatives, options.burstTopFraction ?? 0.05),
        slopeCoverage: slopeCoverage(absDerivatives, options.slopeActivityRatio ?? 0.05),
        curvature: meanCurvature,
        curvatureConcentration: meanCurvature <= 1e-12 ? 0 : maxCurvature / meanCurvature,
        endpointDriftRatio: endpointDriftRatio(centerline, total, left, right),
        amplitudeRatioP95: percentile(amplitudeRatios, 0.95),
        corridorViolation: mean(corridorViolations),
        layerMeanSlope: layerGeometry.meanSlope,
        layerMaxSlope: layerGeometry.maxSlope,
        layerCurvature: layerGeometry.curvature
    };
    const metrics = {
        ...metricsWithoutScore,
        readabilityScore: 0
    };
    metrics.readabilityScore = readabilityScore(metrics, options.reference ?? null, options.weights);
    return metrics;
}
export function compareCenterlineReadability(layers, beforeBaseline, afterBaseline, roi = null, options = {}) {
    const beforeRaw = computeCenterlineReadability(layers, beforeBaseline, roi, options);
    const before = {
        ...beforeRaw,
        readabilityScore: readabilityScore(beforeRaw, beforeRaw, options.weights)
    };
    const after = computeCenterlineReadability(layers, afterBaseline, roi, {
        ...options,
        reference: beforeRaw
    });
    const delta = {};
    const improvementPct = {};
    for (const rawKey of Object.keys(before)) {
        delta[rawKey] = after[rawKey] - before[rawKey];
        const direction = CENTERLINE_READABILITY_DIRECTIONS[rawKey];
        if (rawKey === "sampleCount" || rawKey === "derivativeCount") {
            improvementPct[rawKey] = null;
        }
        else {
            improvementPct[rawKey] = improvementPercent(before[rawKey], after[rawKey], direction);
        }
    }
    return { before, after, delta, improvementPct };
}
function readabilityScore(metrics, reference, weightsOverride) {
    const weights = { ...DEFAULT_WEIGHTS, ...(weightsOverride ?? {}) };
    if (!reference) {
        return (weights.layerMeanSlope * metrics.layerMeanSlope +
            weights.layerMaxSlope * metrics.layerMaxSlope +
            weights.layerCurvature * metrics.layerCurvature +
            weights.centerlinePeak * metrics.maxAbsSlope +
            weights.derivativeConcentration * metrics.derivativeConcentration +
            weights.burstMassShare * metrics.burstMassShare +
            weights.centerlineCurvature * metrics.curvature +
            weights.endpointDrift * metrics.endpointDriftRatio +
            weights.corridorViolation * metrics.corridorViolation -
            weights.slopeCoverage * metrics.slopeCoverage);
    }
    const coverageRatio = reference.slopeCoverage <= 1e-12
        ? metrics.slopeCoverage > 1e-12
            ? 0.5
            : 1
        : reference.slopeCoverage / Math.max(1e-12, metrics.slopeCoverage);
    return (weights.layerMeanSlope * ratio(metrics.layerMeanSlope, reference.layerMeanSlope) +
        weights.layerMaxSlope * ratio(metrics.layerMaxSlope, reference.layerMaxSlope) +
        weights.layerCurvature * ratio(metrics.layerCurvature, reference.layerCurvature) +
        weights.centerlinePeak * ratio(metrics.maxAbsSlope, reference.maxAbsSlope) +
        weights.derivativeConcentration * ratio(metrics.derivativeConcentration, reference.derivativeConcentration) +
        weights.burstMassShare * ratio(metrics.burstMassShare, reference.burstMassShare) +
        weights.centerlineCurvature * ratio(metrics.curvature, reference.curvature) +
        weights.endpointDrift * ratio(metrics.endpointDriftRatio, reference.endpointDriftRatio) +
        weights.corridorViolation * metrics.corridorViolation +
        weights.slopeCoverage * coverageRatio);
}
function derivativeSamples(values, left, right) {
    const out = [];
    for (let t = Math.max(left + 1, 1); t <= right; t += 1) {
        out.push(values[t] - values[t - 1]);
    }
    return out;
}
function curvatureSamples(values, left, right) {
    const out = [];
    for (let t = Math.max(left + 2, 2); t <= right; t += 1) {
        out.push(values[t] - 2 * values[t - 1] + values[t - 2]);
    }
    return out;
}
function layerGeometryMetrics(layers, baseline, left, right) {
    const prefix = new Array(baseline.length).fill(0);
    const slopes = [];
    const curvatures = [];
    let maxSlope = 0;
    for (const layer of layers) {
        const center = new Array(baseline.length).fill(0);
        for (let t = 0; t < baseline.length; t += 1) {
            center[t] = baseline[t] + prefix[t] + 0.5 * (layer.height[t] ?? 0);
        }
        for (let t = Math.max(left + 1, 1); t <= right; t += 1) {
            const slope = Math.abs(center[t] - center[t - 1]);
            slopes.push(slope);
            maxSlope = Math.max(maxSlope, slope);
        }
        for (let t = Math.max(left + 2, 2); t <= right; t += 1) {
            curvatures.push(Math.abs(center[t] - 2 * center[t - 1] + center[t - 2]));
        }
        for (let t = 0; t < baseline.length; t += 1) {
            prefix[t] += Math.max(0, layer.height[t] ?? 0);
        }
    }
    return {
        meanSlope: mean(slopes),
        maxSlope,
        curvature: mean(curvatures)
    };
}
function centeredWindow(values, left, right) {
    const window = values.slice(left, right + 1);
    const center = median(window);
    return window.map((value) => value - center);
}
function endpointDriftRatio(values, total, left, right) {
    if (right <= left || values.length === 0) {
        return 0;
    }
    const drift = Math.abs(values[right] - values[left]);
    const scale = mean(total.slice(left, right + 1));
    return drift / Math.max(1e-12, scale);
}
function slopeCoverage(absDerivatives, activityRatio) {
    const peak = max(absDerivatives);
    if (peak <= 1e-12 || absDerivatives.length === 0) {
        return 0;
    }
    const threshold = Math.max(1e-12, Math.max(0, activityRatio) * peak);
    return mean(absDerivatives.map((value) => Math.min(1, value / threshold)));
}
function topMassShare(values, topFraction) {
    const clean = values.filter((value) => Number.isFinite(value) && value > 0);
    const total = sum(clean);
    if (clean.length === 0 || total <= 1e-12) {
        return 0;
    }
    const count = Math.max(1, Math.ceil(clean.length * Math.max(0, Math.min(1, topFraction))));
    const top = clean.sort((a, b) => b - a).slice(0, count);
    return sum(top) / total;
}
function improvementPercent(before, after, direction) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return null;
    }
    if (Math.abs(before) <= 1e-12) {
        return Math.abs(after) <= 1e-12 ? 0 : null;
    }
    const signed = direction === "up" ? after - before : before - after;
    return (signed / Math.abs(before)) * 100;
}
function ratio(value, reference) {
    if (!Number.isFinite(value)) {
        return Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(reference) || Math.abs(reference) <= 1e-12) {
        return Math.max(0, value);
    }
    return value / Math.max(1e-12, Math.abs(reference));
}
function percentile(values, q) {
    const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (clean.length === 0) {
        return 0;
    }
    const pos = Math.max(0, Math.min(clean.length - 1, q * (clean.length - 1)));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) {
        return clean[lo];
    }
    const f = pos - lo;
    return clean[lo] * (1 - f) + clean[hi] * f;
}
function median(values) {
    return percentile(values, 0.5);
}
function mean(values) {
    const clean = values.filter((value) => Number.isFinite(value));
    if (clean.length === 0) {
        return 0;
    }
    return sum(clean) / clean.length;
}
function sum(values) {
    let out = 0;
    for (const value of values) {
        out += value;
    }
    return out;
}
function max(values) {
    let out = 0;
    for (const value of values) {
        if (Number.isFinite(value)) {
            out = Math.max(out, value);
        }
    }
    return out;
}
