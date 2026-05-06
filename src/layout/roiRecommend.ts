/**
 * ROI candidate scoring for quick analyst navigation.
 */
import type { PreparedDataset, ROI, RoiRecommendStrategy } from "../core/types";
import { range, sum } from "../core/utils";
import { layerUncertaintyAt } from "../core/validate";

export interface RoiCandidate {
  roi: ROI;
  score: number;
  label: string;
}

export function recommendRoiWindows(
  dataset: PreparedDataset,
  strategy: RoiRecommendStrategy,
  windowSize: number,
  topK = 6
): RoiCandidate[] {
  const span = Math.max(4, Math.min(dataset.times.length - 1, windowSize));
  const scored: RoiCandidate[] = [];

  for (let left = 0; left + span < dataset.times.length; left += Math.max(1, Math.floor(span / 4))) {
    const roi: ROI = { t0Index: left, t1Index: left + span };
    const score = scoreWindow(dataset, strategy, roi);
    scored.push({ roi, score, label: `${strategy} [${roi.t0Index}, ${roi.t1Index}]` });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

function scoreWindow(dataset: PreparedDataset, strategy: RoiRecommendStrategy, roi: ROI): number {
  if (strategy === "highest uncertainty") {
    let acc = 0;
    for (let t = roi.t0Index; t <= roi.t1Index; t += 1) {
      for (const layer of dataset.layers) {
        acc += layerUncertaintyAt(layer, t);
      }
    }
    return acc;
  }

  if (strategy === "highest mean slope") {
    let acc = 0;
    for (const layer of dataset.layers) {
      for (let t = roi.t0Index + 1; t <= roi.t1Index; t += 1) {
        acc += Math.abs(layer.mean[t] - layer.mean[t - 1]);
      }
    }
    return acc;
  }

  if (strategy === "highest wiggle") {
    let acc = 0;
    for (const layer of dataset.layers) {
      for (let t = roi.t0Index + 2; t <= roi.t1Index; t += 1) {
        const d2 = layer.mean[t] - 2 * layer.mean[t - 1] + layer.mean[t - 2];
        acc += d2 * d2;
      }
    }
    return acc;
  }

  const totals = range(roi.t0Index, roi.t1Index + 1).map((t) => sum(dataset.layers.map((layer) => layer.mean[t])));
  let change = 0;
  for (let i = 1; i < totals.length; i += 1) {
    change += Math.abs(totals[i] - totals[i - 1]);
  }
  return change;
}
