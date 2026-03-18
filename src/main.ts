import "./styles.css";
import * as d3 from "d3";
import { createSyntheticBundle, loadCovidBundle, type DatasetBundle } from "./core/datasets";
import { computeBaseline } from "./core/baseline";
import { computeBraidLayout } from "./core/braid";
import { runInvariantChecks } from "./core/assertions";
import { computeStackedBoundaries } from "./core/stack";
import { clampRoiToParent, normalizeROI } from "./core/roi";
import { layerUncertaintyAt, orderLayers } from "./core/validate";
import type {
  AggregationMode,
  BaselineMode,
  DatasetKind,
  GapMode,
  GapSemanticMode,
  InsetViewMode,
  MetricScope,
  PreparedDataset,
  PresetMode,
  RenderMode,
  ROI,
  RoiRecommendStrategy
} from "./core/types";
import { createInitialState } from "./state/appState";
import { preprocessDataset } from "./data/transforms";
import { MainChart } from "./render/mainChart";
import { InsetChart } from "./render/insetChart";
import { OverviewChart } from "./render/overviewChart";
import { computeMetrics } from "./layout/metrics";
import { MetricsPanel } from "./render/metricsPanel";
import { buildGapLegendText } from "./render/legends";
import { applyPreset } from "./interactions/presets";
import { recommendRoiWindows } from "./layout/roiRecommend";
import { buildHoverInfo, tooltipText } from "./interactions/hover";
import { exportConfigJson, exportSnapshotPng, exportSnapshotSvg } from "./interactions/export";

void bootstrap();

