/**
 * Demo entry: state, controls, hover details, cost panel, export.
 */
import { runPipeline } from "../code/index";
import { DEFAULT_COVID_STATES, convertCovidCase, type CovidStateSelection } from "../code/data/covidConverter";
import { convertIllustrationCase } from "../code/data/illustration";
import { convertTcmCase, TCM_COLORS } from "../code/data/tcmConverter";
import type { InputDataset } from "../code/input";
import {
  diseaseDay,
  exportSvg,
  renderChart,
  renderTimeFilter,
  M,
  W,
  H,
  type DisplayLayer,
  type VisMethod,
} from "./render";
import { createLegendController } from "./legend";
import type { BraidedStreamOptions, PipelineResult } from "../code/engine/types";

// Case-study data files are served from vite's public/ directory.
export const COVID_PARAMETERS: { stateSelection: CovidStateSelection } = {
  stateSelection: DEFAULT_COVID_STATES,
};

const DATASETS = {
  illustration: {
    path: "dataset/illustration.csv",
    label: "illustration",
    parse: convertIllustrationCase,
  },
  tcm: { path: "dataset/TCMRecord.csv", label: "tcm", parse: convertTcmCase },
  "covid-inc": {
    path: "dataset/covid_inc_case_trained_members.json",
    label: "covid-inc",
    parse: (text: string) => convertCovidCase(text, { states: COVID_PARAMETERS.stateSelection }),
  },
} as const;

type DatasetId = keyof typeof DATASETS;

/** Code-owned parameters; future controls can update this object before run(). */
export const BRAIDED_PARAMETERS: Partial<BraidedStreamOptions> = {
  bandwidthRatio: 0.3,
  debug: true,
};

/** Number of equal-probability color strips used by the optional KDE density encoding. */
export const DENSITY_GRADIENT_BINS = 16;

interface State {
  dataset: DatasetId;
  visMethod: VisMethod;
  baseline: "wiggle" | "sine";
  smoothContours: boolean;
  showEnvelopeStroke: boolean;
  showRepresentativeStroke: boolean;
  showTimeCell: boolean;
  showBranchStroke: boolean;
  showYAxis: boolean;
  showDensityGradient: boolean;
  collapseBranches: boolean;
  hover: number | null;
  highlight: string | null;
  selectedLayer: string | null;
  timeStart: number;
  timeEnd: number;
}

const state: State = {
  dataset: "illustration",
  visMethod: "braided",
  baseline: "wiggle",
  smoothContours: true,
  showEnvelopeStroke: false,
  showRepresentativeStroke: false,
  showTimeCell: false,
  showBranchStroke: false,
  showYAxis: true,
  showDensityGradient: false,
  collapseBranches: false,
  hover: null,
  highlight: null,
  selectedLayer: null,
  timeStart: 0,
  timeEnd: 1,
};

let dataCache: {
  dataset: InputDataset;
  layers: DisplayLayer[];
  times: string[];
  sampleSize: Readonly<Record<string, readonly number[]>>;
} | null = null;
let result: PipelineResult | null = null;
let perfMs = 0;
let loadVersion = 0;
let loadController: AbortController | null = null;

const $ = <T extends Element>(id: string): T =>
  document.getElementById(id) as unknown as T;
const svgEl = $<SVGSVGElement>("chart");
const timeFilterEl = $<SVGSVGElement>("time-filter");
const tooltip = $("tooltip");
const costsEl = $("costs");
const legend = createLegendController({
  onLayoutOrderChange: () => run(),
  onAppearanceChange: () => render(),
  onLayerSelect: (layerId) => {
    state.selectedLayer = layerId;
    render();
    updateLegend();
  },
});

async function loadData(requestedDataset: DatasetId): Promise<void> {
  const version = ++loadVersion;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const spec = DATASETS[requestedDataset];
  try {
    const res = await fetch(spec.path, { signal: controller.signal });
    if (!res.ok) throw new Error(`failed to load ${spec.path}: ${res.status}`);
    const text = await res.text();
    if (version !== loadVersion) return;
    const converted = spec.parse(text);
    if (version !== loadVersion) return;
    dataCache = {
      dataset: converted.dataset,
      times: [...converted.dataset.times],
      layers: converted.dataset.layers.map((layer) => ({
        id: layer.id,
        ...(requestedDataset === "tcm" && Object.hasOwn(TCM_COLORS, layer.id)
          ? { color: TCM_COLORS[layer.id] } : {}),
      })),
      sampleSize: converted.metadata.sampleSize,
    };
    state.timeStart = 0;
    state.timeEnd = Math.max(0, dataCache.times.length - 1);
    state.hover = null;
    state.highlight = null;
    state.selectedLayer = null;
    run();
  } catch (error) {
    if (version !== loadVersion || (error instanceof DOMException && error.name === "AbortError")) return;
    const message = error instanceof Error ? error.message : String(error);
    costsEl.textContent = `data load failed: ${message}`;
  }
}

