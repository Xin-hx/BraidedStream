/**
 * Pipeline: distributions → TPID order → fixed external-envelope layers → layer slots
 * → branch geometry. Pure functions, deterministic, no DOM.
 */
import { validateData } from "./engine/quantiles";
import { computeUncertainty } from "./engine/uncertainty";
import { computePid, type TpidOptions } from "./engine/pid";
import { computeSineBaseline, computeWiggleBaseline } from "./engine/baseline";
import {
  DEFAULT_BRAIDED_STREAM_OPTIONS,
  buildLayerSlotGeometry,
  computeActiveMask,
  computeBranchTopology,
  resolveLayerQuantiles,
  requestQuantileEnvelope,
  relaxLayerCollisions,
} from "./engine/braided";
import { computeGeometryCosts } from "./engine/costs";
import type {
  CorridorOptions,
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
  /** Deprecated seam options; accepted but ignored by faithful braided geometry. */
  corridors?: CorridorOptions;
  tpid?: TpidOptions;
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
  const n = valid.length;
  if (n === 0) {
    throw new Error("runPipeline: no layers");
  }
  const braidOptions = { ...DEFAULT_BRAIDED_STREAM_OPTIONS, ...options.braided };
  if (!Number.isFinite(braidOptions.epsilon) || braidOptions.epsilon <= 0) {
    throw new Error("braided epsilon must be finite and positive");
  }
  if (!Number.isFinite(braidOptions.envelopeQuantile) ||
      braidOptions.envelopeQuantile <= 0.5 || braidOptions.envelopeQuantile > 0.975) {
    throw new Error("braided envelopeQuantile must be in (0.5, 0.975]");
  }
  if (!Number.isFinite(braidOptions.representativeQuantile) ||
      braidOptions.representativeQuantile < 0.025 ||
      braidOptions.representativeQuantile >= braidOptions.envelopeQuantile) {
    throw new Error("braided representativeQuantile must be in [0.025, envelopeQuantile)");
  }
  const uncertainty = computeUncertainty(
    valid,
    braidOptions.epsilon,
    braidOptions.uncertaintyFocusPercent,
  );

  const pid = computePid(layers, options.tpid);

  // Stack order: highest TPID at the center, then lower scores toward the outside.
  const order = pid.order;
  const sourceLayers = order.map((id) => valid.find((l) => l.id === id)!);
  const quantiles = sourceLayers.map((layer) => layer.q.p50.map((_, t) =>
    resolveLayerQuantiles(layer, t, braidOptions.envelopeQuantile, braidOptions.representativeQuantile)
  ));
  const ordered = sourceLayers.map((layer, i) => ({
    ...layer, magnitude: quantiles[i].map((q) => q.qRepresentative),
  }));
  const base =
    (options.baselineMode ?? "wiggle") === "sine"
      ? computeSineBaseline(ordered, order)
      : computeWiggleBaseline(ordered, order);

  const h0 = h0FromLayers(ordered);
  const yExtent = h0Max(h0);

  const uncertaintyOrdered = order.map((id) => uncertainty.value[valid.findIndex((l) => l.id === id)]);
  const rankOrdered = order.map((id) => uncertainty.rank[valid.findIndex((l) => l.id === id)]);
  const exposureOrdered = order.map((id) => uncertainty.exposure[valid.findIndex((l) => l.id === id)]);
  const topology = computeBranchTopology(ordered, quantiles);
  const requested = requestQuantileEnvelope(quantiles, exposureOrdered, topology);
  const activeOrdered = computeActiveMask(requested.total);
  const slotLayers = ordered.map((layer, i) => ({
    ...layer,
    magnitude: layer.magnitude.map((value, t) => value + requested.capacity[i][t]),
  }));
  const slotBase = (options.baselineMode ?? "wiggle") === "sine"
    ? computeSineBaseline(slotLayers, order)
    : computeWiggleBaseline(slotLayers, order);
  const braided = buildLayerSlotGeometry(
    ordered, quantiles, topology, slotBase, uncertaintyOrdered, rankOrdered, exposureOrdered,
    activeOrdered, requested, braidOptions, base
  );
  const relaxation = relaxLayerCollisions(braided, braidOptions.epsilon);
  if (braidOptions.debug) {
    console.debug(
      `[braided] collisions ${relaxation.beforeCount} -> ${relaxation.afterCount}; ` +
      `max overlap ${relaxation.maxOverlapBefore} -> ${relaxation.maxOverlapAfter}; passes ${relaxation.passes}`
    );
  }

  const zeros = uncertaintyOrdered.map((row) => row.map(() => 0));
  const req = {
    aReq: requested.total,
    gate: exposureOrdered,
    seamReq: [] as number[][],
    window: exposureOrdered,
    freq: zeros,
    theta: zeros,
    ampConst: requested.total.map((row) => row.reduce((sum, value) => sum + value, 0) / row.length),
  };
  const phases = { phi: Array.from({ length: n }, (_, i) => Math.PI * (i % 2)) };
  const costs = computeGeometryCosts(base, braided, req.aReq, h0);

  return {
    validation,
    pid,
    uncertainty,
    base,
    corridors: req,
    phases,
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
