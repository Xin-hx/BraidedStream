import { normalizeROI } from "./roi.js";
import { clamp, clamp01 } from "./utils.js";
import { boundaryUncertaintyAt } from "./validate.js";
/** Add ROI-local spacing between layers and return braid geometry plus diagnostics. */
export function computeBraidLayout(args) {
    const { base, orderedLayers, roi, baselineMode, gapMode, gapAlphaPx, maxExtraHeightPx, smoothKernel, yScale } = args;
    const tLength = base.baseline.length;
    const normalizedROI = normalizeROI(roi, tLength);
    // Omega acts as a soft mask: spacing is concentrated in ROI and smoothly decays outside.
    const omegaResult = computeOmega(tLength, normalizedROI, smoothKernel);
    const omega = omegaResult.omega;
    const roiSupport = omegaResult.roiSupport;
    const spacing = resolveSpacingOptions(args, maxExtraHeightPx);
    const gapResult = computeGapComputation(orderedLayers, gapMode, omega, roiSupport, gapAlphaPx, maxExtraHeightPx, spacing);
    // Convert spacing back to data units and reconstruct top/bottom envelopes.
    const pxPerValue = estimatePixelsPerValue(yScale);
    const gapsValue = gapResult.gapsPx.map((row) => row.map((v) => v / pxPerValue));
    const boundaries = applyGapValuesToStack(base, orderedLayers, gapsValue, gapResult.sumGapPx, pxPerValue, baselineMode);
    return {
        baseline: base.baseline.slice(),
        yBottom: boundaries.yBottom,
        yTop: boundaries.yTop,
        omega,
        gapsPx: gapResult.gapsPx,
        gapsValue,
        sumGapPx: gapResult.sumGapPx,
        roiSupport,
        diagnostics: {
            orderObjectiveBefore: 0,
            orderObjectiveAfter: 0,
            clusterCount: 1,
            trunkCluster: 0,
            crossClusterBoundaries: 0,
            spacingObjective: (gapResult.terms.uncertainty + gapResult.terms.slope) / Math.max(1, gapResult.spacingSamples) +
                spacing.temporalWeight * gapResult.terms.temporal / Math.max(1, gapResult.temporalSamples),
            spacingUncertaintyTerm: gapResult.terms.uncertainty / Math.max(1, gapResult.spacingSamples),
            spacingSlopeTerm: gapResult.terms.slope / Math.max(1, gapResult.spacingSamples),
            spacingTemporalTerm: gapResult.terms.temporal / Math.max(1, gapResult.temporalSamples),
            spacingIterations: spacing.iterations,
            spacingObjectiveHistory: gapResult.objectiveHistory
        }
    };
}
function resolveSpacingOptions(args, maxExtraHeightPx) {
    return {
        budgetPx: Math.max(0, args.spacingBudgetPx ?? maxExtraHeightPx),
        uncertaintyWeight: Math.max(0, args.spacingUncertaintyWeight ?? 1),
        slopeWeight: Math.max(0, args.spacingSlopeWeight ?? 0),
        temporalWeight: clamp(args.spacingTemporalWeight ?? 0, 0, 0.95),
        iterations: Math.max(1, Math.floor(args.spacingIterations ?? 1)),
        boundaryPenalty: args.boundaryPenalty ?? []
    };
}
function computeGapComputation(orderedLayers, gapMode, omega, roiSupport, gapAlphaPx, maxExtraHeightPx, spacing) {
    const tLength = omega.length;
    const gapCount = Math.max(0, orderedLayers.length - 1);
    const gapsPx = Array.from({ length: gapCount }, () => new Array(tLength).fill(0));
    const targetPx = Array.from({ length: gapCount }, () => new Array(tLength).fill(0));
    const sumGapPx = new Array(tLength).fill(0);
    const terms = { uncertainty: 0, slope: 0, temporal: 0 };
    const objectiveHistory = [];
    let spacingSamples = 0;
    let temporalSamples = 0;
    if (gapMode !== "none" && roiSupport) {
        const scales = computeGapScales(orderedLayers, tLength, roiSupport, gapMode, gapAlphaPx);
        const samples = fillInitialGaps(orderedLayers, gapMode, omega, gapsPx, targetPx, sumGapPx, terms, scales, spacing, gapAlphaPx, maxExtraHeightPx);
        spacingSamples = samples.spacingSamples;
        temporalSamples = samples.temporalSamples;
        smoothGapTimeline(gapsPx, targetPx, objectiveHistory, spacing, maxExtraHeightPx);
    }
    return {
        gapsPx,
        targetPx,
        sumGapPx,
        terms,
        spacingSamples,
        temporalSamples,
        objectiveHistory
    };
}
function computeGapScales(orderedLayers, tLength, roiSupport, gapMode, gapAlphaPx) {
    return {
        // Robust quantile scales prevent outliers from dominating uncertainty/slope normalization.
        uncScale: gapMode === "uncGap" ? robustTermScale(orderedLayers, tLength, roiSupport, "uncertainty") : 1,
        slopeScale: gapMode === "uncGap" ? robustTermScale(orderedLayers, tLength, roiSupport, "slope") : 1,
        boundaryThicknessScale: gapMode === "uncGap" ? robustBoundaryThicknessScale(orderedLayers, tLength, roiSupport) : 1,
        minVisibleGapPx: gapMode === "uncGap" ? Math.max(1.2, 0.22 * gapAlphaPx) : 0
    };
}
function fillInitialGaps(orderedLayers, gapMode, omega, gapsPx, targetPx, sumGapPx, terms, scales, spacing, gapAlphaPx, maxExtraHeightPx) {
    const tLength = omega.length;
    const gapCount = gapsPx.length;
    let spacingSamples = 0;
    let temporalSamples = 0;
    // Stage 1: estimate target gaps from local uncertainty/slope and apply one-step temporal damping.
    for (let t = 0; t < tLength; t += 1) {
        let totalGapPx = 0;
        for (let k = 0; k < gapCount; k += 1) {
            const rawGapPx = rawGapAt(orderedLayers, gapMode, omega[t], k, t, terms, scales, spacing, gapAlphaPx);
            if (gapMode === "uncGap") {
                spacingSamples += 1;
            }
            targetPx[k][t] = Math.max(0, rawGapPx);
            const prev = t > 0 ? gapsPx[k][t - 1] : rawGapPx;
            gapsPx[k][t] = Math.max(0, (1 - spacing.temporalWeight) * rawGapPx + spacing.temporalWeight * prev);
            if (t > 0) {
                const dt = gapsPx[k][t] - gapsPx[k][t - 1];
                terms.temporal += dt * dt;
                temporalSamples += 1;
            }
            totalGapPx += gapsPx[k][t];
        }
        sumGapPx[t] = capGapsAtTime(gapsPx, t, totalGapPx, maxExtraHeightPx, spacing.budgetPx);
    }
    return { spacingSamples, temporalSamples };
}
function rawGapAt(orderedLayers, gapMode, omegaValue, boundaryIndex, timeIndex, terms, scales, spacing, gapAlphaPx) {
    if (gapMode === "fixedGap") {
        return omegaValue * gapAlphaPx;
    }
    if (gapMode !== "uncGap") {
        return 0;
    }
    const layerA = orderedLayers[boundaryIndex];
    const layerB = orderedLayers[boundaryIndex + 1];
    const uncertainty = boundaryUncertaintyAt(layerA, layerB, timeIndex);
    const slopeA = timeIndex > 0 ? Math.abs(layerA.mean[timeIndex] - layerA.mean[timeIndex - 1]) : 0;
    const slopeB = timeIndex > 0 ? Math.abs(layerB.mean[timeIndex] - layerB.mean[timeIndex - 1]) : 0;
    const slopeTerm = 0.5 * (slopeA + slopeB);
    const localThickness = 0.5 * (Math.max(1e-9, layerA.mean[timeIndex]) + Math.max(1e-9, layerB.mean[timeIndex]));
    const uNorm = clamp01(uncertainty / scales.uncScale);
    const slopeNorm = clamp01(slopeTerm / scales.slopeScale);
    const thinnessNorm = clamp01(scales.boundaryThicknessScale / Math.max(1e-9, localThickness));
    const edgeBoost = spacing.boundaryPenalty[boundaryIndex] ?? 1;
    const aggressiveUncertainty = Math.pow(uNorm, 1.35);
    const thinDriftBoost = 1 + 1.1 * aggressiveUncertainty * thinnessNorm;
    const slopeDrive = 0.6 * slopeNorm;
    const signal = spacing.uncertaintyWeight * aggressiveUncertainty * thinDriftBoost + spacing.slopeWeight * slopeDrive;
    const visibility = clamp01(0.2 + 0.8 * aggressiveUncertainty + 0.6 * thinnessNorm);
    terms.uncertainty += spacing.uncertaintyWeight * uncertainty;
    terms.slope += spacing.slopeWeight * slopeTerm;
    return omegaValue * edgeBoost * (gapAlphaPx * signal + scales.minVisibleGapPx * visibility);
}
function capGapsAtTime(gapsPx, timeIndex, totalGapPx, maxExtraHeightPx, spacingBudgetPx) {
    const cap = Math.min(maxExtraHeightPx, spacingBudgetPx);
    if (totalGapPx <= cap || totalGapPx <= 0) {
        return totalGapPx;
    }
    const scale = cap / totalGapPx;
    for (let k = 0; k < gapsPx.length; k += 1) {
        gapsPx[k][timeIndex] *= scale;
    }
    return cap;
}
function smoothGapTimeline(gapsPx, targetPx, objectiveHistory, spacing, maxExtraHeightPx) {
    const gapCount = gapsPx.length;
    const tLength = gapsPx[0]?.length ?? 0;
    // Stage 2: iterative temporal smoothing under per-time total extra-height cap.
    for (let iter = 0; iter < spacing.iterations; iter += 1) {
        const nextGaps = gapsPx.map((row) => row.slice());
        for (let k = 0; k < gapCount; k += 1) {
            for (let t = 0; t < tLength; t += 1) {
                const prev = t > 0 ? gapsPx[k][t - 1] : gapsPx[k][t];
                const next = t < tLength - 1 ? gapsPx[k][t + 1] : gapsPx[k][t];
                const smoothTarget = 0.5 * (prev + next);
                const blended = (1 - spacing.temporalWeight) * targetPx[k][t] + spacing.temporalWeight * smoothTarget;
                nextGaps[k][t] = Math.max(0, blended);
            }
        }
        for (let t = 0; t < tLength; t += 1) {
            let total = 0;
            for (let k = 0; k < gapCount; k += 1) {
                total += nextGaps[k][t];
            }
            capGapsAtTime(nextGaps, t, total, maxExtraHeightPx, spacing.budgetPx);
        }
        for (let k = 0; k < gapCount; k += 1) {
            for (let t = 0; t < tLength; t += 1) {
                gapsPx[k][t] = nextGaps[k][t];
            }
        }
        objectiveHistory.push(computeSpacingObjective(gapsPx, targetPx, spacing.temporalWeight));
    }
}
function applyGapValuesToStack(base, orderedLayers, gapsValue, sumGapPx, pxPerValue, baselineMode) {
    const tLength = base.baseline.length;
    const gapCount = Math.max(0, orderedLayers.length - 1);
    const yBottom = base.yBottom.map((row) => row.slice());
    const yTop = base.yTop.map((row) => row.slice());
    for (let t = 0; t < tLength; t += 1) {
        // Center baseline keeps added spacing visually balanced around the stream centerline.
        const totalExtraValue = sumGapPx[t] / pxPerValue;
        const centerShift = baselineMode === "center" ? -0.5 * totalExtraValue : 0;
        let extra = 0;
        for (let k = 0; k < orderedLayers.length; k += 1) {
            yBottom[k][t] = base.yBottom[k][t] + centerShift + extra;
            yTop[k][t] = yBottom[k][t] + orderedLayers[k].mean[t];
            if (k < gapCount) {
                extra += gapsValue[k][t];
            }
        }
    }
    return { yBottom, yTop };
}
function computeSpacingObjective(gapsPx, targetPx, temporalWeight) {
    const kLength = gapsPx.length;
    if (kLength === 0) {
        return 0;
    }
    const tLength = gapsPx[0].length;
    let fit = 0;
    let smooth = 0;
    let fitN = 0;
    let smoothN = 0;
    for (let k = 0; k < kLength; k += 1) {
        for (let t = 0; t < tLength; t += 1) {
            const d = gapsPx[k][t] - targetPx[k][t];
            fit += d * d;
            fitN += 1;
            if (t > 0) {
                const dt = gapsPx[k][t] - gapsPx[k][t - 1];
                smooth += dt * dt;
                smoothN += 1;
            }
        }
    }
    return fit / Math.max(1, fitN) + temporalWeight * smooth / Math.max(1, smoothN);
}
export function computeOmega(tLength, roi, smoothKernel) {
    const omega = new Array(tLength).fill(0);
    if (!roi) {
        return { omega, roiSupport: null };
    }
    const span = roi.t1Index - roi.t0Index + 1;
    if (span <= 0) {
        return { omega, roiSupport: null };
    }
    const tau = Math.max(5, Math.floor(0.25 * (roi.t1Index - roi.t0Index)));
    const supportStart = clamp(Math.floor(roi.t0Index - tau), 0, tLength - 1);
    const supportEnd = clamp(Math.ceil(roi.t1Index + tau), 0, tLength - 1);
    // Raised-cosine ramps reduce visual discontinuities at ROI support boundaries.
    for (let t = supportStart; t <= supportEnd; t += 1) {
        omega[t] = raisedCosineWindow(t, roi.t0Index, roi.t1Index, tau, smoothKernel);
    }
    return {
        omega,
        roiSupport: {
            tau,
            coreStart: roi.t0Index,
            coreEnd: roi.t1Index,
            supportStart,
            supportEnd
        }
    };
}
function estimatePixelsPerValue(yScale) {
    const p0 = yScale(0);
    const p1 = yScale(1);
    const slope = Math.abs(p1 - p0);
    if (!Number.isFinite(slope) || slope <= 1e-12) {
        throw new Error("yScale must be linear with non-zero slope");
    }
    return slope;
}
function raisedCosineWindow(t, t0, t1, tau, smoothKernel) {
    if (t < t0 - tau || t > t1 + tau) {
        return 0;
    }
    if (t >= t0 && t <= t1) {
        return 1;
    }
    if (tau <= 0) {
        return t >= t0 && t <= t1 ? 1 : 0;
    }
    if (t < t0) {
        const u = clamp01((t - (t0 - tau)) / tau);
        if (smoothKernel === "cubic") {
            return 0.5 - 0.5 * Math.cos(Math.PI * u);
        }
    }
    const u = clamp01(((t1 + tau) - t) / tau);
    if (smoothKernel === "cubic") {
        return 0.5 - 0.5 * Math.cos(Math.PI * u);
    }
    return 0;
}
function robustTermScale(orderedLayers, tLength, roiSupport, term) {
    const values = [];
    const gapCount = Math.max(0, orderedLayers.length - 1);
    const tStart = roiSupport ? roiSupport.supportStart : 0;
    const tEnd = roiSupport ? roiSupport.supportEnd : Math.max(0, tLength - 1);
    for (let t = tStart; t <= tEnd; t += 1) {
        for (let k = 0; k < gapCount; k += 1) {
            if (term === "uncertainty") {
                values.push(boundaryUncertaintyAt(orderedLayers[k], orderedLayers[k + 1], t));
            }
            else {
                const slopeA = t > 0 ? Math.abs(orderedLayers[k].mean[t] - orderedLayers[k].mean[t - 1]) : 0;
                const slopeB = t > 0 ? Math.abs(orderedLayers[k + 1].mean[t] - orderedLayers[k + 1].mean[t - 1]) : 0;
                values.push(0.5 * (slopeA + slopeB));
            }
        }
    }
    if (values.length === 0) {
        return 1;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(0.9 * (sorted.length - 1))));
    return Math.max(1e-6, sorted[idx]);
}
function robustBoundaryThicknessScale(orderedLayers, tLength, roiSupport) {
    const values = [];
    const gapCount = Math.max(0, orderedLayers.length - 1);
    const tStart = roiSupport ? roiSupport.supportStart : 0;
    const tEnd = roiSupport ? roiSupport.supportEnd : Math.max(0, tLength - 1);
    for (let t = tStart; t <= tEnd; t += 1) {
        for (let k = 0; k < gapCount; k += 1) {
            const meanA = Math.max(0, orderedLayers[k].mean[t]);
            const meanB = Math.max(0, orderedLayers[k + 1].mean[t]);
            values.push(0.5 * (meanA + meanB));
        }
    }
    if (values.length === 0) {
        return 1;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(0.5 * (sorted.length - 1))));
    return Math.max(1e-6, sorted[idx]);
}
