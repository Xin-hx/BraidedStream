import "./styles.css";
import { createSyntheticBundle, loadCovidBundle, type DatasetBundle } from "./core/datasets";
import type { BaselineMode, DatasetKind, GapMode, RenderMode } from "./core/types";
import { BraidedChart, type ChartDiagnostics, type DemoState } from "./render/chart";

void bootstrap();

async function bootstrap(): Promise<void> {
  const state: DemoState = {
    baseline: "center",
    gapMode: "uncGap",
    renderMode: "mean+uncBandInGap",
    ROI: null,
    gapAlphaPx: 15,
    maxExtraHeightPx: 110,
    smoothKernel: "cubic",
    assertEnabled: true,
    showOverlayOmega: false,
    showOverlaySumGap: false,
    showOverlaySampleGaps: false
  };

  const datasetCache = new Map<DatasetKind, DatasetBundle>();
  const syntheticBundle = createSyntheticBundle();
  datasetCache.set("synthetic", syntheticBundle);
  let activeKind: DatasetKind = "synthetic";
  let activeBundle = syntheticBundle;
  let pendingToken = 0;

  const svgElement = byId<SVGSVGElement>("chart");
  const chart = new BraidedChart(svgElement, activeBundle.dataset, state, (roi) => {
    state.ROI = roi;
    redraw();
  });

  const datasetSelect = byId<HTMLSelectElement>("dataset-select");
  const baselineSelect = byId<HTMLSelectElement>("baseline-select");
  const gapModeSelect = byId<HTMLSelectElement>("gapmode-select");
  const renderModeSelect = byId<HTMLSelectElement>("rendermode-select");
  const gapAlphaSlider = byId<HTMLInputElement>("gap-alpha");
  const gapAlphaValue = byId<HTMLSpanElement>("gap-alpha-value");
  const maxExtraSlider = byId<HTMLInputElement>("max-extra");
  const maxExtraValue = byId<HTMLSpanElement>("max-extra-value");
  const assertToggle = byId<HTMLInputElement>("assert-toggle");
  const overlayOmegaToggle = byId<HTMLInputElement>("overlay-omega");
  const overlaySumGapToggle = byId<HTMLInputElement>("overlay-sumgap");
  const overlaySampleToggle = byId<HTMLInputElement>("overlay-sample-gaps");
  const clearRoiButton = byId<HTMLButtonElement>("clear-roi");
  const roiLabel = byId<HTMLSpanElement>("roi-label");
  const dataNote = byId<HTMLSpanElement>("data-note");
  const metrics = byId<HTMLPreElement>("metrics");

  datasetSelect.value = activeKind;
  baselineSelect.value = state.baseline;
  gapModeSelect.value = state.gapMode;
  renderModeSelect.value = state.renderMode;
  gapAlphaSlider.value = String(state.gapAlphaPx);
  maxExtraSlider.value = String(state.maxExtraHeightPx);
  assertToggle.checked = state.assertEnabled;
  overlayOmegaToggle.checked = state.showOverlayOmega;
  overlaySumGapToggle.checked = state.showOverlaySumGap;
  overlaySampleToggle.checked = state.showOverlaySampleGaps;
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
      state.ROI = null;
      chart.setDataset(nextBundle.dataset);
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

  assertToggle.addEventListener("change", () => {
    state.assertEnabled = assertToggle.checked;
    redraw();
  });

  overlayOmegaToggle.addEventListener("change", () => {
    state.showOverlayOmega = overlayOmegaToggle.checked;
    redraw();
  });

  overlaySumGapToggle.addEventListener("change", () => {
    state.showOverlaySumGap = overlaySumGapToggle.checked;
    redraw();
  });

  overlaySampleToggle.addEventListener("change", () => {
    state.showOverlaySampleGaps = overlaySampleToggle.checked;
    redraw();
  });

  clearRoiButton.addEventListener("click", () => {
    state.ROI = null;
    redraw();
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
    const diagnostics = chart.render();
    updateRoiLabel();
    updateDatasetNote();
    updateMetrics(diagnostics);
  }

  function updateDatasetNote(): void {
    const note = [...activeBundle.notes];
    if (activeBundle.uncNote) {
      note.push(activeBundle.uncNote);
    }
    dataNote.textContent = note.join(" | ");
  }

  function updateRoiLabel(): void {
    roiLabel.textContent = state.ROI ? `ROI: [${state.ROI.t0Index}, ${state.ROI.t1Index}]` : "ROI: none";
  }

  function updateMetrics(diagnostics: ChartDiagnostics): void {
    const violations = diagnostics.invariant.violations;
    const top = violations.slice(0, 8);
    const rangeText = diagnostics.sampleGapRanges
      .map((r) => `g[${r.k}] min/max px: ${r.min.toFixed(2)} / ${r.max.toFixed(2)}`)
      .join("\n");

    metrics.textContent = [
      `dataset: ${activeKind}`,
      `maxGapPerTimePx: ${diagnostics.maxGapPerTimePx.toFixed(2)}`,
      `minGapPerTimePx: ${diagnostics.minGapPerTimePx.toFixed(2)}`,
      `tau: ${diagnostics.tau}`,
      `maxThicknessError: ${diagnostics.invariant.maxThicknessError.toExponential(3)}`,
      `invariants: ${diagnostics.invariant.checked ? (violations.length === 0 ? "PASS" : "FAIL") : "SKIPPED"}`,
      `roiSupport: ${diagnostics.hasRoiSupport ? "active" : "none"}`,
      `sampleGapIndices: ${diagnostics.sampleGapIndices.length > 0 ? diagnostics.sampleGapIndices.join(",") : "none"}`,
      ...(rangeText ? [rangeText] : []),
      `violations: ${violations.length}`,
      ...top.map((v, i) => `${i + 1}. ${v}`)
    ].join("\n");
  }

  function syncSliderLabels(): void {
    gapAlphaValue.textContent = state.gapAlphaPx.toFixed(0);
    maxExtraValue.textContent = state.maxExtraHeightPx.toFixed(0);
  }
}

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element as unknown as T;
}