function run(): void {
  if (!dataCache || dataCache.times.length < 2) return;
  const t0 = performance.now();
  const layoutOrder = legend.getLayoutOrder(dataCache.layers.map((layer) => layer.id));

  result = runPipeline(dataCache.dataset, {
    layoutOrder,
    baselineMode: state.baseline,
    densityProfileBins: state.showDensityGradient ? DENSITY_GRADIENT_BINS : undefined,
    braided: {
      ...BRAIDED_PARAMETERS,
    },
  });
  perfMs = performance.now() - t0;

  render();
  renderCosts();
  updateLegend();
}

function render(): void {
  if (!dataCache || !result) return;
  const legendAppearance = legend.getAppearance(state.dataset);
  const braided = state.visMethod === "braided";
  const collapse = $<HTMLButtonElement>("btn-collapse");
  collapse.hidden = !braided;
  collapse.disabled = !braided;
  collapse.textContent = state.collapseBranches ? "Expand branches" : "Collapse branches";
  const densityGradient = $<HTMLInputElement>("ctl-density-gradient");
  const envelopeStroke = $<HTMLInputElement>("ctl-envelope-stroke");
  const representativeStroke = $<HTMLInputElement>("ctl-representative-stroke");
  const timeCell = $<HTMLInputElement>("ctl-time-cell");
  const branchStroke = $<HTMLInputElement>("ctl-branch-stroke");
  densityGradient.disabled = !braided || state.collapseBranches;
  envelopeStroke.disabled = !braided;
  representativeStroke.disabled = !braided;
  timeCell.disabled = !braided || state.collapseBranches;
  branchStroke.disabled = !braided || state.collapseBranches;
  renderChart(svgEl, {
    layers: dataCache.layers,
    times: dataCache.times,
    result,
    colorOverrides: legendAppearance.colorOverrides,
    palette: legendAppearance.palette,
    start: state.timeStart,
    end: state.timeEnd,
    visMethod: state.visMethod,
    smoothContours: state.smoothContours,
    showEnvelopeStroke: state.showEnvelopeStroke,
    showRepresentativeStroke: state.showRepresentativeStroke,
    showTimeCell: state.showTimeCell,
    showBranchStroke: state.showBranchStroke,
    showYAxis: state.showYAxis,
    showDensityGradient: state.showDensityGradient,
    collapseBranches: state.collapseBranches,
    hover: state.hover,
    highlightLayer: state.highlight ?? state.selectedLayer,
  });
  renderTimeFilter(timeFilterEl, {
    layers: dataCache!.layers,
    times: dataCache!.times,
    result,
    layoutOrder: result.layoutOrder,
    colorOverrides: legendAppearance.colorOverrides,
    palette: legendAppearance.palette,
    start: state.timeStart,
    end: state.timeEnd,
    onChange: updateTimeRange,
  });
}

function renderCosts(): void {
  costsEl.innerHTML = `<b>recompute</b> in ${perfMs.toFixed(1)} ms`;
}

function updateLegend(): void {
  if (!result || !dataCache) return;
  legend.update({
    datasetId: state.dataset,
    layers: dataCache.layers,
    layoutOrder: result.layoutOrder,
    tpidRanking: result.pid.ranking,
    tpidDepth: result.pid.depth,
    tpidDefined: result.pid.defined,
    selectedLayerId: state.selectedLayer,
    note:
      state.visMethod === "braided" && state.showDensityGradient && !state.collapseBranches
        ? "Branch color intensity represents KDE density."
        : "",
  });
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(1);
}

