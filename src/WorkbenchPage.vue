<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  buildBraidedEnhanceScene,
  buildOptimizeComparisonScene,
  buildScene,
  defaultWindow,
  recommendHighUncertaintyRoi,
  type SceneBuildResult
} from "./app/sceneBuilder";
import type { DatasetBundle } from "./core/datasets";
import { applyCovidUncertaintyBand, createSyntheticBundle, loadCovidBundle } from "./core/datasets";
import { normalizeOrderForComparison } from "./core/orderCompare";
import { optimizeLayerOrder } from "./core/optimizeOrder";
import { FIXED_SEED } from "./core/seed";
import type { BaselineMode, DatasetKind, LayerInput, ROI } from "./core/types";
import { exportConfigJson, exportSnapshotPng, exportSnapshotSvg } from "./interactions/export";
import { computePidOrderingMetrics } from "./layout/pidMetrics";
import { type RoiCandidate, recommendRoiWindows } from "./layout/roiRecommend";
import { createInitialState } from "./state/appState";
import type { AppState } from "./state/appState";
import ControlPanelView from "./views/ControlPanelView.vue";
import GlobalStreamView from "./views/GlobalStreamView.vue";
import InsetDetailView from "./views/InsetDetailView.vue";
import MetricsView from "./views/MetricsView.vue";
import PidNewView from "./views/PidNewView.vue";
import PidOrderingView from "./views/PidOrderingView.vue";
import SpaghettiView from "./views/SpaghettiView.vue";
import "./styles.css";

interface HoverPayload {
  x: number;
  y: number;
  text: string;
}

interface GlobalViewExpose {
  getMainSvg: () => SVGSVGElement | null;
  getOverviewSvg: () => SVGSVGElement | null;
}

interface InsetViewExpose {
  getInsetSvg: () => SVGSVGElement | null;
}

interface SpaghettiViewExpose {
  getSpaghettiSvg: () => SVGSVGElement | null;
}

interface PidOrderingViewExpose {
  getPidOrderingSvg: () => SVGSVGElement | null;
}

interface PidNewViewExpose {
  getPidNewSvg: () => SVGSVGElement | null;
}

type MainBaselineBranch = "center" | "zero";

interface SpaghettiStateOption {
  id: string;
  label: string;
  total: number;
}

const defaultState = createInitialState();
const state = reactive(createInitialState());
state.fixedSeed = FIXED_SEED;
state.enableJaggedEdge = false;

const syntheticBundle = createSyntheticBundle();
const datasetCache = new Map<DatasetKind, DatasetBundle>([["synthetic", syntheticBundle]]);
const activeKind = ref<DatasetKind>(state.datasetKind);
const activeBundle = ref<DatasetBundle>(syntheticBundle);

const mainScene = ref<SceneBuildResult | null>(null);
const optimizeScene = ref<SceneBuildResult | null>(null);
const braidedScene = ref<SceneBuildResult | null>(null);

const recommendList = ref<RoiCandidate[]>([]);
const selectedRecommendIndex = ref(0);
const hover = ref<HoverPayload | null>(null);
const mainBaselineBranch = ref<MainBaselineBranch>(state.baseline === "zero" ? "zero" : "center");

const globalViewRef = ref<GlobalViewExpose | null>(null);
const insetViewRef = ref<InsetViewExpose | null>(null);
const spaghettiViewRef = ref<SpaghettiViewExpose | null>(null);
const pidOrderingViewRef = ref<PidOrderingViewExpose | null>(null);
const pidNewViewRef = ref<PidNewViewExpose | null>(null);

const enhanceTabs: Array<{ key: AppState["enhanceTab"]; label: string }> = [
  { key: "optimize", label: "Optimizing" },
  { key: "braided", label: "Braided" },
  { key: "spaghetti", label: "spaghetti" },
  { key: "pidOrdering", label: "PID ordering" },
  { key: "pidNew", label: "PID new" }
];

const enhanceBaselineMode = computed<BaselineMode>(() => {
  return "sineStream";
});

