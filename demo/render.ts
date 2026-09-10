/** SVG renderer. */
import { computeSineBaseline } from "../code/baseline";
import { area, axisBottom, axisLeft, curveBasis, curveLinear, line, scaleLinear, select, stack, stackOffsetWiggle } from "d3";
import type { BaseLayout, Layer, PipelineResult } from "../code/types";

export const W = 1180;
export const H = 620;
export const M = { top: 24, right: 28, bottom: 64, left: 64 };
const IW = W - M.left - M.right;
const NS = "http://www.w3.org/2000/svg";
export const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#56B4E9", "#D55E00", "#CC79A7", "#F0E442", "#000000", "#8C8C8C", "#66C2A5"];

export interface RenderInput {
  layers: Layer[];
  times: string[];
  result: PipelineResult;
  baseInput: BaseLayout;
  mode: "base" | "pid" | "braided";
  smoothContours: boolean;
  showRef: boolean;
  forceBase: boolean;
  hover: number | null;
  highlightLayer: string | null;
}

export function renderChart(svg: SVGElement, input: RenderInput): void {
  const tLen = input.times.length;
  const braided = input.mode === "braided" && !input.forceBase;
  const base = input.mode === "base";
  const bottom = base ? input.baseInput.yBottom : braided ? input.result.braided.yBottomStar : input.result.base.yBottom;
  const top = base ? input.baseInput.yTop : braided ? input.result.braided.yTopStar : input.result.base.yTop;
  const layerIds = base ? input.layers.map((layer) => layer.id) : input.result.pid.order;
  const values = [...bottom.flat(), ...top.flat()];
  if (input.showRef) values.push(...input.result.base.yTop.at(-1)!);
  const pad = (Math.max(...values) - Math.min(...values)) * 0.06 || 1;
  const y = scaleLinear().domain([Math.min(...values) - pad, Math.max(...values) + pad]).range([H - M.bottom, M.top]);
  const x = scaleLinear().domain([0, Math.max(1, tLen - 1)]).range([M.left, W - M.right]);
  const indices = Array.from({ length: tLen }, (_, t) => t);
  const curve = input.smoothContours ? curveBasis : curveLinear;
  const makeArea = (lo: number[], hi: number[]) => area<number>()
    .curve(curve).x((t) => x(t)).y0((t) => y(lo[t])).y1((t) => y(hi[t]))(indices) ?? "";
  const makeLine = (values: number[]) => line<number>()
    .curve(curve).x((t) => x(t)).y((t) => y(values[t]))(indices) ?? "";

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  const root = select(svg);
  root.selectAll("*").remove();
  const ticks = 5;
  root.append("g").attr("class", "grid").attr("transform", `translate(${M.left},0)`)
    .call(axisLeft(y).ticks(ticks).tickSize(-IW).tickFormat(() => "")).select(".domain").remove();
  const xTicks: number[] = [];
  const step = Math.max(1, Math.ceil(tLen / 10));
  for (let t = 0; t < tLen; t += step) xTicks.push(t);
  if (xTicks.at(-1) !== tLen - 1) xTicks.push(tLen - 1);
  root.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.bottom})`)
    .call(axisBottom(x).tickValues(xTicks).tickFormat((t) => tickLabel(input.times[Number(t)] ?? "")));
  root.append("g").attr("class", "axis axis-y").attr("transform", `translate(${M.left},0)`)
    .call(axisLeft(y).ticks(ticks).tickFormat((value) => fmtNum(Number(value))));
  if (input.showRef) {
    root.append("path").attr("d", makeLine(input.result.base.yTop.at(-1)!)).attr("class", "ref-silhouette");
    root.append("path").attr("d", makeLine(input.result.base.yBottom[0])).attr("class", "ref-silhouette").attr("stroke-opacity", 0.5);
  }
  const colorOf = (idx: number): string => input.layers.find((layer) => layer.id === layerIds[idx])?.color ?? PALETTE[idx % PALETTE.length];
  root.append("g").attr("class", "layers").selectAll("path").data(layerIds).join("path")
    .attr("d", (_, i) => makeArea(bottom[i], top[i]))
    .attr("class", (id) => `layer${input.highlightLayer && id !== input.highlightLayer ? " dim" : ""}`)
    .attr("fill", (_, i) => colorOf(i)).attr("fill-opacity", 0.82).attr("stroke", (_, i) => colorOf(i))
    .attr("stroke-width", 0.8).attr("data-idx", (_, i) => i).attr("data-id", (id) => id);
  if (input.hover !== null) svg.appendChild(el("line", { class: "hover-line", x1: x(input.hover), x2: x(input.hover), y1: M.top, y2: H - M.bottom }));
}

export function baseGeometryInInputOrder(layers: Layer[], times: string[], baselineMode: "wiggle" | "sine" = "wiggle"): BaseLayout {
  if (baselineMode === "sine") return computeSineBaseline(layers, layers.map((layer) => layer.id));
  const ids = layers.map((layer) => layer.id);
  const rows = times.map((_, t) => Object.fromEntries(layers.map((layer) => [layer.id, (layer.magnitude ?? layer.q.p50)[t]])) as Record<string, number>);
  const series = stack<Record<string, number>>().keys(ids).offset(stackOffsetWiggle)(rows);
  const yBottom = series.map((layer) => layer.map(([bottom]) => bottom));
  const yTop = series.map((layer) => layer.map(([, top]) => top));
  const shift = -(Math.min(...yBottom.flat()) + Math.max(...yTop.flat())) / 2;
  return { baseline: yBottom[0].map((value) => value + shift), yBottom: yBottom.map((layer) => layer.map((value) => value + shift)), yTop: yTop.map((layer) => layer.map((value) => value + shift)) };
}

function tickLabel(label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(label)) return label;
  const [year, month] = label.split("-");
  return `${year.slice(2)}-${month}`;
}
function fmtNum(value: number): string {
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}
function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
export function exportSvg(svg: SVGElement): void {
  downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }), "braided-streamgraph.svg");
}
export function exportPng(svg: SVGElement): Promise<void> {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * 2; canvas.height = H * 2;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("canvas 2d unavailable"));
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); if (!blob) return reject(new Error("toBlob failed")); downloadBlob(blob, "braided-streamgraph.png"); resolve(); }, "image/png");
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("svg rasterization failed")); };
    image.src = url;
  });
}
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
