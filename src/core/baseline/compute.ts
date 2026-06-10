import type { BaselineMode, LayerInput } from "../types";
import { validateTimeLengths } from "../validate";
import { computeSineStreamBaseline } from "./sineStream";
import type { BaselineParameters } from "./types";
import { computeWiggleBaseline } from "./measure";

export function sumLayerHeights(tLength: number, layers: LayerInput[]): number[] {
  const totals = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 0; t < tLength; t += 1) {
      totals[t] += layer.height[t];
    }
  }
  return totals;
}

// 计算中心对齐的基线，对应 silhouette 外轮廓上下边界平方和的最小值。
export function computeCenteredBaseline(tLength: number, layers: LayerInput[]): number[] {
  const totals = sumLayerHeights(tLength, layers);
  return totals.map((value) => -0.5 * value);
}


// 计算层高度的一阶差分。
export function computeLayerHeightFirstDifference(tLength: number, layers: LayerInput[]): number[][] {
  const offsets: number[][] = Array.from({ length: tLength }, () => []);
  if (tLength <= 1 || layers.length === 0) {
    return offsets;
  }

  for (const layer of layers) {
    for (let t = 1; t < tLength; t += 1) {
      offsets[t].push(layer.height[t] - layer.height[t - 1]);
    }
  }
  return offsets;
}

// 计算层中心线的一阶差分。
export function computeLayerCenterFirstDifference(tLength: number, layers: LayerInput[]): number[][] {
  // 创建结果容器，长度为 tLength，每个元素存储对应时间点的中心线差分值。
  const offsets: number[][] = Array.from({ length: tLength }, () => []);
  // 如果时间长度小于等于 1 或者没有层，直接返回空 offsets。
  if (tLength <= 1 || layers.length === 0) {
    return offsets;
  }

  // prefix 用于累计每个时间点之前层的高度总和，初始值为 0。
  const prefix = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 1; t < tLength; t += 1) {
      const centerNow = prefix[t] + 0.5 * layer.height[t];  // 当前时间点的层中心位置。
      const centerPrev = prefix[t - 1] + 0.5 * layer.height[t - 1];  // 前一个时间点的层中心位置。
      offsets[t].push(centerNow - centerPrev);  // offset = 一阶差分。
    }
    // 当前 layer 处理完成后，把它加入 prefix。
    for (let t = 0; t < tLength; t += 1) {
      prefix[t] += layer.height[t];
    }
  }
  return offsets;
}

/** Compute a baseline by the selected global baseline mode. */
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
    return computeCenteredBaseline(times.length, layers);
  }
  if (mode === "l1" || mode === "l2") {
    return computeWiggleBaseline(times.length, layers, mode, params);
  }
  return computeSineStreamBaseline(times.length, layers, params);
}
