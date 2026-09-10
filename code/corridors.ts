/**
 * Compact event gates, explicit adjacent seams, and supremum budget retention.
 *
 * For adjacent stack layers j and j+1:
 *   g_i(t) = smoothstep(close, open, u_i(t))
 *   a_i^req(t) = a_max u_i(t)^gamma g_i(t)
 *   d_j^req(t) = a_j^req(t) + a_{j+1}^req(t)
 *                + clearance max(g_j(t), g_{j+1}(t))
 *
 * The displayed seam is d_j(t)=rho(t)d_j^req(t). Building final offsets by
 * cumulative d_j makes the seam exact by construction, including exact zero
 * outside compact event support.
 */
import type {
  BaseLayout,
  BraidedLayout,
  EncodingMode,
  RequestedCorridors,
} from "./types";

export interface RequestOptions {
  gateClose: number;
  gateOpen: number;
  aMax: number;
  clearance: number;
  gamma: number;
  encoding: EncodingMode;
  fMin: number;
  fMax: number;
  layerOverride?: Record<string, boolean> | null;
}

/** Quintic C2 compact smootherstep: exactly 0/1 outside the shared transition. */
export function eventGate(u: number, close: number, open: number): number {
  if (u <= close) return 0;
  if (u >= open) return 1;
  const z = (u - close) / Math.max(Number.EPSILON, open - close);
  return z * z * z * (z * (z * 6 - 15) + 10);
}

export function requestCorridors(
  layers: { id: string }[],
  u: number[][],
  opts: RequestOptions
): RequestedCorridors {
  const n = layers.length;
  const tLen = u[0].length;
  const span = Math.max(1, tLen - 1);
  const fMax = Math.min(opts.fMax, tLen / 8);
  const gate = Array.from({ length: n }, () => new Array<number>(tLen));
  const aReq = Array.from({ length: n }, () => new Array<number>(tLen));
  const ampConst = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    const override = opts.layerOverride?.[layers[i].id];
    const meanU = u[i].reduce((sum, value) => sum + value, 0) / tLen;
    ampConst[i] = opts.aMax * meanU;
    for (let t = 0; t < tLen; t += 1) {
      const g = override === undefined ? eventGate(u[i][t], opts.gateClose, opts.gateOpen) : Number(override);
      gate[i][t] = g;
      const amplitude = opts.encoding === "frequency"
        ? ampConst[i]
        : opts.aMax * Math.pow(u[i][t], opts.gamma);
      aReq[i][t] = amplitude * g;
    }
  }

  const seamReq = Array.from({ length: Math.max(0, n - 1) }, () => new Array<number>(tLen));
  for (let j = 0; j + 1 < n; j += 1) {
    for (let t = 0; t < tLen; t += 1) {
      const seamGate = Math.max(gate[j][t], gate[j + 1][t]);
      seamReq[j][t] = aReq[j][t] + aReq[j + 1][t] + opts.clearance * seamGate;
    }
  }

  const freq = Array.from({ length: n }, () => new Array<number>(tLen));
  const theta = Array.from({ length: n }, () => new Array<number>(tLen));
  for (let i = 0; i < n; i += 1) {
    let phase = 0;
    for (let t = 0; t < tLen; t += 1) {
      const f = opts.encoding === "amplitude" ? opts.fMin : opts.fMin + (fMax - opts.fMin) * u[i][t];
      freq[i][t] = f;
      theta[i][t] = phase;
      phase += (2 * Math.PI * f) / span;
    }
  }

  return { aReq, gate, seamReq, window: gate, freq, theta, ampConst };
}

/** Retain the maximum feasible common request ratio at every time step. */
export function allocateBudget(
  aReq: number[][],
  seamReq: number[][],
  budgetEta: number,
  h0: number[]
): { rho: number[]; aAlloc: number[][]; seam: number[][] } {
  const tLen = h0.length;
  const rho = new Array<number>(tLen);
  for (let t = 0; t < tLen; t += 1) {
    let requestedExtra = 0;
    for (const row of seamReq) requestedExtra += row[t];
    const feasibleExtra = Math.max(0, budgetEta * h0[t] - h0[t]);
    rho[t] = requestedExtra > 0 ? Math.min(1, feasibleExtra / requestedExtra) : 1;
  }
  return {
    rho,
    aAlloc: aReq.map((row) => row.map((value, t) => value * rho[t])),
    seam: seamReq.map((row) => row.map((value, t) => value * rho[t])),
  };
}

/** Build q50-exact layers from explicit adjacent displayed seams. */
export function buildBraidedGeometry(
  base: BaseLayout,
  aAlloc: number[][],
  seam: number[][],
  gate: number[][],
  rho: number[]
): BraidedLayout {
  const n = base.yBottom.length;
  const tLen = base.baseline.length;
  const s = Array.from({ length: n }, () => new Array<number>(tLen));
  const totalHeight = new Array<number>(tLen);

  for (let t = 0; t < tLen; t += 1) {
    let cumulative = 0;
    let mean = 0;
    for (let i = 0; i < n; i += 1) {
      s[i][t] = cumulative;
      mean += cumulative;
      if (i + 1 < n) cumulative += seam[i][t];
    }
    mean /= n;
    for (let i = 0; i < n; i += 1) s[i][t] -= mean;
    totalHeight[t] = base.yTop[n - 1][t] - base.yBottom[0][t] + cumulative;
  }

  const yBottomStar = Array.from({ length: n }, () => new Array<number>(tLen));
  const yTopStar = Array.from({ length: n }, () => new Array<number>(tLen));
  const envelopeLow = Array.from({ length: n }, () => new Array<number>(tLen));
  const envelopeHigh = Array.from({ length: n }, () => new Array<number>(tLen));
  const o = Array.from({ length: n }, () => new Array<number>(tLen).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let t = 0; t < tLen; t += 1) {
      yBottomStar[i][t] = base.yBottom[i][t] + s[i][t];
      yTopStar[i][t] = base.yTop[i][t] + s[i][t];
      envelopeLow[i][t] = yBottomStar[i][t] - aAlloc[i][t];
      envelopeHigh[i][t] = yTopStar[i][t] + aAlloc[i][t];
    }
  }

  const components: number[][] = [];
  for (let t = 0; t < tLen; t += 1) {
    const atTime: number[] = [];
    let edges = 0;
    for (let j = 0; j + 1 < n; j += 1) {
      if (gate[j][t] > 0 || gate[j + 1][t] > 0) edges += 1;
      else if (edges > 0) {
        atTime.push(edges + 1);
        edges = 0;
      }
    }
    if (edges > 0) atTime.push(edges + 1);
    components.push(atTime);
  }

  return {
    yBottomStar,
    yTopStar,
    s,
    o,
    aAlloc,
    seam,
    rho,
    totalHeight,
    components,
    envelopeLow,
    envelopeHigh,
  };
}
