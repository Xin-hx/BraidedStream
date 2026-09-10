/** Temporal PID ordering over the analysis distributions shared with braiding. */
import {
  DEFAULT_BRAIDED_STREAM_OPTIONS,
  analysisOverlap,
  buildAnalysisDistribution,
  computeAnalysisTopology,
  type AnalysisDistribution,
  type AnalysisTopology,
} from "./braided";
import {
  type DistributionAtTime,
  type Layer,
  type PidResult,
} from "../types";

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
  /** Shared KDE ratio beta; the pipeline supplies its braided value. */
  bandwidthRatio?: number;
}

/** PID inclusion on the joint time-value domain for two declared layers. */
export function temporalInclusion(
  layerA: Layer,
  layerB: Layer,
  bandwidthRatio = DEFAULT_BRAIDED_STREAM_OPTIONS.bandwidthRatio,
): number {
  const analysis = computeAnalysisTopology([layerA, layerB], bandwidthRatio);
  return directionalInclusion(analysis[0], analysis[1], commonReferenceTimes(analysis));
}

/** Member-sample adapter using the same empirical-measure to KDE path as the main pipeline. */
export function compute_tpid_layer_ordering(
  layers: TpidLayerInput[],
  options: TpidOptions = {},
): TpidOrderingEntry[] {
  const bandwidthRatio = betaFrom(options);
  const analysis = layers.map((layer) => timeMajor(layer.values).map((values) =>
    buildAnalysisDistribution(sampleDistribution(values), bandwidthRatio)
  ));
  const result = computePidFromAnalysis(layers.map((layer) => layer.layer_id), analysis);
  return result.ranking.map((layer_id) => ({ layer_id, tpid_score: result.depth[layer_id] }));
}

export function computePid(layers: Layer[], options: TpidOptions = {}): PidResult {
  return computePidFromAnalysis(
    layers.map((layer) => layer.id),
    computeAnalysisTopology(layers, betaFrom(options)),
  );
}

/** Official PID applied to temporal survival masks u_i(t,x)=P_hat_it(X>x). */
export function computePidFromAnalysis(
  layerIds: string[],
  analysis: AnalysisTopology,
): PidResult {
  if (layerIds.length !== analysis.length || new Set(layerIds).size !== layerIds.length) {
    throw new Error("TPID layer IDs and analysis rows must match uniquely");
  }
  const referenceTimeIndices = commonReferenceTimes(analysis);
  if (layerIds.length < 2 || !referenceTimeIndices.length) {
    const ranking = layerIds.slice().sort((a, b) => a.localeCompare(b));
    const zero = Object.fromEntries(layerIds.map((id) => [id, 0]));
    return {
      depth: zero,
      inclusionIn: { ...zero },
      inclusionOut: { ...zero },
      ranking,
      order: centerOutOrder(ranking),
      referenceTimeIndices,
      defined: false,
    };
  }

  const count = layerIds.length;
  const masses = analysis.map((layer) => referenceTimeIndices.reduce(
    (sum, time) => sum + layer[time]!.summary.mean,
    0,
  ));
  const inwardOverlap = new Array<number>(count).fill(0);
  const outwardInclusion = new Array<number>(count).fill(0);
  for (const time of referenceTimeIndices) {
    const cells = analysis.map((layer) => layer[time]!);
    for (let source = 0; source < count; source += 1) {
      for (let target = source; target < count; target += 1) {
        const overlap = analysisOverlap(cells[source], cells[target]);
        inwardOverlap[source] += overlap;
        if (masses[source] > 0) outwardInclusion[target] += overlap / masses[source];
        if (target !== source) {
          inwardOverlap[target] += overlap;
          if (masses[target] > 0) outwardInclusion[source] += overlap / masses[target];
        }
      }
    }
  }
  const entries = layerIds.map((id, index) => ({
    id,
    inclusionIn: masses[index] > 0
      ? clamp01(inwardOverlap[index] / (count * masses[index]))
      : 0,
    inclusionOut: clamp01(outwardInclusion[index] / count),
    depth: 0,
  })).map((entry) => ({
    ...entry,
    depth: Math.min(entry.inclusionIn, entry.inclusionOut),
  })).sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id));
  const ranking = entries.map((entry) => entry.id);
  return {
    depth: Object.fromEntries(entries.map((entry) => [entry.id, entry.depth])),
    inclusionIn: Object.fromEntries(entries.map((entry) => [entry.id, entry.inclusionIn])),
    inclusionOut: Object.fromEntries(entries.map((entry) => [entry.id, entry.inclusionOut])),
    ranking,
    order: centerOutOrder(ranking),
    referenceTimeIndices,
    defined: true,
  };
}

function directionalInclusion(
  source: Array<AnalysisDistribution | null>,
  target: Array<AnalysisDistribution | null>,
  referenceTimes: number[],
): number {
  let numerator = 0;
  let denominator = 0;
  for (const time of referenceTimes) {
    const sourceCell = source[time];
    const targetCell = target[time];
    if (!sourceCell || !targetCell) throw new Error("TPID reference time must be observed");
    numerator += analysisOverlap(sourceCell, targetCell);
    denominator += sourceCell.summary.mean;
  }
  return denominator > 0 ? clamp01(numerator / denominator) : 0;
}

function commonReferenceTimes(analysis: AnalysisTopology): number[] {
  const length = Math.max(0, ...analysis.map((layer) => layer.length));
  return Array.from({ length }, (_, time) => time)
    .filter((time) => analysis.every((layer) => layer[time] !== null && layer[time] !== undefined));
}

function sampleDistribution(values: number[]): DistributionAtTime | null {
  return values.some(Number.isFinite) ? { kind: "samples", values } : null;
}

function timeMajor(values: TpidLayerInput["values"]): number[][] {
  return values.length && typeof values[0] === "number"
    ? (values as number[]).map((value) => [value])
    : values as number[][];
}

function betaFrom(options: TpidOptions): number {
  const value = options.bandwidthRatio ?? DEFAULT_BRAIDED_STREAM_OPTIONS.bandwidthRatio;
  if (!Number.isFinite(value) || value <= 0) throw new Error("TPID bandwidth ratio beta must be positive");
  return value;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
