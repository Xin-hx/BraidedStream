import type { BaselineMode, LayerInput } from "../types";
import { validateTimeLengths } from "../validate";
import { sumLayerMeans } from "./shared";
import { computeSineStreamBaseline } from "./sineStream";
import { computeWiggleBaseline } from "./wiggle";
import type { BaselineHooks } from "./types";

export * from "./types";
export { computeMultiscaleDistributedBaseline } from "./multiscale";

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
