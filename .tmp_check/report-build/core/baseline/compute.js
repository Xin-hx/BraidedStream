import { validateTimeLengths } from "../validate";
import { centeredBaselineFromLayers } from "./shared";
import { computeSineStreamBaseline } from "./sineStream";
import { computeWiggleBaseline } from "./wiggle";
/** Compute a baseline by the selected global baseline mode. */
// 根据选择的模式，计算基线（y_bottom）
export function computeBaseline(times, layers, mode, params = {}) {
    validateTimeLengths(times, layers);
    if (mode === "zero") {
        return new Array(times.length).fill(0);
    }
    if (mode === "center") {
        return centeredBaselineFromLayers(times.length, layers);
    }
    if (mode === "l1" || mode === "l2") {
        return computeWiggleBaseline(times.length, layers, mode, params);
    }
    return computeSineStreamBaseline(times.length, layers, params);
}
