/**
 * Demo entry: state, controls, hover details, cost panel, export.
 */
import { runPipeline } from "../code/index";
import { parseCovidCsv } from "../code/covid";
import { parseEditableCsv } from "../code/editable";
import { parseTcmCsv } from "../code/tcm";
import { PALETTE, PUBLICATION_PALETTE, baseGeometryInInputOrder, exportPng, exportSvg, renderChart, M, W, H } from "./render";
import type { Layer, PipelineResult, PresentationMode, ViewMode } from "../code/types";

// CSV files are served from the vite public/ dir (see scripts/copy-dataset.mjs).
const DATASETS = {
  editable: { path: "dataset/editable.csv", label: "editable", parse: parseEditableCsv },
  tcm: { path: "dataset/TCMRecord.csv", label: "tcm", parse: parseTcmCsv },
  "covid-inc": { path: "dataset/ensemble_covid_inc_case.csv", label: "covid-inc" },
  flusight: { path: "dataset/ensemble_flusight_hosp.csv", label: "flusight" },
} as const;

type DatasetId = keyof typeof DATASETS;

interface State {
  presentation: PresentationMode;
  dataset: DatasetId;
  mode: ViewMode;
  baseline: "wiggle" | "sine";
  smoothContours: boolean;
  eta: number;
  amaxPct: number;
  tau: number;
  window: number;
  showRef: boolean;
  forceBase: boolean;
  hover: number | null;
  highlight: string | null;
}

const state: State = {
  presentation: "publication",
  dataset: "editable",
  mode: "braided",
  baseline: "wiggle",
  smoothContours: true,
  eta: 1.6,
  amaxPct: 3,
  tau: 0.3,
  window: 30,
  showRef: true,
  forceBase: false,
  hover: null,
  highlight: null,
};

let dataCache: { layers: Layer[]; times: string[] } | null = null;
let result: PipelineResult | null = null;
let baseInput: ReturnType<typeof baseGeometryInInputOrder> | null = null;
let perfMs = 0;

const $ = <T extends Element>(id: string): T => document.getElementById(id) as unknown as T;
const svgEl = $<SVGSVGElement>("chart");
const tooltip = $("tooltip");
const costsEl = $("costs");
const legendEl = $("legend");

async function loadData(): Promise<void> {
  const spec = DATASETS[state.dataset];
  const res = await fetch(spec.path);
  if (!res.ok) throw new Error(`failed to load ${spec.path}: ${res.status}`);
  const text = await res.text();
  dataCache = "parse" in spec ? spec.parse(text) : parseCovidCsv(text);
}

function run(): void {
  if (!dataCache) return;
  const t0 = performance.now();
  const { layers, times } = dataCache;
  const yExtentGuess = Math.max(1, layers.reduce((acc, l) => {
    let m = 0;
    for (const v of l.q.p50) if (v > m) m = v;
    return acc + m;
  }, 0));
  const amax = (state.amaxPct / 100) * yExtentGuess;
  const clearance = 0.002 * yExtentGuess;

  result = runPipeline(layers, {
    normalize: "global",
    smoothWindow: 0,
    baselineMode: state.baseline,
    corridors: {
      participationThreshold: state.tau,
      amplitudeMax: amax,
      clearance,
      gamma: 1,
      encoding: "amplitude",
      frequencyMin: 0.5,
      frequencyMax: 4,
      windowSmooth: state.window,
      budgetEta: state.eta,
      phaseMode: "sine",
    },
  });
  baseInput = baseGeometryInInputOrder(layers, times, state.baseline);
  perfMs = performance.now() - t0;

  render();
  renderCosts();
  renderLegend();
}

