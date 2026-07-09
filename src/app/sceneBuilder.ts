import { computeBaseline, computeOptimizingBaseline } from "../core/baseline/compute";
import type { DatasetBundle } from "../data/datasets";
import { orderLayers } from "../core/ordering/display";
import { optimizeLayerOrder, type OrderOptimizationResult } from "../core/ordering/sineStream";
import { computeOptimizingOrder, type OptimizingOrderResult } from "./optimizingOrder";
import {
  optimizingBaselineModeLabel,
  optimizingStageLabel,
  orderingScoringLabel,
  resolveOptimizingVariantConfig,
  type OptimizingVariantConfig
} from "../optimizingConfig";
import { clampRoiToParent, normalizeROI } from "../interactions/roi";
import { computeStackedBoundaries } from "../core/stack";
import { emptyInvariantSummary } from "../core/validate";
import type {
  BaselineMode,
  DatasetKind,
  HorizonFilterMode,
  InvariantSummary,
  LayerInput,
  PidUncertaintySource,
  PreparedDataset,
  ROI,
  StackLayout
} from "../core/types";
import { preprocessDataset } from "../data/transforms";
import { computeMetrics, type MetricResult, toMultiscaleDiagnosticsSummary } from "../layout/metrics";
import type { AppState } from "../state/appState";
import {
  layoutScourTree,
  solveRecursiveScour,
  type ScourConfig
} from "../core/temp";

export interface SceneBuildResult {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  baseLayout: StackLayout;
  afterLayout: StackLayout;
  roi: ROI;
  insetRoi: ROI;
  metrics: MetricResult;
  notes: string[];
  diagnosticsNotes: string[];
  usesPid: boolean;
  pidUncertaintySource: PidUncertaintySource | null;
}

export type { OptimizingVariantConfig } from "../optimizingConfig";

export function buildScene(bundle: DatasetBundle, state: AppState): SceneBuildResult {
  const context = prepareDatasetWindowContext(bundle, state);
  const orderedLayers = orderLayers(context.dataset.layers, context.dataset.order);
  const baseline = computeBaseline(context.dataset.times, orderedLayers, state.baseline, baselineHooksFromState(state));
  const baseLayout = computeStackedBoundaries(baseline, orderedLayers);
  const afterLayout = baseLayout;
  const invariant = runInvariantChecks(orderedLayers, afterLayout, {
    enabled: state.assertEnabled,
    throwOnError: false
  });
  const metrics = computeMetrics(context.dataset, baseLayout, afterLayout, context.insetRoi, invariant, orderedLayers, {
    includeGlobalRows: true
  });
  const diagnosticsNotes = ["main reference: original order + centered baseline"];

  return {
    dataset: context.dataset,
    orderedLayers,
    baseLayout,
    afterLayout,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes,
    usesPid: false,
    pidUncertaintySource: null
  };
}

