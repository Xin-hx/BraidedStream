/**
 * PID-lite: probabilistic inclusion depth proxy (METHOD.md M2).
 *
 * Adapted from the IntervalPidCalculator math in the legacy Vue workbench
 * (Code/src/core/ordering/pid.ts). This is a reproducible proxy for
 * probabilistic inclusion depth [61], NOT a faithful re-implementation —
 * Gate A validation is required before the paper may claim more.
 *
 *   D_i = mean over t of (width-penalized fraction of other layers whose
 *         [Q_j(.10), Q_j(.90)] band contains Q_i(.50))
 *
 * Ordering: inside-out (deepest in the middle), classic streamgraph style.
 */
import type { Layer, PidResult } from "./types";

export function computePid(layers: Layer[]): PidResult {
  const n = layers.length;
  const tLen = n > 0 ? layers[0].q.p50.length : 0;
  const depth: Record<string, number> = {};
  const depthSeries: Record<string, number[]> = {};

  for (let i = 0; i < n; i += 1) {
    const series = new Array<number>(tLen).fill(0);
    let sum = 0;
    let valid = 0;
    for (let t = 0; t < tLen; t += 1) {
      const center = layers[i].q.p50[t];
      if (!Number.isFinite(center)) continue;

      // median width of other layers at t (for width penalty)
      const widths: number[] = [];
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const w = layers[j].q.p90[t] - layers[j].q.p10[t];
        if (Number.isFinite(w)) widths.push(w > 0 ? w : 0);
      }
      if (widths.length < 2) continue;
      const wMed = median(widths);
      if (wMed <= 0) continue;

      let covered = 0;
      let total = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const lo = layers[j].q.p10[t];
        const hi = layers[j].q.p90[t];
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
        const w = hi - lo;
        const weight = 1 / (1 + (w > 0 ? w : 0) / wMed); // width-penalty
        total += weight;
        if (center >= lo && center <= hi) covered += weight;
      }
      if (total <= 1e-12) continue;
      series[t] = covered / total;
      sum += series[t];
      valid += 1;
    }
    depth[layers[i].id] = valid > 0 ? sum / valid : 0;
    depthSeries[layers[i].id] = series;
  }

  // inside-out order: sort by depth desc, then place ranks from the center
  // outward (classic streamgraph order: deepest layers in the middle).
  const sorted = layers
    .map((l) => ({ id: l.id, d: depth[l.id] }))
    .sort((a, b) => (b.d !== a.d ? b.d - a.d : a.id.localeCompare(b.id)));

  const nOrder = sorted.length;
  const order = new Array<string>(nOrder);
  const mid = Math.floor(nOrder / 2);
  let rank = 0;
  for (let k = 0; k < nOrder && rank < nOrder; k += 1) {
    const pos = k % 2 === 0 ? mid - 1 - Math.floor(k / 2) : mid + Math.floor(k / 2);
    if (pos >= 0 && pos < nOrder) {
      order[pos] = sorted[rank].id;
      rank += 1;
    }
  }
  // odd n: the farthest right position is filled by the last rank
  for (let pos = 0; pos < nOrder && rank < nOrder; pos += 1) {
    if (order[pos] === undefined) {
      order[pos] = sorted[rank].id;
      rank += 1;
    }
  }

  return { depth, order };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
