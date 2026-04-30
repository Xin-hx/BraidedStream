export function runInvariantChecks(orderedLayers, base, braided, roi, options) {
    if (!options.enabled) {
        return { checked: false, violations: [], maxThicknessError: 0 };
    }
    const eps = options.epsilon ?? 1e-6;
    const maxMessages = options.maxMessages ?? 30;
    const tLength = base.baseline.length;
    const kLength = orderedLayers.length;
    const support = braided.roiSupport;
    const violations = [];
    let skipped = 0;
    let maxThicknessError = 0;
    const pushViolation = (message) => {
        if (violations.length < maxMessages) {
            violations.push(message);
        }
        else {
            skipped += 1;
        }
    };
    for (let k = 0; k < kLength; k += 1) {
        for (let t = 0; t < tLength; t += 1) {
            const thickness = braided.yTop[k][t] - braided.yBottom[k][t];
            const err = Math.abs(thickness - orderedLayers[k].mean[t]);
            maxThicknessError = Math.max(maxThicknessError, err);
            if (err > eps) {
                pushViolation(`A thickness mismatch at k=${k}, t=${t}, err=${err.toExponential(3)}`);
            }
        }
    }
    for (let t = 0; t < tLength; t += 1) {
        const outsideSupport = !support || t < support.supportStart || t > support.supportEnd;
        if (outsideSupport) {
            for (let k = 0; k < braided.gapsValue.length; k += 1) {
                if (Math.abs(braided.gapsValue[k][t]) > eps) {
                    pushViolation(`B non-zero gap outside ROI±tau at boundary=${k}, t=${t}`);
                }
            }
            for (let k = 0; k < kLength; k += 1) {
                const deltaBottom = Math.abs(braided.yBottom[k][t] - base.yBottom[k][t]);
                const deltaTop = Math.abs(braided.yTop[k][t] - base.yTop[k][t]);
                if (deltaBottom > eps || deltaTop > eps) {
                    pushViolation(`B y differs outside ROI±tau at k=${k}, t=${t}`);
                }
            }
        }
    }
    for (let t = 0; t < tLength; t += 1) {
        const sumGap = braided.sumGapPx[t] ?? 0;
        if (sumGap < -eps) {
            pushViolation(`B sumGap negative at t=${t}`);
        }
    }
    for (let t = 0; t < tLength; t += 1) {
        const outsideSupport = !support || t < support.supportStart || t > support.supportEnd;
        if (outsideSupport && Math.abs(braided.omega[t]) > eps) {
            pushViolation(`D omega not zero outside support at t=${t}`);
        }
    }
    for (let k = 0; k < kLength - 1; k += 1) {
        for (let t = 0; t < tLength; t += 1) {
            if (braided.yBottom[k + 1][t] + eps < braided.yTop[k][t]) {
                pushViolation(`C overlap at between k=${k} and k+1, t=${t}`);
            }
        }
    }
    for (let t = 0; t < tLength; t += 1) {
        const v = braided.omega[t];
        if (!Number.isFinite(v)) {
            pushViolation(`D omega is non-finite at t=${t}`);
        }
        else if (v < -eps || v > 1 + eps) {
            pushViolation(`D omega outside [0,1] at t=${t}: ${v.toFixed(4)}`);
        }
    }
    if (support) {
        const fullLeftRamp = support.coreStart - support.tau >= 0;
        const fullRightRamp = support.coreEnd + support.tau <= tLength - 1;
        if (fullLeftRamp && Math.abs(braided.omega[support.supportStart]) > eps) {
            pushViolation(`D omega at supportStart should be 0, t=${support.supportStart}`);
        }
        if (fullRightRamp && Math.abs(braided.omega[support.supportEnd]) > eps) {
            pushViolation(`D omega at supportEnd should be 0, t=${support.supportEnd}`);
        }
        if (Math.abs(braided.omega[support.coreStart] - 1) > eps) {
            pushViolation(`D omega at coreStart should be 1, t=${support.coreStart}`);
        }
        if (Math.abs(braided.omega[support.coreEnd] - 1) > eps) {
            pushViolation(`D omega at coreEnd should be 1, t=${support.coreEnd}`);
        }
        const maxOmegaDelta = support.tau > 0 ? 1.7 / support.tau : 1;
        for (let t = 1; t < tLength; t += 1) {
            const d = Math.abs(braided.omega[t] - braided.omega[t - 1]);
            if (d > maxOmegaDelta + 1e-3) {
                pushViolation(`D omega jump too large at t=${t}, delta=${d.toFixed(4)}`);
            }
        }
        const s0 = support.supportStart;
        const s1 = support.supportEnd;
        for (let k = 0; k < kLength; k += 1) {
            const deltaStart = braided.yBottom[k][s0] - base.yBottom[k][s0];
            const deltaEnd = braided.yBottom[k][s1] - base.yBottom[k][s1];
            if (fullLeftRamp && Math.abs(deltaStart) > eps) {
                pushViolation(`D delta at supportStart not zero at k=${k}, t=${s0}`);
            }
            if (fullRightRamp && Math.abs(deltaEnd) > eps) {
                pushViolation(`D delta at supportEnd not zero at k=${k}, t=${s1}`);
            }
            if (fullLeftRamp && s0 > 0) {
                const before = braided.yBottom[k][s0 - 1] - base.yBottom[k][s0 - 1];
                if (Math.abs(before) > eps) {
                    pushViolation(`D delta before supportStart not zero at k=${k}, t=${s0 - 1}`);
                }
            }
            if (fullRightRamp && s1 < tLength - 1) {
                const after = braided.yBottom[k][s1 + 1] - base.yBottom[k][s1 + 1];
                if (Math.abs(after) > eps) {
                    pushViolation(`D delta after supportEnd not zero at k=${k}, t=${s1 + 1}`);
                }
            }
        }
    }
    if (skipped > 0) {
        violations.push(`... and ${skipped} more violations`);
    }
    if (options.throwOnError && violations.length > 0) {
        throw new Error(violations.join("\n"));
    }
    return {
        checked: true,
        violations,
        maxThicknessError
    };
}
