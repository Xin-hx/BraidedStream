/**
 * Baseline layouts (METHOD.md M2.5).
 *
 *  - "wiggle": classic Byron-Wattenberg wiggle (uniform-weight L2 slope
 *    minimization), vertically centered.
 *
 *  - "sine": SineStream's Gaussian-weighted L2 baseline (Li et al., TVCG
 *    2021, DOI 10.1109/TVCG.2020.3030404; reference implementation in
 *    参考文献/SineStream/javascript/Layout_Ours.js). With a fixed layer
 *    order, the sine baseline IS the solution of a Gaussian-weighted L2
 *    optimization: each time step advances the baseline by
 *
 *        deltaG = - sum_j g_j * F_j * Q_j / sum_j g_j * F_j
 *
 *    where F_j = thickness of layer j at t, dF_j = F_j(t) - F_j(t-1),
 *    Q_j = sum_{k<j} dF_k + dF_j/2 (bottom + half of the layer's own
 *    change), and the Gaussian weight g_j = exp(-dF_j^2 / (2 c^2)) with
 *    c = median of |dF_j| across layers — layers whose thickness changes
 *    more than the typical scale get down-weighted. baseline[0] is centered.
 */
import type { BaseLayout, Layer } from "../types";

export type BaselineMode = "wiggle" | "sine";

export function computeWiggleBaseline(layers: Layer[], order: string[]): BaseLayout {
  const n = order.length;
  const tLen = (layers[0].magnitude ?? layers[0].q.p50).length;
  const m = order.map((id) => layers.find((l) => l.id === id)!.magnitude ?? layers.find((l) => l.id === id)!.q.p50);

  const yBottom: number[][] = Array.from({ length: n }, () => new Array<number>(tLen));
  const yTop: number[][] = Array.from({ length: n }, () => new Array<number>(tLen));
  const total = new Array<number>(tLen);

  for (let t = 0; t < tLen; t += 1) {
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      yBottom[i][t] = acc;
      acc += m[i][t];
      yTop[i][t] = acc;
    }
    total[t] = acc;
  }

  const c = new Array<number>(tLen).fill(0);
  for (let t = 0; t + 1 < tLen; t += 1) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      const w = m[i][t] + m[i][t + 1];
      num += w * (yBottom[i][t + 1] - yBottom[i][t]);
      den += w;
    }
    c[t + 1] = c[t] - (den > 0 ? num / den : 0);
  }

  // center: shift so that (min of baseline, max of baseline+total) is symmetric about 0
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = 0; t < tLen; t += 1) {
    if (c[t] < lo) lo = c[t];
    if (c[t] + total[t] > hi) hi = c[t] + total[t];
  }
  const shift = -(lo + hi) / 2;
  const baseline = c.map((v) => v + shift);

  for (let t = 0; t < tLen; t += 1) {
    for (let i = 0; i < n; i += 1) {
      yBottom[i][t] += baseline[t];
      yTop[i][t] += baseline[t];
    }
  }
  return { baseline, yBottom, yTop };
}

/** SineStream Gaussian-weighted L2 baseline. */
export function computeSineBaseline(
  layers: Layer[],
  order: string[],
  cType: "median" | "mean" | "geometric" | "harmonic" = "median"
): BaseLayout {
  const n = order.length;
  const tLen = (layers[0].magnitude ?? layers[0].q.p50).length;
  const m = order.map((id) => layers.find((l) => l.id === id)!.magnitude ?? layers.find((l) => l.id === id)!.q.p50);

  const yBottom: number[][] = Array.from({ length: n }, () => new Array<number>(tLen));
  const yTop: number[][] = Array.from({ length: n }, () => new Array<number>(tLen));
  for (let t = 0; t < tLen; t += 1) {
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      yBottom[i][t] = acc;
      acc += m[i][t];
      yTop[i][t] = acc;
    }
  }

  const baseline = new Array<number>(tLen).fill(0);
  // t=0 centered (SineStream: baseline[0] = -total/2)
  let total0 = 0;
  for (let i = 0; i < n; i += 1) total0 += m[i][0];
  baseline[0] = -total0 / 2;

  for (let t = 1; t < tLen; t += 1) {
    const dF = new Array<number>(n);
    for (let i = 0; i < n; i += 1) dF[i] = m[i][t] - m[i][t - 1];

    // c = scale of thickness change (aggregate of |dF|)
    const c = aggregateAbs(dF, cType);

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      // Q_j = sum_{k<=j} 2*dF_k - dF_j over 2 = cumulative bottom + half own change
      let cum = 0;
      for (let k = 0; k <= i; k += 1) cum += 2 * dF[k];
      const Q = (cum - dF[i]) / 2;
      const g = c > 0 ? Math.exp(-(dF[i] * dF[i]) / (2 * c * c)) : 1;
      const cur = g * m[i][t];
      den += cur;
      num += cur * Q;
    }
    if (den === 0) {
      let tot = 0;
      for (let i = 0; i < n; i += 1) tot += m[i][t - 1];
      baseline[t] = baseline[t - 1] + tot / 2;
    } else {
      baseline[t] = baseline[t - 1] - num / den;
    }
  }

  for (let t = 0; t < tLen; t += 1) {
    for (let i = 0; i < n; i += 1) {
      yBottom[i][t] += baseline[t];
      yTop[i][t] += baseline[t];
    }
  }
  return { baseline, yBottom, yTop };
}

function aggregateAbs(values: number[], cType: "median" | "mean" | "geometric" | "harmonic"): number {
  const abs = values.map((v) => Math.abs(v));
  if (cType === "mean") {
    return abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length);
  }
  if (cType === "geometric") {
    const pos = abs.filter((v) => v > 0);
    if (pos.length === 0) return 0;
    return Math.exp(pos.reduce((a, b) => a + Math.log(b), 0) / pos.length);
  }
  if (cType === "harmonic") {
    const pos = abs.filter((v) => v > 0);
    if (pos.length === 0) return 0;
    return pos.length / pos.reduce((a, b) => a + 1 / b, 0);
  }
  // median
  const sorted = abs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
