import { EPSILON, clamp, finiteOr, firstFinite, median, sortPair, sum } from "./utils.js";
const QUANTILE_BAND_PAIRS = [
    ["p025", "p975"],
    ["p05", "p95"],
    ["p10", "p90"],
    ["p25", "p75"]
];
/**
 * Interval-inclusion PID ordering for streamgraph layers.
 * A layer is deeper when its central trajectory is often covered by peer bands.
 */
export function computePidOrdering(layers, options = {}) {
    if (layers.length === 0) {
        return {
            order: [],
            scores: [],
            depthByLayerId: new Map(),
            depthSeriesByLayerId: new Map()
        };
    }
    const excludeSelf = options.excludeSelf !== false;
    const widthPenaltyPower = Math.max(0, options.widthPenaltyPower ?? 1);
    const minComparators = Math.max(1, Math.floor(options.minComparators ?? 2));
    const uncertaintySource = options.uncertaintySource ?? "value";
    const tLength = layers[0].mean.length;
    const bands = layers.map((layer) => buildLayerBand(layer, tLength, uncertaintySource));
    const scores = [];
    const depthByLayerId = new Map();
    const depthSeriesByLayerId = new Map();
    for (let i = 0; i < layers.length; i += 1) {
        const series = new Array(tLength).fill(Number.NaN);
        let validTimeCount = 0;
        let depthSum = 0;
        for (let t = 0; t < tLength; t += 1) {
            const center = bands[i].center[t];
            if (!Number.isFinite(center)) {
                continue;
            }
            const widths = [];
            for (let j = 0; j < layers.length; j += 1) {
                if (excludeSelf && i === j) {
                    continue;
                }
                const low = bands[j].low[t];
                const high = bands[j].high[t];
                if (!Number.isFinite(low) || !Number.isFinite(high)) {
                    continue;
                }
                widths.push(Math.max(1e-9, high - low));
            }
            if (widths.length < minComparators) {
                continue;
            }
            const widthRef = Math.max(1e-9, median(widths));
            let covered = 0;
            let total = 0;
            for (let j = 0; j < layers.length; j += 1) {
                if (excludeSelf && i === j) {
                    continue;
                }
                const low = bands[j].low[t];
                const high = bands[j].high[t];
                if (!Number.isFinite(low) || !Number.isFinite(high)) {
                    continue;
                }
                const width = Math.max(1e-9, high - low);
                const widthRatio = width / widthRef;
                const weight = widthPenaltyPower <= 0 ? 1 : 1 / Math.pow(1 + widthRatio, widthPenaltyPower);
                total += weight;
                if (center >= low && center <= high) {
                    covered += weight;
                }
            }
            if (total <= 1e-12) {
                continue;
            }
            const pointDepth = covered / total;
            series[t] = pointDepth;
            depthSum += pointDepth;
            validTimeCount += 1;
        }
        const depth = validTimeCount > 0 ? depthSum / validTimeCount : 0;
        const totalMean = sum(layers[i].mean);
        const score = { id: layers[i].id, depth, totalMean, validTimeCount };
        scores.push(score);
        depthByLayerId.set(layers[i].id, depth);
        depthSeriesByLayerId.set(layers[i].id, series);
    }
    scores.sort((a, b) => {
        if (b.depth !== a.depth) {
            return b.depth - a.depth;
        }
        if (b.validTimeCount !== a.validTimeCount) {
            return b.validTimeCount - a.validTimeCount;
        }
        if (b.totalMean !== a.totalMean) {
            return b.totalMean - a.totalMean;
        }
        return a.id.localeCompare(b.id);
    });
    return {
        order: scores.map((score) => score.id),
        scores,
        depthByLayerId,
        depthSeriesByLayerId
    };
}
/**
 * Reorder a depth-sorted list so that the deepest layer sits near the center
 * and the rest alternate outward in a center-out stack.
 */
