import { validateTimeLengths } from "../validate.js";
import { computeSineStreamBaseline } from "./sineStream.js";
import { median } from "../utils.js";
import { computeMultiscaleDistributedBaseline } from "./multiscale.js";
export function sumLayerHeights(tLength, layers) {
    const totals = new Array(tLength).fill(0);
    for (const layer of layers) {
        for (let t = 0; t < tLength; t += 1) {
            totals[t] += layer.height[t];
        }
    }
    return totals;
}
// 计算中心对齐的基线，对应 silhouette 外轮廓上下边界平方和的最小值。
export function computeCenteredBaseline(tLength, layers) {
    const totals = sumLayerHeights(tLength, layers);
    return totals.map((value) => -0.5 * value);
}
// 计算层高度的一阶差分。
export function computeLayerHeightFirstDifference(tLength, layers) {
    const offsets = Array.from({ length: tLength }, () => []);
    if (tLength <= 1 || layers.length === 0) {
        return offsets;
    }
    for (const layer of layers) {
        for (let t = 1; t < tLength; t += 1) {
            offsets[t].push(layer.height[t] - layer.height[t - 1]);
        }
    }
    return offsets;
}
// 计算层中心线的一阶差分。
export function computeLayerCenterFirstDifference(tLength, layers) {
    // 创建结果容器，长度为 tLength，每个元素存储对应时间点的中心线差分值。
    const offsets = Array.from({ length: tLength }, () => []);
    // 如果时间长度小于等于 1 或者没有层，直接返回空 offsets。
    if (tLength <= 1 || layers.length === 0) {
        return offsets;
    }
    // prefix 用于累计每个时间点之前层的高度总和，初始值为 0。
    const prefix = new Array(tLength).fill(0);
    for (const layer of layers) {
        for (let t = 1; t < tLength; t += 1) {
            const centerNow = prefix[t] + 0.5 * layer.height[t]; // 当前时间点的层中心位置。
            const centerPrev = prefix[t - 1] + 0.5 * layer.height[t - 1]; // 前一个时间点的层中心位置。
            offsets[t].push(centerNow - centerPrev); // offset = 一阶差分。
        }
        // 当前 layer 处理完成后，把它加入 prefix。
        for (let t = 0; t < tLength; t += 1) {
            prefix[t] += layer.height[t];
        }
    }
    return offsets;
}
/** Compute a baseline by the selected global baseline mode. */
export function computeBaseline(times, layers, mode, params = {}) {
    validateTimeLengths(times, layers);
    if (mode === "zero") {
        return new Array(times.length).fill(0);
    }
    if (mode === "center") {
        return computeCenteredBaseline(times.length, layers);
    }
    if (mode === "l1" || mode === "l2") {
        return computeWiggleBaseline(times.length, layers, mode, params);
    }
    return computeSineStreamBaseline(times.length, layers, params);
}
export function computeOptimizingBaseline(times, orderedLayers, mode, hooks, waveStrength, energyThreshold = 0.08) {
    if (mode !== "multiscale") {
        return {
            baseline: computeBaseline(times, orderedLayers, mode, hooks),
            multiscaleDiagnostics: null
        };
    }
    const result = computeMultiscaleDistributedBaseline(times, orderedLayers, Math.max(0, waveStrength), hooks, energyThreshold);
    return {
        baseline: result.baseline,
        multiscaleDiagnostics: result.diagnostics
    };
}
/** Compute a baseline by the selected wiggle mode. */
export function computeWiggleBaseline(tLength, layers, mode, params) {
    if (mode === "l1") {
        return computeWiggleBaselineL1(tLength, layers, params);
    }
    return computeWiggleBaselineL2(tLength, layers, params);
}
export function computeWiggleBaselineL2(tLength, layers, params) {
    const centers = computeCenteredBaseline(tLength, layers);
    const offsets = computeLayerCenterFirstDifference(tLength, layers);
    const deltas = new Array(tLength).fill(0);
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
    const baseline = integrateBaselineFromDeltas(tLength, centers, deltas);
    return blendWithCenteredBaseline(baseline, centers, Math.max(0, params.wiggleWeightL2 ?? 1), params);
}
export function computeWiggleBaselineL1(tLength, layers, hooks) {
    const centers = computeCenteredBaseline(tLength, layers);
    const offsets = computeLayerCenterFirstDifference(tLength, layers);
    const deltas = new Array(tLength).fill(0);
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
    const baseline = integrateBaselineFromDeltas(tLength, centers, deltas);
    return blendWithCenteredBaseline(baseline, centers, Math.max(0, hooks.wiggleWeightL1 ?? 1), hooks);
}
function integrateBaselineFromDeltas(tLength, centers, deltas) {
    const baseline = new Array(tLength).fill(0);
    baseline[0] = centers[0];
    for (let t = 1; t < tLength; t += 1) {
        baseline[t] = baseline[t - 1] + deltas[t];
    }
    return baseline;
}
function blendWithCenteredBaseline(baseline, centers, wiggleWeight, hooks) {
    const anchor = Math.max(0, hooks.centerAnchorWeight ?? 0.35);
    const denom = wiggleWeight + anchor;
    if (denom <= 0) {
        return baseline;
    }
    return baseline.map((v, i) => (wiggleWeight * v + anchor * centers[i]) / denom);
}
