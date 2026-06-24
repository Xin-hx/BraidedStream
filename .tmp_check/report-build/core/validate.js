import { EPSILON } from "./utils";
/**
 * Assert that all per-time layer series match the dataset timeline length. 时间序列校验，每一层长度一致，每个时间点都有值
 * Series normalization is handled in data ingestion/preprocessing. 缺失值补0在数据预处理阶段完成
 */
export function validateTimeLengths(times, layers) {
    if (times.length === 0) {
        throw new Error("times must not be empty");
    }
    for (const layer of layers) {
        if (layer.height.length !== times.length) {
            throw new Error(`Layer ${layer.id} mean length mismatch: expected ${times.length}`);
        }
        if (layer.unc && layer.unc.length !== times.length) {
            throw new Error(`Layer ${layer.id} unc length mismatch: expected ${times.length}`);
        }
        if (layer.poportionUnc && layer.poportionUnc.length !== times.length) {
            throw new Error(`Layer ${layer.id} poportionUnc length mismatch: expected ${times.length}`);
        }
        if (layer.poportionMean && layer.poportionMean.length !== times.length) {
            throw new Error(`Layer ${layer.id} poportionMean length mismatch: expected ${times.length}`);
        }
        if (layer.poportionLower && layer.poportionLower.length !== times.length) {
            throw new Error(`Layer ${layer.id} poportionLower length mismatch: expected ${times.length}`);
        }
        if (layer.poportionUpper && layer.poportionUpper.length !== times.length) {
            throw new Error(`Layer ${layer.id} poportionUpper length mismatch: expected ${times.length}`);
        }
        if (layer.lower && layer.lower.length !== times.length) {
            throw new Error(`Layer ${layer.id} lower length mismatch: expected ${times.length}`);
        }
        if (layer.upper && layer.upper.length !== times.length) {
            throw new Error(`Layer ${layer.id} upper length mismatch: expected ${times.length}`);
        }
        if (layer.quantiles) {
            for (const [quantileKey, series] of Object.entries(layer.quantiles)) {
                if (series.length !== times.length) {
                    throw new Error(`Layer ${layer.id} quantile length mismatch (${quantileKey}): expected ${times.length}, got ${series.length}`);
                }
            }
        }
        if (layer.poportionQuantiles) {
            for (const [quantileKey, series] of Object.entries(layer.poportionQuantiles)) {
                if (series.length !== times.length) {
                    throw new Error(`Layer ${layer.id} poportionQuantile length mismatch (${quantileKey}): expected ${times.length}, got ${series.length}`);
                }
            }
        }
    }
}
/** Estimate a layer's uncertainty spread at one time sample. */
export function layerUncertaintyAt(layer, t) {
    if (layer.quantiles) {
        const values = Object.values(layer.quantiles)
            .map((series) => series[t])
            .filter((v) => Number.isFinite(v));
        if (values.length >= 2) {
            const minV = Math.min(...values);
            const maxV = Math.max(...values);
            return Math.max(0, maxV - minV);
        }
    }
    if (layer.unc) {
        return Math.max(0, layer.unc[t] ?? 0);
    }
    if (layer.lower && layer.upper) {
        return Math.max(0, (layer.upper[t] - layer.lower[t]) * 0.5);
    }
    return 0;
}
/** Boundary uncertainty is the combined spread of adjacent layers. */
export function boundaryUncertaintyAt(a, b, t) {
    return layerUncertaintyAt(a, t) + layerUncertaintyAt(b, t);
}
/** Numeric equality check used by invariant and geometry code. */
export function almostEqual(a, b, eps = EPSILON) {
    return Math.abs(a - b) <= eps;
}
/** Empty invariant placeholder for layouts that are compared but not assertion-checked. */
export function emptyInvariantSummary() {
    return {
        checked: false,
        violations: [],
        maxThicknessError: 0
    };
}
