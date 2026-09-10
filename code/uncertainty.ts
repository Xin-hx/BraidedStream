/**
 * Category-internal uncertainty (METHOD.md M3).
 *
 *   w_i(t) = Q_i(t, p_high) - Q_i(t, p_low)      (interval width, default 80% PI)
 *   u_i(t) = w_i(t) / max_tau w_i(tau)           (per-layer normalization)
 *          = w_i(t) / max_{j,tau} w_j(tau)       (global normalization, optional)
 *
 * u is defined on widths only — it never divides by q50, so q50≈0 layers are safe.
 */
import type { Layer, UncertaintyOptions, UncertaintyResult } from "./types";

export function computeUncertainty(layers: Layer[], options: UncertaintyOptions): UncertaintyResult {
  const lowKey = options.lowKey ?? "p10";
  const highKey = options.highKey ?? "p90";
  const normalize = options.normalize ?? "global";
  const smoothWindow = Math.max(0, Math.round(options.smoothWindow ?? 0));

  const tLen = layers[0].q.p50.length;
  const width: number[][] = layers.map((layer) => {
    const lo = layer.q[lowKey];
    const hi = layer.q[highKey];
    const out = new Array<number>(tLen);
    for (let t = 0; t < tLen; t += 1) {
      const w = hi[t] - lo[t];
      out[t] = w > 0 ? w : 0;
    }
    return out;
  });

  let scale = 0;
  if (normalize === "per-layer") {
    for (const w of width) {
      for (let t = 0; t < tLen; t += 1) if (w[t] > scale) scale = w[t];
    }
    // per-layer: scale is the max width of THIS layer
    const u = width.map((w) => {
      let wMax = 0;
      for (let t = 0; t < tLen; t += 1) if (w[t] > wMax) wMax = w[t];
      const s = wMax > 0 ? wMax : 1;
      return w.map((v) => v / s);
    });
    return { width, u: smoothAll(u, smoothWindow) };
  }
  // global
  for (const w of width) for (let t = 0; t < tLen; t += 1) if (w[t] > scale) scale = w[t];
  const s = scale > 0 ? scale : 1;
  const u = width.map((w) => w.map((v) => v / s));
  return { width, u: smoothAll(u, smoothWindow) };
}

/** Zero-phase (centered) moving average; window=0 returns input unchanged. */
export function smoothSeries(values: number[], window: number): number[] {
  if (window <= 1 || values.length < 3) return values.slice();
  const n = values.length;
  const out = new Array<number>(n);
  const half = Math.floor(window / 2);
  for (let t = 0; t < n; t += 1) {
    let sum = 0;
    let cnt = 0;
    const a = Math.max(0, t - half);
    const b = Math.min(n - 1, t + half);
    for (let k = a; k <= b; k += 1) {
      sum += values[k];
      cnt += 1;
    }
    out[t] = sum / cnt;
  }
  return out;
}

function smoothAll(u: number[][], window: number): number[][] {
  if (window <= 1) return u;
  return u.map((series) => smoothSeries(series, window));
}