export function buildOptimizingVariantScene(
  bundle: DatasetBundle,
  state: AppState,
  config: OptimizingVariantConfig
): SceneBuildResult {
  const context = prepareDatasetWindowContext(bundle, state);
  const resolvedConfig = resolveOptimizingVariantConfig(config);
  const orderResult = computeOptimizingOrder(context.dataset, resolvedConfig);
  const orderedLayers = orderLayers(context.dataset.layers, orderResult.displayOrder);

  if (resolvedConfig.baselineMode === "scour") {
    return buildScourVariantScene(context, config, resolvedConfig, orderResult, orderedLayers);
  }

  const baselineResult = computeOptimizingBaseline(
    context.dataset.times,
    orderedLayers,
    resolvedConfig.baselineMode,
    resolvedConfig.baselineHooks,
    resolvedConfig.baselineUncertaintyWeight,
    resolvedConfig.multiscaleEnergyThreshold
  );
  const layoutStack = computeStackedBoundaries(baselineResult.baseline, orderedLayers);
  const invariant = emptyInvariantSummary();
  const metrics = computeMetrics(context.dataset, layoutStack, layoutStack, context.insetRoi, invariant, orderedLayers, {
    includeGlobalRows: true,
    multiscale: baselineResult.multiscaleDiagnostics
      ? toMultiscaleDiagnosticsSummary(baselineResult.multiscaleDiagnostics)
      : null
  });
  const diagnosticsNotes = [
    `stage: ${optimizingStageLabel(config.optimizingStage)}`,
    config.optimizingStage === "ours"
      ? "method: common-interface joint layer ordering + baseline optimization"
      : `ordering scoring: ${orderingScoringLabel(resolvedConfig.orderingScoringMode)}`,
    `baseline: ${optimizingBaselineModeLabel(resolvedConfig.baselineMode)}`,
    ...orderResult.notes
  ];
  if (baselineResult.multiscaleDiagnostics !== null) {
    diagnosticsNotes.push(`multiscale wave strength: ${Math.max(0, resolvedConfig.baselineUncertaintyWeight).toFixed(3)}`);
    diagnosticsNotes.push(...multiscaleDiagnosticsNotes(baselineResult.multiscaleDiagnostics));
  }
  const usesPid = isPidOrderingMode(resolvedConfig.orderingScoringMode);

  return {
    dataset: context.dataset,
    orderedLayers,
    baseLayout: layoutStack,
    afterLayout: layoutStack,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes,
    usesPid,
    pidUncertaintySource: usesPid ? resolvedConfig.pidUncertaintySource : null
  };
}

function buildScourVariantScene(
  context: DatasetWindowContext,
  config: OptimizingVariantConfig,
  resolvedConfig: OptimizingVariantConfig,
  orderResult: OptimizingOrderResult,
  orderedLayers: LayerInput[]
): SceneBuildResult {
  const heights = orderedLayers.map((layer) =>
    layer.height.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0))
  );
  const scourConfig: ScourConfig = {
    ...resolvedConfig.scour,
    searchMode: orderedLayers.length <= 12 ? "exact" : "greedy",
    seed: resolvedConfig.sineOrder.fixedSeed
  };
  const { tree, debug } = solveRecursiveScour(heights, scourConfig);
  const rawLayout = layoutScourTree(heights, tree);
  const renderOrder = normalizeScourRenderOrder(rawLayout.order, orderedLayers.length);
  const scourOrderedLayers = renderOrder.map((index) => orderedLayers[index]);
  const layoutStack: StackLayout = {
    baseline: rawLayout.centerline.slice(),
    yBottom: renderOrder.map((index) => cloneSeries(rawLayout.yBottom[index], context.dataset.times.length)),
    yTop: renderOrder.map((index) => cloneSeries(rawLayout.yTop[index], context.dataset.times.length))
  };
  const invariant = emptyInvariantSummary();
  const metrics = computeMetrics(context.dataset, layoutStack, layoutStack, context.insetRoi, invariant, scourOrderedLayers, {
    includeGlobalRows: true
  });
  const diagnosticsNotes = [
    `stage: ${optimizingStageLabel(config.optimizingStage)}`,
    config.optimizingStage === "ours"
      ? "method: common-interface joint layer ordering + baseline optimization"
      : `ordering scoring: ${orderingScoringLabel(resolvedConfig.orderingScoringMode)}`,
    `baseline: ${optimizingBaselineModeLabel(resolvedConfig.baselineMode)}`,
    ...orderResult.notes,
    `scour search: ${scourConfig.searchMode}, maxDepth=${scourConfig.maxDepth}, rho=${scourConfig.rhoSplit.toFixed(3)}`,
    `scour moving interface: mode=${scourConfig.movingInterfaceMode}, lambda=${scourConfig.movingInterfaceLambda.toFixed(3)}, anchor=${scourConfig.movingInterfaceAnchorWeight.toFixed(3)}, weight=${scourConfig.movingInterfaceWeight.toFixed(3)}, nodes=${rawLayout.nodeWiseMovingInterfaces.length}`,
    `scour cost: total=${debug.totalCost.toFixed(3)}, chain=${debug.chainCost?.toFixed(3) ?? "N/A"}, depth=${debug.recursionDepth}`,
    debug.selectedSplit ? `scour root split: ${debug.selectedSplit}` : "",
    summarizeScourTree(debug.treeStructure)
  ].filter((text) => text.length > 0);
  const usesPid = isPidOrderingMode(resolvedConfig.orderingScoringMode);

  return {
    dataset: context.dataset,
    orderedLayers: scourOrderedLayers,
    baseLayout: layoutStack,
    afterLayout: layoutStack,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes,
    usesPid,
    pidUncertaintySource: usesPid ? resolvedConfig.pidUncertaintySource : null
  };
}

