import { validateTimeLengths } from "../validate.js";
import { sumLayerMeans } from "./shared.js";
import { computeSineStreamBaseline } from "./sineStream.js";
import { computeWiggleBaseline } from "./wiggle.js";
export * from "./types.js";
export { computeMultiscaleDistributedBaseline } from "./multiscale.js";
/** Compute a baseline by the selected global baseline mode. */
export function computeBaseline(times, layers, mode, hooks = {}) {
    validateTimeLengths(times, layers);
    if (mode === "zero") {
        return new Array(times.length).fill(0);
    }
    if (mode === "center") {
        const totals = sumLayerMeans(times.length, layers);
        return totals.map((v) => -0.5 * v);
    }
    if (mode === "l2") {
        return computeWiggleBaseline(times.length, layers, "l2", hooks);
    }
    if (mode === "l1") {
        return computeWiggleBaseline(times.length, layers, "l1", hooks);
    }
    return computeSineStreamBaseline(times.length, layers, hooks);
}
