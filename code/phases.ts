/**
 * Phase optimization (METHOD.md M8). Two deterministic strategies:
 *
 *  - "sine": analytical anti-phase — phi alternates by pi along the stack
 *    order, so adjacent layers move opposite. O(n), zero iteration.
 *
 *  - "l2": coordinate descent minimizing
 *      E(phi) = lc * sum_t sum_<i,i+1> max(0, delta - gap_ij(t))^2
 *             + ls * sum_i sum_t (o_i(t) - o_i(t-1))^2
 *    where gaps use the ENVELOPE thickness (m_i + 2*a_i, incl. clearance),
 *    i.e. the spread layer's total thickness including gaps. Fixed rounds
 *    and grid points make the result deterministic.
 *
 * Only phi is optimized; amplitudes/frequencies stay driven by u, so the
 * optimizer never alters the uncertainty encoding semantics.
 */
import type { BaseLayout, CorridorOptions, PhaseOptimizerResult } from "./types";

export interface PhaseEvalContext {
  base: BaseLayout;
  /** allocated amplitude (stack order). */
  aAlloc: number[][];
  active: boolean[][];
  clearance: number;
  window: number[][];
  theta: number[][];
}

export interface L2Context extends PhaseEvalContext {
  cascadeS: number[][];
}

/** Envelope gap excess at time t between layers i,i+1 (negative = violation). */
function gapExcess(ctx: L2Context, t: number, i: number): number {
  const { base, aAlloc, clearance, cascadeS } = ctx;
  const lowNext = base.yBottom[i + 1][t] + cascadeS[i + 1][t] - aAlloc[i + 1][t];
  const highCur = base.yTop[i][t] + cascadeS[i][t] + aAlloc[i][t];
  return lowNext - highCur - clearance;
}

/** Energy with precomputed cascade displacement s(phi). */
export function phaseEnergy(ctx: L2Context, phi: number[], lc: number, ls: number): number {
  const { base, aAlloc, window, theta } = ctx;
  const n = base.yBottom.length;
  const tLen = base.baseline.length;

  // oscillation offset given phi
  const o = (i: number, t: number): number =>
    aAlloc[i][t] * window[i][t] * Math.sin(phi[i] + theta[i][t]);

  let e = 0;
  for (let t = 0; t < tLen; t += 1) {
    for (let i = 0; i + 1 < n; i += 1) {
      const gap = gapExcess(ctx, t, i);
      if (gap < 0) e += lc * gap * gap;
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (let t = 1; t < tLen; t += 1) {
      const d = o(i, t) - o(i, t - 1);
      e += ls * d * d;
    }
  }
  return e;
}

/** Recompute cascade s for a given phi (deterministic, O(nT)).
 *  Note: s depends only on allocated amplitudes — window/theta/phi enter via
 *  the energy term only, not the clearance recursion. */
export function computeCascadeS(
  base: BaseLayout,
  aAlloc: number[][],
  active: boolean[][],
  clearance: number
): number[][] {
  const n = base.yBottom.length;
  const tLen = base.baseline.length;
  const s: number[][] = Array.from({ length: n }, () => new Array<number>(tLen).fill(0));
  for (let t = 0; t < tLen; t += 1) {
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      s[i][t] = acc;
      if (i + 1 < n && (active[i][t] || active[i + 1][t])) {
        const gap = aAlloc[i][t] + aAlloc[i + 1][t] + clearance;
        if (gap > 0) acc += gap;
      }
    }
  }
  return s;
}

export function optimizePhases(
  mode: "sine" | "l2",
  nLayers: number,
  options: CorridorOptions,
  ctx: PhaseEvalContext
): PhaseOptimizerResult {
  const phi = new Array<number>(nLayers).fill(0);
  if (mode === "sine") {
    for (let i = 0; i < nLayers; i += 1) phi[i] = Math.PI * (i % 2);
    return { phi };
  }

  // L2 coordinate descent
  const lc = options.l2CollisionWeight ?? 1.0;
  const ls = options.l2SmoothWeight ?? 0.5;
  const rounds = Math.max(1, options.l2Rounds ?? 3);
  const grid = Math.max(5, options.l2GridPoints ?? 17);
  const half = Math.PI / 2;

  let s = computeCascadeS(ctx.base, ctx.aAlloc, ctx.active, ctx.clearance);
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < nLayers; i += 1) {
      let bestE = Infinity;
      let bestPhi = phi[i];
      for (let g = 0; g < grid; g += 1) {
        const candidate = phi[i] - half + (half * 2 * g) / (grid - 1);
        phi[i] = candidate;
        s = computeCascadeS(ctx.base, ctx.aAlloc, ctx.active, ctx.clearance);
        const e = phaseEnergy({ ...ctx, cascadeS: s }, phi, lc, ls);
        if (e < bestE) {
          bestE = e;
          bestPhi = candidate;
        }
      }
      phi[i] = bestPhi;
      s = computeCascadeS(ctx.base, ctx.aAlloc, ctx.active, ctx.clearance);
    }
  }
  return { phi };
}
