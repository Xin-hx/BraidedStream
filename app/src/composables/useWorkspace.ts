import { computed, onBeforeUnmount, reactive, shallowRef, watch } from "vue";
import { runPipeline, type InputDataset, type PipelineResult } from "braided-stream/core";
import type { ChartOptions, DisplayLayer, HoverEvent, VisMethod } from "braided-stream";
import { DEFAULT_COVID_STATES, convertCovidCase } from "../../../examples/converters/covidConverter";
import { convertIllustrationCase } from "../../../examples/converters/illustration";
import { convertTcmCase, TCM_COLORS } from "../../../examples/converters/tcmConverter";
import { loadAppearance, saveAppearance } from "../lib/appearance";
import { createAnalysisTask, type ImportAcceptance, type AnalysisResult } from "../lib/analysis-task";

const datasets = {
  illustration: { path: "dataset/illustration.csv", parse: convertIllustrationCase },
  tcm: { path: "dataset/TCMRecord.csv", parse: convertTcmCase },
  "covid-inc": { path: "dataset/covid_inc_case_trained_members.json", parse: (text: string) => convertCovidCase(text, { states: DEFAULT_COVID_STATES }) },
};
interface LoadedData {
  dataset: InputDataset;
  layers: DisplayLayer[];
  sampleSize: Readonly<Record<string, readonly number[]>>;
}

