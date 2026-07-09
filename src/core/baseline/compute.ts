import type { BaselineMode, LayerInput } from "../types";
import type { StackLayout } from "../types";
import { validateTimeLengths } from "../validate";
import { computeSineStreamBaseline } from "./sineStream";
import type { BaselineParameters } from "./types";
import { median } from "../utils";
import { computeMultiscaleDistributedBaseline } from "./multiscale";

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

export interface OptimizingBaselineResult {
  baseline: number[];
  multiscaleDiagnostics: ReturnType<typeof computeMultiscaleDistributedBaseline>["diagnostics"] | null;
}

export function computeOptimizingBaseline(
  times: number[],
  orderedLayers: LayerInput[],
  mode: BaselineMode | "multiscale",
  hooks: BaselineParameters,
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


/** Compute a baseline by the selected wiggle mode. */
export function computeWiggleBaseline(
  tLength: number,
  layers: LayerInput[],
  mode: "l1" | "l2",
  params: BaselineParameters
): number[] {
  if (mode === "l1") {
    return computeWiggleBaselineL1(tLength, layers, params);
  }
  return computeWiggleBaselineL2(tLength, layers, params);
}

export function computeWiggleBaselineL2(tLength: number, layers: LayerInput[], params: BaselineParameters): number[] {
  const baseline = params.weightedWiggle
    ? computeWeightedWiggleBaselineL2(tLength, layers)
    : computeUnweightedWiggleBaselineL2(tLength, layers);
  return blendWithCenteredBaseline(
    baseline,
    computeCenteredBaseline(tLength, layers),
    Math.max(0, params.wiggleWeightL2 ?? 1),
    params
  );
}

export function computeUnweightedWiggleBaselineL2(tLength: number, layers: LayerInput[]): number[] {
  const n = layers.length;
  const baseline = new Array<number>(tLength).fill(0);
  for (let t = 0; t < tLength; t += 1) {
    let acc = 0;
    for (let j = 0; j < n; j += 1) {
      acc += (n - j) * layers[j].height[t];
    }
    baseline[t] = -(acc / (n + 1));
  }
  return baseline;
}

export function computeWeightedWiggleBaselineL2(tLength: number, layers: LayerInput[]): number[] {
  const centers = computeCenteredBaseline(tLength, layers);
  const offsets = computeLayerCenterFirstDifference(tLength, layers);
  const deltas = new Array<number>(tLength).fill(0);
  for (let t = 1; t < tLength; t += 1) {
    const arr = offsets[t];
    if (arr.length === 0) {
      deltas[t] = 0;
      continue;
    }
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < layers.length; i += 1) {
      const weight = layers[i].height[t];
      numerator += weight * (arr[i] ?? 0);
      denominator += weight;
    }
    deltas[t] = Math.abs(denominator) <= 1e-12 ? 0 : -(numerator / denominator);
  }

  return integrateBaselineFromDeltas(tLength, centers, deltas);
}

export function computeWiggleBaselineL1(tLength: number, layers: LayerInput[], hooks: BaselineParameters): number[] {
  const centers = computeCenteredBaseline(tLength, layers);
  const offsets = computeLayerCenterFirstDifference(tLength, layers);
  const deltas = new Array<number>(tLength).fill(0);
  const weighted = hooks.weightedWiggle === true;

  const iterations = Math.max(1, Math.round(hooks.irlsIterations ?? 12));
  const eps = Math.max(1e-9, hooks.irlsEps ?? 1e-3);
  for (let t = 1; t < tLength; t += 1) {
    const arr = offsets[t];
    deltas[t] = arr.length === 0 ? 0 : -(weighted ? weightedMedian(arr, layers.map((layer) => layer.height[t] ?? 0)) : median(arr));
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
      for (let i = 0; i < arr.length; i += 1) {
        const d = arr[i];
        const baseWeight = weighted ? Math.max(0, layers[i]?.height[t] ?? 0) : 1;
        if (baseWeight <= 0) {
          continue;
        }
        const w = baseWeight / Math.max(eps, Math.abs(deltas[t] + d));
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

function weightedMedian(values: number[], weights: number[]): number {
  const pairs = values
    .map((value, index) => ({ value, weight: Math.max(0, weights[index] ?? 0) }))
    .filter((item) => Number.isFinite(item.value) && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  const total = pairs.reduce((acc, item) => acc + item.weight, 0);
  if (total <= 0) {
    return median(values);
  }
  let acc = 0;
  for (const item of pairs) {
    acc += item.weight;
    if (acc >= total / 2) {
      return item.value;
    }
  }
  return pairs[pairs.length - 1].value;
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
  hooks: BaselineParameters
): number[] {
  const anchor = Math.max(0, hooks.centerAnchorWeight ?? 0);
  const denom = wiggleWeight + anchor;
  if (denom <= 0) {
    return baseline;
  }
  return baseline.map((v, i) => (wiggleWeight * v + anchor * centers[i]) / denom);
}
