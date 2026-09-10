/**
 * Synthetic forecast generator with known ground truth (METHOD.md M10).
 *
 * Gate A truth types (storyline §11 Evaluation A):
 *   c0..c3  consensus cluster   — shared mu baseline, small individual waves
 *   c4      wide coverage       — sigma inflated at all times
 *   c5      persistent outlier  — constant mu offset away from the cluster
 *   c6      transient deviation — mu offset + sigma spike in t in [45,75]
 *
 * Quantiles: q_p(t) = exp(mu_i(t) + sigma_i(t) * Phi^-1(p))  (lognormal)
 * => strictly positive, monotone in p by construction. Fixed seed (mulberry32)
 * makes every run bit-identical.
 */
import type { Layer, QuantileMatrix } from "./types";

const P = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975] as const;
const KEY: (keyof QuantileMatrix)[] = ["p025", "p10", "p25", "p50", "p75", "p90", "p975"];

export interface SyntheticSpec {
  tLen?: number;
  seed?: number;
}

/** mulberry32 PRNG (deterministic, 32-bit state). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal quantile (Acklam rational approximation, |z| < 1e-9). */
export function normalQuantile(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export interface SyntheticLayerSpec {
  id: string;
  base: number; // median level at t=0
  sigma0: number; // baseline log-sigma
  waveAmp: number; // individual wave amplitude (log)
  wavePhase: number; // individual wave phase (rad)
  muOffset?: number; // persistent offset (log)
  event?: {
    center: number;
    halfWidth: number;
    sigmaScale: number;
    muShift?: number;
  } | null;
  color?: string;
}

export const DEFAULT_LAYER_SPECS: SyntheticLayerSpec[] = [
  { id: "c0", base: 6.0, sigma0: 0.12, waveAmp: 0.10, wavePhase: 0.0, color: "#56B4E9" },
  { id: "c1", base: 6.2, sigma0: 0.12, waveAmp: 0.09, wavePhase: 0.4, color: "#0072B2", event: { center: 0.18, halfWidth: 0.12, sigmaScale: 7.0 } },
  { id: "c2", base: 5.8, sigma0: 0.12, waveAmp: 0.11, wavePhase: 0.8, color: "#009E73" },
  { id: "c3", base: 6.1, sigma0: 0.12, waveAmp: 0.10, wavePhase: 1.2, color: "#E69F00", event: { center: 0.38, halfWidth: 0.10, sigmaScale: 3.0 } },
  { id: "c4", base: 5.5, sigma0: 0.16, waveAmp: 0.08, wavePhase: 1.6, color: "#CC79A7", event: { center: 0.52, halfWidth: 0.14, sigmaScale: 5.0 } },
  { id: "c5", base: 7.0, sigma0: 0.12, waveAmp: 0.10, wavePhase: 2.0, muOffset: 0.55, color: "#D55E00" },
  { id: "c6", base: 6.0, sigma0: 0.12, waveAmp: 0.10, wavePhase: 2.4, event: { center: 0.82, halfWidth: 0.12, muShift: -0.35, sigmaScale: 8.0 }, color: "#F0E442" },
  { id: "c7", base: 5.7, sigma0: 0.11, waveAmp: 0.07, wavePhase: 2.8, color: "#000000" },
  // c8: THIN layer with HIGH uncertainty — breaks the "thick ⇔ uncertain"
  // correlation: tiny q50 (barely visible) but a very wide PI in [50,80],
  // i.e. high u where the layer is nearly invisible.
  { id: "c8", base: 1.3, sigma0: 0.18, waveAmp: 0.05, wavePhase: 3.2, color: "#8C8C8C", event: { center: 0.60, halfWidth: 0.14, sigmaScale: 9.0 } },
];

/** Shared median trend plus staggered, layer-local compact uncertainty pulses. */
export function generateSynthetic(spec: SyntheticSpec = {}): { layers: Layer[]; truth: string[] } {
  const tLen = spec.tLen ?? 120;
  const seed = spec.seed ?? 20260811;
  const rand = mulberry32(seed);

  // per-layer individual noise (deterministic draws)
  const jitter = DEFAULT_LAYER_SPECS.map(() => (rand() - 0.5) * 0.05);

  const layers: Layer[] = DEFAULT_LAYER_SPECS.map((ls, idx) => {
    const q: QuantileMatrix = {
      p025: [], p10: [], p25: [], p50: [], p75: [], p90: [], p975: [],
    };
    for (let t = 0; t < tLen; t += 1) {
      // log-median: shared gentle rise + individual wave + offsets
      const trend = 0.25 * (t / tLen) + 0.05 * Math.sin((2 * Math.PI * t) / tLen + 1.0);
      let mu =
        Math.log(ls.base) +
        trend * 0.6 +
        ls.waveAmp * Math.sin((2 * Math.PI * 2 * t) / tLen + ls.wavePhase) +
        jitter[idx] +
        (ls.muOffset ?? 0);
      // C-infinity compact support avoids rectangular shoulders and makes
      // calm states exact rather than asymptotic Gaussian tails.
      const tau = t / Math.max(1, tLen - 1);
      const pulse = ls.event ? compactBump(tau, ls.event.center, ls.event.halfWidth) : 0;
      mu += (ls.event?.muShift ?? 0) * pulse;
      let sigma = ls.sigma0 * (1 + (ls.event?.sigmaScale ?? 0) * pulse);
      sigma = Math.max(1e-3, sigma);
      for (let k = 0; k < P.length; k += 1) {
        const z = normalQuantile(P[k]);
        const v = Math.exp(mu + sigma * z);
        q[KEY[k]].push(v);
      }
    }
    return { id: ls.id, color: ls.color, magnitude: q.p50.slice(), sampleSize: q.p50.map(() => null), sourceKind: "quantile", q };
  });

  return {
    layers,
    truth: [
      "consensus cluster: c0,c1,c2,c3",
      "wide coverage: c4",
      "persistent outlier: c5",
      "staggered compact uncertainty events: c1,c3,c4,c6,c8",
      "transient deviation: c6 (late smooth compact pulse)",
      "thin layer, high uncertainty: c8 (middle smooth compact pulse)",
    ],
  };
}

function compactBump(x: number, center: number, halfWidth: number): number {
  const d = (x - center) / Math.max(Number.EPSILON, halfWidth);
  if (Math.abs(d) >= 1) return 0;
  return Math.exp(1 - 1 / (1 - d * d));
}
