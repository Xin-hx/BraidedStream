/** Layer-level probabilistic inclusion depth (PID) ordering. */
import { QUANTILE_KEYS, type Layer, type PidResult, type QuantileMatrix } from "../types";

const QUANTILE_PROBABILITIES = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975] as const;

export interface TpidLayerInput {
  layer_id: string;
  /** Time-major member samples: values[t][member]. A flat array is one value per time. */
  values: number[][] | number[];
}

export interface TpidOrderingEntry {
  layer_id: string;
  tpid_score: number;
}

export interface TpidOptions {
  epsilon?: number;
}

type MaskSource =
  | { kind: "members"; values: number[]; weights?: number[] }
  | { kind: "quantiles"; probabilities: number[]; values: number[] };

/** Empirical P(X >= v) at each value-grid point. */
export function memberSurvival(values: number[], grid: number[], weights?: number[]): number[] {
  const members = normalizedMembers(values, weights);
  if (!members.length) return [];
  return grid.map((v) => v < 0 ? 0 : members.reduce(
    (survival, member) => survival + (member.value >= v ? member.weight : 0),
    0,
  ));
}

/** Approximate P(X >= v) from the fixed quantiles available at one time point. */
export function quantileSurvival(q: QuantileMatrix, t: number, grid: number[]): number[] {
  return survivalFromQuantiles(
    QUANTILE_KEYS.map((key, i) => ({ probability: QUANTILE_PROBABILITIES[i], value: q[key][t] })),
    grid
  );
}

/** Probabilistic inclusion integral(a*b) / integral(a). */
export function inclusion(a: number[], b: number[], grid: number[], epsilon = 1e-12): number {
  let denominator = 0;
  let numerator = 0;
  for (let i = 1; i < grid.length; i += 1) {
    const width = grid[i] - grid[i - 1];
    denominator += width * (a[i - 1] + a[i]) / 2;
    numerator += width * (a[i - 1] * b[i - 1] + a[i] * b[i]) / 2;
  }
  return denominator <= epsilon ? 0 : numerator / denominator;
}

/** Equal-time average of pairwise inclusion over shared, observed time points. */
export function temporalInclusion(layerA: Layer, layerB: Layer, epsilon = 1e-12): number {
  return temporalInclusionSources(layerSources(layerA), layerSources(layerB), epsilon);
}

/** Member-sample adapter retained for the standalone TPID ordering API. */
export function compute_tpid_layer_ordering(
  layers: TpidLayerInput[],
  options: TpidOptions = {}
): TpidOrderingEntry[] {
  return rankLayers(layers.map((layer) => ({
    id: layer.layer_id,
    sources: timeMajor(layer.values).map((values) => memberSource(values)),
  })), epsilonFrom(options));
}

export function computePid(layers: Layer[], options: TpidOptions = {}): PidResult {
  const ranked = rankLayers(layers.map((layer) => ({ id: layer.id, sources: layerSources(layer) })), epsilonFrom(options));
  const depth = Object.fromEntries(ranked.map(({ layer_id, tpid_score }) => [layer_id, tpid_score]));
  const ranking = ranked.map((entry) => entry.layer_id);
  return { depth, ranking, order: centerOutOrder(ranking) };
}

function rankLayers(
  layers: Array<{ id: string; sources: Array<MaskSource | undefined> }>,
  epsilon: number
): TpidOrderingEntry[] {
  return layers.map((layer, i) => {
    if (layers.length === 1) return { layer_id: layer.id, tpid_score: 0 };
    let inclusionIn = 0;
    let inclusionOut = 0;
    for (let j = 0; j < layers.length; j += 1) {
      if (j === i) continue;
      inclusionIn += temporalInclusionSources(layer.sources, layers[j].sources, epsilon);
      inclusionOut += temporalInclusionSources(layers[j].sources, layer.sources, epsilon);
    }
    const peers = layers.length - 1;
    return { layer_id: layer.id, tpid_score: Math.min(inclusionIn / peers, inclusionOut / peers) };
  }).sort((a, b) => b.tpid_score - a.tpid_score || a.layer_id.localeCompare(b.layer_id));
}

function temporalInclusionSources(
  a: Array<MaskSource | undefined>,
  b: Array<MaskSource | undefined>,
  epsilon: number
): number {
  let total = 0;
  let sharedTimes = 0;
  for (let t = 0; t < Math.max(a.length, b.length); t += 1) {
    const sourceA = a[t];
    const sourceB = b[t];
    if (!sourceA || !sourceB) continue;
    const grid = valueGrid(sourceA, sourceB);
    total += inclusion(survival(sourceA, grid), survival(sourceB, grid), grid, epsilon);
    sharedTimes += 1;
  }
  return sharedTimes ? total / sharedTimes : 0;
}

