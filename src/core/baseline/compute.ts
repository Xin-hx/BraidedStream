import type { BaselineMode, LayerInput } from "../types";
import { validateTimeLengths } from "../validate";
import { centeredBaselineFromLayers } from "./shared";
import { computeSineStreamBaseline } from "./sineStream";
import type { BaselineHooks } from "./types";
import { computeWiggleBaseline } from "./wiggle";

/** Compute a baseline by the selected global baseline mode. */
export function computeBaseline(
  times: number[],
  layers: LayerInput[],
  mode: BaselineMode,
  hooks: BaselineHooks = {}
): number[] {
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