const pidSineReferenceOrder = computed<string[]>(() => {
  const dataset = optimizeScene.value?.dataset ?? null;
  if (!dataset || dataset.layers.length === 0) {
    return [];
  }

  const optimized = optimizeLayerOrder(
    dataset.layers,
    null,
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
      useUncertaintyTerm: false,
      uncertaintyWeight: 0
    },
    dataset.order
  );

  return normalizeOrderForComparison(
    optimized.order,
    dataset.layers.map((layer) => layer.id),
    dataset.order
  );
});

const availableStateOptions = computed<SpaghettiStateOption[]>(() => {
  const layers = optimizeScene.value?.dataset.layers ?? [];
  return layers
    .map((layer) => ({
      id: layer.id,
      label: layerStateLabel(layer.id),
      total: sum(layer.mean)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const defaultSpaghettiStateId = computed<string | null>(() => {
  const layers = optimizeScene.value?.dataset.layers ?? [];
  return pickDefaultSpaghettiState(layers);
});

const effectiveSpaghettiStateIds = computed<string[]>(() => {
  const allIds = availableStateOptions.value.map((item) => item.id);
  if (state.spaghettiAllStates) {
    return allIds;
  }
  const allowed = new Set(allIds);
  const selected = state.spaghettiSelectedStates.filter((id) => allowed.has(id));
  if (selected.length > 0) {
    return selected;
  }
  const fallback = defaultSpaghettiStateId.value;
  if (fallback && allowed.has(fallback)) {
    return [fallback];
  }
  return allIds.length > 0 ? [allIds[0]] : [];
});

const activeMetrics = computed(() => {
  if (state.enhanceTab === "optimize") {
    return optimizeScene.value?.metrics ?? null;
  }
  if (state.enhanceTab === "braided") {
    return braidedScene.value?.metrics ?? null;
  }
  if (state.enhanceTab === "pidOrdering") {
    return pidMetricsBundle.value?.metrics ?? null;
  }
  return null;
});

const metricsTitle = computed(() => {
  if (state.enhanceTab === "optimize") {
    return "Metrics: Optimizing";
  }
  if (state.enhanceTab === "braided") {
    return "Metrics: Braided";
  }
  if (state.enhanceTab === "pidOrdering") {
    return "Metrics: PID ordering";
  }
  if (state.enhanceTab === "pidNew") {
    return "Metrics: PID new";
  }
  return "Metrics: spaghetti";
});

const spaghettiMetricsSummary = computed(() => ({
  selectedCount: effectiveSpaghettiStateIds.value.length,
  totalCount: availableStateOptions.value.length,
  allSelected: state.spaghettiAllStates,
  defaultStateLabel: defaultSpaghettiStateId.value ? layerStateLabel(defaultSpaghettiStateId.value) : "N/A"
}));

const pidMetricsBundle = computed(() => {
  const scene = optimizeScene.value;
  const dataset = scene?.dataset ?? null;
  if (!dataset || dataset.layers.length === 0 || dataset.times.length === 0) {
    return null;
  }
  return computePidOrderingMetrics({
    dataset,
    roi: scene?.insetRoi ?? null,
    sineOrder: pidSineReferenceOrder.value,
    uncertaintyStrength: Math.max(0, state.optimization.baselineUncertaintyWeight ?? 0.45),
    uncertaintySource: state.pidUncertaintySource,
    baselineHooks: {
      centerType: state.optimization.baselineCenterType ?? "median",
      wiggleWeightL1: state.optimization.wiggleWeightL1,
      wiggleWeightL2: state.optimization.wiggleWeightL2,
      centerAnchorWeight: state.optimization.centerAnchorWeight,
      irlsIterations: state.optimization.irlsIterations,
      irlsEps: state.optimization.irlsEps
    }
  });
});

const metricsNotes = computed(() => {
  const notes = [...activeBundle.value.notes];
  if (state.enhanceTab === "optimize" && optimizeScene.value) {
    notes.push(`[optimize method=${state.optimizeMethod}]`, ...optimizeScene.value.diagnosticsNotes, ...optimizeScene.value.notes);
  } else if (state.enhanceTab === "braided" && braidedScene.value) {
    notes.push(`[optimize method=${enhanceBaselineMode.value}]`, ...braidedScene.value.diagnosticsNotes, ...braidedScene.value.notes);
  } else if (state.enhanceTab === "pidOrdering") {
    const bundle = pidMetricsBundle.value;
    if (!bundle) {
      notes.push("PID ordering metrics: N/A");
    } else {
      const summary = bundle.summary;
      const topLabel = summary.topPidLayerId ? layerStateLabel(summary.topPidLayerId) : "N/A";
      notes.push(
        `[pid display baseline=${state.pidBaselineMode}]`,
        "PID display baseline is selectable: L1 / L2 / SineStream / Multiscale",
        "PID metrics baseline comparison is fixed: Sine -> Multiscale",
        `baseline uncertainty weight: ${Math.max(0, state.optimization.baselineUncertaintyWeight ?? 0.45).toFixed(3)}`,
        "PID definition: self-excluded weighted inclusion depth (wide intervals down-weighted)",
        "PID display order: deepest near center, then alternating upper/lower insertion",
        "IEEE-style order agreement: Spearman rho and Kendall tau",
        "sine reference ordering: full timeline (ROI-independent)",
        `top PID layer: ${topLabel} (depth=${summary.topPidDepth.toFixed(3)})`,
        `top PID valid-time ratio: ${(summary.topPidValidRatio * 100).toFixed(1)}% (${summary.timeCount} time points)`,
        `rank changed layers: ${summary.changedCount}/${summary.layerCount}`,
        `avg |rank shift|: ${summary.averageAbsShift.toFixed(2)}`,
        `max |rank shift|: ${summary.maxAbsShift}`,
        `spearman rho: ${summary.spearmanRho.toFixed(3)}`,
        `kendall tau: ${summary.kendallTau.toFixed(3)}`
      );
    }
  } else if (state.enhanceTab === "pidNew") {
    notes.push(
      `[pid_new display baseline=${state.pidBaselineMode}]`,
      "PID new metrics: N/A in v1",
      "PID new definition: PID-Mean over time-value fuzzy masks",
      "mask space: time x log1p(value)",
      "membership: p25-p75 core with p025-p975 fuzzy shoulders",
      "display order: deepest contour-PID layer near center, then alternating upper/lower insertion"
    );
  } else {
    notes.push(
      `spaghetti metrics: N/A`,
      `selected states: ${spaghettiMetricsSummary.value.selectedCount}/${spaghettiMetricsSummary.value.totalCount}`,
      `all states selected: ${spaghettiMetricsSummary.value.allSelected ? "yes" : "no"}`,
      `default state: ${spaghettiMetricsSummary.value.defaultStateLabel}`
    );
  }
  return notes;
});

onMounted(async () => {
  await activateDataset(state.datasetKind);
});

async function ensureDataset(kind: DatasetKind): Promise<DatasetBundle> {
  if (datasetCache.has(kind)) {
    return datasetCache.get(kind)!;
  }
  const bundle = kind === "covid" ? await loadCovidBundle() : createSyntheticBundle();
  datasetCache.set(kind, bundle);
  return bundle;
}

async function activateDataset(kind: DatasetKind): Promise<void> {
  let resolvedKind = kind;
  let bundle: DatasetBundle;
  try {
    bundle = await ensureDataset(kind);
  } catch {
    resolvedKind = "synthetic";
    bundle = await ensureDataset("synthetic");
    state.datasetKind = "synthetic";
  }
  activeKind.value = resolvedKind;
  activeBundle.value = bundle;
  state.datasetKind = resolvedKind;

  syncActiveCovidUncertainty();
  state.ROI = defaultWindow(bundle.dataset.times.length);
  state.insetROI = recommendHighUncertaintyRoi(bundle.dataset, state.ROI);
  state.spaghettiAllStates = false;
  state.spaghettiSelectedStates = [];
  recomputeScene();
}

function syncActiveCovidUncertainty(): void {
  if (activeKind.value !== "covid") {
    return;
  }
  applyCovidUncertaintyBand(activeBundle.value.dataset, state.covidUncertaintyBand);
  activeBundle.value.uncNote =
    state.covidUncertaintyBand === "50"
      ? "unc mode: IQR spread (q75-q25)"
      : "unc mode: 95% spread (q97.5-q2.5)";
}

function recomputeScene(): void {
  sanitizeState();
  syncActiveCovidUncertainty();

  const mainState = {
    ...state,
    baseline: mainBaselineBranch.value as BaselineMode,
    enableJaggedEdge: false
  };
  const enhanceState = {
    ...state,
    baseline: enhanceBaselineMode.value,
    enableJaggedEdge: false
  };

  const nextMain = buildScene(activeBundle.value, mainState);
  const nextOptimize = buildOptimizeComparisonScene(activeBundle.value, enhanceState, state.optimizeMethod);
  const nextBraided = buildBraidedEnhanceScene(activeBundle.value, enhanceState, enhanceBaselineMode.value);

  state.baseline = mainBaselineBranch.value;
  state.ROI = nextMain.roi;
  state.insetROI = nextMain.insetRoi;
  state.enableJaggedEdge = false;
  mainScene.value = nextMain;
  optimizeScene.value = nextOptimize;
  braidedScene.value = nextBraided;
  sanitizeSpaghettiSelection();
}

function applyRoiChange(roi: ROI | null): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  state.ROI = roi ?? defaultWindow(source.dataset.times.length);
  state.insetROI = recommendHighUncertaintyRoi(source.dataset, state.ROI);
  recomputeScene();
}

function applyInsetRoiChange(roi: ROI | null): void {
  state.insetROI = roi;
  recomputeScene();
}

function onControlsChanged(): void {
  sanitizeState();
  recomputeScene();
}

async function onDatasetChanged(): Promise<void> {
  await activateDataset(state.datasetKind);
}

function onEnhanceTabChange(next: AppState["enhanceTab"]): void {
  if (state.enhanceTab === next) {
    return;
  }
  hover.value = null;
  state.enhanceTab = next;
}

function onToggleMetrics(): void {
  state.metricsExpanded = !state.metricsExpanded;
}

function onSpaghettiSelectedStatesChange(next: string[]): void {
  state.spaghettiSelectedStates = next.slice();
  sanitizeSpaghettiSelection();
}

function onRecommendRoi(): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  const windowSize = state.ROI
    ? state.ROI.t1Index - state.ROI.t0Index + 1
    : Math.max(14, Math.floor(source.dataset.times.length * 0.1));
  recommendList.value = recommendRoiWindows(source.dataset, state.recommendStrategy, windowSize, 8);
  selectedRecommendIndex.value = 0;
  if (recommendList.value.length > 0) {
    state.ROI = recommendList.value[0].roi;
    state.insetROI = recommendHighUncertaintyRoi(source.dataset, state.ROI);
    recomputeScene();
  }
}

function onApplyRecommendedRoi(): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  const candidate = recommendList.value[selectedRecommendIndex.value];
  if (!candidate) {
    return;
  }
  state.ROI = candidate.roi;
  state.insetROI = recommendHighUncertaintyRoi(source.dataset, state.ROI);
  recomputeScene();
}

function onRecommendInsetRoi(): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  state.insetROI = recommendHighUncertaintyRoi(source.dataset, state.ROI);
  recomputeScene();
}

function onClearRoi(): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  state.ROI = defaultWindow(source.dataset.times.length);
  state.insetROI = recommendHighUncertaintyRoi(source.dataset, state.ROI);
  recomputeScene();
}