function render(): void {
  if (!dataCache || !result || !baseInput) return;
  renderChart(svgEl, {
    layers: dataCache.layers,
    times: dataCache.times,
    result,
    baseInput,
    mode: state.mode,
    smoothContours: state.smoothContours,
    showRef: state.showRef,
    forceBase: state.forceBase,
    hover: state.hover,
    highlightLayer: state.highlight,
    presentation: state.presentation,
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
    `corridor alloc/req ${(c.allocRatio * 100).toFixed(1)}%  (req ${fmt(c.requestedTotal)} → alloc ${fmt(c.allocatedTotal)})`,
  ];
  costsEl.innerHTML = lines.join("\n");
}

function renderLegend(): void {
  if (!result) return;
  if (state.presentation === "publication") {
    legendEl.setAttribute("data-publication-legend", "true");
    const syntheticSemantics: Record<string, string> = {
      c0: "consensus", c1: "early high-u", c2: "consensus",
      c3: "early-mid high-u", c4: "mid high-u", c5: "persistent outlier",
      c6: "late shift/high-u", c7: "low-u", c8: "thin / high-u",
    };
    const layerItems = result.pid.order.map((id, idx) =>
      `<span class="layer-key" data-layer-legend="${id}"><span class="sw" style="background:${PUBLICATION_PALETTE[idx % PUBLICATION_PALETTE.length]}"></span>${id}${state.dataset === "editable" ? ` ${syntheticSemantics[id] ?? ""}` : ""}</span>`
    ).join("");
    const encodingKey = state.dataset === "tcm"
      ? `<div class="encoding-key"><span class="legend-thickness"></span>color band = median herb amount` +
        `<span class="legend-corridor"></span>cool-gray corridor = inter-patient dose variation` +
        `<span class="legend-reference"></span>dashed outline = collapsed median amount</div>`
      : `<div class="encoding-key"><span class="legend-thickness"></span>color band = q50 thickness` +
        `<span class="legend-corridor"></span>cool-gray corridor = uncertainty event/display space` +
        `<span class="legend-reference"></span>dashed outline = collapsed Σq50` +
        `<span class="legend-event">A–C</span>A–C = selected opening–rejoining events; unmarked corridors remain data-bearing</div>`;
    legendEl.innerHTML = encodingKey +
      `<div class="layer-keys" aria-label="layer identities">${layerItems}</div>`;
    return;
  }
  legendEl.removeAttribute("data-publication-legend");
  const order = result.pid.order;
  const html = order
    .map((id, idx) => {
      const src = dataCache!.layers.find((l) => l.id === id);
      const color = src?.color ?? PALETTE[idx % PALETTE.length];
      const d = result!.pid.depth[id];
      return `<span class="sw" style="background:${color}"></span>${id} <span style="opacity:.6">D=${d.toFixed(3)}</span>`;
    })
    .join("&nbsp;&nbsp;");
  legendEl.innerHTML = html;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(1);
}

function onHoverMove(evt: MouseEvent): void {
  if (!dataCache || !result || state.presentation === "publication") return;
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
  const tLen = dataCache.times.length;
  let t = Math.round(((px - M.left) / (W - M.left - M.right)) * (tLen - 1));
  t = Math.max(0, Math.min(tLen - 1, t));
  state.hover = t;

  // find layer under cursor (braided geometry when applicable)
  const braided = state.mode === "braided" && !state.forceBase;
  const bottom = braided ? result.braided.yBottomStar : state.mode === "base" ? baseInput!.yBottom : result.base.yBottom;
  const top = braided ? result.braided.yTopStar : state.mode === "base" ? baseInput!.yTop : result.base.yTop;
  const ids = state.mode === "base" ? dataCache.layers.map((l) => l.id) : result.pid.order;
  let hit = -1;
  for (let i = 0; i < ids.length; i += 1) {
    if (dataY(py, bottom[i][t], top[i][t]) !== null) {
      hit = i;
      break;
    }
  }
  state.highlight = hit >= 0 ? ids[hit] : null;
  showTooltip(t, hit >= 0 ? ids[hit] : null);
  render();
}

/** map cursor y (svg units) back to data units, return null if outside [lo,hi] */
function dataY(py: number, lo: number, hi: number): number | null {
  if (!result || !baseInput) return null;
  const tLen = dataCache!.times.length;
  let yMin = Infinity;
  let yMax = -Infinity;
  const braided = state.mode === "braided" && !state.forceBase;
  const bottom = braided ? result.braided.yBottomStar : state.mode === "base" ? baseInput.yBottom : result.base.yBottom;
  const top = braided ? result.braided.yTopStar : state.mode === "base" ? baseInput.yTop : result.base.yTop;
  for (let i = 0; i < top.length; i += 1) {
    for (let t = 0; t < tLen; t += 1) {
      if (bottom[i][t] < yMin) yMin = bottom[i][t];
      if (top[i][t] > yMax) yMax = top[i][t];
    }
  }
  if (state.showRef) {
    for (let t = 0; t < tLen; t += 1) {
      const h0 = result.base.yTop[result.base.yTop.length - 1][t];
      if (h0 > yMax) yMax = h0;
    }
  }
  const pad = (yMax - yMin) * 0.06 || 1;
  yMin -= pad;
  yMax += pad;
  const v = yMax - ((py - M.top) / (H - M.top - M.bottom)) * (yMax - yMin);
  return v >= lo && v <= hi ? v : null;
}

function showTooltip(t: number, layerId: string | null): void {
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
  const sourceIndex = layers.indexOf(layer);
  const u = result.uncertainty.u[sourceIndex][t];
  const w = result.uncertainty.width[sourceIndex][t];
  const aReq = result.corridors.aReq[i][t];
  const aAlloc = result.braided.aAlloc[i][t];
  const d = result.pid.depth[layer.id];
  const q50 = layer.q.p50[t];
  const p10 = layer.q.p10[t];
  const p90 = layer.q.p90[t];
  const perCapita = layer.perCapita ? ` · ${fmt(layer.perCapita[t])}/cap` : "";

  const rows = [
    [state.dataset === "tcm" ? "median herb amount" : "q50", fmt(q50)],
    [state.dataset === "tcm" ? "80% dose range" : "80% PI", `[${fmt(p10)}, ${fmt(p90)}]`],
    [state.dataset === "tcm" ? "dose range" : "width w", fmt(w)],
    [state.dataset === "tcm" ? "variation u" : "uncertainty u", u.toFixed(3)],
    ["PID depth", d.toFixed(3)],
    ["corridor req", fmt(aReq)],
    ["corridor alloc", fmt(aAlloc)],
  ];
  tt.innerHTML =
    `<div class="tt-title">${times[t]} · ${layer.id}${perCapita}</div>` +
    rows.map(([k, v]) => `<div class="tt-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
  tt.classList.remove("hidden");
}

function bindControls(): void {
  const bind = <T extends HTMLInputElement | HTMLSelectElement>(id: string, apply: (v: string) => void): void => {
    const el = $(id) as T;
    el.addEventListener("input", () => apply((el as HTMLInputElement).value));
    el.addEventListener("change", () => apply((el as HTMLInputElement).value));
  };
  const val = (id: string, text: string): void => { $(id).textContent = text; };

  bind("ctl-dataset", (v) => {
    state.dataset = v as DatasetId;
    void loadData().then(run);
  });
  bind("ctl-mode", (v) => {
    state.mode = v as ViewMode;
    state.forceBase = false;
    $("btn-collapse").classList.remove("active");
    run();
  });
  bind("ctl-baseline", (v) => { state.baseline = v as State["baseline"]; run(); });

  bind("ctl-eta", (v) => { state.eta = Number(v); val("val-eta", Number(v).toFixed(2)); run(); });
  bind("ctl-amax", (v) => { state.amaxPct = Number(v); val("val-amax", `${Number(v).toFixed(1)}%`); run(); });
  bind("ctl-tau", (v) => { state.tau = Number(v); val("val-tau", Number(v).toFixed(2)); run(); });
  bind("ctl-window", (v) => {
    state.window = Number(v);
    val("val-window", (Number(v) / 100).toFixed(2));
    run();
  });

  const ref = $<HTMLInputElement>("ctl-ref");
  ref.addEventListener("change", () => { state.showRef = ref.checked; render(); });
  const smooth = $<HTMLInputElement>("ctl-smooth");
  smooth.addEventListener("change", () => { state.smoothContours = smooth.checked; render(); });

  $("btn-collapse").addEventListener("click", () => {
    state.forceBase = !state.forceBase;
    $("btn-collapse").classList.toggle("active", state.forceBase);
    state.hover = null;
    tooltip.classList.add("hidden");
    render();
  });
  $("btn-svg").addEventListener("click", () => exportSvg(svgEl));
  $("btn-png").addEventListener("click", () => { void exportPng(svgEl).catch(console.error); });
  $("btn-pub-svg").addEventListener("click", () => exportSvg(svgEl));
  $("btn-pub-png").addEventListener("click", () => { void exportPng(svgEl).catch(console.error); });

  const setPresentation = (presentation: PresentationMode): void => {
    state.presentation = presentation;
    document.body.dataset.presentation = presentation;
    for (const mode of ["publication", "diagnostic"] as const) {
      const button = $(`btn-${mode}`);
      const selected = mode === presentation;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    state.hover = null;
    state.highlight = null;
    tooltip.classList.add("hidden");
    render();
    renderLegend();
  };
  $("btn-publication").addEventListener("click", () => setPresentation("publication"));
  $("btn-diagnostic").addEventListener("click", () => setPresentation("diagnostic"));

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