function normalizeScourRenderOrder(order: number[], layerCount: number): number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= layerCount || seen.has(index)) {
      continue;
    }
    seen.add(index);
    normalized.push(index);
  }

  for (let index = 0; index < layerCount; index += 1) {
    if (!seen.has(index)) {
      normalized.push(index);
    }
  }

  return normalized;
}

function cloneSeries(series: number[] | undefined, length: number): number[] {
  if (!series) {
    return new Array<number>(length).fill(0);
  }
  return Array.from({ length }, (_value, index) => series[index] ?? 0);
}

function summarizeScourTree(treeStructure: string): string {
  const lines = treeStructure
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }
  const visible = lines.slice(0, 6).join(" / ");
  return lines.length > 6 ? `scour tree: ${visible} / ...` : `scour tree: ${visible}`;
}

export function defaultWindow(length: number): ROI {
  if (length <= 1) {
    return { t0Index: 0, t1Index: 0 };
  }
  const span = Math.max(8, Math.floor(length * 0.28));
  const right = length - 1;
  const left = Math.max(0, right - span);
  return { t0Index: left, t1Index: right };
}

export function applyHorizonFilter(
  dataset: PreparedDataset,
  kind: DatasetKind,
  horizon: HorizonFilterMode
): PreparedDataset {
  if (kind !== "covid") {
    return dataset;
  }
  const layers = dataset.layers.filter((layer) => layer.id.endsWith(`|${horizon}`));
  if (layers.length === 0) {
    return dataset;
  }
  const selected = new Set(layers.map((layer) => layer.id));
  return {
    times: dataset.times,
    layers,
    order: dataset.order.filter((id) => selected.has(id))
  };
}

interface SceneContext {
  dataset: PreparedDataset;
  activeRoi: ROI;
  insetRoi: ROI;
  optimized: OrderOptimizationResult;
  orderedLayers: LayerInput[];
  preprocessedNotes: string[];
}

interface DatasetWindowContext {
  dataset: PreparedDataset;
  activeRoi: ROI;
  insetRoi: ROI;
  preprocessedNotes: string[];
}

interface SceneContextOptions {
  optimizeScope: "full" | "roi";
  orderWithUncertainty?: boolean;
}

function prepareDatasetWindowContext(bundle: DatasetBundle, state: AppState): DatasetWindowContext {
  // Clone/normalize incoming dataset first so scene building stays side-effect free.
  const preprocessed = preprocessDataset(bundle.dataset);
  // Covid horizon selection changes layer set but preserves the original timeline.
  const dataset = applyHorizonFilter(preprocessed.dataset, bundle.kind, state.covidHorizonFilter);
  const activeRoi = normalizeROI(state.ROI, dataset.times.length) ?? defaultWindow(dataset.times.length);
  const insetRoi =
    clampRoiToParent(normalizeROI(state.insetROI, dataset.times.length), activeRoi) ??
    activeRoi;

  return {
    dataset,
    activeRoi,
    insetRoi,
    preprocessedNotes: preprocessed.notes
  };
}