export function useWorkspace() {
  const model = reactive({
    datasetId: "illustration" as keyof typeof datasets | "custom",
    customName: "", customAvailable: false, computing: false,
    data: shallowRef<LoadedData | null>(null), result: shallowRef<PipelineResult | null>(null),
    visMethod: "braided" as VisMethod, baseline: "wiggle" as "wiggle" | "sine", bandwidthRatio: 0.3,
    smoothContours: true, showEnvelopeStroke: false, showRepresentativeStroke: false,
    showTimeCell: false, showBranchStroke: false, showYAxis: true, showDensityGradient: false,
    selectedLayer: null as string | null,
    start: 0, end: 1, sort: "tpid" as "tpid" | "category",
    appearance: loadAppearance(), status: "", error: "", loading: false, perfMs: 0,
    panelCollapsed: false, legendVisible: true, legendMinimized: false,
    hover: shallowRef<HoverEvent | null>(null),
  });
  const customData = shallowRef<LoadedData | null>(null);
  const analysisTask = createAnalysisTask();
  let computeVersion = 0;
  let primed: { data: LoadedData; analysis: AnalysisResult } | undefined;
  const analysisOptions = computed<import("braided-stream/core").PipelineOptions>(() => ({
    baselineMode: model.baseline,
    braided: { bandwidthRatio: model.bandwidthRatio, debug: true },
    densityProfileBins: model.showDensityGradient ? 16 : undefined,
  }));
  let version = 0;
  let controller: AbortController | undefined;

  async function loadData() {
    const current = ++version;
    controller?.abort();
    analysisTask.cancel(); computeVersion++; model.computing = false;
    controller = new AbortController();
    const id = model.datasetId;
    model.loading = true;
    model.error = "";
    model.hover = null;
    // Do not display the previous dataset under the newly selected dataset's labels.
    model.data = null;
    model.result = null;
    try {
      if (id === "custom") {
        if (!customData.value) throw new Error("Import a file before choosing custom data.");
        model.data = customData.value;
        model.start = 0; model.end = customData.value.dataset.times.length - 1; model.selectedLayer = null;
        return;
      }
      if (id === "tcm" && !__LOCAL_TCM__) throw new Error("TCM records are available only in a local development session");
      const spec = datasets[id];
      const response = await fetch(spec.path, { signal: controller.signal });
      if (!response.ok) throw new Error(`failed to load ${spec.path}: ${response.status}`);
      const text = await response.text();
      if (current !== version) return;
      const converted = spec.parse(text);
      model.start = 0;
      model.end = converted.dataset.times.length - 1;
      model.selectedLayer = null;
      model.data = {
        dataset: converted.dataset,
        layers: converted.dataset.layers.map(layer => ({ id: layer.id,
          ...(id === "tcm" && Object.hasOwn(TCM_COLORS, layer.id) ? { color: TCM_COLORS[layer.id] } : {}) })),
        sampleSize: converted.metadata.sampleSize,
      };
    } catch (error) {
      if (current !== version || (error instanceof Error && error.name === "AbortError")) return;
      model.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (current === version) model.loading = false;
    }
  }

  watch(() => model.datasetId, loadData, { immediate: true, flush: "sync" });
  watch(() => [model.data, model.baseline, model.bandwidthRatio, model.sort, model.showDensityGradient], async () => {
    const current = ++computeVersion;
    analysisTask.cancel();
    const source = model.data;
    if (!source) { model.computing = false; return; }
    model.hover = null;
    model.computing = model.datasetId === "custom";
    try {
      const options = { ...analysisOptions.value, layoutOrder: model.sort === "category"
        ? source.layers.map(layer => layer.id).sort((a, b) => a.localeCompare(b)) : undefined };
      let analysis: AnalysisResult;
      if (primed?.data === source) { analysis = primed.analysis; primed = undefined; }
      else if (model.datasetId === "custom") analysis = await analysisTask.run({ dataset: source.dataset, options });
      else {
        const started = performance.now();
        analysis = { result: runPipeline(source.dataset, options), perfMs: performance.now() - started };
      }
      if (current !== computeVersion || source !== model.data) return;
      model.result = analysis.result;
      model.perfMs = analysis.perfMs;
      model.error = "";
    } catch (error) {
      if (current !== computeVersion || (error instanceof Error && error.name === "AbortError")) return;
      model.error = error instanceof Error ? error.message : String(error);
    } finally { if (current === computeVersion) model.computing = false; }
  });
  watch(() => [model.start, model.end, model.visMethod], () => { model.hover = null; });
  watch(() => model.legendVisible, () => { model.legendMinimized = false; });
  const colors = computed(() => {
    const prefix = `${model.datasetId}:`;
    return Object.fromEntries(Object.entries(model.appearance.colors)
      .filter(([key]) => key.startsWith(prefix)).map(([key, color]) => [key.slice(prefix.length), color]));
  });
  const chartOptions = computed<ChartOptions>(() => ({
    layers: model.data?.layers, palette: model.appearance.palette, colorOverrides: colors.value,
    start: model.start, end: model.end, visMethod: model.visMethod, smoothContours: model.smoothContours,
    showEnvelopeStroke: model.showEnvelopeStroke, showRepresentativeStroke: model.showRepresentativeStroke,
    showTimeCell: model.showTimeCell, showBranchStroke: model.showBranchStroke, showYAxis: model.showYAxis,
    showDensityGradient: model.showDensityGradient,
    highlightLayer: model.selectedLayer,
  }));
  function save() {
    const colors = Object.fromEntries(Object.entries(model.appearance.colors).filter(([key]) => !key.startsWith("custom:")));
    model.status = saveAppearance({ palette: model.appearance.palette, colors });
  }
  function acceptImport(acceptance: ImportAcceptance) {
    const loaded: LoadedData = { dataset: acceptance.data.dataset, layers: acceptance.data.dataset.layers.map(layer => ({ id: layer.id })), sampleSize: acceptance.data.sampleSize };
    primed = { data: loaded, analysis: acceptance.analysis };
    customData.value = loaded; model.customName = acceptance.name; model.customAvailable = true;
    model.appearance.colors = Object.fromEntries(Object.entries(model.appearance.colors).filter(([key]) => !key.startsWith("custom:")));
    if (model.datasetId !== "custom") model.datasetId = "custom";
    else { model.data = loaded; model.start = 0; model.end = loaded.dataset.times.length - 1; model.selectedLayer = null; model.hover = null; }
  }
  function clearImport() {
    customData.value = null; primed = undefined; model.customAvailable = false; model.customName = "";
    model.appearance.colors = Object.fromEntries(Object.entries(model.appearance.colors).filter(([key]) => !key.startsWith("custom:")));
    if (model.datasetId === "custom") model.datasetId = "illustration";
  }
  onBeforeUnmount(() => { version++; computeVersion++; controller?.abort(); analysisTask.cancel(); });
  return { model, colors, chartOptions, analysisOptions, save, acceptImport, clearImport };
}
export type WorkspaceState = ReturnType<typeof useWorkspace>["model"];