export function buildPidCenterOutOrder(depthSortedOrder) {
    const n = depthSortedOrder.length;
    if (n <= 2) {
        return depthSortedOrder.slice();
    }
    const out = new Array(n);
    const centerLeft = Math.floor((n - 1) / 2);
    let left = centerLeft;
    let right = centerLeft + 1;
    for (let i = 0; i < n; i += 1) {
        const id = depthSortedOrder[i];
        if (i === 0) {
            out[centerLeft] = id;
            left -= 1;
            continue;
        }
        const placeUpper = i % 2 === 1;
        if (placeUpper) {
            if (right < n) {
                out[right] = id;
                right += 1;
            }
            else if (left >= 0) {
                out[left] = id;
                left -= 1;
            }
        }
        else {
            if (left >= 0) {
                out[left] = id;
                left -= 1;
            }
            else if (right < n) {
                out[right] = id;
                right += 1;
            }
        }
    }
    return out.filter((id) => typeof id === "string" && id.length > 0);
}
/**
 * Compute adjacent-time temporal self-inclusion (TSI) for each layer.
 */
export function computeTemporalSelfInclusion(depthSeriesByLayerId) {
    const out = new Map();
    for (const [layerId, series] of depthSeriesByLayerId.entries()) {
        const tsi = [];
        for (let t = 1; t < series.length; t += 1) {
            const prev = series[t - 1];
            const next = series[t];
            if (!Number.isFinite(prev) || !Number.isFinite(next)) {
                tsi.push(Number.NaN);
                continue;
            }
            tsi.push(clamp(1 - Math.abs(next - prev), 0, 1));
        }
        out.set(layerId, tsi);
    }
    return out;
}
/**
 * Build layer-wise ordering scores for PID time ordering modes.
 */
