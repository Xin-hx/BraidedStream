/**
 * StreamGraph用于优化"measures of distortion"
 * 这个文件包含若干distortion measurements，包括Silhouette、Wiggle
 */

import type { LayerInput, StackLayout } from "../types";
import { median } from "../utils";
import type { SineStreamParams } from "./types";
import { computeLayerCenterFirstDifference, computeCenteredBaseline } from "./compute";


// Silhouette的计算：仅看整体上界和下界； silhouette(0) = (g_0)^2 + （g_n)^2
// Silhouette energy only depends on the final outer envelope:
// silhouette(t) = bottom_0(t)^2 + top_n(t)^2.
export function computeSilhouette(layout: StackLayout): number {
  const layerCount = layout.yBottom.length;
  if (layerCount === 0) {
    return 0;
  }

  const tLength = layout.baseline.length;
  const bottom = layout.yBottom[0];
  const top = layout.yTop[layerCount - 1];
  let silhouette = 0;
  for (let t = 0; t < tLength; t += 1) {
    const g0 = bottom[t] ?? 0;
    const gn = top[t] ?? 0;
    silhouette += g0 * g0 + gn * gn;
  }
  return silhouette;
}



// 计算Wiggle的选择器
// 参数：类型（L1 or L2），权重，IRLS迭代次数和epsilon
export function computeWiggleBaseline(
  tLength: number,
  layers: LayerInput[],
  mode: "l1" | "l2",
  params: SineStreamParams
): number[] {
  if (mode === "l1") {
    return computeWiggleBaselineL1(tLength, layers, params);
  }
  // mode === "l2"
  return computeWiggleBaselineL2(tLength, layers, params);
}

export function computeWiggleBaselineL2(tLength: number, layers: LayerInput[], params: SineStreamParams): number[] {
  const centers = computeCenteredBaseline(tLength, layers);
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

export function computeWiggleBaselineL1(tLength: number, layers: LayerInput[], hooks: SineStreamParams): number[] {
  const centers = computeCenteredBaseline(tLength, layers);
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
  hooks: SineStreamParams
): number[] {
  const anchor = Math.max(0, hooks.centerAnchorWeight ?? 0.35);
  const denom = wiggleWeight + anchor;
  if (denom <= 0) {
    return baseline;
  }
  return baseline.map((v, i) => (wiggleWeight * v + anchor * centers[i]) / denom);
}