function onHoverMove(evt: MouseEvent): void {
  if (!dataCache || !result) return;
  const matrix = svgEl.getScreenCTM();
  if (!matrix) return;
  const point = svgEl.createSVGPoint();
  point.x = evt.clientX;
  point.y = evt.clientY;
  const { x: px, y: py } = point.matrixTransform(matrix.inverse());
  if (px < M.left || px > W - M.right) {
    state.hover = null;
    state.highlight = null;
    tooltip.classList.add("hidden");
    render();
    return;
  }
  const visibleIndices = Array.from(
    { length: state.timeEnd - state.timeStart + 1 },
    (_, offset) => state.timeStart + offset,
  );
  const eventDays = visibleIndices.map((t) => diseaseDay(dataCache!.times[t]));
  let localTime = Math.round(
    ((px - M.left) / (W - M.left - M.right)) * (visibleIndices.length - 1),
  );
  if (eventDays.every(Number.isFinite)) {
    const target =
      eventDays[0] +
      ((px - M.left) / (W - M.left - M.right)) *
        (eventDays.at(-1)! - eventDays[0]);
    localTime = eventDays.reduce(
      (best, day, index) =>
        Math.abs(day - target) < Math.abs(eventDays[best] - target)
          ? index
          : best,
      0,
    );
  }
  localTime = Math.max(0, Math.min(visibleIndices.length - 1, localTime));
  const t = visibleIndices[localTime];
  state.hover = t;

  const braided = state.visMethod === "braided";
  const bottom = braided
    ? result.braided.layers.map((layer) => layer.slotY0)
    : result.base.yBottom;
  const top = braided
    ? result.braided.layers.map((layer) => layer.slotY1)
    : result.base.yTop;
  const ids = result.layoutOrder;
  const target = (evt.target as Element).closest?.(
    "[data-owner-layer]",
  ) as SVGElement | null;
  const owner = target?.dataset.ownerLayer;
  const hit = owner
    ? ids.indexOf(owner)
    : ids.findIndex((_, i) => dataY(py, bottom[i][t], top[i][t]) !== null);
  state.highlight = hit >= 0 ? ids[hit] : null;
  showTooltip(t, hit >= 0 ? ids[hit] : null, target?.dataset.spaceKind);
  render();
}

/** map cursor y (svg units) back to data units, return null if outside [lo,hi] */
function dataY(py: number, lo: number, hi: number): number | null {
  if (!dataCache || !result) return null;
  const tLen = dataCache.times.length;
  let yMin = Infinity;
  let yMax = -Infinity;
  const braided = state.visMethod === "braided";
  const bottom = braided
    ? result.braided.layers.map((layer) => layer.slotY0)
    : result.base.yBottom;
  const top = braided
    ? result.braided.layers.map((layer) => layer.slotY1)
    : result.base.yTop;
  for (let i = 0; i < top.length; i += 1) {
    for (let t = 0; t < tLen; t += 1) {
      if (bottom[i][t] < yMin) yMin = bottom[i][t];
      if (top[i][t] > yMax) yMax = top[i][t];
    }
  }
  const pad = (yMax - yMin) * 0.06 || 1;
  yMin -= pad;
  yMax += pad;
  const v = yMax - ((py - M.top) / (H - M.top - M.bottom)) * (yMax - yMin);
  return v >= lo && v <= hi ? v : null;
}

export function showTooltip(
  t: number,
  layerId: string | null,
  spaceKind?: string,
): void {
  if (!dataCache || !result) return;
  const { layers, times } = dataCache;
  const layer = layerId ? layers.find((l) => l.id === layerId) : null;
  const tt = tooltip as HTMLElement;
  if (!layer) {
    const title = document.createElement("div");
    title.className = "tt-title";
    title.textContent = times[t];
    const message = document.createElement("div");
    message.textContent = "no layer under cursor (corridor gap)";
    tt.replaceChildren(title, message);
    tt.classList.remove("hidden");
    return;
  }
  const i = result.layoutOrder.indexOf(layer.id);
  const geometry = result.braided.layers[i];
  const point = geometry.debug?.[t];
  const magnitude = result.base.yTop[i][t] - result.base.yBottom[i][t];
  const sampleSize = dataCache.sampleSize[layer.id]?.[t];

  const rows = [
    ["representative thickness H = raw P median", fmt(magnitude)],
    ["raw P: U / A- / A+ / b", point
      ? `${fmt(point.dispersion)} / ${fmt(point.deviationLow)} / ${fmt(point.deviationHigh)} / ${geometry.balance[t].toFixed(3)}`
      : "n/a"],
    ["modes K / basin masses π", point
      ? `${geometry.branchCount[t]} / ${point.branchMasses.map((mass) => mass.toFixed(3)).join(", ")}`
      : "n/a"],
    ["allocated gaps g", point ? point.gaps.map(fmt).join(", ") : "n/a"],
    ...(spaceKind ? [["space owner", `${spaceKind} · ${layer.id}`]] : []),
    ...(sampleSize === null || sampleSize === undefined
      ? []
      : [[state.dataset === "covid-inc"
        ? "model members"
        : state.dataset === "illustration" ? "ensemble members" : "patient sample", String(sampleSize)]]),
  ];
  const title = document.createElement("div");
  title.className = "tt-title";
  title.textContent = `${times[t]} · ${layer.id}`;
  const rowElements = rows.map(([key, value]) => {
    const row = document.createElement("div");
    row.className = "tt-row";
    const keyElement = document.createElement("span");
    keyElement.className = "k";
    keyElement.textContent = key;
    const valueElement = document.createElement("span");
    valueElement.className = "v";
    valueElement.textContent = value;
    row.append(keyElement, valueElement);
    return row;
  });
  tt.replaceChildren(title, ...rowElements);
  tt.classList.remove("hidden");
}

