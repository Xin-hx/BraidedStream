import { computeBaseline, computeMultiscaleDistributedBaseline, type SineStreamHooks } from "../core/baseline";
import { computeBraidLayout } from "../core/braid";
import type { DatasetBundle } from "../core/datasets";
import { optimizeLayerOrder, type OrderOptimizationResult } from "../core/optimizeOrder";
import {
  buildPidCenterOutOrder,
  computeContourPid,
  computePidOrdering,
  computePidOrderingScores,
  computeTemporalSelfInclusion
} from "../core/pid";
import { clampRoiToParent, normalizeROI } from "../core/roi";
import { computeStackedBoundaries } from "../core/stack";
import type {
  BaselineMode,
  BraidLayout,
  DatasetKind,
  HorizonFilterMode,
  InvariantSummary,
  LayerInput,
  OrderingScoringMode,
  OptimizeMethod,
  PidBaselineMode,
  PidUncertaintySource,
  PreparedDataset,
  ROI,
  StackLayout
} from "../core/types";
import { layerUncertaintyAt, orderLayers } from "../core/validate";
import { preprocessDataset } from "../data/transforms";
import { computeMetrics, type MetricResult } from "../layout/metrics";
import type { AppState } from "../state/appState";

export interface SceneBuildResult {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  baseLayout: StackLayout;
  braidedLayout: BraidLayout;
  roi: ROI;
  insetRoi: ROI;
  metrics: MetricResult;
  notes: string[];
  diagnosticsNotes: string[];
}

export interface OptimizingVariantConfig {
  orderingScoringMode: OrderingScoringMode;
  baselineMode: PidBaselineMode;
  pidUncertaintySource: PidUncertaintySource;
  pidTimeAlpha: number;
  baselineUncertaintyWeight: number;
  baselineHooks: SineStreamHooks;
}

export function buildScene(bundle: DatasetBundle, state: AppState): SceneBuildResult {
  const context = prepareSceneContext(bundle, state, { optimizeScope: "full" });
  // 1) Baseline + stack define the reference layout without uncertainty spacing.
  const baseline = computeBaseline(context.dataset.times, context.orderedLayers, state.baseline, baselineHooksFromState(state));
  const baseLayout = computeStackedBoundaries(baseline, context.orderedLayers);

  // 2) Braiding injects uncertainty-aware gaps on top of the base stack.
  const effectiveGapMode = state.enableUncertaintyGap ? state.gapMode : "none";
  const braidedLayout = computeBraidLayout({
    base: baseLayout,
    orderedLayers: context.orderedLayers,
    roi: context.insetRoi,
    baselineMode: state.baseline,
    gapMode: effectiveGapMode,
    gapAlphaPx: state.gapAlphaPx,
    maxExtraHeightPx: state.maxExtraHeightPx,
    spacingBudgetPx: state.optimization.spacingBudgetPx,
    spacingUncertaintyWeight: state.optimization.spacingUncertaintyWeight,
    spacingSlopeWeight: state.optimization.spacingSlopeWeight,
    spacingTemporalWeight: state.optimization.spacingTemporalWeight,
    spacingIterations: state.optimization.spacingIterations,
    boundaryPenalty: context.optimized.boundaryPenalty,
    smoothKernel: state.smoothKernel,
    yScale: (v) => v
  });

  if (braidedLayout.diagnostics) {
    braidedLayout.diagnostics.orderObjectiveBefore = context.optimized.diagnostics.objectiveBefore;
    braidedLayout.diagnostics.orderObjectiveAfter = context.optimized.diagnostics.objectiveAfter;
    braidedLayout.diagnostics.clusterCount = context.optimized.diagnostics.clusterCount;
    braidedLayout.diagnostics.trunkCluster = context.optimized.diagnostics.trunkCluster;
    braidedLayout.diagnostics.crossClusterBoundaries = context.optimized.diagnostics.crossClusterBoundaries;
  }

  const invariant = runInvariantChecks(context.orderedLayers, baseLayout, braidedLayout, context.insetRoi, {
    enabled: state.assertEnabled,
    throwOnError: false
  });
  const metrics = computeMetrics(context.dataset, baseLayout, braidedLayout, context.insetRoi, invariant, context.orderedLayers, {
    includeGlobalRows: true
  });
  const diagnosticsNotes = [...orderDiagnosticsNotes(context.optimized), ...gapDiagnosticsNotes(braidedLayout)];

  return {
    dataset: context.dataset,
    orderedLayers: context.orderedLayers,
    baseLayout,
    braidedLayout,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes
  };
}

