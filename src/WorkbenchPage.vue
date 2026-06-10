<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  buildBraidedEnhanceScene,
  buildOptimizingVariantScene,
  buildScene,
  defaultWindow,
  type OptimizingVariantConfig,
  type SceneBuildResult
} from "./app/sceneBuilder";
import type { SineStreamParams } from "./core/baseline";
import type { DatasetBundle } from "./data/datasets";
import { applyCovidUncertaintyBand, createSyntheticBundle, loadCovidBundle } from "./data/datasets";
import { clampRoiToParent, roiFromIsoDateRange } from "./interactions/roi";
import type { BaselineMode, DatasetKind, LayerInput, ROI } from "./core/types";
import { FIXED_SEED } from "./core/utils";
import { exportConfigJson, exportSnapshotPng, exportSnapshotSvg } from "./interactions/export";
import { computeMetrics, type MetricResult } from "./layout/metrics";
import { createInitialState } from "./state/appState";
import type { AppState } from "./state/appState";
import ControlPanelView from "./views/ControlPanelView.vue";
import GlobalStreamView from "./views/GlobalStreamView.vue";
import InsetDetailView from "./views/InsetDetailView.vue";
import MetricsView from "./views/MetricsView.vue";
import OptimizingVariantControls from "./views/OptimizingVariantControls.vue";
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

interface SpaghettiStateOption {
  id: string;
  label: string;
  total: number;
}

const DEFAULT_MAIN_WINDOW = { start: "2021-08-26", end: "2022-04-15" };
const DEFAULT_ROI_WINDOW = { start: "2021-12-11", end: "2022-03-12" };

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

const hover = ref<HoverPayload | null>(null);

const globalViewRef = ref<GlobalViewExpose | null>(null);
const insetViewRef = ref<InsetViewExpose | null>(null);
const spaghettiViewRef = ref<SpaghettiViewExpose | null>(null);
const compareViewRef = ref<InsetViewExpose | null>(null);

const enhanceTabs: Array<{ key: AppState["enhanceTab"]; label: string }> = [
  { key: "optimize", label: "Optimizing" },
  { key: "braided", label: "Braided" },
  { key: "spaghetti", label: "spaghetti" }
];

const enhanceBaselineMode = computed<BaselineMode>(() => {
  return "sineStream";
});