function layerSources(layer: Layer): Array<MaskSource | undefined> {
  if (layer.distribution !== undefined) {
    return layer.distribution.map((cell) => {
      if (!cell) return undefined;
      return cell.kind === "samples"
        ? memberSource(cell.values, cell.weights)
        : quantileSource(cell.probabilities, cell.values);
    });
  }
  const timeLength = Math.max(...QUANTILE_KEYS.map((key) => layer.q[key].length));
  return Array.from({ length: timeLength }, (_, t) => quantileSource(
    QUANTILE_PROBABILITIES,
    QUANTILE_KEYS.map((key) => layer.q[key][t])
  ));
}

function memberSource(values: number[], weights?: number[]): MaskSource | undefined {
  const members = normalizedMembers(values, weights);
  if (!members.length) return undefined;
  return {
    kind: "members",
    values: members.map((member) => member.value),
    ...(weights ? { weights: members.map((member) => member.weight) } : {}),
  };
}

function quantileSource(probabilities: readonly number[], values: readonly number[]): MaskSource | undefined {
  const pairs = probabilities.map((probability, i) => ({ probability, value: values[i] }))
    .filter(({ probability, value }) => Number.isFinite(probability) && probability >= 0 && probability <= 1 && Number.isFinite(value))
    .sort((a, b) => a.value - b.value || a.probability - b.probability);
  return pairs.length ? {
    kind: "quantiles",
    probabilities: pairs.map((pair) => pair.probability),
    values: pairs.map((pair) => pair.value),
  } : undefined;
}

function survival(source: MaskSource, grid: number[]): number[] {
  return source.kind === "members"
    ? memberSurvival(source.values, grid, source.weights)
    : survivalFromQuantiles(source.probabilities.map((probability, i) => ({ probability, value: source.values[i] })), grid);
}

function normalizedMembers(values: number[], weights?: number[]): Array<{ value: number; weight: number }> {
  if (weights && weights.length !== values.length) throw new Error("member weights length mismatch");
  const members = values.flatMap((value, i) => {
    const weight = weights?.[i] ?? 1;
    return Number.isFinite(value) && Number.isFinite(weight) && weight > 0 ? [{ value, weight }] : [];
  });
  const totalWeight = members.reduce((sum, member) => sum + member.weight, 0);
  return totalWeight ? members.map((member) => ({ ...member, weight: member.weight / totalWeight })) : [];
}

function survivalFromQuantiles(
  pairs: Array<{ probability: number; value: number }>,
  grid: number[]
): number[] {
  const knots: Array<{ probability: number; value: number }> = [];
  for (const pair of pairs.filter((pair) => Number.isFinite(pair.value) && Number.isFinite(pair.probability))
    .sort((a, b) => a.value - b.value || a.probability - b.probability)) {
    if (knots.at(-1)?.value === pair.value) knots[knots.length - 1] = pair;
    else knots.push(pair);
  }
  if (!knots.length) return [];
  if (knots.length === 1) return grid.map((v) => v >= 0 && v <= knots[0].value ? 1 : 0);
  return grid.map((v) => {
    if (v < 0) return 0;
    if (v < knots[0].value) return 1;
    if (v > knots.at(-1)!.value) return 0;
    const right = knots.findIndex((knot) => v <= knot.value);
    if (right <= 0) return 1 - knots[0].probability;
    const left = knots[right - 1];
    const ratio = (v - left.value) / (knots[right].value - left.value);
    const cdf = left.probability + ratio * (knots[right].probability - left.probability);
    return Math.max(0, Math.min(1, 1 - cdf));
  });
}

function valueGrid(a: MaskSource, b: MaskSource): number[] {
  return [...new Set([0, ...a.values, ...b.values].filter((value) => Number.isFinite(value) && value >= 0))]
    .sort((x, y) => x - y);
}

function timeMajor(values: TpidLayerInput["values"]): number[][] {
  return values.length && typeof values[0] === "number"
    ? (values as number[]).map((value) => [value])
    : values as number[][];
}

function epsilonFrom(options: TpidOptions): number {
  return Number.isFinite(options.epsilon) && options.epsilon! > 0 ? options.epsilon! : 1e-12;
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
