/**
 * Demo entry: state, controls, hover details, cost panel, export.
 */
import { resolveLayerQuantiles, runPipeline } from "../code/index";
import { DEFAULT_COVID_STATES, parseCovidCaseJson, type CovidStateSelection } from "../code/data/covid";
import { parseIllustrationCsv } from "../code/data/illustration";
import { parseTcmCsv } from "../code/data/tcm";
import {
  colorForLayer,
  diseaseDay,
  exportPng,
  exportSvg,
  lighterFamilyColor,
  renderChart,
  renderTimeFilter,
  M,
  W,
  H,
  type VisMethod,
} from "./render";
import type {
  BraidedStreamOptions,
  Layer,
  PipelineResult,
} from "../code/types";

// Case-study data files are served from vite's public/ directory.
export const COVID_PARAMETERS: { stateSelection: CovidStateSelection } = {
  stateSelection: DEFAULT_COVID_STATES,
};

const DATASETS = {
  illustration: {
    path: "dataset/illustration.csv",
    label: "illustration",
    parse: parseIllustrationCsv,
  },
  tcm: { path: "dataset/TCMRecord.csv", label: "tcm", parse: parseTcmCsv },
  "covid-inc": {
    path: "dataset/covid_inc_case_trained_members.json",
    label: "covid-inc",
    parse: (text: string) => parseCovidCaseJson(text, COVID_PARAMETERS.stateSelection),
  },
} as const;

type DatasetId = keyof typeof DATASETS;

/** Code-owned parameters; future controls can update this object before run(). */
export const BRAIDED_PARAMETERS: Partial<BraidedStreamOptions> = {
  bandwidthRatio: 0.3,
  debug: true,
};

interface State {
  dataset: DatasetId;
  visMethod: VisMethod;
  baseline: "wiggle" | "sine";
  smoothContours: boolean;
  showSlotBoundary: boolean;
  collapseBranches: boolean;
  hover: number | null;
  highlight: string | null;
  timeStart: number;
  timeEnd: number;
}

const state: State = {
  dataset: "illustration",
  visMethod: "braided",
  baseline: "wiggle",
  smoothContours: true,
  showSlotBoundary: true,
  collapseBranches: false,
  hover: null,
  highlight: null,
  timeStart: 0,
  timeEnd: 1,
};

let dataCache: { layers: Layer[]; times: string[] } | null = null;
let result: PipelineResult | null = null;
let perfMs = 0;

const $ = <T extends Element>(id: string): T =>
  document.getElementById(id) as unknown as T;
const svgEl = $<SVGSVGElement>("chart");
const timeFilterEl = $<SVGSVGElement>("time-filter");
const tooltip = $("tooltip");
const costsEl = $("costs");
const legendEl = $("legend");

async function loadData(): Promise<void> {
  const spec = DATASETS[state.dataset];
  const res = await fetch(spec.path);
  if (!res.ok) throw new Error(`failed to load ${spec.path}: ${res.status}`);
  const text = await res.text();
  dataCache = spec.parse(text);
  state.timeStart = 0;
  state.timeEnd = Math.max(0, dataCache.times.length - 1);
  state.hover = null;
  state.highlight = null;
}

function run(): void {
  if (!dataCache || dataCache.times.length < 2) return;
  const t0 = performance.now();

  result = runPipeline(dataCache.layers, {
    baselineMode: state.baseline,
    braided: {
      ...BRAIDED_PARAMETERS,
    },
  });
  perfMs = performance.now() - t0;

  render();
  renderCosts();
  renderLegend();
}

function render(): void {
  if (!dataCache || !result) return;
  const braided = state.visMethod === "braided";
  const collapse = $<HTMLButtonElement>("btn-collapse");
  collapse.hidden = !braided;
  collapse.disabled = !braided;
  collapse.textContent = state.collapseBranches ? "Expand branches" : "Collapse branches";
  renderChart(svgEl, {
    layers: dataCache.layers,
    times: dataCache.times,
    result,
    start: state.timeStart,
    end: state.timeEnd,
    visMethod: state.visMethod,
    smoothContours: state.smoothContours,
    showSlotBoundary: state.showSlotBoundary,
    collapseBranches: state.collapseBranches,
    hover: state.hover,
    highlightLayer: state.highlight,
  });
  renderTimeFilter(timeFilterEl, {
    layers: dataCache!.layers,
    times: dataCache!.times,
    start: state.timeStart,
    end: state.timeEnd,
    onChange: updateTimeRange,
  });
}