function prepareSceneContext(bundle: DatasetBundle, state: AppState, options: SceneContextOptions): SceneContext {
  const base = prepareDatasetWindowContext(bundle, state);
  const orderRoi = options.optimizeScope === "roi" ? base.activeRoi : null;
  const orderWithUncertainty = options.orderWithUncertainty === true;
  // Optimizing tab may focus ordering on ROI; other views keep full-timeline ordering.
  const optimized = optimizeLayerOrder(
    base.dataset.layers,
    orderRoi,
    {
      clusterAutoCutScale: state.optimization.clusterAutoCutScale,
      clusterBoundaryPenalty: state.optimization.clusterBoundaryPenalty,
      similaritySigma: state.optimization.orderSimilaritySigma,
      maxSwapPasses: state.optimization.orderMaxSwapPasses,
      weightType: state.optimization.orderWeightType ?? "max",
      useThicknessWeight: state.optimization.orderUseThicknessWeight !== false,
      useLengthWeight: state.optimization.orderUseLengthWeight !== false,
      lengthWeightThreshold: state.optimization.orderLengthWeightThreshold ?? 9,
      shuffleSeed: state.fixedSeed,
      useUncertaintyTerm: orderWithUncertainty,
      uncertaintyWeight: orderWithUncertainty ? Math.max(0, state.optimization.orderUncertaintyWeight ?? 0.35) : 0
    },
    base.dataset.order
  );
  const orderedLayers = orderLayers(base.dataset.layers, optimized.order);
  return {
    dataset: base.dataset,
    activeRoi: base.activeRoi,
    insetRoi: base.insetRoi,
    optimized,
    orderedLayers,
    preprocessedNotes: base.preprocessedNotes
  };
}

function baselineHooksFromState(state: AppState) {
  return {
    centerType: state.optimization.baselineCenterType ?? "median",
    wiggleWeightL1: state.optimization.wiggleWeightL1,
    wiggleWeightL2: state.optimization.wiggleWeightL2,
    weightedWiggle: true,
    centerAnchorWeight: state.optimization.centerAnchorWeight,
    irlsIterations: state.optimization.irlsIterations,
    irlsEps: state.optimization.irlsEps
  };
}

function orderDiagnosticsNotes(optimized: OrderOptimizationResult): string[] {
  return [
    `order objective: ${optimized.diagnostics.objectiveBefore.toFixed(3)} -> ${optimized.diagnostics.objectiveAfter.toFixed(3)}`,
    `clusters: count=${optimized.diagnostics.clusterCount}, trunk=${optimized.diagnostics.trunkCluster}, cross-boundaries=${optimized.diagnostics.crossClusterBoundaries}`
  ];
}

