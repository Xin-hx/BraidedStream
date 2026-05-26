import { median } from "../math.js";
import { buildCenterLineDerivativeOffsets, centeredBaselineFromLayers } from "./shared.js";
export function computeWiggleBaseline(tLength, layers, mode, hooks) {
    if (layers.length === 0 || tLength === 0) {
        return new Array(tLength).fill(0);
    }
    const centers = centeredBaselineFromLayers(tLength, layers);
    const offsets = buildCenterLineDerivativeOffsets(tLength, layers);
    const deltas = new Array(tLength).fill(0);
    if (mode === "l2") {
        for (let t = 1; t < tLength; t += 1) {
            const arr = offsets[t];
            if (arr.length === 0) {
                deltas[t] = 0;
                continue;
            }
            let sum = 0;
            for (const v of arr) {
                sum += v;
            }
            deltas[t] = -(sum / arr.length);
        }
    }
    else {
        const iterations = Math.max(1, Math.round(hooks.irlsIterations ?? 12));
        const eps = Math.max(1e-9, hooks.irlsEps ?? 1e-3);
        for (let t = 1; t < tLength; t += 1) {
            const arr = offsets[t];
            deltas[t] = arr.length === 0 ? 0 : -median(arr);
        }
        for (let it = 0; it < iterations; it += 1) {
            for (let t = 1; t < tLength; t += 1) {
                const arr = offsets[t];
                if (arr.length === 0) {
                    deltas[t] = 0;
                    continue;
                }
                let wSum = 0;
                let wdSum = 0;
                for (const d of arr) {
                    const w = 1 / Math.max(eps, Math.abs(deltas[t] + d));
                    wSum += w;
                    wdSum += w * d;
                }
                if (wSum > 0) {
                    deltas[t] = -(wdSum / wSum);
                }
            }
        }
    }
    const baseline = new Array(tLength).fill(0);
    baseline[0] = centers[0];
    for (let t = 1; t < tLength; t += 1) {
        baseline[t] = baseline[t - 1] + deltas[t];
    }
    const anchor = Math.max(0, hooks.centerAnchorWeight ?? 0.35);
    const wiggle = Math.max(0, mode === "l1" ? hooks.wiggleWeightL1 ?? 1 : hooks.wiggleWeightL2 ?? 1);
    const denom = wiggle + anchor;
    if (denom <= 0) {
        return baseline;
    }
    return baseline.map((v, i) => (wiggle * v + anchor * centers[i]) / denom);
}