async function bootstrap(): Promise<void> {
  const state = createInitialState();

  const datasetCache = new Map<DatasetKind, DatasetBundle>();
  const syntheticBundle = createSyntheticBundle();
  datasetCache.set("synthetic", syntheticBundle);
  let activeKind: DatasetKind = "synthetic";
  let activeBundle = syntheticBundle;
  let pendingToken = 0;
  let recommendList: ReturnType<typeof recommendRoiWindows> = [];
  let lastMainXScale: d3.ScaleLinear<number, number> | null = null;
  let lastInsetXScale: d3.ScaleLinear<number, number> | null = null;
  let cachedPreprocessed: ReturnType<typeof preprocessDataset> | null = null;

  const overviewSvg = byId<SVGSVGElement>("overview-chart");
  const mainSvg = byId<SVGSVGElement>("main-chart");
  const insetSvg = byId<SVGSVGElement>("inset-chart");
  const overviewChart = new OverviewChart(overviewSvg);
  const mainChart = new MainChart(mainSvg);
  const insetChart = new InsetChart(insetSvg);
  const metricsPanel = new MetricsPanel(byId<HTMLElement>("metrics"));

  const datasetSelect = byId<HTMLSelectElement>("dataset-select");
  const baselineSelect = byId<HTMLSelectElement>("baseline-select");
  const gapModeSelect = byId<HTMLSelectElement>("gapmode-select");
  const renderModeSelect = byId<HTMLSelectElement>("rendermode-select");
  const insetModeSelect = byId<HTMLSelectElement>("insetmode-select");
  const gapSemanticSelect = byId<HTMLSelectElement>("gapsemantic-select");
  const metricScopeSelect = byId<HTMLSelectElement>("metric-scope-select");
  const gapAlphaSlider = byId<HTMLInputElement>("gap-alpha");
  const gapAlphaValue = byId<HTMLSpanElement>("gap-alpha-value");
  const maxExtraSlider = byId<HTMLInputElement>("max-extra");
  const maxExtraValue = byId<HTMLSpanElement>("max-extra-value");
  const smoothWindowSlider = byId<HTMLInputElement>("smooth-window");
  const smoothWindowValue = byId<HTMLSpanElement>("smooth-window-value");
  const downsampleStepSlider = byId<HTMLInputElement>("downsample-step");
  const downsampleStepValue = byId<HTMLSpanElement>("downsample-step-value");
  const aggregationSelect = byId<HTMLSelectElement>("aggregation-select");
  const presetSelect = byId<HTMLSelectElement>("preset-select");
  const assertToggle = byId<HTMLInputElement>("assert-toggle");
  const overlayOmegaToggle = byId<HTMLInputElement>("overlay-omega");
  const overlaySumGapToggle = byId<HTMLInputElement>("overlay-sumgap");
  const overlaySampleToggle = byId<HTMLInputElement>("overlay-sample-gaps");
  const staticModeToggle = byId<HTMLInputElement>("static-mode-toggle");
  const publicationModeToggle = byId<HTMLInputElement>("publication-mode-toggle");
  const recommendStrategySelect = byId<HTMLSelectElement>("recommend-strategy-select");
  const recommendButton = byId<HTMLButtonElement>("recommend-roi");
  const recommendCandidateSelect = byId<HTMLSelectElement>("recommend-candidate-select");
  const applyRecommendButton = byId<HTMLButtonElement>("apply-recommend-roi");
  const recommendInsetButton = byId<HTMLButtonElement>("recommend-inset-roi");
  const exportSvgButton = byId<HTMLButtonElement>("export-svg");
  const exportPngButton = byId<HTMLButtonElement>("export-png");
  const exportJsonButton = byId<HTMLButtonElement>("export-json");
  const clearRoiButton = byId<HTMLButtonElement>("clear-roi");
  const roiLabel = byId<HTMLSpanElement>("roi-label");
  const insetRoiLabel = byId<HTMLSpanElement>("inset-roi-label");
  const dataNote = byId<HTMLSpanElement>("data-note");
  const gapLegend = byId<HTMLDivElement>("gap-legend");
  const tooltip = byId<HTMLDivElement>("hover-tooltip");

  datasetSelect.value = activeKind;
  state.ROI = defaultWindow(activeBundle.dataset.times.length);
  state.insetROI = recommendHighUncertaintyRoi(activeBundle.dataset, state.ROI);
  baselineSelect.value = state.baseline;
  gapModeSelect.value = state.gapMode;
  renderModeSelect.value = state.renderMode;
  insetModeSelect.value = state.insetViewMode;
  gapSemanticSelect.value = state.gapSemanticMode;
  metricScopeSelect.value = state.metricScope;
  gapAlphaSlider.value = String(state.gapAlphaPx);
  maxExtraSlider.value = String(state.maxExtraHeightPx);
  smoothWindowSlider.value = String(state.smoothingWindow);
  downsampleStepSlider.value = String(state.downsamplingStep);
  aggregationSelect.value = state.aggregationMode;
  presetSelect.value = state.preset;
  assertToggle.checked = state.assertEnabled;
  overlayOmegaToggle.checked = false;
  overlaySumGapToggle.checked = false;
  overlaySampleToggle.checked = false;
  staticModeToggle.checked = state.staticMode;
  publicationModeToggle.checked = state.publicationMode;
  recommendStrategySelect.value = state.recommendStrategy;
  syncSliderLabels();
  updateDatasetNote();

  datasetSelect.addEventListener("change", async () => {
    const nextKind = datasetSelect.value as DatasetKind;
    const token = ++pendingToken;
    dataNote.textContent = `loading ${nextKind}...`;
    try {
      const nextBundle = await ensureDataset(nextKind);
      if (token !== pendingToken) {
        return;
      }
      activeKind = nextKind;
      activeBundle = nextBundle;
      state.ROI = defaultWindow(nextBundle.dataset.times.length);
      state.insetROI = recommendHighUncertaintyRoi(nextBundle.dataset, state.ROI);
      redraw();
    } catch (error) {
      dataNote.textContent = `dataset load failed: ${String(error)}`;
      datasetSelect.value = activeKind;
    }
  });

  baselineSelect.addEventListener("change", () => {
    state.baseline = baselineSelect.value as BaselineMode;
    redraw();
  });

  gapModeSelect.addEventListener("change", () => {
    state.gapMode = gapModeSelect.value as GapMode;
    redraw();
  });

  renderModeSelect.addEventListener("change", () => {
    state.renderMode = renderModeSelect.value as RenderMode;
    redraw();
  });

  insetModeSelect.addEventListener("change", () => {
    state.insetViewMode = insetModeSelect.value as InsetViewMode;
    redraw();
  });

  gapSemanticSelect.addEventListener("change", () => {
    state.gapSemanticMode = gapSemanticSelect.value as GapSemanticMode;
    redraw();
  });

  metricScopeSelect.addEventListener("change", () => {
    state.metricScope = metricScopeSelect.value as MetricScope;
    redraw();
  });

  gapAlphaSlider.addEventListener("input", () => {
    state.gapAlphaPx = Number(gapAlphaSlider.value);
    syncSliderLabels();
    redraw();
  });

  maxExtraSlider.addEventListener("input", () => {
    state.maxExtraHeightPx = Number(maxExtraSlider.value);
    syncSliderLabels();
    redraw();
  });

  smoothWindowSlider.addEventListener("input", () => {
    state.smoothingWindow = Number(smoothWindowSlider.value);
    syncSliderLabels();
    redraw();
  });

  downsampleStepSlider.addEventListener("input", () => {
    state.downsamplingStep = Number(downsampleStepSlider.value);
    syncSliderLabels();
    redraw();
  });

  aggregationSelect.addEventListener("change", () => {
    state.aggregationMode = aggregationSelect.value as AggregationMode;
    redraw();
  });

  presetSelect.addEventListener("change", () => {
    applyPreset(state, presetSelect.value as PresetMode);
    syncControlsFromState();
    redraw();
  });

  assertToggle.addEventListener("change", () => {
    state.assertEnabled = assertToggle.checked;
    redraw();
  });

  overlayOmegaToggle.addEventListener("change", () => {
    redraw();
  });

  overlaySumGapToggle.addEventListener("change", () => {
    redraw();
  });

  overlaySampleToggle.addEventListener("change", () => {
    redraw();
  });

  staticModeToggle.addEventListener("change", () => {
    state.staticMode = staticModeToggle.checked;
    redraw();
  });

  publicationModeToggle.addEventListener("change", () => {
    state.publicationMode = publicationModeToggle.checked;
    if (state.publicationMode) {
      state.staticMode = true;
      state.insetViewMode = "diff";
      state.renderMode = "mean+gapSemantic";
      state.gapSemanticMode = "uncBand";
      syncControlsFromState();
    }
    redraw();
  });

  recommendStrategySelect.addEventListener("change", () => {
    state.recommendStrategy = recommendStrategySelect.value as RoiRecommendStrategy;
  });

  recommendButton.addEventListener("click", () => {
    const windowSize = state.ROI ? state.ROI.t1Index - state.ROI.t0Index + 1 : Math.max(14, Math.floor(activeBundle.dataset.times.length * 0.1));
    recommendList = recommendRoiWindows(activeBundle.dataset, state.recommendStrategy, windowSize, 8);
    recommendCandidateSelect.innerHTML = recommendList
      .map((c, idx) => `<option value="${idx}">${c.label} score=${c.score.toFixed(2)}</option>`)
      .join("");
    if (recommendList.length > 0) {
      state.ROI = recommendList[0].roi;
      state.insetROI = recommendHighUncertaintyRoi(activeBundle.dataset, state.ROI);
      redraw();
    }
  });

  applyRecommendButton.addEventListener("click", () => {
    const idx = Number(recommendCandidateSelect.value);
    const candidate = recommendList[idx];
    if (!candidate) {
      return;
    }
    state.ROI = candidate.roi;
    state.insetROI = recommendHighUncertaintyRoi(activeBundle.dataset, state.ROI);
    redraw();
  });

  recommendInsetButton.addEventListener("click", () => {
    const source = getCurrentDataset();
    state.insetROI = recommendHighUncertaintyRoi(source, state.ROI);
    redraw();
  });

  exportSvgButton.addEventListener("click", async () => {
    await exportSnapshotSvg({
      mainSvg,
      overviewSvg,
      insetSvg,
      config: snapshotConfig()
    });
  });

  exportPngButton.addEventListener("click", async () => {
    await exportSnapshotPng({
      mainSvg,
      overviewSvg,
      insetSvg,
      config: snapshotConfig()
    });
  });

  exportJsonButton.addEventListener("click", () => {
    exportConfigJson(snapshotConfig());
  });

  clearRoiButton.addEventListener("click", () => {
    state.ROI = defaultWindow(activeBundle.dataset.times.length);
    state.insetROI = recommendHighUncertaintyRoi(activeBundle.dataset, state.ROI);
    redraw();
  });

  overviewSvg.addEventListener("mousemove", (event) => {
    const data = getCurrentDataset();
    const x = pointerX(overviewSvg, event);
    const i = nearestByPixel(data.times, x, Number(overviewSvg.getAttribute("width") ?? "1140"));
    showTooltip(event.clientX, event.clientY, tooltipText(buildHoverInfo(i, data.times, data.layers), ["overview"]));
  });

  mainSvg.addEventListener("mousemove", (event) => {
    const data = getCurrentDataset();
    const x = pointerX(mainSvg, event);
    const i = nearestByPixel(data.times, x, Number(mainSvg.getAttribute("width") ?? "1140"));
    if (lastMainXScale) {
      mainChart.setHover(data.times[i], lastMainXScale);
    }
    showTooltip(event.clientX, event.clientY, tooltipText(buildHoverInfo(i, data.times, data.layers), ["main"]));
  });

  insetSvg.addEventListener("mousemove", (event) => {
    const data = getCurrentDataset();
    const activeInset = state.insetROI ?? state.ROI;
    if (!activeInset) {
      return;
    }
    const x = pointerX(insetSvg, event);
    const width = Number(insetSvg.getAttribute("width") ?? "1140");
    const roiTimes = data.times.slice(activeInset.t0Index, activeInset.t1Index + 1);
    if (roiTimes.length === 0) {
      return;
    }
    const localIndex = nearestByPixel(roiTimes, x, width);
    const i = activeInset.t0Index + localIndex;
    if (lastInsetXScale) {
      insetChart.setHover(data.times[i], lastInsetXScale);
    }
    showTooltip(event.clientX, event.clientY, tooltipText(buildHoverInfo(i, data.times, data.layers), ["inset local"]));
  });

  [overviewSvg, mainSvg, insetSvg].forEach((el) => {
    el.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
      if (lastMainXScale) {
        mainChart.setHover(null, lastMainXScale);
      }
      insetChart.setHover(null, null);
    });
  });

  redraw();

  async function ensureDataset(kind: DatasetKind): Promise<DatasetBundle> {
    if (datasetCache.has(kind)) {
      return datasetCache.get(kind)!;
    }
    if (kind === "covid") {
      const bundle = await loadCovidBundle(24);
      datasetCache.set(kind, bundle);
      return bundle;
    }
    const bundle = createSyntheticBundle();
    datasetCache.set(kind, bundle);
    return bundle;
  }

  function redraw(): void {
    cachedPreprocessed = preprocessDataset(
      activeBundle.dataset,
      state.smoothingWindow,
      state.downsamplingStep,
      state.aggregationMode
    );
    const preprocessed = cachedPreprocessed;
    const dataset = preprocessed.dataset;
    const orderedLayers = orderLayers(dataset.layers, dataset.order);
    const activeRoi = normalizeROI(state.ROI, dataset.times.length) ?? defaultWindow(dataset.times.length);
    state.ROI = activeRoi;
    const insetRoi =
      clampRoiToParent(normalizeROI(state.insetROI, dataset.times.length), activeRoi) ??
      recommendHighUncertaintyRoi(dataset, activeRoi);
    state.insetROI = insetRoi;
    const baseline = computeBaseline(dataset.times, orderedLayers, state.baseline);
    const base = computeStackedBoundaries(baseline, orderedLayers);
    const yScaleProbe = (v: number) => v;
    const braided = computeBraidLayout({
      base,
      orderedLayers,
      roi: insetRoi,
      baselineMode: state.baseline,
      gapMode: state.gapMode,
      gapAlphaPx: state.gapAlphaPx,
      maxExtraHeightPx: state.maxExtraHeightPx,
      smoothKernel: state.smoothKernel,
      yScale: yScaleProbe
    });
    const invariant = runInvariantChecks(orderedLayers, base, braided, insetRoi, {
      enabled: state.assertEnabled,
      throwOnError: false
    });

    overviewChart.render({
      dataset,
      roi: activeRoi,
      onRoiChange: (roi) => {
        state.ROI = normalizeROI(roi, dataset.times.length) ?? defaultWindow(dataset.times.length);
        state.insetROI = recommendHighUncertaintyRoi(dataset, state.ROI);
        redraw();
      }
    });

    const mainResult = mainChart.render({
      dataset,
      layout: base,
      roi: activeRoi,
      insetRoi,
      onInsetRoiChange: (roi) => {
        state.insetROI = clampRoiToParent(normalizeROI(roi, dataset.times.length), activeRoi) ?? insetRoi;
        redraw();
      },
      staticMode: state.staticMode
    });
    lastMainXScale = mainResult.xScale;
    const insetResult = insetChart.render({
      dataset,
      before: base,
      after: braided,
      roi: insetRoi,
      viewMode: state.insetViewMode,
      semanticMode: state.gapSemanticMode,
      yZoom: state.yZoomInset,
      staticMode: state.staticMode
    });
    lastInsetXScale = insetResult.xScale;

    const metricResult = computeMetrics(
      dataset,
      base,
      braided,
      insetRoi,
      state.metricScope === "global",
      invariant
    );
    metricsPanel.render(metricResult, preprocessed.notes);

    updateRoiLabel(activeRoi, insetRoi);
    updateDatasetNote();
    gapLegend.textContent = buildGapLegendText(state.renderMode, state.gapSemanticMode);
  }

  function getCurrentDataset(): PreparedDataset {
    if (!cachedPreprocessed) {
      cachedPreprocessed = preprocessDataset(
        activeBundle.dataset,
        state.smoothingWindow,
        state.downsamplingStep,
        state.aggregationMode
      );
    }
    return cachedPreprocessed.dataset;
  }

  function updateDatasetNote(): void {
    const note = [...activeBundle.notes];
    if (activeBundle.uncNote) {
      note.push(activeBundle.uncNote);
    }
    dataNote.textContent = note.join(" | ");
  }

  function updateRoiLabel(activeRoi: ROI | null, insetRoi: ROI | null): void {
    roiLabel.textContent = activeRoi ? `ROI Window: [${activeRoi.t0Index}, ${activeRoi.t1Index}]` : "ROI Window: none";
    insetRoiLabel.textContent = insetRoi ? `Inset ROI: [${insetRoi.t0Index}, ${insetRoi.t1Index}]` : "Inset ROI: none";
  }

  function syncSliderLabels(): void {
    gapAlphaValue.textContent = state.gapAlphaPx.toFixed(0);
    maxExtraValue.textContent = state.maxExtraHeightPx.toFixed(0);
    smoothWindowValue.textContent = state.smoothingWindow.toFixed(0);
    downsampleStepValue.textContent = state.downsamplingStep.toFixed(0);
  }

  function syncControlsFromState(): void {
    baselineSelect.value = state.baseline;
    gapModeSelect.value = state.gapMode;
    renderModeSelect.value = state.renderMode;
    insetModeSelect.value = state.insetViewMode;
    gapSemanticSelect.value = state.gapSemanticMode;
    gapAlphaSlider.value = String(state.gapAlphaPx);
    maxExtraSlider.value = String(state.maxExtraHeightPx);
    staticModeToggle.checked = state.staticMode;
    syncSliderLabels();
  }

  function showTooltip(clientX: number, clientY: number, text: string): void {
    tooltip.style.display = "block";
    tooltip.style.left = `${clientX + 12}px`;
    tooltip.style.top = `${clientY + 12}px`;
    tooltip.textContent = text;
  }

  function snapshotConfig(): Record<string, unknown> {
    return {
      date: new Date().toISOString(),
      dataset: activeKind,
      state: {
        ...state
      }
    };
  }
}

function defaultWindow(length: number): ROI {
  if (length <= 1) {
    return { t0Index: 0, t1Index: 0 };
  }
  const span = Math.max(8, Math.floor(length * 0.28));
  const right = length - 1;
  const left = Math.max(0, right - span);
  return { t0Index: left, t1Index: right };
}
function recommendHighUncertaintyRoi(dataset: PreparedDataset, parent: ROI | null): ROI {
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

function pointerX(svg: SVGSVGElement, event: MouseEvent): number {
  const rect = svg.getBoundingClientRect();
  return Math.max(0, Math.min(rect.width, event.clientX - rect.left));
}

function nearestByPixel(times: number[], xPixel: number, width: number): number {
  if (times.length <= 1) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, xPixel / Math.max(1, width)));
  return Math.max(0, Math.min(times.length - 1, Math.round(ratio * (times.length - 1))));
}

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as unknown as T;
}
