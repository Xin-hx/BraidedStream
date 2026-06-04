import { computeBaseline } from "../core/baseline";
import { computeBraidLayout } from "../core/braid";
import type { DatasetBundle } from "../core/datasets";
import { optimizeLayerOrder, orderLayers, type OrderOptimizationResult } from "../core/ordering";
import {
  computeOptimizingBaseline,
  computeOptimizingOrder,
  optimizingBaselineModeLabel,
  optimizingStageLabel,
  orderingScoringLabel,
  resolveOptimizingVariantConfig,
  type OptimizingVariantConfig
} from "../core/optimizing";
import { clampRoiToParent, normalizeROI } from "../core/roi";
import { computeStackedBoundaries } from "../core/stack";
import type {
  BaselineMode,
  BraidLayout,
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
  usesPid: boolean;
  pidUncertaintySource: PidUncertaintySource | null;
}

export type { OptimizingVariantConfig } from "../core/optimizing";

export function buildScene(bundle: DatasetBundle, state: AppState): SceneBuildResult {
  const context = prepareDatasetWindowContext(bundle, state);
  const orderedLayers = orderLayers(context.dataset.layers, context.dataset.order);
  // 1) Baseline + stack define the reference layout without uncertainty spacing.
  const baseline = computeBaseline(context.dataset.times, orderedLayers, state.baseline, baselineHooksFromState(state));
  const baseLayout = computeStackedBoundaries(baseline, orderedLayers);

  // 2) Braiding injects uncertainty-aware gaps on top of the base stack.
  const effectiveGapMode = state.enableUncertaintyGap ? state.gapMode : "none";
  const boundaryPenalty = new Array(Math.max(0, orderedLayers.length - 1)).fill(1);
  const braidedLayout = computeBraidLayout({
    base: baseLayout,
    orderedLayers,
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
    boundaryPenalty,
    smoothKernel: state.smoothKernel,
    yScale: (v) => v
  });

  const invariant = runInvariantChecks(orderedLayers, baseLayout, braidedLayout, context.insetRoi, {
    enabled: state.assertEnabled,
    throwOnError: false
  });
  const metrics = computeMetrics(context.dataset, baseLayout, braidedLayout, context.insetRoi, invariant, orderedLayers, {
    includeGlobalRows: true
  });
  const diagnosticsNotes = ["main reference: original order + centered baseline", ...gapDiagnosticsNotes(braidedLayout)];

  return {
    dataset: context.dataset,
    orderedLayers,
    baseLayout,
    braidedLayout,
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
  const baselineResult = computeOptimizingBaseline(
    context.dataset.times,
    orderedLayers,
    resolvedConfig.baselineMode,
    resolvedConfig.baselineHooks,
    resolvedConfig.baselineUncertaintyWeight,
    resolvedConfig.multiscaleEnergyThreshold
  );
  const layoutStack = computeStackedBoundaries(baselineResult.baseline, orderedLayers);
  const layout = stackToBraidLayout(layoutStack);
  const invariant = emptyInvariantSummary();
  const metrics = computeMetrics(context.dataset, layoutStack, layout, context.insetRoi, invariant, orderedLayers, {
    includeGlobalRows: true,
    multiscale: baselineResult.multiscaleDiagnostics
      ? {
          method: baselineResult.multiscaleDiagnostics.method,
          verified: baselineResult.multiscaleDiagnostics.verifiedMultiscale,
          fallbackUsed: baselineResult.multiscaleDiagnostics.fallbackUsed,
          effectiveScaleCount: baselineResult.multiscaleDiagnostics.effectiveScaleCount,
          selectedScaleCount: baselineResult.multiscaleDiagnostics.selectedScaleCount,
          threshold: baselineResult.multiscaleDiagnostics.energyThreshold,
          scaleBands: baselineResult.multiscaleDiagnostics.scaleBands.map((band) => ({
            scale: band.scale,
            ratio: band.ratio
          })),
          scaleCoefficients: baselineResult.multiscaleDiagnostics.scaleCoefficients,
          objectiveBefore: baselineResult.multiscaleDiagnostics.objectiveBefore,
          objectiveAfter: baselineResult.multiscaleDiagnostics.objectiveAfter,
          meanSlopeBefore: baselineResult.multiscaleDiagnostics.meanSlopeBefore,
          meanSlopeAfter: baselineResult.multiscaleDiagnostics.meanSlopeAfter,
          maxSlopeBefore: baselineResult.multiscaleDiagnostics.maxSlopeBefore,
          maxSlopeAfter: baselineResult.multiscaleDiagnostics.maxSlopeAfter,
          curvatureBefore: baselineResult.multiscaleDiagnostics.curvatureBefore,
          curvatureAfter: baselineResult.multiscaleDiagnostics.curvatureAfter,
          burstBefore: baselineResult.multiscaleDiagnostics.burstBefore,
          burstAfter: baselineResult.multiscaleDiagnostics.burstAfter,
          derivativeConcentrationBefore: baselineResult.multiscaleDiagnostics.derivativeConcentrationBefore,
          derivativeConcentrationAfter: baselineResult.multiscaleDiagnostics.derivativeConcentrationAfter,
          centerlineSlopeCoverageBefore: baselineResult.multiscaleDiagnostics.centerlineSlopeCoverageBefore,
          centerlineSlopeCoverageAfter: baselineResult.multiscaleDiagnostics.centerlineSlopeCoverageAfter,
          globalMeanSlopeGuardrailPassed: baselineResult.multiscaleDiagnostics.globalMeanSlopeGuardrailPassed
        }
      : null
  });
  const diagnosticsNotes = [
    `stage: ${optimizingStageLabel(config.optimizingStage)}`,
    `ordering scoring: ${orderingScoringLabel(resolvedConfig.orderingScoringMode)}`,
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
    braidedLayout: layout,
    roi: context.activeRoi,
    insetRoi: context.insetRoi,
    metrics,
    notes: context.preprocessedNotes,
    diagnosticsNotes,
    usesPid,
    pidUncertaintySource: usesPid ? resolvedConfig.pidUncertaintySource : null
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
    diagnosticsNotes: [...orderDiagnosticsNotes(context.optimized), ...gapDiagnosticsNotes(braidedLayout)],
    usesPid: false,
    pidUncertaintySource: null
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
      const err = Math.abs(thickness - orderedLayers[k].height[t]);
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
      spacingObjective: 0,
      spacingUncertaintyTerm: 0,
      spacingSlopeTerm: 0,
      spacingTemporalTerm: 0,
      spacingIterations: 0,
      spacingObjectiveHistory: []
    }
  };
}
