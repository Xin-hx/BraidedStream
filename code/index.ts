/**
 * Pipeline: distributions → TPID order → dynamic slots → branch geometry
 * → branch geometry. Pure functions, deterministic, no DOM.
 */
import { validateData } from "./engine/quantiles";
import { computeUncertainty } from "./engine/uncertainty";
import { computePidFromAnalysis } from "./engine/pid";
import { computeSineBaseline, computeWiggleBaseline } from "./engine/baseline";
import {
  DEFAULT_BRAIDED_STREAM_OPTIONS,
  branchTopologyFromAnalysis,
  buildLayerSlotGeometry,
  computeAnalysisTopology,
  distributionAt,
  getBraidedQuantiles,
  resolveLayerQuantiles,
  requestDynamicSpaces,
} from "./engine/braided";
import { computeGeometryCosts } from "./engine/costs";
import type {
  BraidedStreamOptions,
  Layer,
  PipelineResult,
  QuantileMatrix,
  ValidationResult,
} from "./types";

export function h0FromLayers(layers: Layer[]): number[] {
  const tLen = (layers[0].magnitude ?? layers[0].q.p50).length;
  const h0 = new Array<number>(tLen).fill(0);
  for (const layer of layers) {
    const magnitude = layer.magnitude ?? layer.q.p50;
    for (let t = 0; t < tLen; t += 1) h0[t] += magnitude[t];
  }
  return h0;
}

export interface PipelineOptions {
  /** New uncertainty-aware layer-slot configuration. */
  braided?: Partial<BraidedStreamOptions>;
  /** baseline layout algorithm: "wiggle" (Byron-Wattenberg L2) or "sine"
   *  (SineStream Gaussian-weighted L2). Default "wiggle". */
  baselineMode?: "wiggle" | "sine";
}

/**
 * Run the full braided pipeline on validated layers.
 * Layers may arrive in any order; the TPID center-out order is applied.
 */
export function runPipeline(layers: Layer[], options: PipelineOptions): PipelineResult {
  const { layers: valid, result: validation } = validateData(layers, true);
  if (valid.length === 0) {
    throw new Error("runPipeline: no layers");
  }
  const braidOptions = { ...DEFAULT_BRAIDED_STREAM_OPTIONS, ...options.braided };
  if (!Number.isFinite(braidOptions.epsilon) || braidOptions.epsilon <= 0) {
    throw new Error("braided epsilon must be finite and positive");
  }
  if (!Number.isFinite(braidOptions.bandwidthRatio) || braidOptions.bandwidthRatio <= 0) {
    throw new Error("braided bandwidthRatio beta must be finite and positive");
  }
  // Retained for the two non-braided comparison views; it never affects braided geometry.
  const uncertainty = computeUncertainty(valid, braidOptions.epsilon, 0);

  const analysis = computeAnalysisTopology(valid, braidOptions.bandwidthRatio);
  const pid = computePidFromAnalysis(valid.map((layer) => layer.id), analysis);

  // Higher TPID ranks occupy progressively more interior ordinal shells.
  const order = pid.order;
  const sourceLayers = order.map((id) => valid.find((l) => l.id === id)!);
  const orderedAnalysis = order.map((id) => analysis[valid.findIndex((layer) => layer.id === id)]);
  const quantiles = sourceLayers.map((layer) => layer.q.p50.map((_, t) =>
    resolveLayerQuantiles(layer, t)
  ));
  const representative = sourceLayers.map((layer) => layer.q.p50.map((_, t) =>
    getBraidedQuantiles(distributionAt(layer, t)).q50
  ));
  const topology = branchTopologyFromAnalysis(orderedAnalysis);
  const ordered = sourceLayers.map((layer, i) => ({
    ...layer,
    magnitude: representative[i],
  }));
  const base =
    (options.baselineMode ?? "wiggle") === "sine"
      ? computeSineBaseline(ordered, order)
      : computeWiggleBaseline(ordered, order);

  const h0 = h0FromLayers(ordered);
  const yExtent = h0Max(h0);

  const requested = requestDynamicSpaces(topology);
  const slotLayers = ordered.map((layer, i) => ({
    ...layer,
    magnitude: layer.magnitude.map((value, t) => value + requested.actual[i][t]),
  }));
  const slotBase = (options.baselineMode ?? "wiggle") === "sine"
    ? computeSineBaseline(slotLayers, order)
    : computeWiggleBaseline(slotLayers, order);
  const braided = buildLayerSlotGeometry(
    ordered, quantiles, topology, slotBase, requested, braidOptions
  );

  const costs = computeGeometryCosts(base, braided, h0);

  return {
    validation,
    pid,
    uncertainty,
    base,
    braided,
    options: braidOptions,
    costs,
    yExtent,
  };
}

function h0Max(h0: number[]): number {
  let m = 0;
  for (const v of h0) if (v > m) m = v;
  return m > 0 ? m : 1;
}

export type { Layer, QuantileMatrix, ValidationResult };
export { resolveLayerQuantiles } from "./engine/braided";
export { inputDataset as canonicalizeDataset } from "./data/dataInput";
export { compute_tpid_layer_ordering } from "./engine/pid";
export type { TpidLayerInput, TpidOptions, TpidOrderingEntry } from "./engine/pid";
