import { validateInput, type InputDataset } from "./input";
import { computeUncertainty } from "./engine/uncertainty";
import { computePidFromAnalysis } from "./engine/pid";
import { computeSineBaseline, computeWiggleBaseline } from "./engine/baseline";
import {
  DEFAULT_BRAIDED_STREAM_OPTIONS,
  branchTopologyFromAnalysis,
  buildLayerSlotGeometry,
  computeAnalysisTopology,
  densityProfilesFromAnalysis,
  getBraidedQuantiles,
  requestDynamicSpaces,
} from "./engine/braided";
import { computeGeometryCosts } from "./engine/costs";
import type {
  BraidedStreamOptions,
  LayoutLayer,
  PipelineResult,
} from "./engine/types";

export interface PipelineOptions {
  /** Optional bottom-to-top layout order. Defaults to computed TPID order. */
  readonly layoutOrder?: readonly string[];
  readonly braided?: Partial<BraidedStreamOptions>;
  readonly baselineMode?: "wiggle" | "sine";
  readonly densityProfileBins?: number;
}

/** The single public analysis entry point. */
export function runPipeline(dataset: InputDataset, options: PipelineOptions): PipelineResult {
  const valid = validateInput(dataset);
  const ids = valid.layers.map((layer) => layer.id);
  const requestedOrder = options.layoutOrder ? [...options.layoutOrder] : undefined;
  if (requestedOrder && (requestedOrder.length !== ids.length ||
      new Set(requestedOrder).size !== ids.length ||
      requestedOrder.some((id) => !ids.includes(id)))) {
    throw new Error("layoutOrder must contain each layer id exactly once");
  }
  const braidedOptions = { ...DEFAULT_BRAIDED_STREAM_OPTIONS, ...options.braided };
  if (!Number.isFinite(braidedOptions.bandwidthRatio) || braidedOptions.bandwidthRatio <= 0) {
    throw new Error("braided bandwidthRatio beta must be finite and positive");
  }

  const analysis = computeAnalysisTopology(valid.layers, braidedOptions.bandwidthRatio);
  const pid = computePidFromAnalysis(ids, analysis);
  const order = requestedOrder ?? pid.order;
  const orderedIndices = order.map((id) => ids.indexOf(id));
  const orderedAnalysis = orderedIndices.map((index) => analysis[index]);
  const topology = branchTopologyFromAnalysis(orderedAnalysis);
  const orderedQuantiles = orderedIndices.map((index) => valid.layers[index].measures.map(getBraidedQuantiles));
  const orderedLayers: LayoutLayer[] = orderedIndices.map((index) => ({
    id: valid.layers[index].id,
    magnitude: analysis[index].map((cell) => cell?.summary.representative ?? 0),
  }));
  const base = baseline(orderedLayers, order, options.baselineMode);
  const h0 = h0FromLayers(orderedLayers);
  const requested = requestDynamicSpaces(topology);
  const slotLayers: LayoutLayer[] = orderedLayers.map((layer, layerIndex) => ({
    id: layer.id,
    magnitude: layer.magnitude.map((value, time) => value + requested.actual[layerIndex][time]),
  }));
  const slotBase = baseline(slotLayers, order, options.baselineMode);
  const braided = buildLayerSlotGeometry(
    orderedLayers,
    orderedQuantiles,
    topology,
    slotBase,
    requested,
    braidedOptions,
  );
  const densityProfiles = options.densityProfileBins === undefined
    ? undefined
    : densityProfilesFromAnalysis(orderedAnalysis, options.densityProfileBins);
  const inputOrderQuantiles = valid.layers.map((layer) => layer.measures.map((measure) =>
    measure ? getBraidedQuantiles(measure) : null
  ));
  return {
    validation: { ok: true, issues: [] },
    pid,
    layoutOrder: order,
    uncertainty: computeUncertainty(inputOrderQuantiles, 1e-9, 0),
    base,
    braided,
    densityProfiles,
    options: braidedOptions,
    costs: computeGeometryCosts(base, braided, h0),
    yExtent: Math.max(1, ...h0),
  };
}

export function h0FromLayers(layers: readonly LayoutLayer[]): number[] {
  const height = new Array<number>(layers[0].magnitude.length).fill(0);
  for (const layer of layers) {
    for (let time = 0; time < height.length; time += 1) height[time] += layer.magnitude[time];
  }
  return height;
}

function baseline(
  layers: LayoutLayer[],
  order: string[],
  mode: PipelineOptions["baselineMode"],
) {
  return (mode ?? "wiggle") === "sine"
    ? computeSineBaseline(layers, order)
    : computeWiggleBaseline(layers, order);
}

export type { InputDataset, InputLayer, MeasureComponent, ProbabilityMeasure } from "./input";
export type { BraidedStreamOptions, PipelineResult } from "./engine/types";