function multiscaleDiagnosticsNotes(diagnostics: {
  fallbackUsed: boolean;
  fallbackReason: string | null;
  verifiedMultiscale: boolean;
  effectiveScaleCount: number;
  selectedScaleCount?: number;
  selectedScales?: number[];
  energyThreshold: number;
  localShiftBudget: number;
  distributedShiftBudget: number;
  objectiveBefore?: number;
  objectiveAfter?: number;
  meanSlopeBefore?: number;
  meanSlopeAfter?: number;
  maxSlopeBefore?: number;
  maxSlopeAfter?: number;
  curvatureBefore?: number;
  curvatureAfter?: number;
  burstBefore?: number;
  burstAfter?: number;
  derivativeConcentrationBefore?: number;
  derivativeConcentrationAfter?: number;
  centerlineSlopeCoverageBefore?: number;
  centerlineSlopeCoverageAfter?: number;
  globalMeanSlopeGuardrailPassed?: boolean;
  scaleCoefficients?: Array<{ scale: number; coefficient: number }>;
  scaleBands: Array<{ scale: number; ratio: number }>;
}): string[] {
  const topBands = diagnostics.scaleBands
    .slice()
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3)
    .map((band) => `${band.scale}:${(band.ratio * 100).toFixed(1)}%`)
    .join(", ");
  const coefficients = (diagnostics.scaleCoefficients ?? [])
    .filter((item) => Math.abs(item.coefficient) > 1e-6)
    .map((item) => `${item.scale}:${item.coefficient.toFixed(2)}`)
    .join(", ");
  const objective =
    Number.isFinite(diagnostics.objectiveBefore) && Number.isFinite(diagnostics.objectiveAfter)
      ? `multiscale objective: ${diagnostics.objectiveBefore?.toFixed(3)} -> ${diagnostics.objectiveAfter?.toFixed(3)}, slope-cap=${diagnostics.globalMeanSlopeGuardrailPassed ? "pass" : "soft breach"}`
      : "";
  const coverage =
    Number.isFinite(diagnostics.centerlineSlopeCoverageBefore) &&
    Number.isFinite(diagnostics.centerlineSlopeCoverageAfter)
      ? `centerline slope coverage: ${diagnostics.centerlineSlopeCoverageBefore?.toFixed(3)} -> ${diagnostics.centerlineSlopeCoverageAfter?.toFixed(3)}`
      : "";
  return [
    `multiscale baseline: verified=${diagnostics.verifiedMultiscale ? "yes" : "no"}, fallback=${diagnostics.fallbackUsed ? "yes" : "no"}`,
    `multiscale selected/effective scales: ${diagnostics.selectedScaleCount ?? diagnostics.effectiveScaleCount}/${diagnostics.effectiveScaleCount} (threshold=${diagnostics.energyThreshold.toFixed(2)})`,
    `multiscale shift budget: local=${diagnostics.localShiftBudget.toFixed(3)}, distributed=${diagnostics.distributedShiftBudget.toFixed(3)}`,
    objective,
    coverage,
    diagnostics.fallbackUsed && diagnostics.fallbackReason ? `multiscale fallback reason: ${diagnostics.fallbackReason}` : "",
    topBands ? `multiscale top scale ratios: ${topBands}` : "",
    coefficients ? `multiscale active coefficients: ${coefficients}` : "multiscale active coefficients: none"
  ].filter((text) => text.length > 0);
}

function isPidOrderingMode(mode: string): boolean {
  return mode === "intervalInclusion" || mode === "pidMean" || mode === "pidTimeWeighted";
}

interface AssertionOptions {
  enabled: boolean;
  epsilon?: number;
  throwOnError?: boolean;
  maxMessages?: number;
}

function runInvariantChecks(
  orderedLayers: LayerInput[],
  layout: StackLayout,
  options: AssertionOptions
): InvariantSummary {
  if (!options.enabled) {
    return { checked: false, violations: [], maxThicknessError: 0 };
  }
  const eps = options.epsilon ?? 1e-6;
  const maxMessages = options.maxMessages ?? 30;
  const tLength = layout.baseline.length;
  const kLength = orderedLayers.length;

  const violations: string[] = [];
  let skipped = 0;
  let maxThicknessError = 0;

  const pushViolation = (message: string): void => {
    if (violations.length < maxMessages) {
      violations.push(message);
    } else {
      skipped += 1;
    }
  };

  for (let k = 0; k < kLength; k += 1) {
    for (let t = 0; t < tLength; t += 1) {
      const thickness = layout.yTop[k][t] - layout.yBottom[k][t];
      const err = Math.abs(thickness - orderedLayers[k].height[t]);
      maxThicknessError = Math.max(maxThicknessError, err);
      if (err > eps) {
        pushViolation(`A thickness mismatch at k=${k}, t=${t}, err=${err.toExponential(3)}`);
      }
    }
  }

  for (let k = 0; k < kLength - 1; k += 1) {
    for (let t = 0; t < tLength; t += 1) {
      if (layout.yBottom[k + 1][t] + eps < layout.yTop[k][t]) {
        pushViolation(`C overlap at between k=${k} and k+1, t=${t}`);
      }
    }
  }

  if (skipped > 0) {
    violations.push(`... and ${skipped} more violations`);
  }
  if (options.throwOnError && violations.length > 0) {
    throw new Error(violations.join("\n"));
  }
  return {
    checked: true,
    violations,
    maxThicknessError
  };
}
