/**
 * Scour energy calculation for recursive scour-minimized streamgraphs.
 *
 * E_chain(S) = E_move + lambdaTurn * E_turn.
 *
 * The key modeling choice is that a layer pays only for motion of its support
 * interface. In a normal chain, that interface is the cumulative thickness of
 * layers before it in the chain order, so a layer never pays for its own
 * thickness change.
 */

import type { ScourConfig, ScourMovingInterfaceMode } from "./scourTypes";

export interface MovingInterfaceOptions {
  lambda: number;
  anchorWeight: number;
  mode: ScourMovingInterfaceMode;
}

/** Clamp a value to [0, Infinity). */
function nonNegative(value: number): number {
  return Math.max(0, value);
}

/**
 * Aggregate thickness for a subset of layers at every time step.
 * H_S[k] = sum_{i in S} h_i[k].
 */
export function aggregateThickness(
  heights: number[][],
  group: number[]
): number[] {
  const T = heights[0]?.length ?? 0;
  const result = new Array<number>(T).fill(0);

  for (const i of group) {
    const row = heights[i];
    for (let k = 0; k < T; k += 1) {
      result[k] += row[k] ?? 0;
    }
  }

  return result;
}

/** First temporal difference: Delta H[k] = H[k] - H[k - 1]. */
export function firstDifference(series: number[]): number[] {
  const out = new Array<number>(series.length).fill(0);
  for (let k = 1; k < series.length; k += 1) {
    out[k] = series[k] - series[k - 1];
  }
  return out;
}

/**
 * Second temporal difference:
 * Delta^2 H[k] = H[k] - 2 * H[k - 1] + H[k - 2].
 */
export function secondDifference(series: number[]): number[] {
  const out = new Array<number>(series.length).fill(0);
  for (let k = 2; k < series.length; k += 1) {
    out[k] = series[k] - 2 * series[k - 1] + series[k - 2];
  }
  return out;
}

/**
 * Layer weight at time k:
 * w_{i,k} = (h_i[k - 1] + h_i[k]) / 2.
 */
export function layerWeights(
  heights: number[][],
  layerIndices: number[]
): number[][] {
  const T = heights[0]?.length ?? 0;

  return layerIndices.map((i) => {
    const row = heights[i];
    const w = new Array<number>(T).fill(0);
    for (let k = 1; k < T; k += 1) {
      w[k] = nonNegative(((row[k - 1] ?? 0) + (row[k] ?? 0)) / 2);
    }
    return w;
  });
}

/**
 * Variation score for a single layer, used only to derive a stable heuristic
 * order for chain rendering.
 *
 * V_i = sum_k (Delta h_i[k])^2 + lambdaTurn * sum_k (Delta^2 h_i[k])^2.
 */
export function layerVariationScore(
  heights: number[][],
  layerIndex: number,
  lambdaTurn: number
): number {
  const row = heights[layerIndex] ?? [];
  let score = 0;

  for (let k = 1; k < row.length; k += 1) {
    const d1 = (row[k] ?? 0) - (row[k - 1] ?? 0);
    score += d1 * d1;
  }

  for (let k = 2; k < row.length; k += 1) {
    const d2 = (row[k] ?? 0) - 2 * (row[k - 1] ?? 0) + (row[k - 2] ?? 0);
    score += lambdaTurn * d2 * d2;
  }

  return score;
}

/**
 * Heuristic ordering: sort by increasing variation score with original layer
 * index as a stable tie-breaker.
 */
export function heuristicOrder(
  heights: number[][],
  group: number[],
  lambdaTurn: number
): number[] {
  return group
    .slice()
    .sort((a, b) => {
      const va = layerVariationScore(heights, a, lambdaTurn);
      const vb = layerVariationScore(heights, b, lambdaTurn);
      if (va !== vb) {
        return va - vb;
      }
      return a - b;
    });
}

/**
 * Compute E_chain(S) and the chain order for a group of layers.
 *
 * Only prefix-layer changes contribute to a layer's passive migration. The
 * current layer is added to the prefix after its own interface cost is measured.
 */
