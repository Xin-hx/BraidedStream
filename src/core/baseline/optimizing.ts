import type { LayerInput, OptimizingBaselineMode } from "../types";
import { computeBaseline } from "./compute";
import { computeMultiscaleDistributedBaseline } from "./multiscale";
import type { SineStreamParams } from "./types";

export interface OptimizingBaselineResult {
  baseline: number[];
  multiscaleDiagnostics: ReturnType<typeof computeMultiscaleDistributedBaseline>["diagnostics"] | null;
}

export function computeOptimizingBaseline(
  times: number[],
  orderedLayers: LayerInput[],
  mode: OptimizingBaselineMode,
  hooks: SineStreamParams,
  waveStrength: number,
  energyThreshold = 0.08
): OptimizingBaselineResult {
  if (mode !== "multiscale") {
    return {
      baseline: computeBaseline(times, orderedLayers, mode, hooks),
      multiscaleDiagnostics: null
    };
  }

  const result = computeMultiscaleDistributedBaseline(
    times,
    orderedLayers,
    Math.max(0, waveStrength),
    hooks,
    energyThreshold
  );
  return {
    baseline: result.baseline,
    multiscaleDiagnostics: result.diagnostics
  };
}