function snapshotConfig(): Record<string, unknown> {
  return {
    date: new Date().toISOString(),
    dataset: activeKind.value,
    fixedSeed: state.fixedSeed,
    viewBranches: {
      mainBaseline: mainBaselineBranch.value,
      optimizeMethod: state.optimizeMethod,
      enhanceTab: state.enhanceTab
    },
    state: {
      ...state,
      spaghettiSelectedStates: effectiveSpaghettiStateIds.value.slice()
    }
  };
}

async function onExportSvg(): Promise<void> {
  const mainSvg = globalViewRef.value?.getMainSvg() ?? null;
  const overviewSvg = globalViewRef.value?.getOverviewSvg() ?? null;
  const detailSvg = currentDetailSvg();
  if (!mainSvg || !overviewSvg || !detailSvg) {
    return;
  }
  await exportSnapshotSvg({ mainSvg, overviewSvg, insetSvg: detailSvg, config: snapshotConfig() });
}

async function onExportPng(): Promise<void> {
  const mainSvg = globalViewRef.value?.getMainSvg() ?? null;
  const overviewSvg = globalViewRef.value?.getOverviewSvg() ?? null;
  const detailSvg = currentDetailSvg();
  if (!mainSvg || !overviewSvg || !detailSvg) {
    return;
  }
  await exportSnapshotPng({ mainSvg, overviewSvg, insetSvg: detailSvg, config: snapshotConfig() });
}