export function buildOptimizingVariantScene(
  bundle: DatasetBundle,
  state: AppState,
  config: OptimizingVariantConfig
): SceneBuildResult {
  const context = prepareDatasetWindowContext(bundle, state);
  const orderResult = computeOptimizingOrder(context.dataset, config);
  const orderedLayers = orderLayers(context.dataset.layers, orderResult.displayOrder);
  const baselineResult = computeOptimizingBaseline(
    context.dataset.times,
    orderedLayers,
    config.baselineMode,
    config.baselineHooks,
    config.baselineUncertaintyWeight
  );
  const layoutStack = computeStackedBoundaries(baselineResult.baseline, orderedLayers);
  const layout = stackToBraidLayout(layoutStack);
  const invariant = emptyInvariantSummary();
  const metrics = computeMetrics(context.dataset, layoutStack, layout, context.insetRoi, invariant, orderedLayers, {
    includeGlobalRows: true
  });
  const diagnosticsNotes = [
    `ordering scoring: ${orderingScoringLabel(config.orderingScoringMode)}`,
    `baseline: ${pidBaselineModeLabel(config.baselineMode)}`,
    ...orderResult.notes
  ];
  if (baselineResult.multiscaleDiagnostics !== null) {
    diagnosticsNotes.push(`baseline uncertainty weight: ${Math.max(0, config.baselineUncertaintyWeight).toFixed(3)}`);
    diagnosticsNotes.push(...multiscaleDiagnosticsNotes(baselineResult.multiscaleDiagnostics));
  }

  return {
    dataset: context.dataset,
    orderedLayers,
    baseLayout: layoutStack,
    braidedLayout: layout,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes
  };
}

export function buildOptimizeComparisonScene(
  bundle: DatasetBundle,
  state: AppState,
  optimizeMethod: OptimizeMethod
): SceneBuildResult {
  const useMultiscale = optimizeMethod === "multiscale";
  const context = prepareSceneContext(bundle, state, {
    optimizeScope: state.optimizeWithinROI ? "roi" : "full",
    orderWithUncertainty: useMultiscale
  });
  const hooks = baselineHooksFromState(state);
  const uncStrength = Math.max(0, state.optimization.baselineUncertaintyWeight ?? 0.45);
  const beforeBaseline = computeBaseline(context.dataset.times, context.orderedLayers, "sineStream", hooks);
  const beforeLayout = computeStackedBoundaries(beforeBaseline, context.orderedLayers);
  let afterBaseline = beforeBaseline.slice();
  let multiscale: ReturnType<typeof computeMultiscaleDistributedBaseline> | null = null;
  if (useMultiscale) {
    multiscale = computeMultiscaleDistributedBaseline(context.dataset.times, context.orderedLayers, uncStrength, hooks, 0.08);
    afterBaseline = multiscale.baseline;
  }
  const afterLayoutStack = computeStackedBoundaries(afterBaseline, context.orderedLayers);
  const afterLayout = stackToBraidLayout(afterLayoutStack);

  const invariant = {
    checked: false,
    violations: [],
    maxThicknessError: 0
  };
  const metrics = computeMetrics(context.dataset, beforeLayout, afterLayout, context.insetRoi, invariant, context.orderedLayers, {
    semantic:
      multiscale === null
        ? undefined
        : {
            enableTpidCenterAlignment: true,
            baselineShiftBeforeAbs: new Array<number>(context.dataset.times.length).fill(0),
            baselineShiftAfterAbs: multiscale.diagnostics.distributedShiftAbs,
            uncertaintySaliency: multiscale.diagnostics.uncertaintySaliency
          },
    multiscale:
      multiscale === null
        ? null
        : {
            method: multiscale.diagnostics.method,
            verified: multiscale.diagnostics.verifiedMultiscale,
            fallbackUsed: multiscale.diagnostics.fallbackUsed,
            effectiveScaleCount: multiscale.diagnostics.effectiveScaleCount,
            threshold: multiscale.diagnostics.energyThreshold,
            scaleBands: multiscale.diagnostics.scaleBands.map((band) => ({ scale: band.scale, ratio: band.ratio }))
          },
    includeGlobalRows: true
  });
  const diagnosticsNotes = [...orderDiagnosticsNotes(context.optimized)];
  if (multiscale !== null) {
    diagnosticsNotes.push(`baseline uncertainty weight: ${uncStrength.toFixed(3)}`);
    diagnosticsNotes.push(...multiscaleDiagnosticsNotes(multiscale.diagnostics));
  }
  return {
    dataset: context.dataset,
    orderedLayers: context.orderedLayers,
    baseLayout: beforeLayout,
    braidedLayout: afterLayout,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes
  };
}

