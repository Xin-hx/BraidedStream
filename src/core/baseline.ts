import type { BaselineMode, LayerInput } from "./types";
import { validateTimeLengths } from "./validate";

export interface SineStreamHooks {
  smoothRadius?: number;
  gaussianSigma?: number;
  gaussianWeights?: number[];
}

export function computeBaseline(
  times: number[],
  layers: LayerInput[],
  mode: BaselineMode,
  hooks: SineStreamHooks = {}
): number[] {
  validateTimeLengths(times, layers);
  const totals = sumLayerMeans(times.length, layers);
  if (mode === "zero") {
    return new Array(times.length).fill(0);
  }
  const centered = totals.map((v) => -0.5 * v);
  if (mode === "center") {
    return centered;
  }
  return computeSineStreamBaseline(centered, hooks);
}

function sumLayerMeans(tLength: number, layers: LayerInput[]): number[] {
  const totals = new Array<number>(tLength).fill(0);
  for (const layer of layers) {
    for (let t = 0; t < tLength; t += 1) {
      totals[t] += layer.mean[t];
    }
  }
  return totals;
}

function computeSineStreamBaseline(centered: number[], hooks: SineStreamHooks): number[] {
  const tLength = centered.length;
  const radius = hooks.smoothRadius ?? 3;
  const sigma = hooks.gaussianSigma ?? Math.max(1, radius * 0.75);
  const edgeHook = defaultEdgeHook(tLength);
  const userHook = hooks.gaussianWeights;
  const blendHook =
    userHook && userHook.length === tLength
      ? userHook.map((v, i) => Math.max(0.05, v) * edgeHook[i])
      : edgeHook;

  const firstPass = gaussianSmooth(centered, radius, sigma, blendHook);
  const secondPass = gaussianSmooth(firstPass, Math.max(1, Math.floor(radius / 2)), Math.max(0.8, sigma * 0.8), blendHook);
  return secondPass;
}

function gaussianSmooth(values: number[], radius: number, sigma: number, hooks: number[]): number[] {
  if (radius <= 0) {
    return values.slice();
  }
  const out = new Array<number>(values.length).fill(0);
  for (let t = 0; t < values.length; t += 1) {
    let acc = 0;
    let weightAcc = 0;
    for (let d = -radius; d <= radius; d += 1) {
      const idx = clamp(t + d, 0, values.length - 1);
      const gaussian = Math.exp(-(d * d) / (2 * sigma * sigma));
      const weight = gaussian * hooks[idx];
      acc += values[idx] * weight;
      weightAcc += weight;
    }
    out[t] = weightAcc > 0 ? acc / weightAcc : values[t];
  }
  return out;
}

function defaultEdgeHook(tLength: number): number[] {
  if (tLength <= 1) {
    return [1];
  }
  const out = new Array<number>(tLength).fill(1);
  for (let i = 0; i < tLength; i += 1) {
    const s = Math.sin((Math.PI * (i + 0.5)) / tLength);
    out[i] = 0.35 + 0.65 * s * s;
  }
  return out;
}

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}
