import { validateTimeLengths } from "../validate.js";
import { centeredBaselineFromLayers } from "./shared.js";
import { computeSineStreamBaseline } from "./sineStream.js";
import { computeWiggleBaseline } from "./wiggle.js";
/** Compute a baseline by the selected global baseline mode. */
export function computeBaseline(times, layers, mode, hooks = {}) {
    validateTimeLengths(times, layers);
    if (mode === "zero") {
        return new Array(times.length).fill(0);
    }
    if (mode === "center") {
        return centeredBaselineFromLayers(times.length, layers);
    }
    if (mode === "l1" || mode === "l2") {
        return computeWiggleBaseline(times.length, layers, mode, hooks);
    }
    return computeSineStreamBaseline(times.length, layers, hooks);
}