function onExportJson(): void {
  exportConfigJson(snapshotConfig());
}

function onHover(payload: HoverPayload | null): void {
  hover.value = payload;
}

function currentDetailSvg(): SVGSVGElement | null {
  if (state.enhanceTab === "spaghetti") {
    return spaghettiViewRef.value?.getSpaghettiSvg() ?? null;
  }
  if (state.enhanceTab === "pidOrdering") {
    return pidOrderingViewRef.value?.getPidOrderingSvg() ?? null;
  }
  if (state.enhanceTab === "pidNew") {
    return pidNewViewRef.value?.getPidNewSvg() ?? null;
  }
  return insetViewRef.value?.getInsetSvg() ?? null;
}

function onMainBaselineBranchChange(next: MainBaselineBranch): void {
  if (mainBaselineBranch.value === next) {
    return;
  }
  mainBaselineBranch.value = next;
  state.baseline = next;
  recomputeScene();
}

function sanitizeState(): void {
  if (state.datasetKind === "covid") {
    state.covidHorizonFilter = "h1";
  }
  state.fixedSeed = FIXED_SEED;
  state.enableJaggedEdge = false;
  state.optimizeWithinROI = state.optimizeWithinROI !== false;
  state.gapAlphaPx = finiteAtLeast(state.gapAlphaPx, defaultState.gapAlphaPx, 0);
  state.maxExtraHeightPx = finiteAtLeast(state.maxExtraHeightPx, defaultState.maxExtraHeightPx, 1);
  state.insetJaggedAmplitude = finiteAtLeast(state.insetJaggedAmplitude, defaultState.insetJaggedAmplitude, 0);
  state.insetJaggedFrequency = finiteAtLeast(state.insetJaggedFrequency, defaultState.insetJaggedFrequency, 0);

  state.optimization.spacingBudgetPx = finiteAtLeast(
    state.optimization.spacingBudgetPx,
    defaultState.optimization.spacingBudgetPx,
    1
  );
  state.optimization.spacingUncertaintyWeight = finiteAtLeast(
    state.optimization.spacingUncertaintyWeight,
    defaultState.optimization.spacingUncertaintyWeight,
    0
  );
  state.optimization.spacingSlopeWeight = finiteAtLeast(
    state.optimization.spacingSlopeWeight,
    defaultState.optimization.spacingSlopeWeight,
    0
  );
  state.optimization.spacingTemporalWeight = finiteBetween(
    state.optimization.spacingTemporalWeight,
    defaultState.optimization.spacingTemporalWeight,
    0,
    0.95
  );
  state.optimization.spacingIterations = Math.max(
    1,
    Math.round(finiteAtLeast(state.optimization.spacingIterations, defaultState.optimization.spacingIterations, 1))
  );
  state.optimization.clusterAutoCutScale = finiteAtLeast(
    state.optimization.clusterAutoCutScale,
    defaultState.optimization.clusterAutoCutScale,
    0
  );
  state.optimization.clusterBoundaryPenalty = finiteAtLeast(
    state.optimization.clusterBoundaryPenalty,
    defaultState.optimization.clusterBoundaryPenalty,
    0
  );
  state.optimization.orderSimilaritySigma = finiteAtLeast(
    state.optimization.orderSimilaritySigma,
    defaultState.optimization.orderSimilaritySigma,
    0.0001
  );
  state.optimization.orderMaxSwapPasses = Math.max(
    1,
    Math.round(finiteAtLeast(state.optimization.orderMaxSwapPasses, defaultState.optimization.orderMaxSwapPasses, 1))
  );
  state.optimization.orderLengthWeightThreshold = Math.max(
    1,
    Math.round(
      finiteAtLeast(
        state.optimization.orderLengthWeightThreshold ?? defaultState.optimization.orderLengthWeightThreshold ?? 9,
        defaultState.optimization.orderLengthWeightThreshold ?? 9,
        1
      )
    )
  );
  state.optimization.orderUncertaintyWeight = finiteAtLeast(
    state.optimization.orderUncertaintyWeight ?? defaultState.optimization.orderUncertaintyWeight ?? 0.35,
    defaultState.optimization.orderUncertaintyWeight ?? 0.35,
    0
  );
  state.optimization.baselineUncertaintyWeight = finiteAtLeast(
    state.optimization.baselineUncertaintyWeight ?? defaultState.optimization.baselineUncertaintyWeight ?? 0.45,
    defaultState.optimization.baselineUncertaintyWeight ?? 0.45,
    0
  );
  state.optimization.wiggleWeightL1 = finiteAtLeast(
    state.optimization.wiggleWeightL1,
    defaultState.optimization.wiggleWeightL1,
    0
  );
  state.optimization.wiggleWeightL2 = finiteAtLeast(
    state.optimization.wiggleWeightL2,
    defaultState.optimization.wiggleWeightL2,
    0
  );
  state.optimization.centerAnchorWeight = finiteAtLeast(
    state.optimization.centerAnchorWeight,
    defaultState.optimization.centerAnchorWeight,
    0
  );
  state.optimization.irlsIterations = Math.max(
    1,
    Math.round(finiteAtLeast(state.optimization.irlsIterations, defaultState.optimization.irlsIterations, 1))
  );
  state.optimization.irlsEps = finiteAtLeast(state.optimization.irlsEps, defaultState.optimization.irlsEps, 1e-9);
}