const availableStateOptions = computed<SpaghettiStateOption[]>(() => {
  const layers = optimizeScene.value?.dataset.layers ?? [];
  return layers
    .map((layer) => ({
      id: layer.id,
      label: layerStateLabel(layer.id),
      total: sum(layer.height)
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

const spaghettiMetricsSummary = computed(() => ({
  selectedCount: effectiveSpaghettiStateIds.value.length,
  totalCount: availableStateOptions.value.length,
  allSelected: state.spaghettiAllStates,
  defaultStateLabel: defaultSpaghettiStateId.value ? layerStateLabel(defaultSpaghettiStateId.value) : "N/A"
}));

const compareScene = computed<SceneBuildResult | null>(() => {
  if (state.enhanceTab !== "optimize") {
    return null;
  }
  return buildOptimizingVariantScene(activeBundle.value, state, buildCompareVariantConfig());
});

const compareMetrics = computed<MetricResult | null>(() => {
  const current = optimizeScene.value;
  const compare = compareScene.value;
  if (!current || !compare) {
    return null;
  }
  return computeMetrics(
    current.dataset,
    compare.braidedLayout,
    current.braidedLayout,
    current.insetRoi,
    { checked: false, violations: [], maxThicknessError: 0 },
    current.orderedLayers,
    {
      orderedLayersBefore: compare.orderedLayers,
      orderedLayersAfter: current.orderedLayers,
      includeGlobalRows: true
    }
  );
});

const compareNotes = computed(() => {
  const notes = [...activeBundle.value.notes];
  if (optimizeScene.value) {
    notes.push("Current", ...optimizeScene.value.diagnosticsNotes, ...optimizeScene.value.notes);
  }
  if (compareScene.value) {
    notes.push("Compare", ...compareScene.value.diagnosticsNotes, ...compareScene.value.notes);
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
  applyDefaultWindows(bundle.dataset.times);
  state.spaghettiAllStates = false;
  state.spaghettiSelectedStates = [];
  recomputeScene();
}

function applyDefaultWindows(times: number[]): void {
  const mainWindow =
    roiFromIsoDateRange(times, DEFAULT_MAIN_WINDOW.start, DEFAULT_MAIN_WINDOW.end) ?? defaultWindow(times.length);
  const detailWindow =
    clampRoiToParent(roiFromIsoDateRange(times, DEFAULT_ROI_WINDOW.start, DEFAULT_ROI_WINDOW.end), mainWindow) ??
    mainWindow;
  state.ROI = mainWindow;
  state.insetROI = detailWindow;
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
    baseline: "center",
    enableJaggedEdge: false
  };
  const enhanceState = {
    ...state,
    baseline: enhanceBaselineMode.value,
    enableJaggedEdge: false
  };

  const nextMain = buildScene(activeBundle.value, mainState);
  const nextOptimize = buildOptimizingVariantScene(activeBundle.value, enhanceState, buildCurrentVariantConfig());
  const nextBraided = buildBraidedEnhanceScene(activeBundle.value, enhanceState, enhanceBaselineMode.value);

  state.baseline = "center";
  state.ROI = nextMain.roi;
  state.insetROI = nextMain.insetRoi;
  state.enableJaggedEdge = false;
  mainScene.value = nextMain;
  optimizeScene.value = nextOptimize;
  braidedScene.value = nextBraided;
  sanitizeSpaghettiSelection();
}

function buildCurrentVariantConfig(): OptimizingVariantConfig {
  return {
    optimizingStage: state.optimizingStage,
    orderingScoringMode: state.orderingScoringMode,
    baselineMode: state.optimizingBaselineMode,
    pidUncertaintySource: state.pidUncertaintySource,
    pidTimeAlpha: state.pidTimeAlpha,
    baselineUncertaintyWeight: state.optimization.baselineUncertaintyWeight ?? 0.45,
    multiscaleEnergyThreshold: state.optimization.multiscaleEnergyThreshold ?? 0.08,
    baselineHooks: baselineHooksFromState(),
    orderRoi: state.ROI,
    sineOrder: sineOrderConfigFromState()
  };
}

function buildCompareVariantConfig(): OptimizingVariantConfig {
  return {
    optimizingStage: state.compare.optimizingStage,
    orderingScoringMode: state.compare.orderingScoringMode,
    baselineMode: state.compare.baselineMode,
    pidUncertaintySource: state.compare.pidUncertaintySource,
    pidTimeAlpha: state.compare.pidTimeAlpha,
    baselineUncertaintyWeight: state.compare.baselineUncertaintyWeight,
    multiscaleEnergyThreshold: state.compare.multiscaleEnergyThreshold,
    baselineHooks: baselineHooksFromCompare(),
    orderRoi: state.ROI,
    sineOrder: sineOrderConfigFromCompare()
  };
}

function sineOrderConfigFromState(): OptimizingVariantConfig["sineOrder"] {
  return {
    clusterAutoCutScale: state.optimization.clusterAutoCutScale,
    clusterBoundaryPenalty: state.optimization.clusterBoundaryPenalty,
    orderSimilaritySigma: state.optimization.orderSimilaritySigma,
    orderMaxSwapPasses: state.optimization.orderMaxSwapPasses,
    orderWeightType: state.optimization.orderWeightType ?? "max",
    orderUseThicknessWeight: state.optimization.orderUseThicknessWeight !== false,
    orderUseLengthWeight: state.optimization.orderUseLengthWeight !== false,
    orderLengthWeightThreshold: state.optimization.orderLengthWeightThreshold ?? 9,
    orderUncertaintyWeight: state.optimization.orderUncertaintyWeight ?? 0.35,
    fixedSeed: state.fixedSeed
  };
}

function sineOrderConfigFromCompare(): OptimizingVariantConfig["sineOrder"] {
  return {
    clusterAutoCutScale: state.compare.clusterAutoCutScale,
    clusterBoundaryPenalty: state.compare.clusterBoundaryPenalty,
    orderSimilaritySigma: state.compare.orderSimilaritySigma,
    orderMaxSwapPasses: state.compare.orderMaxSwapPasses,
    orderWeightType: state.compare.sineOrderWeightType,
    orderUseThicknessWeight: state.compare.sineOrderUseThicknessWeight,
    orderUseLengthWeight: state.compare.sineOrderUseLengthWeight,
    orderLengthWeightThreshold: state.compare.sineOrderLengthWeightThreshold,
    orderUncertaintyWeight: state.compare.sineOrderUncertaintyWeight,
    fixedSeed: state.fixedSeed
  };
}

function baselineHooksFromState(): SineStreamParams {
  return {
    centerType: state.optimization.baselineCenterType ?? "median",
    wiggleWeightL1: state.optimization.wiggleWeightL1,
    wiggleWeightL2: state.optimization.wiggleWeightL2,
    centerAnchorWeight: state.optimization.centerAnchorWeight,
    irlsIterations: state.optimization.irlsIterations,
    irlsEps: state.optimization.irlsEps
  };
}

function baselineHooksFromCompare(): SineStreamParams {
  return {
    centerType: state.compare.baselineCenterType,
    wiggleWeightL1: state.compare.wiggleWeightL1,
    wiggleWeightL2: state.compare.wiggleWeightL2,
    centerAnchorWeight: state.compare.centerAnchorWeight,
    irlsIterations: state.compare.irlsIterations,
    irlsEps: state.compare.irlsEps
  };
}

function applyRoiChange(roi: ROI | null): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  state.ROI = roi ?? defaultWindow(source.dataset.times.length);
  state.insetROI =
    clampRoiToParent(state.insetROI, state.ROI) ??
    clampRoiToParent(roiFromIsoDateRange(source.dataset.times, DEFAULT_ROI_WINDOW.start, DEFAULT_ROI_WINDOW.end), state.ROI) ??
    state.ROI;
  recomputeScene();
}

function applyInsetRoiChange(roi: ROI | null): void {
  state.insetROI = clampRoiToParent(roi, state.ROI) ?? state.ROI;
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
  if (next !== "optimize") {
    state.compareExpanded = false;
  }
}

function onToggleCompare(): void {
  state.compareExpanded = !state.compareExpanded;
}

function onCompareControlsChanged(): void {
  sanitizeState();
}

function onSpaghettiSelectedStatesChange(next: string[]): void {
  state.spaghettiSelectedStates = next.slice();
  sanitizeSpaghettiSelection();
}

function onClearRoi(): void {
  const source = mainScene.value ?? optimizeScene.value ?? braidedScene.value;
  if (!source) {
    return;
  }
  applyDefaultWindows(source.dataset.times);
  recomputeScene();
}

function snapshotConfig(): Record<string, unknown> {
  return {
    date: new Date().toISOString(),
    dataset: activeKind.value,
    fixedSeed: state.fixedSeed,
    viewBranches: {
      mainBaseline: "center",
      optimizingStage: state.optimizingStage,
      orderingScoringMode: state.orderingScoringMode,
      optimizingBaseline: state.optimizingBaselineMode,
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
  return insetViewRef.value?.getInsetSvg() ?? null;
}

function sanitizeState(): void {
  if (state.datasetKind === "covid") {
    state.covidHorizonFilter = "h1";
  }
  state.fixedSeed = FIXED_SEED;
  state.enableJaggedEdge = false;
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
  state.optimization.multiscaleEnergyThreshold = finiteBetween(
    state.optimization.multiscaleEnergyThreshold ?? defaultState.optimization.multiscaleEnergyThreshold ?? 0.08,
    defaultState.optimization.multiscaleEnergyThreshold ?? 0.08,
    0,
    1
  );
  state.pidTimeAlpha = finiteBetween(state.pidTimeAlpha, defaultState.pidTimeAlpha, 0, 1);
  state.contourBoxplotYBins = Math.max(
    24,
    Math.min(420, Math.round(finiteAtLeast(state.contourBoxplotYBins, defaultState.contourBoxplotYBins, 24)))
  );
  state.contourBoxplotThreshold = finiteBetween(
    state.contourBoxplotThreshold,
    defaultState.contourBoxplotThreshold,
    0.01,
    0.99
  );
  state.contourBoxplotCentralFraction = finiteBetween(
    state.contourBoxplotCentralFraction,
    defaultState.contourBoxplotCentralFraction,
    0.05,
    1
  );
  state.contourBoxplotOpacity = finiteBetween(
    state.contourBoxplotOpacity,
    defaultState.contourBoxplotOpacity,
    0.1,
    1
  );
  state.compare.pidTimeAlpha = finiteBetween(state.compare.pidTimeAlpha, defaultState.compare.pidTimeAlpha, 0, 1);
  state.compare.baselineUncertaintyWeight = finiteAtLeast(
    state.compare.baselineUncertaintyWeight,
    defaultState.compare.baselineUncertaintyWeight,
    0
  );
  state.compare.multiscaleEnergyThreshold = finiteBetween(
    state.compare.multiscaleEnergyThreshold,
    defaultState.compare.multiscaleEnergyThreshold,
    0,
    1
  );
  state.compare.wiggleWeightL1 = finiteAtLeast(state.compare.wiggleWeightL1, defaultState.compare.wiggleWeightL1, 0);
  state.compare.wiggleWeightL2 = finiteAtLeast(state.compare.wiggleWeightL2, defaultState.compare.wiggleWeightL2, 0);
  state.compare.centerAnchorWeight = finiteAtLeast(
    state.compare.centerAnchorWeight,
    defaultState.compare.centerAnchorWeight,
    0
  );
  state.compare.irlsIterations = Math.max(
    1,
    Math.round(finiteAtLeast(state.compare.irlsIterations, defaultState.compare.irlsIterations, 1))
  );
  state.compare.irlsEps = finiteAtLeast(state.compare.irlsEps, defaultState.compare.irlsEps, 1e-9);
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
    .map((layer) => ({ id: layer.id, total: sum(layer.height) }))
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
          :available-state-options="availableStateOptions"
          :default-spaghetti-state-id="defaultSpaghettiStateId"
          :effective-spaghetti-state-ids="effectiveSpaghettiStateIds"
          @dataset-change="onDatasetChanged"
          @toggle-compare="onToggleCompare"
          @update:spaghetti-selected-states="onSpaghettiSelectedStatesChange"
          @controls-change="onControlsChanged"
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
          @update-roi="applyRoiChange"
          @update-inset-roi="applyInsetRoiChange"
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
          :enable-layer-hover-highlight="true"
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

      </section>
    </div>

    <section v-if="state.compareExpanded && state.enhanceTab === 'optimize'" class="panel compare-drawer">
      <div class="compare-header">
        <strong>Compare</strong>
        <span>Delta is Current - Compare</span>
      </div>

      <div class="compare-controls">
        <OptimizingVariantControls :state="state" target="compare" @controls-change="onCompareControlsChanged" />
      </div>

      <InsetDetailView
        ref="compareViewRef"
        :scene="compareScene"
        :state="state"
        forced-view-mode="after"
        :forced-uncertainty-gap="false"
        :enable-layer-hover-highlight="true"
        @hover="onHover"
      />

      <MetricsView title="Compare: Current - Compare" :metrics="compareMetrics" :notes="compareNotes" />
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
