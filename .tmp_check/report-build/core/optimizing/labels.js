export function orderingScoringLabel(mode) {
    if (mode === "input") {
        return "Original order";
    }
    if (mode === "insideOut") {
        return "Inside-out";
    }
    if (mode === "sineStream") {
        return "SineStream";
    }
    if (mode === "pidMean") {
        return "PID";
    }
    if (mode === "pidTimeWeighted") {
        return "PID + time trend";
    }
    return "One-way inclusion";
}
export function optimizingStageLabel(stage) {
    if (stage === "plainStream") {
        return "Plain stream";
    }
    if (stage === "stackedGeometry") {
        return "Stacked Graphs geometry/aesthetics";
    }
    if (stage === "sineStream") {
        return "SineStream readability";
    }
    if (stage === "tpidMultiscale") {
        return "TPID + multiscale";
    }
    return "Custom";
}
export function optimizingBaselineModeLabel(mode) {
    if (mode === "zero") {
        return "Zero";
    }
    if (mode === "center") {
        return "Centered";
    }
    if (mode === "l1") {
        return "L1";
    }
    if (mode === "l2") {
        return "L2";
    }
    if (mode === "sineStream") {
        return "SineStream";
    }
    return "Multiscale";
}