export function buildBraidedEnhanceScene(
  bundle: DatasetBundle,
  state: AppState,
  baselineMode: BaselineMode
): SceneBuildResult {
  const context = prepareSceneContext(bundle, state, { optimizeScope: "full" });
  const baseline = computeBaseline(context.dataset.times, context.orderedLayers, baselineMode, baselineHooksFromState(state));
  const baseLayout = computeStackedBoundaries(baseline, context.orderedLayers);

  const effectiveGapMode = state.enableUncertaintyGap ? state.gapMode : "none";
  const braidedLayout = computeBraidLayout({
    base: baseLayout,
    orderedLayers: context.orderedLayers,
    roi: context.insetRoi,
    baselineMode,
    gapMode: effectiveGapMode,
    gapAlphaPx: state.gapAlphaPx,
    maxExtraHeightPx: state.maxExtraHeightPx,
    spacingBudgetPx: state.optimization.spacingBudgetPx,
    spacingUncertaintyWeight: state.optimization.spacingUncertaintyWeight,
    spacingSlopeWeight: state.optimization.spacingSlopeWeight,
    spacingTemporalWeight: state.optimization.spacingTemporalWeight,
    spacingIterations: state.optimization.spacingIterations,
    boundaryPenalty: context.optimized.boundaryPenalty,
    smoothKernel: state.smoothKernel,
    yScale: (v) => v
  });

  if (braidedLayout.diagnostics) {
    braidedLayout.diagnostics.orderObjectiveBefore = context.optimized.diagnostics.objectiveBefore;
    braidedLayout.diagnostics.orderObjectiveAfter = context.optimized.diagnostics.objectiveAfter;
    braidedLayout.diagnostics.clusterCount = context.optimized.diagnostics.clusterCount;
    braidedLayout.diagnostics.trunkCluster = context.optimized.diagnostics.trunkCluster;
    braidedLayout.diagnostics.crossClusterBoundaries = context.optimized.diagnostics.crossClusterBoundaries;
  }

  const invariant = runInvariantChecks(context.orderedLayers, baseLayout, braidedLayout, context.insetRoi, {
    enabled: state.assertEnabled,
    throwOnError: false
  });
  const metrics = computeMetrics(context.dataset, baseLayout, braidedLayout, context.insetRoi, invariant, context.orderedLayers, {
    includeGlobalRows: true
  });

  return {
    dataset: context.dataset,
    orderedLayers: context.orderedLayers,
    baseLayout,
    braidedLayout,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes: [...orderDiagnosticsNotes(context.optimized), ...gapDiagnosticsNotes(braidedLayout)]
  };
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

export function recommendHighUncertaintyRoi(dataset: PreparedDataset, parent: ROI | null): ROI {
  const fallback = parent ?? defaultWindow(dataset.times.length);
  const left = Math.max(0, fallback.t0Index);
  const right = Math.min(dataset.times.length - 1, fallback.t1Index);
  const span = right - left + 1;
  if (span <= 2) {
    return { t0Index: left, t1Index: right };
  }

  const subSpan = Math.max(3, Math.floor(span * 0.45));
  let bestL = left;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let l = left; l + subSpan - 1 <= right; l += 1) {
    const r = l + subSpan - 1;
    let score = 0;
    for (let t = l; t <= r; t += 1) {
      for (const layer of dataset.layers) {
        score += layerUncertaintyAt(layer, t);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestL = l;
    }
  }

  return {
    t0Index: bestL,
    t1Index: Math.min(right, bestL + subSpan - 1)
  };
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
    recommendHighUncertaintyRoi(dataset, activeRoi);

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

function computeOptimizingOrder(
  dataset: PreparedDataset,
  config: OptimizingVariantConfig
): { displayOrder: string[]; notes: string[] } {
  const uncertaintySource = config.pidUncertaintySource;
  if (config.orderingScoringMode === "pidMean") {
    const contourPid = computeContourPid(dataset.layers, {
      yBins: 180,
      valueTransform: uncertaintySource === "poportion" ? "linear" : "log1p",
      centralFraction: 0.5,
      contourThreshold: 0.5,
      uncertaintySource
    });
    const top = contourPid.scores[0];
    return {
      displayOrder: contourPid.displayOrder,
      notes: [
        "PID scoring: contour PID-Mean over time-value fuzzy masks",
        top ? `top PID layer: ${layerLabel(top.id)} depth=${top.depth.toFixed(3)}` : "top PID layer: N/A"
      ]
    };
  }

  const pid = computePidOrdering(dataset.layers, {
    excludeSelf: true,
    widthPenaltyPower: 1,
    minComparators: 2,
    uncertaintySource
  });

  if (config.orderingScoringMode === "pidTimeWeighted") {
    const temporalSelfInclusion = computeTemporalSelfInclusion(pid.depthSeriesByLayerId);
    const scores = computePidOrderingScores({
      layerIds: dataset.layers.map((layer) => layer.id),
      D_cross: pid.depthSeriesByLayerId,
      temporalSelfInclusion,
      mode: "layer_pid_time_weighted",
      alpha: config.pidTimeAlpha
    });
    const top = scores[0];
    return {
      displayOrder: buildPidCenterOutOrder(scores.map((score) => score.layerId)),
      notes: [
        `PID time scoring: alpha=${Math.max(0, Math.min(1, config.pidTimeAlpha)).toFixed(2)}`,
        top ? `top PID-time layer: ${layerLabel(top.layerId)} score=${top.score.toFixed(3)}` : "top PID-time layer: N/A"
      ]
    };
  }

  const top = pid.scores[0];
  return {
    displayOrder: buildPidCenterOutOrder(pid.order),
    notes: [
      "one-way inclusion: interval center covered by peer uncertainty bands",
      top ? `top inclusion layer: ${layerLabel(top.id)} depth=${top.depth.toFixed(3)}` : "top inclusion layer: N/A"
    ]
  };
}

function computeOptimizingBaseline(
  times: number[],
  orderedLayers: LayerInput[],
  mode: PidBaselineMode,
  hooks: SineStreamHooks,
  uncertaintyStrength: number
): { baseline: number[]; multiscaleDiagnostics: ReturnType<typeof computeMultiscaleDistributedBaseline>["diagnostics"] | null } {
  if (mode === "multiscale") {
    const result = computeMultiscaleDistributedBaseline(times, orderedLayers, Math.max(0, uncertaintyStrength), hooks, 0.08);
    return {
      baseline: result.baseline,
      multiscaleDiagnostics: result.diagnostics
    };
  }
  return {
    baseline: computeBaseline(times, orderedLayers, mode as BaselineMode, hooks),
    multiscaleDiagnostics: null
  };
}

function emptyInvariantSummary(): InvariantSummary {
  return {
    checked: false,
    violations: [],
    maxThicknessError: 0
  };
}

function baselineHooksFromState(state: AppState) {
  return {
    centerType: state.optimization.baselineCenterType ?? "median",
    wiggleWeightL1: state.optimization.wiggleWeightL1,
    wiggleWeightL2: state.optimization.wiggleWeightL2,
    centerAnchorWeight: state.optimization.centerAnchorWeight,
    irlsIterations: state.optimization.irlsIterations,
    irlsEps: state.optimization.irlsEps
  };
}

function orderingScoringLabel(mode: OrderingScoringMode): string {
  if (mode === "pidMean") {
    return "PID";
  }
  if (mode === "pidTimeWeighted") {
    return "PID + time trend";
  }
  return "One-way inclusion";
}

function pidBaselineModeLabel(mode: PidBaselineMode): string {
  if (mode === "l1") {
    return "L1";
  }
  if (mode === "l2") {
    return "L2";
  }
  if (mode === "sineStream") {
    return "SineStream";
  }
  return "Multiscale";
}

function layerLabel(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}

function orderDiagnosticsNotes(optimized: OrderOptimizationResult): string[] {
  return [
    `order objective: ${optimized.diagnostics.objectiveBefore.toFixed(3)} -> ${optimized.diagnostics.objectiveAfter.toFixed(3)}`,
    `clusters: count=${optimized.diagnostics.clusterCount}, trunk=${optimized.diagnostics.trunkCluster}, cross-boundaries=${optimized.diagnostics.crossClusterBoundaries}`
  ];
}

function gapDiagnosticsNotes(braidedLayout: BraidLayout): string[] {
  if (!braidedLayout.diagnostics) {
    return [];
  }
  return [
    `uncertainty-gap objective: total=${braidedLayout.diagnostics.spacingObjective.toFixed(3)}, unc=${braidedLayout.diagnostics.spacingUncertaintyTerm.toFixed(3)}, slope=${braidedLayout.diagnostics.spacingSlopeTerm.toFixed(3)}, temporal=${braidedLayout.diagnostics.spacingTemporalTerm.toFixed(3)}, iterations=${braidedLayout.diagnostics.spacingIterations}`
  ];
}

function multiscaleDiagnosticsNotes(diagnostics: {
  fallbackUsed: boolean;
  fallbackReason: string | null;
  verifiedMultiscale: boolean;
  effectiveScaleCount: number;
  energyThreshold: number;
  localShiftBudget: number;
  distributedShiftBudget: number;
  scaleBands: Array<{ scale: number; ratio: number }>;
}): string[] {
  const topBands = diagnostics.scaleBands
    .slice()
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3)
    .map((band) => `${band.scale}:${(band.ratio * 100).toFixed(1)}%`)
    .join(", ");
  return [
    `multiscale baseline: verified=${diagnostics.verifiedMultiscale ? "yes" : "no"}, fallback=${diagnostics.fallbackUsed ? "yes" : "no"}`,
    `multiscale effective scales: ${diagnostics.effectiveScaleCount} (threshold=${diagnostics.energyThreshold.toFixed(2)})`,
    `multiscale shift budget: local=${diagnostics.localShiftBudget.toFixed(3)}, distributed=${diagnostics.distributedShiftBudget.toFixed(3)}`,
    diagnostics.fallbackUsed && diagnostics.fallbackReason ? `multiscale fallback reason: ${diagnostics.fallbackReason}` : "",
    topBands ? `multiscale top scale ratios: ${topBands}` : ""
  ].filter((text) => text.length > 0);
}

interface AssertionOptions {
  enabled: boolean;
  epsilon?: number;
  throwOnError?: boolean;
  maxMessages?: number;
}

/** Scene-local invariant checks for braid development and diagnostics. */
function runInvariantChecks(
  orderedLayers: LayerInput[],
  base: StackLayout,
  braided: BraidLayout,
  _roi: ROI | null,
  options: AssertionOptions
): InvariantSummary {
  if (!options.enabled) {
    return { checked: false, violations: [], maxThicknessError: 0 };
  }
  const eps = options.epsilon ?? 1e-6;
  const maxMessages = options.maxMessages ?? 30;
  const tLength = base.baseline.length;
  const kLength = orderedLayers.length;
  const support = braided.roiSupport;

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
      const thickness = braided.yTop[k][t] - braided.yBottom[k][t];
      const err = Math.abs(thickness - orderedLayers[k].mean[t]);
      maxThicknessError = Math.max(maxThicknessError, err);
      if (err > eps) {
        pushViolation(`A thickness mismatch at k=${k}, t=${t}, err=${err.toExponential(3)}`);
      }
    }
  }

  for (let t = 0; t < tLength; t += 1) {
    const outsideSupport = !support || t < support.supportStart || t > support.supportEnd;
    if (outsideSupport) {
      for (let k = 0; k < braided.gapsValue.length; k += 1) {
        if (Math.abs(braided.gapsValue[k][t]) > eps) {
          pushViolation(`B non-zero gap outside ROI +/- tau at boundary=${k}, t=${t}`);
        }
      }
      for (let k = 0; k < kLength; k += 1) {
        const deltaBottom = Math.abs(braided.yBottom[k][t] - base.yBottom[k][t]);
        const deltaTop = Math.abs(braided.yTop[k][t] - base.yTop[k][t]);
        if (deltaBottom > eps || deltaTop > eps) {
          pushViolation(`B y differs outside ROI +/- tau at k=${k}, t=${t}`);
        }
      }
    }
  }

  for (let t = 0; t < tLength; t += 1) {
    const sumGap = braided.sumGapPx[t] ?? 0;
    if (sumGap < -eps) {
      pushViolation(`B sumGap negative at t=${t}`);
    }
  }

  for (let t = 0; t < tLength; t += 1) {
    const outsideSupport = !support || t < support.supportStart || t > support.supportEnd;
    if (outsideSupport && Math.abs(braided.omega[t]) > eps) {
      pushViolation(`D omega not zero outside support at t=${t}`);
    }
  }

  for (let k = 0; k < kLength - 1; k += 1) {
    for (let t = 0; t < tLength; t += 1) {
      if (braided.yBottom[k + 1][t] + eps < braided.yTop[k][t]) {
        pushViolation(`C overlap at between k=${k} and k+1, t=${t}`);
      }
    }
  }

  for (let t = 0; t < tLength; t += 1) {
    const value = braided.omega[t];
    if (!Number.isFinite(value)) {
      pushViolation(`D omega is non-finite at t=${t}`);
    } else if (value < -eps || value > 1 + eps) {
      pushViolation(`D omega outside [0,1] at t=${t}: ${value.toFixed(4)}`);
    }
  }

  if (support) {
    checkRoiSupportContinuity(base, braided, kLength, tLength, eps, pushViolation);
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

function checkRoiSupportContinuity(
  base: StackLayout,
  braided: BraidLayout,
  kLength: number,
  tLength: number,
  eps: number,
  pushViolation: (message: string) => void
): void {
  const support = braided.roiSupport;
  if (!support) {
    return;
  }
  const fullLeftRamp = support.coreStart - support.tau >= 0;
  const fullRightRamp = support.coreEnd + support.tau <= tLength - 1;
  if (fullLeftRamp && Math.abs(braided.omega[support.supportStart]) > eps) {
    pushViolation(`D omega at supportStart should be 0, t=${support.supportStart}`);
  }
  if (fullRightRamp && Math.abs(braided.omega[support.supportEnd]) > eps) {
    pushViolation(`D omega at supportEnd should be 0, t=${support.supportEnd}`);
  }
  if (Math.abs(braided.omega[support.coreStart] - 1) > eps) {
    pushViolation(`D omega at coreStart should be 1, t=${support.coreStart}`);
  }
  if (Math.abs(braided.omega[support.coreEnd] - 1) > eps) {
    pushViolation(`D omega at coreEnd should be 1, t=${support.coreEnd}`);
  }

  const maxOmegaDelta = support.tau > 0 ? 1.7 / support.tau : 1;
  for (let t = 1; t < tLength; t += 1) {
    const delta = Math.abs(braided.omega[t] - braided.omega[t - 1]);
    if (delta > maxOmegaDelta + 1e-3) {
      pushViolation(`D omega jump too large at t=${t}, delta=${delta.toFixed(4)}`);
    }
  }

  const s0 = support.supportStart;
  const s1 = support.supportEnd;
  for (let k = 0; k < kLength; k += 1) {
    const deltaStart = braided.yBottom[k][s0] - base.yBottom[k][s0];
    const deltaEnd = braided.yBottom[k][s1] - base.yBottom[k][s1];
    if (fullLeftRamp && Math.abs(deltaStart) > eps) {
      pushViolation(`D delta at supportStart not zero at k=${k}, t=${s0}`);
    }
    if (fullRightRamp && Math.abs(deltaEnd) > eps) {
      pushViolation(`D delta at supportEnd not zero at k=${k}, t=${s1}`);
    }
    if (fullLeftRamp && s0 > 0) {
      const before = braided.yBottom[k][s0 - 1] - base.yBottom[k][s0 - 1];
      if (Math.abs(before) > eps) {
        pushViolation(`D delta before supportStart not zero at k=${k}, t=${s0 - 1}`);
      }
    }
    if (fullRightRamp && s1 < tLength - 1) {
      const after = braided.yBottom[k][s1 + 1] - base.yBottom[k][s1 + 1];
      if (Math.abs(after) > eps) {
        pushViolation(`D delta after supportEnd not zero at k=${k}, t=${s1 + 1}`);
      }
    }
  }
}

function stackToBraidLayout(layout: StackLayout): BraidLayout {
  const tLength = layout.baseline.length;
  const gapCount = Math.max(0, layout.yBottom.length - 1);
  return {
    baseline: layout.baseline.slice(),
    yBottom: layout.yBottom.map((row) => row.slice()),
    yTop: layout.yTop.map((row) => row.slice()),
    omega: new Array<number>(tLength).fill(0),
    gapsPx: Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0)),
    gapsValue: Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0)),
    sumGapPx: new Array<number>(tLength).fill(0),
    roiSupport: null,
    diagnostics: {
      orderObjectiveBefore: 0,
      orderObjectiveAfter: 0,
      clusterCount: 1,
      trunkCluster: 0,
      crossClusterBoundaries: 0,
      spacingObjective: 0,
      spacingUncertaintyTerm: 0,
      spacingSlopeTerm: 0,
      spacingTemporalTerm: 0,
      spacingIterations: 0,
      spacingObjectiveHistory: []
    }
  };
}
