import { median } from "../math.js";
/**
 * SineStream baseline computation using Gaussian-weighted adjustments.
 * Following: StreamLayout_2norm_Gauss from the SineStream paper.
 */
export function computeSineStreamBaseline(tLength, layers, hooks) {
    const centerType = hooks.centerType ?? "median";
    const baseline = new Array(tLength).fill(0);
    let totalSize = 0;
    for (const layer of layers) {
        totalSize += layer.mean[0];
    }
    baseline[0] = -0.5 * totalSize;
    for (let i = 1; i < tLength; i += 1) {
        const thicknessChanges = layers.map((layer) => Math.abs(layer.mean[i] - layer.mean[i - 1]));
        const c = computeThicknessChangeMetric(thicknessChanges, centerType);
        const deltaG = computeGaussianWeightedAdjustment(layers, i, c);
        baseline[i] = baseline[i - 1] + deltaG;
    }
    return baseline;
}
function computeThicknessChangeMetric(changes, centerType) {
    if (changes.length === 0) {
        return 1;
    }
    let curC = 1;
    let nonZeroCount = 0;
    switch (centerType) {
        case "median": {
            return median(changes);
        }
        case "geometric": {
            for (const value of changes) {
                if (value !== 0) {
                    nonZeroCount += 1;
                }
            }
            if (nonZeroCount === 0) {
                return curC;
            }
            for (const value of changes) {
                if (value !== 0) {
                    curC *= Math.pow(value, 1 / nonZeroCount);
                }
            }
            return curC;
        }
        case "harmonic": {
            curC = 0;
            for (const value of changes) {
                if (value !== 0) {
                    curC += 1 / value;
                    nonZeroCount += 1;
                }
            }
            if (nonZeroCount === 0 || curC === 0) {
                return 0;
            }
            return nonZeroCount / curC;
        }
        case "mean": {
            for (const value of changes) {
                if (value !== 0) {
                    curC += value;
                }
            }
            return curC / changes.length;
        }
        default:
            return curC;
    }
}
function computeGaussianWeightedAdjustment(layers, i, c) {
    const n = layers.length;
    const dFi = new Array(n);
    const Fi = new Array(n);
    const Qi = new Array(n);
    for (let j = 0; j < n; j += 1) {
        const current = layers[j].mean[i];
        const previous = layers[j].mean[i - 1];
        Fi[j] = current;
        dFi[j] = current - previous;
    }
    for (let j = 0; j < n; j += 1) {
        let p = 0;
        for (let k = 0; k <= j; k += 1) {
            p += 2 * dFi[k];
        }
        Qi[j] = (p - dFi[j]) / 2;
    }
    let numerator = 0;
    let denominator = 0;
    for (let j = 0; j < n; j += 1) {
        let gaussianWeight = 1;
        if (c !== 0 && Number.isFinite(c)) {
            gaussianWeight = Math.exp(-((dFi[j] * dFi[j]) / (2 * c * c)));
        }
        const contribution = gaussianWeight * Fi[j];
        denominator += contribution;
        numerator += contribution * Qi[j];
    }
    if (Number.isFinite(denominator) === false || Math.abs(denominator) <= 1e-12) {
        let totalSizePrev = 0;
        for (let j = 0; j < n; j += 1) {
            totalSizePrev += layers[j].mean[i - 1];
        }
        return totalSizePrev / 2;
    }
    return -(numerator / denominator);
}