function updateTimeRange(start: number, end: number): void {
  if (!dataCache) return;
  const max = dataCache.times.length - 1;
  state.timeStart = Math.max(0, Math.min(start, max - 1));
  state.timeEnd = Math.min(max, Math.max(end, state.timeStart + 1));
  state.hover = null;
  state.highlight = null;
  tooltip.classList.add("hidden");
  render();
}

function bindControls(): void {
  const bind = <T extends HTMLInputElement | HTMLSelectElement>(
    id: string,
    apply: (v: string) => void,
  ): void => {
    const el = $(id) as T;
    el.addEventListener("input", () => apply((el as HTMLInputElement).value));
    el.addEventListener("change", () => apply((el as HTMLInputElement).value));
  };
  bind("ctl-dataset", (v) => {
    state.dataset = v as DatasetId;
    void loadData(state.dataset);
  });
  bind("ctl-vis-method", (v) => {
    state.visMethod = v as VisMethod;
    state.collapseBranches = false;
    $("btn-collapse").classList.remove("active");
    render();
    updateLegend();
  });
  bind("ctl-baseline", (v) => {
    state.baseline = v as State["baseline"];
    run();
  });
  bind("ctl-bandwidth-ratio", (v) => {
    BRAIDED_PARAMETERS.bandwidthRatio = Number(v);
    run();
  });
  const smooth = $<HTMLInputElement>("ctl-smooth");
  smooth.addEventListener("change", () => {
    state.smoothContours = smooth.checked;
    render();
  });
  const envelopeStroke = $<HTMLInputElement>("ctl-envelope-stroke");
  envelopeStroke.addEventListener("change", () => {
    state.showEnvelopeStroke = envelopeStroke.checked;
    render();
  });
  const representativeStroke = $<HTMLInputElement>("ctl-representative-stroke");
  representativeStroke.addEventListener("change", () => {
    state.showRepresentativeStroke = representativeStroke.checked;
    render();
  });
  const timeCell = $<HTMLInputElement>("ctl-time-cell");
  timeCell.addEventListener("change", () => {
    state.showTimeCell = timeCell.checked;
    render();
  });
  const branchStroke = $<HTMLInputElement>("ctl-branch-stroke");
  branchStroke.addEventListener("change", () => {
    state.showBranchStroke = branchStroke.checked;
    render();
  });
  const yAxis = $<HTMLInputElement>("ctl-y-axis");
  yAxis.addEventListener("change", () => {
    state.showYAxis = yAxis.checked;
    render();
  });
  const densityGradient = $<HTMLInputElement>("ctl-density-gradient");
  densityGradient.addEventListener("change", () => {
    state.showDensityGradient = densityGradient.checked;
    run();
  });
  $("btn-collapse").addEventListener("click", () => {
    state.collapseBranches = !state.collapseBranches;
    $("btn-collapse").classList.toggle("active", state.collapseBranches);
    state.hover = null;
    tooltip.classList.add("hidden");
    render();
    updateLegend();
  });
  $("btn-svg").addEventListener("click", () => exportSvg(svgEl));
  // collapsible left panel
  const panel = $("panel");
  const btnPanel = $("btn-panel");
  btnPanel.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    btnPanel.textContent = collapsed ? "»" : "«";
  });

  svgEl.addEventListener("mousemove", onHoverMove);
  svgEl.addEventListener("mouseleave", () => {
    state.hover = null;
    state.highlight = null;
    tooltip.classList.add("hidden");
    render();
  });
}

async function main(): Promise<void> {
  bindControls();
  await loadData(state.dataset);
}

void main();
