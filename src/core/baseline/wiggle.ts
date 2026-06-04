import type { LayerInput } from "../types";
import { median } from "../math";
import type { SineStreamHooks } from "./types";
import { computeLayerCenterFirstDifference, computeCenterLine } from "./shared";

// 计算Wiggle
export function computeWiggleBaseline(
  tLength: number,
  layers: LayerInput[],
  mode: "l1" | "l2",
  params: SineStreamHooks
): number[] {
  if (mode === "l1") {
    return computeWiggleBaselineL1(tLength, layers, params);
  }
  // mode === "l2"
  return computeWiggleBaselineL2(tLength, layers, params);
}

export function computeWiggleBaselineL2(tLength: number, layers: LayerInput[], params: SineStreamHooks): number[] {
  const centers = computeCenterLine(tLength, layers);
  const offsets = computeLayerCenterFirstDifference(tLength, layers);
  const deltas = new Array<number>(tLength).fill(0);
  for (let t = 1; t < tLength; t += 1) {
    const arr = offsets[t];
    if (arr.length === 0) {
      deltas[t] = 0;
      continue;
    }
    let sum = 0;
    for (const v of arr) {
      sum += v;
    }
    deltas[t] = -(sum / arr.length);
  }

  const baseline = integrateBaselineFromDeltas(tLength, centers, deltas);
  return blendWithCenteredBaseline(baseline, centers, Math.max(0, params.wiggleWeightL2 ?? 1), params);
}

export function computeWiggleBaselineL1(tLength: number, layers: LayerInput[], hooks: SineStreamHooks): number[] {
  const centers = computeCenterLine(tLength, layers);
  const offsets = computeLayerCenterFirstDifference(tLength, layers);
  const deltas = new Array<number>(tLength).fill(0);

  const iterations = Math.max(1, Math.round(hooks.irlsIterations ?? 12));
  const eps = Math.max(1e-9, hooks.irlsEps ?? 1e-3);
  for (let t = 1; t < tLength; t += 1) {
    const arr = offsets[t];
    deltas[t] = arr.length === 0 ? 0 : -median(arr);
  }
  for (let it = 0; it < iterations; it += 1) {
    for (let t = 1; t < tLength; t += 1) {
      const arr = offsets[t];
      if (arr.length === 0) {
        deltas[t] = 0;
        continue;
      }
      let wSum = 0;
      let wdSum = 0;
      for (const d of arr) {
        const w = 1 / Math.max(eps, Math.abs(deltas[t] + d));
        wSum += w;
        wdSum += w * d;
      }
      if (wSum > 0) {
        deltas[t] = -(wdSum / wSum);
      }
    }
  }

  const baseline = integrateBaselineFromDeltas(tLength, centers, deltas);
  return blendWithCenteredBaseline(baseline, centers, Math.max(0, hooks.wiggleWeightL1 ?? 1), hooks);
}

function integrateBaselineFromDeltas(tLength: number, centers: number[], deltas: number[]): number[] {
  const baseline = new Array<number>(tLength).fill(0);
  baseline[0] = centers[0];
  for (let t = 1; t < tLength; t += 1) {
    baseline[t] = baseline[t - 1] + deltas[t];
  }
  return baseline;
}

function blendWithCenteredBaseline(
  baseline: number[],
  centers: number[],
  wiggleWeight: number,
  hooks: SineStreamHooks
): number[] {
  const anchor = Math.max(0, hooks.centerAnchorWeight ?? 0.35);
  const denom = wiggleWeight + anchor;
  if (denom <= 0) {
    return baseline;
  }
  return baseline.map((v, i) => (wiggleWeight * v + anchor * centers[i]) / denom);
}
