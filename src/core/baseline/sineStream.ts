import type { LayerInput } from "../types";
import { median } from "../utils";
import { computeCenteredBaseline, computeLayerCenterFirstDifference, computeLayerHeightFirstDifference } from "./compute";
import type { BaselineParameters } from "./types";

/**
 * SineStream baseline computation using Gaussian-weighted adjustments.
 * Following: StreamLayout_2norm_Gauss from the SineStream paper.
 */
export function computeSineStreamBaseline(tLength: number, layers: LayerInput[], params: BaselineParameters): number[] {
  const centerType = params.centerType ?? "median";
  const baseline = new Array<number>(tLength).fill(0);
  const centeredBaseline = computeCenteredBaseline(tLength, layers);
  const heightFirstDifferences = computeLayerHeightFirstDifference(tLength, layers);
  const centerFirstDifferences = computeLayerCenterFirstDifference(tLength, layers);

  if (tLength === 0) {
    return baseline;
  }

  baseline[0] = centeredBaseline[0] ?? 0;

  for (let i = 1; i < tLength; i += 1) {
    const thicknessChanges = heightFirstDifferences[i].map((value) => Math.abs(value));
    const c = computeThicknessChangeMetric(thicknessChanges, centerType);
    const deltaG = computeGaussianWeightedAdjustment(layers, i, c, heightFirstDifferences[i], centerFirstDifferences[i]);
    baseline[i] = baseline[i - 1] + deltaG;
  }

  return baseline;
}

function computeThicknessChangeMetric(changes: number[], centerType: string): number {
  if (changes.length === 0) {
    return 1;
  }

  let curC = 1;
  let nonZeroCount = 0;

  switch (centerType) {
    case "median": {
      return median(changes);
    }
    case "geometric": {
      for (const value of changes) {
        if (value !== 0) {
          nonZeroCount += 1;
        }
      }
      if (nonZeroCount === 0) {
        return curC;
      }
      for (const value of changes) {
        if (value !== 0) {
          curC *= Math.pow(value, 1 / nonZeroCount);
        }
      }
      return curC;
    }
    case "harmonic": {
      curC = 0;
      for (const value of changes) {
        if (value !== 0) {
          curC += 1 / value;
          nonZeroCount += 1;
        }
      }
      if (nonZeroCount === 0 || curC === 0) {
        return 0;
      }
      return nonZeroCount / curC;
    }
    case "mean": {
      for (const value of changes) {
        if (value !== 0) {
          curC += value;
        }
      }
      return curC / changes.length;
    }
    default:
      return curC;
  }
}

function computeGaussianWeightedAdjustment(
  layers: LayerInput[],
  i: number,
  c: number,
  heightFirstDifferences: number[],
  centerFirstDifferences: number[]
): number {
  const n = layers.length;
  let numerator = 0;
  let denominator = 0;

  for (let j = 0; j < n; j += 1) {
    const Fi = layers[j].height[i];
    const dFi = heightFirstDifferences[j] ?? 0;
    const Qi = centerFirstDifferences[j] ?? 0;
    let gaussianWeight = 1;
    if (c !== 0 && Number.isFinite(c)) {
      gaussianWeight = Math.exp(-((dFi * dFi) / (2 * c * c)));
    }
    const contribution = gaussianWeight * Fi;
    denominator += contribution;
    numerator += contribution * Qi;
  }

  if (Number.isFinite(denominator) === false || Math.abs(denominator) <= 1e-12) {
    let totalSizePrev = 0;
    for (let j = 0; j < n; j += 1) {
      totalSizePrev += layers[j].height[i - 1];
    }
    return totalSizePrev / 2;
  }

  return -(numerator / denominator);
}
