import type { BaseLayout } from "./types";

export const TWIST_KAPPA = 0.55;
export const TWIST_FREQUENCY = 2.25;

/** Zero-mean cross-section brightness basis. */
export function twistG(xi: number, theta: number): number {
  return Math.cos(theta) * (xi * xi - 1 / 3) + Math.sin(theta) * xi;
}

export function numericalCrossSectionMean(theta: number, samples = 4096): number {
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const xi = -1 + (2 * (i + 0.5)) / samples;
    sum += twistG(xi, theta);
  }
  return sum / samples;
}

/** Uncertainty controls magnitude only; phase/frequency are separate constants. */
export function twistStrength(u: number, kappa = TWIST_KAPPA): number {
  return Math.min(1, Math.max(0, u)) * Math.min(1 - Number.EPSILON, Math.max(0, kappa));
}

export function twistPhase(time: number, timeLength: number, layer: number, frequency = TWIST_FREQUENCY): number {
  const span = Math.max(1, timeLength - 1);
  return (2 * Math.PI * frequency * time) / span + layer * Math.PI / 7;
}

export interface FoldCrease {
  /** fractional time position of the crease (cos(phase)=0 crossing). */
  t: number;
  /** fold direction: +1 = highlight on the right, shadow on the left; -1 mirrored. */
  direction: 1 | -1;
  /** fold strength at the crease (0..kappa). */
  strength: number;
}

/**
 * Deterministic fold-crease schedule for one layer band.
 * A crease occurs where the twist phase crosses π/2 + kπ, i.e. the ribbon
 * surface is edge-on to the viewer. Position and direction depend only on the
 * fixed continuous phase; uncertainty scales strength. Never touches the
 * outer L/U geometry (rendering clips it inside the band).
 */
export function foldCreases(
  timeLength: number,
  layer: number,
  uRow: number[],
  frequency = TWIST_FREQUENCY,
  kappa = TWIST_KAPPA
): FoldCrease[] {
  const creases: FoldCrease[] = [];
  for (let t = 1; t < timeLength; t += 1) {
    const cosPrev = Math.cos(twistPhase(t - 1, timeLength, layer, frequency));
    const cosCur = Math.cos(twistPhase(t, timeLength, layer, frequency));
    if ((cosPrev >= 0 && cosCur < 0) || (cosPrev < 0 && cosCur >= 0)) {
      const denom = cosPrev - cosCur;
      const alpha = denom === 0 ? 0.5 : cosPrev / denom;
      const tFrac = t - 1 + alpha;
      const phase = twistPhase(tFrac, timeLength, layer, frequency);
      const direction: 1 | -1 = Math.sin(phase) >= 0 ? 1 : -1;
      const t0 = Math.min(Math.max(0, Math.floor(tFrac)), Math.max(0, uRow.length - 1));
      const t1 = Math.min(uRow.length - 1, t0 + 1);
      const uAt = uRow[t0] + (uRow[t1] - uRow[t0]) * (tFrac - t0);
      creases.push({ t: tFrac, direction, strength: twistStrength(uAt, kappa) });
    }
  }
  return creases;
}

export interface TwistGeometry {
  outerBottom: number[][];
  outerTop: number[][];
  innerBottom: number[][];
  innerTop: number[][];
}

/** Copy unchanged L/U boundaries and derive a contracted, purely visual inner ribbon. */
export function buildTwistGeometry(
  base: BaseLayout,
  u: number[][],
  kappa = TWIST_KAPPA
): TwistGeometry {
  const outerBottom = base.yBottom.map((row) => row.slice());
  const outerTop = base.yTop.map((row) => row.slice());
  const innerBottom = base.yBottom.map((row) => new Array<number>(row.length));
  const innerTop = base.yTop.map((row) => new Array<number>(row.length));
  for (let layer = 0; layer < base.yBottom.length; layer += 1) {
    for (let t = 0; t < base.yBottom[layer].length; t += 1) {
      const low = base.yBottom[layer][t];
      const high = base.yTop[layer][t];
      const center = (low + high) / 2;
      const halfHeight = ((high - low) / 2) * (1 - twistStrength(u[layer][t], kappa));
      innerBottom[layer][t] = center - halfHeight;
      innerTop[layer][t] = center + halfHeight;
    }
  }
  return { outerBottom, outerTop, innerBottom, innerTop };
}