function renderCosts(): void {
  if (!result) return;
  const c = result.costs;
  const lines = [
    `<b>geometry cost</b>  (recompute ${perfMs.toFixed(1)} ms)`,
    `height ratio  max ${c.maxHeightRatio.toFixed(3)} · mean ${c.meanHeightRatio.toFixed(3)}`,
    `collisions ${c.collisionCount} · min gap ${c.minGap.toFixed(3)}`,
    `curvature  braided ${fmt(c.curvatureBraided)} vs base ${fmt(c.curvatureBase)}`,
    `slope      braided ${fmt(c.slopeBraided)} vs base ${fmt(c.slopeBase)}`,
    `nonlocal displacement ${fmt(c.displacement)}`,
    `deformation total  ΣD=ΣU ${fmt(c.dispersionTotal)}`,
  ];
  costsEl.innerHTML = lines.join("\n");
}

function renderLegend(): void {
  if (!result) return;
  const html = result.pid.ranking
    .map((id, idx) => {
      const color = colorForLayer(dataCache!.layers, id);
      const depthLabel = result!.pid.defined
        ? `TPID=${result!.pid.depth[id].toFixed(6)}`
        : "TPID undefined";
      return `<span class="sw" style="background:${color}"></span>#${idx + 1} ${id} <span style="opacity:.6">${depthLabel}</span>`;
    })
    .join("&nbsp;&nbsp;");
  const meaning = state.dataset === "tcm"
    ? "each layer-time cell = patient-dose distribution; thickness = raw-measure median"
    : state.dataset === "illustration"
      ? "each layer-time cell = generated ensemble distribution; thickness = raw-measure median"
      : "each layer-time cell = weighted reconstructed predictive mixture; thickness = raw-measure median";
  const sampleColor = colorForLayer(dataCache!.layers, result.pid.ranking[0]);
  const geometryKey = state.visMethod === "braided"
    ? `<div><span class="sw" style="background:${sampleColor}"></span>solid = representative thickness H&nbsp;&nbsp;` +
      `<span class="sw" style="background:${lighterFamilyColor(sampleColor)}"></span>light = allocated deformation space (not probability mass or a confidence interval)</div>`
    : "";
  const orderKey = result.pid.defined
    ? `<div>center-out order = decreasing TPID over ${result.pid.referenceTimeIndices.length} common time points</div>`
    : "<div>TPID undefined for this reference set; stable ID fallback order</div>";
  legendEl.innerHTML = `<div>${meaning}</div>${orderKey}${geometryKey}${html}`;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(1);
}

