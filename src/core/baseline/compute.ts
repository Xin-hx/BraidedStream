import type { BaselineMode, LayerInput } from "../types";
import { validateTimeLengths } from "../validate";
import { computeSineStreamBaseline } from "./sineStream";
import type { BaselineParameters } from "./types";
import { computeWiggleBaseline } from "./wiggle";

/** Compute a baseline by the selected global baseline mode. */
// 根据选择的模式，计算基线（y_bottom）
export function computeBaseline(
  times: number[],
  layers: LayerInput[],
  mode: BaselineMode,
  params: BaselineParameters = {}
): number[] {
  validateTimeLengths(times, layers);

  if (mode === "zero") {
    return new Array(times.length).fill(0);
  }
  if (mode === "center") {
    return computeCenterLine(times.length, layers);
  }
  if (mode === "l1" || mode === "l2") {
    return computeWiggleBaseline(times.length, layers, mode, params);
  }
  return computeSineStreamBaseline(times.length, layers, params);
}


// 计算t个时间点上各层的总高度，return 长度为t的数组，每个元素是对应时间点上各层高度之和
export function sumLayerHeights(tLength: number, layers: LayerInput[]): number[] {
  const totals = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 0; t < tLength; t += 1) {
      totals[t] += layer.height[t];
    }
  }
  return totals;
}

// 计算河流中心线（center line），return 长度为t的数组，每个元素是对应时间点上各层高度之和的负一半，即中心线位置
export function computeCenterLine(tLength: number, layers: LayerInput[]): number[] {
  const totals = sumLayerHeights(tLength, layers);
  return totals.map((v) => -0.5 * v);
}

// 河流每一层的中心线的一阶差分，即每层中心线在相邻时间点上的变化量，return 长度为t的数组，每个元素是对应时间点上各层中心线的一阶差分数组
export function computeLayerCenterFirstDifference(tLength: number, layers: LayerInput[]): number[][] {
  const offsets: number[][] = Array.from({ length: tLength }, () => []);
  if (tLength <= 1 || layers.length === 0) {
    return offsets;
  }
  const prefix = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 1; t < tLength; t += 1) {
      const centerNow = prefix[t] + 0.5 * layer.height[t];
      const centerPrev = prefix[t - 1] + 0.5 * layer.height[t - 1];
      offsets[t].push(centerNow - centerPrev);
    }
    for (let t = 0; t < tLength; t += 1) {
      prefix[t] += layer.height[t];
    }
  }
  return offsets;  // offsets[t][layerIndex]
}
