/**
 * Pipeline: quantiles → uncertainty → PID order → base layout → corridor
 * requests → budget allocation → phase optimization → braided geometry →
 * geometry costs. Pure functions, deterministic, no DOM.
 */
import { validateData } from "./quantiles";
import { computeUncertainty } from "./uncertainty";
import { computePid } from "./pid";
import { computeSineBaseline, computeWiggleBaseline } from "./baseline";
import {
  allocateBudget,
  buildBraidedGeometry,
  requestCorridors,
} from "./corridors";
import { computeGeometryCosts } from "./costs";
import type {
  CorridorOptions,
  Layer,
  PipelineResult,
  QuantileMatrix,
  ValidationResult,
} from "./types";

export function h0FromLayers(layers: Layer[]): number[] {
  const tLen = layers[0].q.p50.length;
  const h0 = new Array<number>(tLen).fill(0);
  for (const layer of layers) {
    for (let t = 0; t < tLen; t += 1) h0[t] += layer.q.p50[t];
  }
  return h0;
}

export interface PipelineOptions {
  corridors: CorridorOptions;
  /** normalize mode for uncertainty (default "global"). */
  normalize?: "per-layer" | "global";
  smoothWindow?: number;
  /** baseline layout algorithm: "wiggle" (Byron-Wattenberg L2) or "sine"
   *  (SineStream Gaussian-weighted L2). Default "wiggle". */
  baselineMode?: "wiggle" | "sine";
}

/**
 * Run the full braided pipeline on validated layers.
 * Layers may arrive in any order; the PID inside-out order is applied.
 */
export function runPipeline(layers: Layer[], options: PipelineOptions): PipelineResult {
  const { layers: valid, result: validation } = validateData(layers, true);
  const n = valid.length;
  if (n === 0) {
    throw new Error("runPipeline: no layers");
  }
  const tLen = valid[0].q.p50.length;

  const uncertainty = computeUncertainty(valid, {
    normalize: options.normalize ?? "global",
    smoothWindow: options.smoothWindow ?? 0,
  });

  const pid = computePid(valid);

  // stack order: PID inside-out (deepest center), then base layout
  const order = pid.order;
  const ordered = order.map((id) => valid.find((l) => l.id === id)!);
  const base =
    (options.baselineMode ?? "wiggle") === "sine"
      ? computeSineBaseline(ordered, order)
      : computeWiggleBaseline(ordered, order);

  const h0 = h0FromLayers(valid);
  const yExtent = h0Max(h0);

  const corr = options.corridors;
  const amplitudeMax = corr.amplitudeMax > 0 ? corr.amplitudeMax : 0.03 * yExtent;
  const clearance = corr.clearance > 0 ? corr.clearance : 0.002 * yExtent;

  // request corridors on STACK order (u aligned to ordered layers)
  const uOrdered = order.map((id) => uncertainty.u[valid.findIndex((l) => l.id === id)]);
  const req = requestCorridors(ordered, uOrdered, {
    gateClose: corr.eventCloseThreshold ?? corr.participationThreshold,
    gateOpen: Math.max(
      (corr.eventCloseThreshold ?? corr.participationThreshold) + 0.01,
      corr.eventOpenThreshold ??
        (corr.eventCloseThreshold ?? corr.participationThreshold) + corr.windowSmooth / 100
    ),
    aMax: amplitudeMax,
    clearance,
    gamma: corr.gamma ?? 1,
    encoding: corr.encoding ?? "both",
    fMin: corr.frequencyMin,
    fMax: corr.frequencyMax,
    layerOverride: corr.layerOverride ?? null,
  });

  const { rho, aAlloc, seam } = allocateBudget(req.aReq, req.seamReq, corr.budgetEta, h0);

  // Explicit seams fully determine adjacent geometry. Retain deterministic
  // phase metadata for diagnostics without applying a dead collision objective.
  const phases = { phi: Array.from({ length: n }, (_, i) => Math.PI * (i % 2)) };

  const braided = buildBraidedGeometry(
    base,
    aAlloc,
    seam,
    req.gate,
    rho
  );

  const costs = computeGeometryCosts(base, braided, req.aReq, h0);

  // phase continuity check (by construction zero; assert for tests)
  let phaseContinuityMax = 0;
  const span = Math.max(1, tLen - 1);
  for (let i = 0; i < n; i += 1) {
    for (let t = 1; t < tLen; t += 1) {
      const d = req.theta[i][t] - req.theta[i][t - 1] - (2 * Math.PI * req.freq[i][t - 1]) / span;
      const a = Math.abs(d);
      if (a > phaseContinuityMax) phaseContinuityMax = a;
    }
  }
  costs.phaseContinuityMax = phaseContinuityMax;

  return {
    validation,
    pid,
    uncertainty,
    base,
    corridors: req,
    phases,
    braided,
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