export function chainCost(
  heights: number[][],
  group: number[],
  config: ScourConfig
): { cost: number; order: number[] } {
  const T = heights[0]?.length ?? 0;
  const order = heuristicOrder(heights, group, config.lambdaTurn);
  const weights = layerWeights(heights, order);
  const prefix = new Array<number>(T).fill(0);

  let moveEnergy = 0;
  let turnEnergy = 0;

  for (let r = 0; r < order.length; r += 1) {
    const layerIdx = order[r];
    const w = weights[r];
    const d1 = firstDifference(prefix);
    const d2 = secondDifference(prefix);

    for (let k = 1; k < T; k += 1) {
      moveEnergy += w[k] * d1[k] * d1[k];
    }
    for (let k = 2; k < T; k += 1) {
      turnEnergy += w[k] * d2[k] * d2[k];
    }

    const row = heights[layerIdx] ?? [];
    for (let k = 0; k < T; k += 1) {
      prefix[k] += row[k] ?? 0;
    }
  }

  return {
    cost: moveEnergy + config.lambdaTurn * turnEnergy,
    order
  };
}

/**
 * Split penalty:
 * P(A,B) = rhoSplit + etaHeight * E_height(A,B)
 *        + betaBalance * E_balance(A,B).
 */
export function splitPenalty(
  heights: number[][],
  groupA: number[],
  groupB: number[],
  config: ScourConfig
): number {
  const hA = aggregateThickness(heights, groupA);
  const hB = aggregateThickness(heights, groupB);

  let maxA = 0;
  let maxB = 0;
  let meanA = 0;
  let meanB = 0;

  for (let k = 0; k < hA.length; k += 1) {
    const a = hA[k];
    const b = hB[k];
    maxA = Math.max(maxA, a);
    maxB = Math.max(maxB, b);
    meanA += a;
    meanB += b;
  }

  const T = Math.max(1, hA.length);
  meanA /= T;
  meanB /= T;

  const eHeight = maxA + maxB;
  const eBalance = Math.abs(meanA - meanB) / (meanA + meanB + 1e-9);

  return (
    config.rhoSplit +
    config.etaHeight * eHeight +
    config.betaBalance * eBalance
  );
}

/**
 * Current minimum viable moving interface solver.
 *
 * The interface is local to one split node. It centers the combined upper/lower
 * subtree envelope around the node's local origin:
 * b_v(t) = (H_lower(t) - H_upper(t)) / 2.
 *
 * The function boundary is intentionally solver-like so it can later be replaced
 * by the quadratic optimizer for E_v(b_v).
 */
export function computeMovingInterface(
  hUpper: number[],
  hLower: number[],
  options: MovingInterfaceOptions
): number[] {
  const T = Math.max(hUpper.length, hLower.length);
  if (options.mode === "fixed" || T === 0) {
    return new Array<number>(T).fill(0);
  }

  if (options.mode === "optimized") {
    return solveMovingInterface(hUpper, hLower, options);
  }

  const out = new Array<number>(T).fill(0);
  for (let t = 0; t < T; t += 1) {
    out[t] = ((hLower[t] ?? 0) - (hUpper[t] ?? 0)) / 2;
  }

  return out;
}

/**
 * Moving-interface energy:
 *
 * sum_t [
 *   H_upper(t) * (Delta b(t) + 0.5 Delta H_upper(t))^2
 * + H_lower(t) * (Delta b(t) - 0.5 Delta H_lower(t))^2
 * ] + lambda * sum_t (Delta^2 b(t))^2.
 */
