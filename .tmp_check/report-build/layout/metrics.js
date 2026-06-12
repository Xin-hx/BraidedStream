/**
 * Layout quality metrics used by UI panels and search routines.
 */
import { computePidOrdering } from "../core/ordering/pid.js";
import { meanFinite, range } from "../core/utils.js";
export function computeMetrics(dataset, beforeLayout, afterLayout, roi, invariant, orderedLayersForAfter, options = {}) {
    const idx = computeIndices(dataset.times.length, roi);
    const idxGlobal = range(0, dataset.times.length);
    const centersBefore = centers(beforeLayout);
    const centersAfter = centers(afterLayout);
    const afterLayers = options.orderedLayersAfter ?? orderedLayersForAfter ?? dataset.layers;
    const beforeLayers = options.orderedLayersBefore ?? afterLayers;
    const semantic = options.semantic ?? {};
    const rows = buildRowsForIndices(idx, beforeLayout, afterLayout, centersBefore, centersAfter, beforeLayers, afterLayers, semantic);
    const includeGlobalRows = options.includeGlobalRows === true;
    const globalRows = includeGlobalRows
        ? buildRowsForIndices(idxGlobal, beforeLayout, afterLayout, centersBefore, centersAfter, beforeLayers, afterLayers, semantic)
        : null;
    return {
        rows,
        globalRows,
        invariant,
        scopeText: roi ? "ROI" : "Global",
        globalScopeText: includeGlobalRows ? "Global" : undefined,
        multiscale: options.multiscale ?? null
    };
}
function buildRowsForIndices(idx, beforeLayout, afterLayout, centersBefore, centersAfter, beforeLayers, afterLayers, semantic) {
    const centerlineBefore = streamCenterline(beforeLayout);
    const centerlineAfter = streamCenterline(afterLayout);
    const rows = [
        row("meanSlope", "Mean slope", meanSlope(centersBefore, idx), meanSlope(centersAfter, idx), "down"),
        row("maxSlope", "Max slope", maxSlope(centersBefore, idx), maxSlope(centersAfter, idx), "down"),
        row("centerlineMaxDerivative", "Centerline max derivative", maxBaselineDerivative(centerlineBefore, idx), maxBaselineDerivative(centerlineAfter, idx), "down"),
        row("centerlineDerivativeConcentration", "Centerline derivative concentration", baselineDerivativeConcentration(centerlineBefore, idx), baselineDerivativeConcentration(centerlineAfter, idx), "down"),
        row("centerlineSlopeCoverage", "Centerline slope coverage", baselineSlopeCoverage(centerlineBefore, idx), baselineSlopeCoverage(centerlineAfter, idx), "up"),
        row("baselineBurst", "Max baseline derivative", maxBaselineDerivative(beforeLayout.baseline, idx), maxBaselineDerivative(afterLayout.baseline, idx), "down"),
        row("baselineDerivativeConcentration", "Baseline derivative concentration", baselineDerivativeConcentration(beforeLayout.baseline, idx), baselineDerivativeConcentration(afterLayout.baseline, idx), "down"),
        row("wiggle", "Wiggle energy", wiggleEnergy(centersBefore, idx), wiggleEnergy(centersAfter, idx), "down"),
        row("illusion", "Sine-illusion proxy", curvatureEnergy(centersBefore, idx), curvatureEnergy(centersAfter, idx), "down"),
        row("sepMean", "Mean layer separation", meanSeparation(beforeLayout, idx), meanSeparation(afterLayout, idx), "up"),
        row("sepMin", "Min layer separation", minSeparation(beforeLayout, idx), minSeparation(afterLayout, idx), "up"),
        row("extraSpace", "Extra space used", 0, mean(afterLayout.sumGapPx, idx), "down"),
        row("compact", "Compactness loss", compactness(beforeLayout, idx), compactness(afterLayout, idx), "down"),
        row("boundary", "Boundary distortion", 0, roiBoundaryDistortion(beforeLayout, afterLayout, idx), "down"),
        row("thickness", "Thickness invariance error", 0, thicknessError(afterLayers, afterLayout, idx), "down"),
        row("order", "Order stability", 1, orderStability(afterLayout, idx), "up")
    ];
    if (semantic.enableTpidCenterAlignment === true) {
        rows.push(row("tpidCenterAlignment", "TPID Center Alignment", tpidCenterAlignment(beforeLayers, beforeLayout, idx, semantic), tpidCenterAlignment(afterLayers, afterLayout, idx, semantic), "up"));
    }
    if (semantic.baselineShiftBeforeAbs &&
        semantic.baselineShiftAfterAbs &&
        semantic.uncertaintySaliency &&
        semantic.baselineShiftBeforeAbs.length > 1 &&
        semantic.baselineShiftAfterAbs.length > 1 &&
        semantic.uncertaintySaliency.length > 1) {
        rows.push(row("uncShiftCoherence", "Uncertainty-Shift Coherence", uncertaintyShiftCoherence(semantic.baselineShiftBeforeAbs, semantic.uncertaintySaliency, idx), uncertaintyShiftCoherence(semantic.baselineShiftAfterAbs, semantic.uncertaintySaliency, idx), "up"));
    }
    return rows;
}
function row(key, label, before, after, better) {
    return { key, label, before, after, delta: after - before, better };
}
function computeIndices(length, roi) {
    if (!roi) {
        return range(0, length);
    }
    const left = Math.max(0, roi.t0Index);
    const right = Math.min(length - 1, roi.t1Index);
    return range(left, right + 1);
}
function centers(layout) {
    return layout.yBottom.map((row, k) => row.map((v, t) => 0.5 * (v + layout.yTop[k][t])));
}
function streamCenterline(layout) {
    if (layout.yBottom.length === 0 || layout.yTop.length === 0) {
        return layout.baseline.slice();
    }
    const last = layout.yTop.length - 1;
    return layout.yBottom[0].map((value, t) => 0.5 * (value + layout.yTop[last][t]));
}
function meanSlope(series, idx) {
    const values = [];
    for (const row of series) {
        for (let i = 1; i < idx.length; i += 1) {
            const t0 = idx[i - 1];
            const t1 = idx[i];
            values.push(Math.abs(row[t1] - row[t0]));
        }
    }
    return mean(values);
}
function maxSlope(series, idx) {
    let m = 0;
    for (const row of series) {
        for (let i = 1; i < idx.length; i += 1) {
            const t0 = idx[i - 1];
            const t1 = idx[i];
            m = Math.max(m, Math.abs(row[t1] - row[t0]));
        }
    }
    return m;
}
function maxBaselineDerivative(values, idx) {
    let m = 0;
    for (let i = 1; i < idx.length; i += 1) {
        const t0 = idx[i - 1];
        const t1 = idx[i];
        m = Math.max(m, Math.abs(values[t1] - values[t0]));
    }
    return m;
}
function baselineDerivativeConcentration(values, idx) {
    if (idx.length <= 1) {
        return 0;
    }
    const derivatives = [];
    for (let i = 1; i < idx.length; i += 1) {
        const t0 = idx[i - 1];
        const t1 = idx[i];
        derivatives.push(Math.abs(values[t1] - values[t0]));
    }
    const meanValue = mean(derivatives);
    if (meanValue <= 1e-12) {
        return 0;
    }
    return Math.max(...derivatives) / meanValue;
}
function baselineSlopeCoverage(values, idx) {
    if (idx.length <= 1) {
        return 0;
    }
    const derivatives = [];
    for (let i = 1; i < idx.length; i += 1) {
        const t0 = idx[i - 1];
        const t1 = idx[i];
        derivatives.push(Math.abs(values[t1] - values[t0]));
    }
    const peak = Math.max(...derivatives);
    if (peak <= 1e-12) {
        return 0;
    }
    const threshold = 0.05 * peak;
    return mean(derivatives.map((value) => Math.min(1, value / Math.max(1e-12, threshold))));
}
function wiggleEnergy(series, idx) {
    let acc = 0;
    for (const row of series) {
        for (let i = 2; i < idx.length; i += 1) {
            const a = row[idx[i - 2]];
            const b = row[idx[i - 1]];
            const c = row[idx[i]];
            const secondDiff = c - 2 * b + a;
            acc += secondDiff * secondDiff;
        }
    }
    return acc / Math.max(1, series.length);
}
function curvatureEnergy(series, idx) {
    const values = [];
    for (const row of series) {
        for (let i = 2; i < idx.length; i += 1) {
            const a = row[idx[i - 2]];
            const b = row[idx[i - 1]];
            const c = row[idx[i]];
            values.push(Math.abs(c - 2 * b + a));
        }
    }
    return mean(values);
}
function meanSeparation(layout, idx) {
    if (layout.yBottom.length < 2) {
        return 0;
    }
    const values = [];
    for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
        for (const t of idx) {
            values.push(Math.max(0, layout.yBottom[k + 1][t] - layout.yTop[k][t]));
        }
    }
    return mean(values);
}
function minSeparation(layout, idx) {
    if (layout.yBottom.length < 2) {
        return 0;
    }
    let minV = Number.POSITIVE_INFINITY;
    for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
        for (const t of idx) {
            minV = Math.min(minV, layout.yBottom[k + 1][t] - layout.yTop[k][t]);
        }
    }
    return Number.isFinite(minV) ? minV : 0;
}
function compactness(layout, idx) {
    const heights = idx.map((t) => layout.yTop[layout.yTop.length - 1][t] - layout.yBottom[0][t]);
    return mean(heights);
}
function roiBoundaryDistortion(before, after, idx) {
    if (idx.length < 2) {
        return 0;
    }
    const endpoints = [idx[0], idx[idx.length - 1]];
    const values = [];
    for (const t of endpoints) {
        for (let k = 0; k < before.yBottom.length; k += 1) {
            values.push(Math.abs(after.yBottom[k][t] - before.yBottom[k][t]));
        }
    }
    return mean(values);
}
function thicknessError(referenceLayers, after, idx) {
    let maxErr = 0;
    const layers = referenceLayers;
    for (let k = 0; k < layers.length; k += 1) {
        for (const t of idx) {
            const thickness = after.yTop[k][t] - after.yBottom[k][t];
            maxErr = Math.max(maxErr, Math.abs(thickness - layers[k].height[t]));
        }
    }
    return maxErr;
}
function orderStability(layout, idx) {
    if (layout.yBottom.length < 2) {
        return 1;
    }
    let overlaps = 0;
    let total = 0;
    for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
        for (const t of idx) {
            total += 1;
            if (layout.yBottom[k + 1][t] < layout.yTop[k][t]) {
                overlaps += 1;
            }
        }
    }
    return 1 - overlaps / Math.max(1, total);
}
function tpidCenterAlignment(layers, layout, idx, semantic) {
    if (layers.length <= 1 || layout.yBottom.length !== layers.length) {
        return 1;
    }
    const pid = computePidOrdering(layers, {
        excludeSelf: true,
        widthPenaltyPower: 1,
        minComparators: 2,
        uncertaintySource: semantic.pidUncertaintySource ?? "value"
    });
    const depthByLayer = pid.depthByLayerId;
    const depth = [];
    const centerCloseness = [];
    for (let k = 0; k < layers.length; k += 1) {
        const layerId = layers[k].id;
        const d = depthByLayer.get(layerId);
        if (!Number.isFinite(d)) {
            continue;
        }
        const centerSeries = idx.map((t) => 0.5 * (layout.yBottom[k][t] + layout.yTop[k][t]));
        const meanAbs = mean(centerSeries.map((v) => Math.abs(v)));
        depth.push(d);
        centerCloseness.push(-meanAbs);
    }
    return spearman(depth, centerCloseness);
}
function uncertaintyShiftCoherence(shiftAbs, saliency, idx) {
    const xs = [];
    const ys = [];
    const limit = Math.min(shiftAbs.length, saliency.length);
    for (const t of idx) {
        if (t < 0 || t >= limit) {
            continue;
        }
        const x = shiftAbs[t];
        const y = saliency[t];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        xs.push(x);
        ys.push(y);
    }
    return pearson(xs, ys);
}
function spearman(x, y) {
    if (x.length !== y.length || x.length <= 1) {
        return 1;
    }
    const rx = averageRanks(x);
    const ry = averageRanks(y);
    return pearson(rx, ry);
}
function averageRanks(values) {
    const pairs = values.map((value, index) => ({ value, index }));
    pairs.sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length).fill(0);
    let i = 0;
    while (i < pairs.length) {
        let j = i;
        while (j + 1 < pairs.length && pairs[j + 1].value === pairs[i].value) {
            j += 1;
        }
        const avgRank = 0.5 * (i + j) + 1;
        for (let k = i; k <= j; k += 1) {
            ranks[pairs[k].index] = avgRank;
        }
        i = j + 1;
    }
    return ranks;
}
function pearson(x, y) {
    if (x.length !== y.length || x.length <= 1) {
        return 0;
    }
    const mx = mean(x);
    const my = mean(y);
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < x.length; i += 1) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        cov += dx * dy;
        vx += dx * dx;
        vy += dy * dy;
    }
    const denom = Math.sqrt(vx * vy);
    if (!Number.isFinite(denom) || denom <= 1e-12) {
        return 0;
    }
    return cov / denom;
}
function mean(values, idx) {
    if (idx) {
        const picked = idx.map((i) => values[i]).filter((v) => Number.isFinite(v));
        return meanFinite(picked);
    }
    return meanFinite(values);
}