export function computePidOrderingScores(input) {
    const alpha = clamp(input.alpha ?? 0.8, 0, 1);
    const out = [];
    for (const layerId of input.layerIds) {
        const dSeries = input.D_cross.get(layerId) ?? [];
        const cValues = dSeries.filter((value) => Number.isFinite(value));
        const C = cValues.length > 0 ? sum(cValues) / cValues.length : 0;
        const tsiSeries = input.temporalSelfInclusion?.get(layerId) ?? [];
        const rValues = tsiSeries.filter((value) => Number.isFinite(value));
        const R = rValues.length > 0 ? sum(rValues) / rValues.length : 0;
        const score = input.mode === "layer_pid_time_weighted" ? alpha * C + (1 - alpha) * R : C;
        out.push({ layerId, C, R, score });
    }
    out.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        if (b.C !== a.C) {
            return b.C - a.C;
        }
        if (b.R !== a.R) {
            return b.R - a.R;
        }
        return a.layerId.localeCompare(b.layerId);
    });
    return out;
}
function buildLayerBand(layer, tLength, uncertaintySource) {
    const low = new Array(tLength).fill(0);
    const high = new Array(tLength).fill(0);
    const center = new Array(tLength).fill(0);
    for (let t = 0; t < tLength; t += 1) {
        const meanValue = layerCenterValue(layer, t, uncertaintySource);
        const quantiles = quantilesForSource(layer, uncertaintySource);
        const q50 = finiteOr(quantiles?.p50?.[t], meanValue);
        const [lo, hi] = resolveBand(layer, t, meanValue, uncertaintySource);
        low[t] = lo;
        high[t] = hi;
        center[t] = clamp(q50, lo, hi);
    }
    return { low, high, center };
}
/** Resolve the preferred uncertainty interval at a time sample. */
function resolveBand(layer, timeIndex, meanValue, uncertaintySource) {
    const quantiles = quantilesForSource(layer, uncertaintySource);
    for (const [lowKey, highKey] of QUANTILE_BAND_PAIRS) {
        const qLow = finiteOr(quantiles?.[lowKey]?.[timeIndex], Number.NaN);
        const qHigh = finiteOr(quantiles?.[highKey]?.[timeIndex], Number.NaN);
        if (Number.isFinite(qLow) && Number.isFinite(qHigh)) {
            return sortPair(qLow, qHigh);
        }
    }
    const lower = finiteOr(uncertaintySource === "poportion" ? layer.poportionLower?.[timeIndex] : layer.lower?.[timeIndex], Number.NaN);
    const upper = finiteOr(uncertaintySource === "poportion" ? layer.poportionUpper?.[timeIndex] : layer.upper?.[timeIndex], Number.NaN);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
        return sortPair(lower, upper);
    }
    const unc = finiteOr(uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex], Number.NaN);
    if (Number.isFinite(unc)) {
        const halfWidth = Math.max(0, unc) * 0.5;
        return sortPair(meanValue - halfWidth, meanValue + halfWidth);
    }
    return [meanValue, meanValue];
}
/** Compute contour-mask PID-Mean and the associated contour-boxplot masks. */
export function computeContourPid(layers, options = {}) {
    const xBins = layers[0]?.mean.length ?? 0;
    const yBins = Math.max(16, Math.round(options.yBins ?? 180));
    const contourThreshold = clamp(options.contourThreshold ?? 0.5, 0, 1);
    const centralFraction = clamp(options.centralFraction ?? 0.5, 0, 1);
    const uncertaintySource = options.uncertaintySource ?? "value";
    const gridSize = xBins * yBins;
    if (layers.length === 0 || xBins === 0) {
        return emptyContourPidResult(xBins, yBins, contourThreshold);
    }
    const bands = layers.map((layer) => buildLayerBandSeries(layer, xBins, uncertaintySource));
    const grid = buildContourGrid(bands, xBins, yBins, contourThreshold, uncertaintySource);
    const masks = bands.map((band) => rasterizeBand(band, grid));
    const meanMask = averageMasks(masks, gridSize);
    const scores = sortContourScores(scoreMasks(layers, masks, meanMask));
    const depthOrder = scores.map((score) => score.id);
    const displayOrder = buildPidCenterOutOrder(depthOrder);
    const depthByLayerId = new Map(scores.map((score) => [score.id, score.depth]));
    const scoreByLayerId = new Map(scores.map((score) => [score.id, score]));
    const boxplotMasks = buildContourBoxplotMasks(layers, masks, scores, centralFraction, gridSize);
    return {
        scores,
        depthByLayerId,
        scoreByLayerId,
        depthOrder,
        displayOrder,
        deepestLayerId: boxplotMasks.deepestLayerId,
        meanMask,
        allUnionMask: boxplotMasks.allUnionMask,
        centralUnionMask: boxplotMasks.centralUnionMask,
        centralIntersectionMask: boxplotMasks.centralIntersectionMask,
        deepestMask: boxplotMasks.deepestMask,
        grid
    };
}
function emptyContourPidResult(xBins, yBins, contourThreshold) {
    const emptyMask = new Float32Array(xBins * yBins);
    const grid = {
        xBins,
        yBins,
        zMin: 0,
        zMax: 1,
        contourThreshold,
        valueTransform: "linear"
    };
    return {
        scores: [],
        depthByLayerId: new Map(),
        scoreByLayerId: new Map(),
        depthOrder: [],
        displayOrder: [],
        deepestLayerId: null,
        meanMask: emptyMask,
        allUnionMask: emptyMask,
        centralUnionMask: emptyMask,
        centralIntersectionMask: emptyMask,
        deepestMask: emptyMask,
        grid
    };
}
function buildContourGrid(bands, xBins, yBins, contourThreshold, uncertaintySource) {
    const [zMinRaw, zMaxRaw] = transformedExtent(bands, uncertaintySource === "poportion" ? "linear" : "log1p");
    const zPad = Math.max(1e-6, (zMaxRaw - zMinRaw) * 0.04);
    const zMin = uncertaintySource === "poportion" ? Math.max(0, zMinRaw - zPad) : zMinRaw - zPad;
    const zMax = zMaxRaw + zPad;
    return {
        xBins,
        yBins,
        zMin,
        zMax: zMax > zMin ? zMax : zMin + 1e-6,
        contourThreshold,
        valueTransform: uncertaintySource === "poportion" ? "linear" : "log1p"
    };
}
function averageMasks(masks, gridSize) {
    const meanMask = new Float32Array(gridSize);
    for (const mask of masks) {
        for (let i = 0; i < gridSize; i += 1) {
            meanMask[i] += mask[i];
        }
    }
    for (let i = 0; i < gridSize; i += 1) {
        meanMask[i] /= Math.max(1, masks.length);
    }
    return meanMask;
}
function scoreMasks(layers, masks, meanMask) {
    const areaMean = sumMask(meanMask);
    return masks.map((mask, index) => {
        const area = sumMask(mask);
        const dot = dotMask(mask, meanMask);
        const inScore = area > EPSILON ? dot / area : 0;
        const outScore = areaMean > EPSILON ? dot / areaMean : 0;
        return {
            id: layers[index].id,
            depth: Math.min(inScore, outScore),
            inScore,
            outScore,
            area
        };
    });
}
function sortContourScores(scores) {
    return scores.sort((a, b) => {
        if (b.depth !== a.depth) {
            return b.depth - a.depth;
        }
        if (b.inScore !== a.inScore) {
            return b.inScore - a.inScore;
        }
        if (b.outScore !== a.outScore) {
            return b.outScore - a.outScore;
        }
        return a.id.localeCompare(b.id);
    });
}
function buildContourBoxplotMasks(layers, masks, scores, centralFraction, gridSize) {
    const centralCount = Math.max(1, Math.floor(scores.length * centralFraction));
    const centralIds = new Set(scores.slice(0, centralCount).map((score) => score.id));
    const allUnionMask = new Float32Array(gridSize);
    const centralUnionMask = new Float32Array(gridSize);
    const centralIntersectionMask = new Float32Array(gridSize);
    centralIntersectionMask.fill(1);
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
        const mask = masks[layerIndex];
        const isCentral = centralIds.has(layers[layerIndex].id);
        for (let i = 0; i < gridSize; i += 1) {
            allUnionMask[i] = Math.max(allUnionMask[i], mask[i]);
            if (isCentral) {
                centralUnionMask[i] = Math.max(centralUnionMask[i], mask[i]);
                centralIntersectionMask[i] = Math.min(centralIntersectionMask[i], mask[i]);
            }
        }
    }
    const deepestLayerId = scores[0]?.id ?? null;
    const deepestIndex = deepestLayerId ? layers.findIndex((layer) => layer.id === deepestLayerId) : -1;
    const deepestMask = deepestIndex >= 0 ? masks[deepestIndex].slice() : new Float32Array(gridSize);
    return {
        deepestLayerId,
        allUnionMask,
        centralUnionMask,
        centralIntersectionMask,
        deepestMask
    };
}
function buildLayerBandSeries(layer, tLength, uncertaintySource) {
    const lowOuter = new Array(tLength).fill(0);
    const lowInner = new Array(tLength).fill(0);
    const center = new Array(tLength).fill(0);
    const highInner = new Array(tLength).fill(0);
    const highOuter = new Array(tLength).fill(0);
    for (let t = 0; t < tLength; t += 1) {
        const mean = layerCenterValue(layer, t, uncertaintySource);
        const quantiles = quantilesForSource(layer, uncertaintySource);
        const p50 = finiteOr(quantiles?.p50?.[t], mean);
        const [outerLow, outerHigh] = resolveOuterBand(layer, t, mean, uncertaintySource);
        const innerLow = firstFinite(quantiles?.p25?.[t], Math.min(p50, mean), outerLow);
        const innerHigh = firstFinite(quantiles?.p75?.[t], Math.max(p50, mean), outerHigh);
        const sorted = [outerLow, innerLow, p50, innerHigh, outerHigh].map((value) => Math.max(0, value));
        sorted.sort((a, b) => a - b);
        lowOuter[t] = sorted[0];
        lowInner[t] = sorted[1];
        center[t] = sorted[2];
        highInner[t] = sorted[3];
        highOuter[t] = sorted[4];
    }
    return { lowOuter, lowInner, center, highInner, highOuter };
}
function resolveOuterBand(layer, timeIndex, meanValue, uncertaintySource) {
    const quantiles = quantilesForSource(layer, uncertaintySource);
    const outerLow = firstFinite(quantiles?.p025?.[timeIndex], quantiles?.p05?.[timeIndex], quantiles?.p10?.[timeIndex], uncertaintySource === "poportion" ? layer.poportionLower?.[timeIndex] : layer.lower?.[timeIndex], meanValue -
        0.5 *
            Math.max(0, finiteOr(uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex], 0)), meanValue);
    const outerHigh = firstFinite(quantiles?.p975?.[timeIndex], quantiles?.p95?.[timeIndex], quantiles?.p90?.[timeIndex], uncertaintySource === "poportion" ? layer.poportionUpper?.[timeIndex] : layer.upper?.[timeIndex], meanValue +
        0.5 *
            Math.max(0, finiteOr(uncertaintySource === "poportion" ? layer.poportionUnc?.[timeIndex] : layer.unc?.[timeIndex], 0)), meanValue);
    return sortPair(outerLow, outerHigh);
}
function layerCenterValue(layer, timeIndex, uncertaintySource) {
    if (uncertaintySource === "poportion") {
        return finiteOr(layer.poportionMean?.[timeIndex], finiteOr(layer.poportionQuantiles?.p50?.[timeIndex], 0));
    }
    return finiteOr(layer.mean[timeIndex], 0);
}
function quantilesForSource(layer, uncertaintySource) {
    return uncertaintySource === "poportion" ? layer.poportionQuantiles ?? layer.quantiles : layer.quantiles;
}
function rasterizeBand(band, grid) {
    const mask = new Float32Array(grid.xBins * grid.yBins);
    const dz = grid.yBins <= 1 ? 1 : (grid.zMax - grid.zMin) / (grid.yBins - 1);
    for (let t = 0; t < grid.xBins; t += 1) {
        const lo = transformValue(band.lowOuter[t], grid.valueTransform);
        const li = transformValue(band.lowInner[t], grid.valueTransform);
        const hi = transformValue(band.highInner[t], grid.valueTransform);
        const ho = transformValue(band.highOuter[t], grid.valueTransform);
        const c = transformValue(band.center[t], grid.valueTransform);
        for (let y = 0; y < grid.yBins; y += 1) {
            const z = grid.zMin + y * dz;
            mask[y * grid.xBins + t] = membership(z, lo, li, c, hi, ho);
        }
    }
    return mask;
}
function membership(z, lo, li, c, hi, ho) {
    const lowInner = Math.max(lo, Math.min(li, c));
    const highInner = Math.min(ho, Math.max(hi, c));
    if (z < lo || z > ho) {
        return 0;
    }
    if (z >= lowInner && z <= highInner) {
        return 1;
    }
    if (z < lowInner) {
        return (z - lo) / Math.max(EPSILON, lowInner - lo);
    }
    return (ho - z) / Math.max(EPSILON, ho - highInner);
}
function transformedExtent(bands, valueTransform) {
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    for (const band of bands) {
        for (const series of [band.lowOuter, band.highOuter, band.center]) {
            for (const value of series) {
                const z = transformValue(value, valueTransform);
                minValue = Math.min(minValue, z);
                maxValue = Math.max(maxValue, z);
            }
        }
    }
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
        return [0, 1];
    }
    return [minValue, maxValue];
}
function transformValue(value, valueTransform) {
    const finite = Math.max(0, finiteOr(value, 0));
    return valueTransform === "linear" ? finite : Math.log1p(finite);
}
function sumMask(mask) {
    let out = 0;
    for (const value of mask) {
        out += value;
    }
    return out;
}
function dotMask(a, b) {
    let out = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
        out += a[i] * b[i];
    }
    return out;
}