export function movingInterfaceEnergy(
  hUpper: number[],
  hLower: number[],
  movingInterface: number[],
  lambda: number,
  anchorWeight = 0
): number {
  const T = movingInterface.length;
  let energy = 0;

  for (let t = 0; t < T - 1; t += 1) {
    const db = movingInterface[t + 1] - movingInterface[t];
    const dUpper = (hUpper[t + 1] ?? 0) - (hUpper[t] ?? 0);
    const dLower = (hLower[t + 1] ?? 0) - (hLower[t] ?? 0);
    const upperMotion = db + 0.5 * dUpper;
    const lowerMotion = db - 0.5 * dLower;
    const upperWeight = 0.5 * (Math.max(0, hUpper[t] ?? 0) + Math.max(0, hUpper[t + 1] ?? 0));
    const lowerWeight = 0.5 * (Math.max(0, hLower[t] ?? 0) + Math.max(0, hLower[t + 1] ?? 0));
    energy +=
      upperWeight * upperMotion * upperMotion +
      lowerWeight * lowerMotion * lowerMotion;
  }

  for (let t = 1; t < T - 1; t += 1) {
    const d2 = movingInterface[t + 1] - 2 * movingInterface[t] + movingInterface[t - 1];
    energy += Math.max(0, lambda) * d2 * d2;
  }

  const anchor = Math.max(0, anchorWeight);
  if (anchor > 0) {
    for (let t = 0; t < T; t += 1) {
      energy += anchor * movingInterface[t] * movingInterface[t];
    }
  }

  return energy;
}

function solveMovingInterface(
  hUpper: number[],
  hLower: number[],
  options: MovingInterfaceOptions
): number[] {
  const T = Math.max(hUpper.length, hLower.length);
  if (T <= 1) {
    return new Array<number>(T).fill(0);
  }

  const matrix: number[][] = Array.from({ length: T }, () => new Array<number>(T).fill(0));
  const linear = new Array<number>(T).fill(0);

  for (let t = 0; t < T - 1; t += 1) {
    const upper = 0.5 * (Math.max(0, hUpper[t] ?? 0) + Math.max(0, hUpper[t + 1] ?? 0));
    const lower = 0.5 * (Math.max(0, hLower[t] ?? 0) + Math.max(0, hLower[t + 1] ?? 0));
    const weight = upper + lower;
    const dUpper = (hUpper[t + 1] ?? 0) - (hUpper[t] ?? 0);
    const dLower = (hLower[t + 1] ?? 0) - (hLower[t] ?? 0);
    const q = 0.5 * (upper * dUpper - lower * dLower);

    matrix[t][t] += weight;
    matrix[t + 1][t + 1] += weight;
    matrix[t][t + 1] -= weight;
    matrix[t + 1][t] -= weight;
    linear[t] -= q;
    linear[t + 1] += q;
  }

  const lambda = Math.max(0, options.lambda);
  for (let t = 1; t < T - 1; t += 1) {
    addOuterProduct(matrix, [t - 1, t, t + 1], [1, -2, 1], lambda);
  }

  // Without an anchor the derivative terms are translation-invariant. A tiny
  // anchor picks the zero-mean representative without changing the shape.
  const anchor = Math.max(0, options.anchorWeight);
  const effectiveAnchor = anchor > 0 ? anchor : 1e-9;
  for (let t = 0; t < T; t += 1) {
    matrix[t][t] += effectiveAnchor;
  }

  const rhs = linear.map((value) => -value);
  return solveLinearSystem(matrix, rhs);
}

function addOuterProduct(
  matrix: number[][],
  indices: number[],
  values: number[],
  weight: number
): void {
  if (weight <= 0) {
    return;
  }
  for (let i = 0; i < indices.length; i += 1) {
    for (let j = 0; j < indices.length; j += 1) {
      matrix[indices[i]][indices[j]] += weight * values[i] * values[j];
    }
  }
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let pivotAbs = Math.abs(a[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(a[row][col]);
      if (value > pivotAbs) {
        pivot = row;
        pivotAbs = value;
      }
    }

    if (pivotAbs <= 1e-12) {
      continue;
    }

    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }

    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) {
      a[col][j] /= divisor;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = a[row][col];
      if (Math.abs(factor) <= 1e-14) {
        continue;
      }
      for (let j = col; j <= n; j += 1) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  return a.map((row) => (Number.isFinite(row[n]) ? row[n] : 0));
}