function sanitizeSpaghettiSelection(): void {
  const allIds = availableStateOptions.value.map((item) => item.id);
  if (allIds.length === 0) {
    state.spaghettiSelectedStates = [];
    return;
  }
  const allowed = new Set(allIds);
  const selected = state.spaghettiSelectedStates.filter((id) => allowed.has(id));
  if (state.spaghettiAllStates) {
    state.spaghettiSelectedStates = selected;
    return;
  }
  if (selected.length > 0) {
    state.spaghettiSelectedStates = selected;
    return;
  }
  const fallback = defaultSpaghettiStateId.value ?? allIds[0];
  state.spaghettiSelectedStates = fallback ? [fallback] : [];
}

function finiteAtLeast(value: number, fallback: number, min: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, value);
}

function finiteBetween(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function pickDefaultSpaghettiState(layers: LayerInput[]): string | null {
  if (layers.length === 0) {
    return null;
  }
  return layers
    .map((layer) => ({ id: layer.id, total: sum(layer.mean) }))
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return layerStateLabel(a.id).localeCompare(layerStateLabel(b.id));
    })[0].id;
}

function sum(values: number[]): number {
  let out = 0;
  for (const v of values) {
    out += v;
  }
  return out;
}

function layerStateLabel(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}

</script>

<template>
  <div class="app-shell">
    <header>
      <h1>Streamgraph for Time-Series Ensemble</h1>
    </header>

    <div class="workspace-shell">
      <aside class="workspace-sidebar">
        <ControlPanelView
          :state="state"
          :recommend-list="recommendList"
          :selected-recommend-index="selectedRecommendIndex"
          :available-state-options="availableStateOptions"
          :default-spaghetti-state-id="defaultSpaghettiStateId"
          :effective-spaghetti-state-ids="effectiveSpaghettiStateIds"
          @update:selected-recommend-index="selectedRecommendIndex = $event"
          @dataset-change="onDatasetChanged"
          @toggle-metrics="onToggleMetrics"
          @update:spaghetti-selected-states="onSpaghettiSelectedStatesChange"
          @controls-change="onControlsChanged"
          @recommend-roi="onRecommendRoi"
          @apply-recommend-roi="onApplyRecommendedRoi"
          @recommend-inset-roi="onRecommendInsetRoi"
          @clear-roi="onClearRoi"
          @export-svg="onExportSvg"
          @export-png="onExportPng"
          @export-json="onExportJson"
        />
      </aside>

      <section class="workspace-main">
        <GlobalStreamView
          ref="globalViewRef"
          :scene="mainScene"
          :main-baseline-branch="mainBaselineBranch"
          @update-roi="applyRoiChange"
          @update-inset-roi="applyInsetRoiChange"
          @update-main-baseline-branch="onMainBaselineBranchChange"
          @hover="onHover"
        />

        <nav class="enhancement-tabs" aria-label="Enhance Tabs" role="tablist">
          <button
            v-for="tab in enhanceTabs"
            :key="tab.key"
            type="button"
            class="enhancement-tab"
            :class="{ 'is-active': state.enhanceTab === tab.key }"
            role="tab"
            :aria-selected="state.enhanceTab === tab.key"
            @click="onEnhanceTabChange(tab.key)"
          >
            {{ tab.label }}
          </button>
        </nav>

        <InsetDetailView
          v-if="state.enhanceTab === 'optimize'"
          ref="insetViewRef"
          :scene="optimizeScene"
          :state="state"
          forced-view-mode="after"
          :forced-uncertainty-gap="false"
          @hover="onHover"
        />

        <InsetDetailView
          v-else-if="state.enhanceTab === 'braided'"
          ref="insetViewRef"
          :scene="braidedScene"
          :state="state"
          forced-view-mode="after"
          :forced-uncertainty-gap="state.enableUncertaintyGap"
          @hover="onHover"
        />

        <SpaghettiView
          v-else-if="state.enhanceTab === 'spaghetti'"
          ref="spaghettiViewRef"
          :dataset="optimizeScene?.dataset ?? null"
          :selected-state-ids="effectiveSpaghettiStateIds"
          @hover="onHover"
        />

        <PidOrderingView
          v-else-if="state.enhanceTab === 'pidOrdering'"
          ref="pidOrderingViewRef"
          :dataset="optimizeScene?.dataset ?? null"
          :sine-order="pidSineReferenceOrder"
          :roi="optimizeScene?.insetRoi ?? null"
          :state="state"
          @hover="onHover"
        />

        <PidNewView
          v-else
          ref="pidNewViewRef"
          :dataset="optimizeScene?.dataset ?? null"
          :roi="optimizeScene?.insetRoi ?? null"
          :state="state"
          @hover="onHover"
        />
      </section>
    </div>

    <section v-if="state.metricsExpanded" class="panel metrics-drawer">
      <MetricsView
        :title="metricsTitle"
        :metrics="activeMetrics"
        :notes="metricsNotes"
        :spaghetti-summary="state.enhanceTab === 'spaghetti' ? spaghettiMetricsSummary : null"
      />
    </section>

    <div
      id="hover-tooltip"
      :style="{
        display: hover ? 'block' : 'none',
        left: hover ? `${hover.x + 12}px` : undefined,
        top: hover ? `${hover.y + 12}px` : undefined
      }"
    >
      {{ hover?.text ?? "" }}
    </div>
  </div>
</template>
