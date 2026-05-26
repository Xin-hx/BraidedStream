import { clamp, normalize01, sumAbs } from "../math.js";
import { diffSeries, maxAbsStep, meanAbsStep, meanCurvature, movingAverage, removeMean } from "../series.js";
import { validateTimeLengths } from "../validate.js";
import { computeSineStreamBaseline } from "./sineStream.js";
import { sumLayerMeans } from "./shared.js";
/** Redistribute SineStream centerline derivative bursts through layer-slope multiscale wave bases. */
export function computeMultiscaleDistributedBaseline(times, layers, strength = 0.45, hooks = {}, energyThreshold = 0.08) {
    validateTimeLengths(times, layers);
    const tLength = times.length;
    const kLength = layers.length;
    const total = sumLayerMeans(tLength, layers);
    const clippedThreshold = clamp(energyThreshold, 0, 1);
    const clippedStrength = clamp(strength, 0, 1.5);
    const emptyDiagnostics = () => ({
        method: "haar-dyadic",
        fallbackUsed: true,
        fallbackReason: "degenerate input",
        energyThreshold: clippedThreshold,
        effectiveScaleCount: 0,
        selectedScaleCount: 0,
        selectedScales: [],
        verifiedMultiscale: false,
        localShiftBudget: 0,
        distributedShiftBudget: 0,
        objectiveBefore: 0,
        objectiveAfter: 0,
        meanSlopeBefore: 0,
        meanSlopeAfter: 0,
        maxSlopeBefore: 0,
        maxSlopeAfter: 0,
        curvatureBefore: 0,
        curvatureAfter: 0,
        burstBefore: 0,
        burstAfter: 0,
        derivativeConcentrationBefore: 0,
        derivativeConcentrationAfter: 0,
        centerlineSlopeCoverageBefore: 0,
        centerlineSlopeCoverageAfter: 0,
        globalMeanSlopeGuardrailPassed: false,
        scaleCoefficients: [],
        scaleBands: [],
        uncertaintySaliency: new Array(tLength).fill(0),
        localShiftAbs: new Array(tLength).fill(0),
        distributedShiftAbs: new Array(tLength).fill(0)
    });
    if (kLength === 0 || tLength === 0) {
        return {
            baseline: new Array(tLength).fill(0),
            diagnostics: emptyDiagnostics()
        };
    }
    const anchorBaselineRaw = computeSineStreamBaseline(tLength, layers, { centerType: hooks.centerType ?? "median" });
    const anchorBaseline = recenterBaseline(anchorBaselineRaw, total);
    const anchorCenterline = streamCenterlineFromBaseline(anchorBaseline, total);
    const anchorCenterlineDerivative = diffSeries(anchorCenterline);
    const localShiftAbs = anchorCenterlineDerivative.map((value) => Math.abs(value));
    const slopeSignal = aggregateMultiscaleLayerSlopeSignal(layers, tLength);
    const bands = haarDyadicBands(slopeSignal).map((band) => ({
        ...band,
        saliency: blendScaleSaliencyWithLevel(band.saliency, slopeSignal)
    }));
    if (bands.length === 0) {
        return {
            baseline: anchorBaseline,
            diagnostics: {
                ...emptyDiagnostics(),
                fallbackReason: "layer-slope multiscale signal unavailable",
                localShiftBudget: 0,
                distributedShiftBudget: 0,
                localShiftAbs: localShiftAbs.slice(),
                distributedShiftAbs: new Array(tLength).fill(0),
                globalMeanSlopeGuardrailPassed: true
            }
        };
    }
    let totalEnergy = 0;
    for (const band of bands) {
        totalEnergy += band.energy;
    }
    if (totalEnergy <= 1e-12) {
        return {
            baseline: anchorBaseline,
            diagnostics: {
                ...emptyDiagnostics(),
                fallbackReason: "flat layer-slope multiscale signal",
                localShiftBudget: 0,
                distributedShiftBudget: 0,
                localShiftAbs: localShiftAbs.slice(),
                distributedShiftAbs: new Array(tLength).fill(0),
                globalMeanSlopeGuardrailPassed: true
            }
        };
    }
    const lambda = bands.map((band) => band.energy / totalEnergy);
    const uncertaintySaliency = slopeSignal.slice();
    const scaleBands = bands.map((band, i) => {
        const saliency = band.saliency;
        let maxSaliency = 0;
        let meanSaliency = 0;
        for (const value of saliency) {
            meanSaliency += value;
            maxSaliency = Math.max(maxSaliency, value);
        }
        meanSaliency /= Math.max(1, saliency.length);
        return {
            scale: band.scale,
            energy: band.energy,
            ratio: lambda[i],
            meanSaliency,
            maxSaliency
        };
    });
    const selected = selectScaleBands(bands, lambda, clippedThreshold, 6);
    const bases = selected.map((item) => ({
        scale: item.band.scale,
        ratio: item.ratio,
        values: buildSlopeWaveShiftBasis(item.band, anchorCenterlineDerivative, clippedStrength)
    }));
    const localShiftBudget = bases.reduce((acc, basis) => acc + sumAbs(basis.values), 0);
    const optimized = optimizeScaleCoefficients(layers, anchorBaseline, bases, localShiftBudget);
    const distributedShiftAligned = optimized.shift;
    const baseline = recenterBaseline(anchorBaseline.map((value, i) => value + distributedShiftAligned[i]), total);
    const distributedShift = baseline.map((value, i) => value - anchorBaseline[i]);
    const distributedShiftAbs = distributedShift.map((v) => Math.abs(v));
    const distributedShiftBudget = sumAbs(distributedShift);
    const effectiveScaleCount = optimized.coefficients.filter((value) => Math.abs(value) > 1e-6).length;
    const verifiedMultiscale = selected.length >= 2 &&
        effectiveScaleCount > 0 &&
        optimized.objectiveAfter < optimized.objectiveBefore - 1e-9 &&
        optimized.globalMeanSlopeGuardrailPassed;
    return {
        baseline,
        diagnostics: {
            method: "haar-dyadic",
            fallbackUsed: false,
            fallbackReason: null,
            energyThreshold: clippedThreshold,
            effectiveScaleCount,
            selectedScaleCount: selected.length,
            selectedScales: selected.map((item) => item.band.scale),
            verifiedMultiscale,
            localShiftBudget,
            distributedShiftBudget,
            objectiveBefore: optimized.objectiveBefore,
            objectiveAfter: optimized.objectiveAfter,
            meanSlopeBefore: optimized.metricsBefore.meanSlope,
            meanSlopeAfter: optimized.metricsAfter.meanSlope,
            maxSlopeBefore: optimized.metricsBefore.maxSlope,
            maxSlopeAfter: optimized.metricsAfter.maxSlope,
            curvatureBefore: optimized.metricsBefore.curvature,
            curvatureAfter: optimized.metricsAfter.curvature,
            burstBefore: optimized.metricsBefore.maxBaselineDerivative,
            burstAfter: optimized.metricsAfter.maxBaselineDerivative,
            derivativeConcentrationBefore: optimized.metricsBefore.derivativeConcentration,
            derivativeConcentrationAfter: optimized.metricsAfter.derivativeConcentration,
            centerlineSlopeCoverageBefore: optimized.metricsBefore.centerlineSlopeCoverage,
            centerlineSlopeCoverageAfter: optimized.metricsAfter.centerlineSlopeCoverage,
            globalMeanSlopeGuardrailPassed: optimized.globalMeanSlopeGuardrailPassed,
            scaleCoefficients: bases.map((basis, index) => ({
                scale: basis.scale,
                coefficient: optimized.coefficients[index] ?? 0
            })),
            scaleBands,
            uncertaintySaliency,
            localShiftAbs,
            distributedShiftAbs
        }
    };
}
function recenterBaseline(baseline, total) {
    if (baseline.length === 0) {
        return [];
    }
    let centerOffset = 0;
    for (let t = 0; t < baseline.length; t += 1) {
        centerOffset += baseline[t] + 0.5 * total[t];
    }
    centerOffset /= Math.max(1, baseline.length);
    return baseline.map((value) => value - centerOffset);
}
function streamCenterlineFromBaseline(baseline, total) {
    return baseline.map((value, index) => value + 0.5 * (total[index] ?? 0));
}
function aggregateMultiscaleLayerSlopeSignal(layers, tLength) {
    const slope = new Array(tLength).fill(0);
    for (let t = 1; t < tLength; t += 1) {
        let acc = 0;
        let mass = 0;
        for (const layer of layers) {
            const previous = Math.max(0, layer.mean[t - 1] ?? 0);
            const current = Math.max(0, layer.mean[t] ?? 0);
            acc += Math.abs(current - previous);
            mass += 0.5 * (previous + current);
        }
        slope[t] = acc / Math.max(1e-12, mass);
    }
    const variation = new Array(tLength).fill(0);
    for (let t = 1; t < tLength; t += 1) {
        variation[t] = Math.abs(slope[t] - slope[t - 1]);
    }
    const level = normalize01(slope);
    const variationLevel = normalize01(variation);
    return level.map((value, t) => 0.75 * value + 0.25 * variationLevel[t]);
}
function blendScaleSaliencyWithLevel(scaleSaliency, levelSignal) {
    const detail = normalize01(scaleSaliency);
    const out = new Array(scaleSaliency.length).fill(0);
    for (let t = 0; t < scaleSaliency.length; t += 1) {
        const level = levelSignal[t] ?? 0;
        out[t] = 0.5 * detail[t] + 0.5 * level;
    }
    return out;
}
function selectScaleBands(bands, ratios, threshold, maxCount) {
    const ranked = bands
        .map((band, index) => ({ band, ratio: ratios[index] ?? 0 }))
        .filter((item) => Number.isFinite(item.ratio) && item.ratio > 0)
        .sort((a, b) => {
        if (b.ratio !== a.ratio) {
            return b.ratio - a.ratio;
        }
        return a.band.scale - b.band.scale;
    });
    if (ranked.length === 0) {
        return [];
    }
    const selected = ranked.filter((item) => item.ratio >= threshold);
    const thresholded = selected.length > 0 ? selected : [ranked[0]];
    return thresholded.slice(0, Math.max(1, Math.round(maxCount)));
}
function buildSlopeWaveShiftBasis(band, anchorCenterlineDerivative, strength) {
    const length = anchorCenterlineDerivative.length;
    const saliency = normalize01(band.saliency);
    const localizedDerivative = new Array(length).fill(0);
    for (let t = 1; t < length; t += 1) {
        localizedDerivative[t] = saliency[t] * anchorCenterlineDerivative[t];
    }
    const redistributed = movingAverage(localizedDerivative, Math.max(3, band.scale * 2 + 1));
    const derivativeBasis = new Array(length).fill(0);
    for (let t = 1; t < length; t += 1) {
        derivativeBasis[t] = redistributed[t] - localizedDerivative[t];
    }
    let derivativeMean = 0;
    for (let t = 1; t < length; t += 1) {
        derivativeMean += derivativeBasis[t];
    }
    derivativeMean /= Math.max(1, length - 1);
    for (let t = 1; t < length; t += 1) {
        derivativeBasis[t] -= derivativeMean;
    }
    const shift = new Array(length).fill(0);
    for (let t = 1; t < length; t += 1) {
        shift[t] = shift[t - 1] + strength * derivativeBasis[t];
    }
    return removeMean(shift);
}
function optimizeScaleCoefficients(layers, anchorBaseline, bases, localShiftBudget) {
    const metricsBefore = baselineOptimizationMetrics(layers, anchorBaseline);
    const objectiveBefore = baselineObjective(metricsBefore, metricsBefore, 0, localShiftBudget);
    const coefficients = new Array(bases.length).fill(0);
    const emptyShift = new Array(anchorBaseline.length).fill(0);
    let bestShift = emptyShift;
    let bestMetrics = metricsBefore;
    let bestObjective = objectiveBefore;
    const coefficientGrid = [-1, -0.75, -0.5, -0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35, 0.5, 0.75, 1];
    const evaluate = (candidateCoefficients) => {
        const shift = combineBasisShift(bases, candidateCoefficients);
        const baseline = anchorBaseline.map((value, index) => value + shift[index]);
        const metrics = baselineOptimizationMetrics(layers, baseline);
        const objective = baselineObjective(metrics, metricsBefore, sumAbs(shift), localShiftBudget);
        return { shift, metrics, objective };
    };
    for (let pass = 0; pass < 4; pass += 1) {
        let improved = false;
        for (let basisIndex = 0; basisIndex < bases.length; basisIndex += 1) {
            let localBestCoefficient = coefficients[basisIndex];
            let localBestShift = bestShift;
            let localBestMetrics = bestMetrics;
            let localBestObjective = bestObjective;
            for (const coefficient of coefficientGrid) {
                if (Math.abs(coefficient - coefficients[basisIndex]) <= 1e-12) {
                    continue;
                }
                const candidateCoefficients = coefficients.slice();
                candidateCoefficients[basisIndex] = coefficient;
                const candidate = evaluate(candidateCoefficients);
                if (candidate && candidate.objective < localBestObjective - 1e-9) {
                    localBestCoefficient = coefficient;
                    localBestShift = candidate.shift;
                    localBestMetrics = candidate.metrics;
                    localBestObjective = candidate.objective;
                }
            }
            if (localBestObjective < bestObjective - 1e-9) {
                coefficients[basisIndex] = localBestCoefficient;
                bestShift = localBestShift;
                bestMetrics = localBestMetrics;
                bestObjective = localBestObjective;
                improved = true;
            }
        }
        if (!improved) {
            break;
        }
    }
    return {
        shift: removeMean(bestShift),
        coefficients,
        objectiveBefore,
        objectiveAfter: bestObjective,
        metricsBefore,
        metricsAfter: bestMetrics,
        globalMeanSlopeGuardrailPassed: bestMetrics.meanSlope <= metricsBefore.meanSlope * 1.15 + 1e-9
    };
}
function combineBasisShift(bases, coefficients) {
    const length = bases[0]?.values.length ?? 0;
    const out = new Array(length).fill(0);
    for (let i = 0; i < bases.length; i += 1) {
        const coefficient = coefficients[i] ?? 0;
        if (Math.abs(coefficient) <= 1e-12) {
            continue;
        }
        const basis = bases[i].values;
        for (let t = 0; t < length; t += 1) {
            out[t] += coefficient * basis[t];
        }
    }
    return removeMean(out);
}
function baselineObjective(metrics, reference, shiftBudget, localShiftBudget) {
    const budgetRatio = localShiftBudget <= 1e-12 ? 0 : shiftBudget / localShiftBudget;
    const centerlineMeanGrowth = normalizedRatio(metrics.centerlineMeanSlope, reference.centerlineMeanSlope);
    const centerlineMeanPenalty = Math.max(0, centerlineMeanGrowth - 1.8) ** 2;
    const coverageGain = metrics.centerlineSlopeCoverage - reference.centerlineSlopeCoverage;
    return (0.25 * normalizedRatio(metrics.meanSlope, reference.meanSlope) +
        0.6 * normalizedRatio(metrics.maxSlope, reference.maxSlope) +
        0.55 * normalizedRatio(metrics.curvature, reference.curvature) +
        0.45 * normalizedRatio(metrics.centerlineCurvature, reference.centerlineCurvature) +
        1.15 * normalizedRatio(metrics.maxBaselineDerivative, reference.maxBaselineDerivative) +
        0.8 * normalizedRatio(metrics.derivativeConcentration, reference.derivativeConcentration) +
        0.12 * centerlineMeanPenalty +
        0.05 * budgetRatio -
        0.35 * coverageGain);
}
function normalizedRatio(value, reference) {
    if (!Number.isFinite(value)) {
        return Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(reference) || Math.abs(reference) <= 1e-12) {
        return Math.max(0, value);
    }
    return value / Math.max(1e-12, Math.abs(reference));
}
function baselineOptimizationMetrics(layers, baseline) {
    const total = sumLayerMeans(baseline.length, layers);
    const centerline = streamCenterlineFromBaseline(baseline, total);
    const centers = layerCenterSeries(layers, baseline);
    return {
        meanSlope: centerMeanSlope(centers),
        maxSlope: centerMaxSlope(centers),
        curvature: centerCurvature(centers),
        centerlineMeanSlope: meanAbsStep(centerline),
        maxBaselineDerivative: maxAbsStep(centerline),
        derivativeConcentration: derivativeConcentration(centerline),
        centerlineCurvature: meanCurvature(centerline),
        centerlineSlopeCoverage: slopeCoverage(centerline)
    };
}
function layerCenterSeries(layers, baseline) {
    const tLength = baseline.length;
    const prefix = new Array(tLength).fill(0);
    const centers = [];
    for (const layer of layers) {
        const center = new Array(tLength).fill(0);
        for (let t = 0; t < tLength; t += 1) {
            center[t] = baseline[t] + prefix[t] + 0.5 * layer.mean[t];
        }
        centers.push(center);
        for (let t = 0; t < tLength; t += 1) {
            prefix[t] += layer.mean[t];
        }
    }
    return centers;
}
function centerMeanSlope(series) {
    let acc = 0;
    let count = 0;
    for (const row of series) {
        for (let t = 1; t < row.length; t += 1) {
            acc += Math.abs(row[t] - row[t - 1]);
            count += 1;
        }
    }
    return count > 0 ? acc / count : 0;
}
function centerMaxSlope(series) {
    let out = 0;
    for (const row of series) {
        for (let t = 1; t < row.length; t += 1) {
            out = Math.max(out, Math.abs(row[t] - row[t - 1]));
        }
    }
    return out;
}
function centerCurvature(series) {
    let acc = 0;
    let count = 0;
    for (const row of series) {
        for (let t = 2; t < row.length; t += 1) {
            acc += Math.abs(row[t] - 2 * row[t - 1] + row[t - 2]);
            count += 1;
        }
    }
    return count > 0 ? acc / count : 0;
}
function derivativeConcentration(values) {
    if (values.length <= 1) {
        return 0;
    }
    let maxValue = 0;
    let meanValue = 0;
    let count = 0;
    for (let t = 1; t < values.length; t += 1) {
        const value = Math.abs(values[t] - values[t - 1]);
        maxValue = Math.max(maxValue, value);
        meanValue += value;
        count += 1;
    }
    meanValue /= Math.max(1, count);
    return meanValue <= 1e-12 ? 0 : maxValue / meanValue;
}
function slopeCoverage(values) {
    const maxValue = maxAbsStep(values);
    if (values.length <= 1 || maxValue <= 1e-12) {
        return 0;
    }
    const threshold = Math.max(1e-12, 0.05 * maxValue);
    let acc = 0;
    for (let t = 1; t < values.length; t += 1) {
        acc += Math.min(1, Math.abs(values[t] - values[t - 1]) / threshold);
    }
    return acc / Math.max(1, values.length - 1);
}
function haarDyadicBands(signal) {
    const n = signal.length;
    if (n < 2) {
        return [];
    }
    let paddedLength = 1;
    while (paddedLength < n) {
        paddedLength *= 2;
    }
    const padded = new Array(paddedLength).fill(signal[n - 1] ?? 0);
    for (let i = 0; i < n; i += 1) {
        padded[i] = signal[i];
    }
    const bands = [];
    let current = padded.slice();
    let level = 1;
    while (current.length >= 2) {
        const next = new Array(Math.floor(current.length / 2)).fill(0);
        const detail = new Array(Math.floor(current.length / 2)).fill(0);
        for (let i = 0; i < current.length; i += 2) {
            const a = current[i];
            const b = current[i + 1];
            const outIndex = i / 2;
            next[outIndex] = (a + b) / Math.sqrt(2);
            detail[outIndex] = (a - b) / Math.sqrt(2);
        }
        let energy = 0;
        for (const value of detail) {
            energy += value * value;
        }
        const scale = 2 ** level;
        const saliency = new Array(paddedLength).fill(0);
        for (let i = 0; i < detail.length; i += 1) {
            const magnitude = Math.abs(detail[i]);
            const start = i * scale;
            const end = Math.min(paddedLength, start + scale);
            for (let t = start; t < end; t += 1) {
                saliency[t] = magnitude;
            }
        }
        bands.push({
            level,
            scale,
            energy,
            saliency: saliency.slice(0, n)
        });
        current = next;
        level += 1;
    }
    return bands;
}