function onHoverMove(evt: MouseEvent): void {
  if (!dataCache || !result) return;
  const rect = svgEl.getBoundingClientRect();
  const scaleX = W / rect.width;
  const px = (evt.clientX - rect.left) * scaleX;
  const py = (evt.clientY - rect.top) * scaleX;
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
  const ids = result.pid.order;
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

function showTooltip(
  t: number,
  layerId: string | null,
  spaceKind?: string,
): void {
  if (!dataCache || !result) return;
  const { layers, times } = dataCache;
  const layer = layerId ? layers.find((l) => l.id === layerId) : null;
  const tt = tooltip as HTMLElement;
  if (!layer) {
    tt.innerHTML = `<div class="tt-title">${times[t]}</div><div>no layer under cursor (corridor gap)</div>`;
    tt.classList.remove("hidden");
    return;
  }
  const i = result.pid.order.indexOf(layer.id);
  const geometry = result.braided.layers[i];
  const point = geometry.debug?.[t];
  const d = result.pid.depth[layer.id];
  const magnitude = result.base.yTop[i][t] - result.base.yBottom[i][t];
  const quantiles = resolveLayerQuantiles(layer, t);
  const sampleSize = layer.sampleSize?.[t];
  const perCapita = layer.perCapita ? ` · ${fmt(layer.perCapita[t])}/cap` : "";

  const rows = [
    ["representative thickness H = raw P median", fmt(magnitude)],
    ["raw-P dispersion U", fmt(geometry.actualSpace[t])],
    ["raw-P deviation A- / A+", point ? `${fmt(point.deviationLow)} / ${fmt(point.deviationHigh)}` : "n/a"],
    ["asymmetry b", geometry.balance[t].toFixed(3)],
    ["KDE beta / bandwidth h", point ? `${point.bandwidthRatio.toFixed(2)} / ${fmt(point.bandwidth)}` : "n/a"],
    ["modes K", String(geometry.branchCount[t])],
    ["basin masses pi", point ? point.branchMasses.map((mass) => mass.toFixed(3)).join(", ") : "n/a"],
    ["mode separations d", point ? point.separations.map(fmt).join(", ") || "none" : "n/a"],
    ["allocated gaps g", point ? point.gaps.map(fmt).join(", ") : "n/a"],
    ...(layer.sourceKind === "quantile-mixture"
      ? [["official submitted Q2.5-Q97.5 (reference only)", `[${fmt(quantiles.qLow)}, ${fmt(quantiles.qHigh)}]`]]
      : []),
    ["dynamic-slot boundary", state.showSlotBoundary ? "shown" : "hidden"],
    ["TPID = min(IN-in, IN-out)", result.pid.defined ? d.toFixed(6) : "undefined"],
    ["directional IN-in / IN-out", result.pid.defined
      ? `${result.pid.inclusionIn[layer.id].toFixed(6)} / ${result.pid.inclusionOut[layer.id].toFixed(6)}`
      : "undefined"],
    ["visible branches", String(!state.collapseBranches ? geometry.branchCount[t] : 1)],
    ...(spaceKind ? [["space owner", `${spaceKind} · ${layer.id}`]] : []),
    ...(sampleSize === null || sampleSize === undefined
      ? []
      : [[layer.sourceKind === "quantile-mixture"
        ? "model members"
        : state.dataset === "illustration" ? "ensemble members" : "patient sample", String(sampleSize)]]),
  ];
  tt.innerHTML =
    `<div class="tt-title">${times[t]} · ${layer.id}${perCapita}</div>` +
    rows
      .map(([k, v]) => `<div class="tt-row"><span class="k">${k}</span><span class="v">${v}</span></div>`)
      .join("");
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
    void loadData().then(run);
  });
  bind("ctl-vis-method", (v) => {
    state.visMethod = v as VisMethod;
    state.collapseBranches = false;
    $("btn-collapse").classList.remove("active");
    render();
  });
  bind("ctl-baseline", (v) => {
    state.baseline = v as State["baseline"];
    run();
  });
  bind("ctl-bandwidth-ratio", (v) => {
    BRAIDED_PARAMETERS.bandwidthRatio = Number(v);
    $("ctl-bandwidth-ratio-value").textContent = Number(v).toFixed(2);
    run();
  });
  const smooth = $<HTMLInputElement>("ctl-smooth");
  smooth.addEventListener("change", () => {
    state.smoothContours = smooth.checked;
    render();
  });
  const slotBoundary = $<HTMLInputElement>("ctl-slot-boundary");
  slotBoundary.addEventListener("change", () => {
    state.showSlotBoundary = slotBoundary.checked;
    render();
  });
  $("btn-collapse").addEventListener("click", () => {
    state.collapseBranches = !state.collapseBranches;
    $("btn-collapse").classList.toggle("active", state.collapseBranches);
    state.hover = null;
    tooltip.classList.add("hidden");
    render();
  });
  $("btn-svg").addEventListener("click", () => exportSvg(svgEl));
  $("btn-png").addEventListener("click", () => {
    void exportPng(svgEl).catch(console.error);
  });
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
  await loadData();
  run();
}

void main();
