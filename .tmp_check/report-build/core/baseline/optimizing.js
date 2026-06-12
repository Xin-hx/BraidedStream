import { computeBaseline } from "./compute.js";
import { computeMultiscaleDistributedBaseline } from "./multiscale.js";
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
