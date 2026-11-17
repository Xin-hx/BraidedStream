import { computed, onBeforeUnmount, reactive, shallowRef, watch } from "vue";
import { runPipeline, type InputDataset, type PipelineResult } from "braided-stream/core";
import type { ChartOptions, DisplayLayer, HoverEvent, VisMethod } from "braided-stream";
import { DEFAULT_COVID_STATES, convertCovidCase } from "../../../examples/converters/covidConverter";
import { convertIllustrationCase } from "../../../examples/converters/illustration";
import { convertTcmCase, TCM_COLORS } from "../../../examples/converters/tcmConverter";
import { loadAppearance, saveAppearance } from "../lib/appearance";

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
    datasetId: "illustration" as keyof typeof datasets,
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
  let version = 0;
  let controller: AbortController | undefined;

  async function loadData() {
    const current = ++version;
    controller?.abort();
    controller = new AbortController();
    const id = model.datasetId;
    model.loading = true;
    model.error = "";
    model.hover = null;
    // Do not display the previous dataset under the newly selected dataset's labels.
    model.data = null;
    model.result = null;
    try {
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
  watch(() => [model.data, model.baseline, model.bandwidthRatio, model.sort, model.showDensityGradient], () => {
    if (!model.data) return;
    model.hover = null;
    try {
      const started = performance.now();
      const layoutOrder = model.sort === "category"
        ? model.data.layers.map(layer => layer.id).sort((a, b) => a.localeCompare(b)) : undefined;
      model.result = runPipeline(model.data.dataset, {
        layoutOrder, baselineMode: model.baseline,
        braided: { bandwidthRatio: model.bandwidthRatio, debug: true },
        densityProfileBins: model.showDensityGradient ? 16 : undefined,
      });
      model.perfMs = performance.now() - started;
      model.error = "";
    } catch (error) {
      model.result = null;
      model.error = error instanceof Error ? error.message : String(error);
    }
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
  function save() { model.status = saveAppearance(model.appearance); }
  onBeforeUnmount(() => { version++; controller?.abort(); });
  return { model, colors, chartOptions, save };
}
export type WorkspaceState = ReturnType<typeof useWorkspace>["model"];
