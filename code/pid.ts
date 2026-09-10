/** Temporal Probabilistic Inclusion Depth (TPID) layer ordering. */
import { QUANTILE_KEYS, type Layer, type PidResult, type QuantileMatrix } from "./types";

export interface TpidLayerInput {
  layer_id: string;
  /** Time-major samples or quantiles: values[t][z]. */
  values: number[][] | number[];
}

export interface TpidOrderingEntry {
  layer_id: string;
  tpid_score: number;
}

export interface TpidOptions {
  /** Number of dyadic Haar detail scales. Default: all scales up to log2(T). */
  levels?: number;
  epsilon?: number;
}

/**
 * Build P_i(t,s,z) from wavelet energy along time for every distribution
 * dimension z, then compute TPID(i)=min(mean_j I(i,j), mean_j I(j,i)).
 */
export function compute_tpid_layer_ordering(
  layers: TpidLayerInput[],
  options: TpidOptions = {}
): TpidOrderingEntry[] {
  if (!layers.length) return [];
  const matrices = layers.map((layer) => timeMajor(layer.values));
  const timeLength = Math.max(1, ...matrices.map((matrix) => matrix.length));
  const zLength = Math.max(1, ...matrices.map((matrix) => Math.max(0, ...matrix.map((row) => row.length))));
  const maxLevels = Math.max(1, Math.floor(Math.log2(timeLength)));
  const requestedLevels = Number.isFinite(options.levels) ? Math.floor(options.levels!) : maxLevels;
  const levels = Math.max(1, Math.min(maxLevels, requestedLevels));
  const epsilon = Number.isFinite(options.epsilon) && options.epsilon! > 0 ? options.epsilon! : 1e-12;

  const probabilities = matrices.map((matrix) => {
    const energy = Array.from({ length: zLength }, (_, z) =>
      haarEnergy(sanitizeAndResample(matrix.map((row) => row[z]), timeLength), levels)
    ).flat();
    const total = energy.reduce((sum, value) => sum + value, 0);
    return total <= epsilon ? energy.map(() => 0) : energy.map((value) => value / (total + epsilon));
  });

  const scores = layers.map((layer, i) => {
    if (layers.length === 1) return { layer_id: layer.layer_id, tpid_score: 0 };
    let inclusionIn = 0;
    let inclusionOut = 0;
    for (let j = 0; j < layers.length; j += 1) {
      if (j === i) continue;
      inclusionIn += dot(probabilities[i], probabilities[j]);
      inclusionOut += dot(probabilities[j], probabilities[i]);
    }
    const peers = layers.length - 1;
    return { layer_id: layer.layer_id, tpid_score: Math.min(inclusionIn / peers, inclusionOut / peers) };
  });
  return scores.sort((a, b) => b.tpid_score - a.tpid_score || a.layer_id.localeCompare(b.layer_id));
}

/** Existing pipeline adapter: use preserved distributions, never magnitude. */
export function computePid(layers: Layer[], options: TpidOptions = {}): PidResult {
  const ranked = compute_tpid_layer_ordering(
    layers.map((layer) => ({ layer_id: layer.id, values: layer.distribution ?? quantileDistribution(layer.q) })),
    options
  );
  const depth = Object.fromEntries(ranked.map(({ layer_id, tpid_score }) => [layer_id, tpid_score]));
  return { depth, order: centerOutOrder(ranked.map((entry) => entry.layer_id)) };
}

/** Haar detail coefficients at each scale plus the coarsest approximation. */
function haarEnergy(signal: number[], levels: number): number[] {
  const energy: number[] = [];
  for (let level = 0; level < levels; level += 1) {
    const half = 2 ** level;
    const norm = Math.sqrt(2 * half);
    for (let t = 0; t < signal.length; t += 1) {
      let coefficient = 0;
      for (let k = 0; k < half; k += 1) coefficient += signal[(t + k) % signal.length] - signal[(t + half + k) % signal.length];
      energy.push(Math.abs(coefficient / norm));
    }
  }
  const half = 2 ** (levels - 1);
  const norm = Math.sqrt(2 * half);
  for (let t = 0; t < signal.length; t += 1) {
    let approximation = 0;
    for (let k = 0; k < 2 * half; k += 1) approximation += signal[(t + k) % signal.length];
    energy.push(Math.abs(approximation / norm));
  }
  return energy;
}

function timeMajor(values: TpidLayerInput["values"]): number[][] {
  return values.length && typeof values[0] === "number"
    ? (values as number[]).map((value) => [value])
    : values as number[][];
}

function sanitizeAndResample(values: Array<number | undefined>, length: number): number[] {
  const finite = values.map((value) => Number.isFinite(value) ? value! : Number.NaN);
  if (!finite.some(Number.isFinite)) return new Array<number>(length).fill(0);
  for (let i = 0; i < finite.length; i += 1) {
    if (Number.isFinite(finite[i])) continue;
    let left = i - 1;
    let right = i + 1;
    while (left >= 0 && !Number.isFinite(finite[left])) left -= 1;
    while (right < finite.length && !Number.isFinite(finite[right])) right += 1;
    if (left < 0) finite[i] = finite[right];
    else if (right >= finite.length) finite[i] = finite[left];
    else finite[i] = finite[left] + (finite[right] - finite[left]) * (i - left) / (right - left);
  }
  if (finite.length === length) return finite;
  if (finite.length === 1) return new Array<number>(length).fill(finite[0]);
  return Array.from({ length }, (_, index) => {
    const position = index * (finite.length - 1) / Math.max(1, length - 1);
    const left = Math.floor(position);
    const right = Math.min(finite.length - 1, Math.ceil(position));
    return finite[left] + (finite[right] - finite[left]) * (position - left);
  });
}

function quantileDistribution(q: QuantileMatrix): number[][] {
  return q.p50.map((_, t) => QUANTILE_KEYS.map((key) => q[key][t]));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function centerOutOrder(rankedIds: string[]): string[] {
  const order = new Array<string>(rankedIds.length);
  const centerLeft = Math.floor((rankedIds.length - 1) / 2);
  for (let rank = 0; rank < rankedIds.length; rank += 1) {
    const position = rank % 2 === 0 ? centerLeft - rank / 2 : centerLeft + (rank + 1) / 2;
    order[position] = rankedIds[rank];
  }
  return order;
}
