/** SVG renderer. */
import { computeSineBaseline } from "../code/engine/baseline";
import {
  area,
  axisBottom,
  axisLeft,
  brushX,
  curveBasis,
  curveLinear,
  hsl,
  line,
  scaleLinear,
  select,
  stack,
  stackOffsetWiggle,
  symbol,
  symbolStar,
} from "d3";
import type { BaseLayout, Layer, PipelineResult } from "../code/types";

export const W = 1180;
export const H = 620;
export const M = { top: 24, right: 28, bottom: 64, left: 64 };
const IW = W - M.left - M.right;
const NS = "http://www.w3.org/2000/svg";
export type VisMethod = "braided" | "star" | "color-blur";


export const REFERENCE_PALETTE = [
  "#B3DE69", "#8DD3C7", "#FCCDE5", "#BEBADA", "#FFFFB3",
  "#FDB462", "#FB8072", "#80B1D3", "#D9D9D9", "#BC80BD",
];

export interface RenderInput {
  layers: Layer[];
  times: string[];
  result: PipelineResult;
  start: number;
  end: number;
  visMethod: VisMethod;
  smoothContours: boolean;
  showOutlines: boolean;
  /** Pack colored branches back into the representative Q50 band. */
  collapseBranches: boolean;
  hover: number | null;
  highlightLayer: string | null;
}

export interface TimeFilterInput {
  layers: Layer[];
  times: string[];
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}

/** Stable within a dataset and independent of input/stack order. */
export function colorForLayer(layers: Layer[], id: string): string {
  const layer = layers.find((item) => item.id === id);
  if (layer?.color) return layer.color;
  const ids = layers.filter((item) => !item.color).map((item) => item.id).sort();
  const index = Math.max(0, ids.indexOf(id));
  return REFERENCE_PALETTE[index % REFERENCE_PALETTE.length];
}

export function visibleTimeIndices(length: number, start: number, end: number): number[] {
  const first = Math.max(0, Math.min(Math.floor(start), length - 1));
  const last = Math.max(first, Math.min(Math.floor(end), length - 1));
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

export function renderChart(svg: SVGSVGElement, input: RenderInput): void {
  const tLen = input.times.length;
  const braided = input.visMethod === "braided";
  const bottom = braided
    ? input.result.braided.layers.map((layer) => layer.slotY0)
    : input.result.base.yBottom;
  const top = braided
    ? input.result.braided.layers.map((layer) => layer.slotY1)
    : input.result.base.yTop;
  const layerIds = input.result.pid.order;
  const values = [...bottom.flat(), ...top.flat()];
  const pad = (Math.max(...values) - Math.min(...values)) * 0.06 || 1;
  const y = scaleLinear()
    .domain([Math.min(...values) - pad, Math.max(...values) + pad])
    .range([H - M.bottom, M.top]);
  const indices = visibleTimeIndices(tLen, input.start, input.end);
  const firstTime = indices[0];
  const lastTime = indices.at(-1)!;
  const eventDays = input.times.map(diseaseDay);
  const eventAligned = eventDays.every(Number.isFinite);
  const xValues = eventAligned
    ? eventDays
    : Array.from({ length: tLen }, (_, t) => t);
  const x = scaleLinear()
    .domain([xValues[firstTime] ?? 0, xValues[lastTime] ?? 1])
    .range([M.left, W - M.right]);
  const xAt = (time: number) => {
    const left = Math.max(firstTime, Math.min(lastTime, Math.floor(time)));
    const right = Math.min(lastTime, left + 1);
    return x(xValues[left] + (xValues[right] - xValues[left]) * (time - left));
  };
  const curve = input.smoothContours ? curveBasis : curveLinear;
  const makeArea = (lo: number[], hi: number[]) =>
    area<number>()
      .curve(curve)
      .x((t) => x(xValues[t]))
      .y0((t) => y(lo[t]))
      .y1((t) => y(hi[t]))(indices) ?? "";
  const makeAreaRange = (
    lo: number[],
    hi: number[],
    start: number,
    end: number,
  ) =>
    area<number>()
      .curve(curve)
      .x((t) => x(xValues[t]))
      .y0((t) => y(lo[t]))
      .y1((t) => y(hi[t]))(indices.filter((t) => t >= start && t <= end)) ?? "";
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  const root = select(svg);
  root.selectAll("*").remove();
  const ticks = 5;
  root
    .append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${M.left},0)`)
    .call(
      axisLeft(y)
        .ticks(ticks)
        .tickSize(-IW)
        .tickFormat(() => ""),
    )
    .select(".domain")
    .remove();
  const xTicks: number[] = [];
  const step = Math.max(1, Math.ceil(indices.length / 10));
  for (let t = firstTime; t <= lastTime; t += step) xTicks.push(t);
  if (xTicks.at(-1) !== lastTime) xTicks.push(lastTime);
  const xAxis = root
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`);
  if (eventAligned) {
    xAxis.call(
      axisBottom(x)
        .ticks(8)
        .tickFormat((day) => String(Math.round(Number(day)))),
    );
    root
      .append("text")
      .attr("x", M.left + IW / 2)
      .attr("y", H - 10)
      .attr("text-anchor", "middle")
      .text("Days since diagnosis");
  } else {
    xAxis.call(
      axisBottom(x)
        .tickValues(xTicks)
        .tickFormat((t) => tickLabel(input.times[Number(t)] ?? "")),
    );
  }
  root
    .append("g")
    .attr("class", "axis axis-y")
    .attr("transform", `translate(${M.left},0)`)
    .call(
      axisLeft(y)
        .ticks(ticks)
        .tickFormat((value) => fmtNum(Number(value))),
    );
  const colorOf = (idx: number): string => colorForLayer(input.layers, layerIds[idx]);
  if (braided) {
    const layers = root.append("g").attr("class", "layers");
    for (const [i, geometry] of input.result.braided.layers.entries()) {
      const dim =
        input.highlightLayer && geometry.layerId !== input.highlightLayer
          ? " dim"
          : "";
      layers
        .append("path")
        .attr("d", makeArea(geometry.visualEnvelopeY0, geometry.visualEnvelopeY1))
        .attr("class", `envelope${dim}`)
        .attr("fill", colorOf(i))
        .attr("fill-opacity", 0.16)
        .attr("pointer-events", "none");
      // A single compound fill keeps the shared edge of packed channels invisible.
      const branchAreas = input.collapseBranches
        ? [makeArea(geometry.slotY0, geometry.slotY0.map((bottom, t) =>
            bottom + input.result.base.yTop[i][t] - input.result.base.yBottom[i][t]))]
        : geometry.branches.map((branch) =>
            indices.some((t) => branch.y1[t] > branch.y0[t])
              ? makeArea(branch.y0, branch.y1)
              : "",
          );
      layers
        .append("path")
        .attr("d", branchAreas.join(""))
        .attr("class", `layer branch${dim}`)
        .attr("fill", colorOf(i))
        .attr("fill-opacity", 0.82)
        .attr("stroke", "none")
        .attr("data-id", geometry.layerId);
      // Only outline positive-width runs. Zero-width temporal paths must not become whiskers.
      for (const branch of geometry.branches) {
        if (!input.showOutlines || input.collapseBranches) continue;
        const outline = area<number>()
          .defined((t) => geometry.active[t] && geometry.branchCount[t] > 1 && branch.y1[t] > branch.y0[t])
          .curve(curve)
          .x((t) => x(xValues[t]))
          .y0((t) => y(branch.y0[t]))
          .y1((t) => y(branch.y1[t]))(indices);
        layers
          .append("path")
          .attr("d", outline ?? "")
          .attr("class", `layer branch${dim}`)
          .attr("fill", "none")
          .attr("stroke", colorOf(i))
          .attr("stroke-width", 0.8)
          .attr("data-id", geometry.layerId)
          .attr("data-branch-index", branch.branchIndex);
      }
      for (const space of geometry.spaces) {
        layers
          .append("path")
          .attr("d", makeArea(space.y0, space.y1))
          .attr("class", "internal-space");
        layers
          .append("path")
          .attr("d", makeArea(space.y0, space.y1))
          .attr("class", "space-hit")
          .attr("fill", "transparent")
          .attr("stroke", "none")
          .attr("pointer-events", "all")
          .attr("data-owner-layer", space.ownerLayerId)
          .attr("data-space-kind", space.kind)
          .attr("data-gap-index", space.gapIndex);
      }
      // Draw last so the fixed Q^eta boundary remains visible above branches.
      layers
        .append("path")
        .attr(
          "d",
          line<number>()
            .curve(curve)
            .x((t) => x(xValues[t]))
            .y((t) => y(geometry.slotY1[t]))(indices) ?? "",
        )
        .attr("class", `q-envelope${dim}`)
        .attr("stroke", colorOf(i));
    }
  } else {
    root
      .append("g")
      .attr("class", "layers")
      .selectAll("path")
      .data(layerIds)
      .join("path")
      .attr("d", (_, i) => makeArea(bottom[i], top[i]))
      .attr(
        "class",
        (id) =>
          `layer${input.highlightLayer && id !== input.highlightLayer ? " dim" : ""}`,
      )
      .attr("fill", (_, i) => colorOf(i))
      .attr("fill-opacity", 0.82)
      .attr("stroke", (_, i) => (input.showOutlines ? colorOf(i) : "none"))
      .attr("stroke-width", input.showOutlines ? 0.8 : 0)
      .attr("data-idx", (_, i) => i)
      .attr("data-id", (id) => id);
    const exposure = layerIds.map(
      (id) =>
        input.result.uncertainty.exposure[
          input.layers.findIndex((layer) => layer.id === id)
        ],
    );
    if (input.visMethod === "star")
      drawStars(svg, bottom, top, exposure, indices, xAt, y, colorOf);
    else if (input.visMethod === "color-blur")
      drawColorBlur(svg, bottom, top, exposure, firstTime, lastTime, makeAreaRange, colorOf);
  }
  if (input.hover !== null)
    svg.appendChild(
      el("line", {
        class: "hover-line",
        x1: x(xValues[input.hover]),
        x2: x(xValues[input.hover]),
        y1: M.top,
        y2: H - M.bottom,
      }),
    );
}

/** Full-range streamgraph overview with a D3 brush that selects the visible time window. */
export function renderTimeFilter(svg: SVGSVGElement, input: TimeFilterInput): void {
  const tLen = input.times.length;
  const filterHeight = 92;
  svg.setAttribute("viewBox", `0 0 ${W} ${filterHeight}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(filterHeight));
  const root = select(svg);
  root.selectAll("*").remove();
  if (tLen < 2) return;

  const overview = baseGeometryInInputOrder(input.layers, input.times);
  const values = [...overview.yBottom.flat(), ...overview.yTop.flat()];
  const pad = (Math.max(...values) - Math.min(...values)) * 0.08 || 1;
  const x = scaleLinear().domain([0, tLen - 1]).range([M.left, W - M.right]);
  const y = scaleLinear()
    .domain([Math.min(...values) - pad, Math.max(...values) + pad])
    .range([58, 12]);
  const indices = Array.from({ length: tLen }, (_, t) => t);

  root
    .append("rect")
    .attr("x", M.left)
    .attr("y", 8)
    .attr("width", IW)
    .attr("height", 54)
    .attr("fill", "#f8fafc")
    .attr("stroke", "#e5e7eb");
  for (let i = 0; i < input.layers.length; i += 1) {
    root
      .append("path")
      .attr(
        "d",
        area<number>()
          .curve(curveLinear)
          .x((t) => x(t))
          .y0((t) => y(overview.yBottom[i][t]))
          .y1((t) => y(overview.yTop[i][t]))(indices) ?? "",
      )
      .attr("fill", colorForLayer(input.layers, input.layers[i].id))
      .attr("fill-opacity", 0.76);
  }

  const ticks = [0, Math.round((tLen - 1) / 2), tLen - 1].filter((value, i, all) => all.indexOf(value) === i);
  root
    .append("g")
    .attr("transform", "translate(0,62)")
    .call(axisBottom(x).tickValues(ticks).tickFormat((t) => tickLabel(input.times[Number(t)] ?? "")))
    .selectAll("text")
    .attr("fill", "#6b7280")
    .attr("font-size", 10);

  const brush = brushX()
    .extent([[M.left, 8], [W - M.right, 62]])
    .on("end", (event) => {
      if (!event.sourceEvent || !event.selection) return;
      const [left, right] = event.selection as [number, number];
      const start = Math.round(x.invert(left));
      const end = Math.round(x.invert(right));
      input.onChange(Math.min(start, end), Math.max(start, end));
    });
  const selection = root
    .append("g")
    .call(brush)
    .call(brush.move, [x(input.start), x(input.end)]);
  selection.select(".selection").attr("fill", "#0072b2").attr("fill-opacity", 0.18);
  selection.selectAll(".handle").attr("fill", "#ffffff").attr("stroke", "#0072b2");
  selection.select(".overlay").attr("cursor", "crosshair");
}

export function diseaseDay(label: string): number {
  const match = /^day (\d+)$/.exec(label);
  return match ? Number(match[1]) : Number.NaN;
}

function drawStars(
  svg: SVGSVGElement,
  bottom: number[][],
  top: number[][],
  u: number[][],
  indices: number[],
  x: (t: number) => number,
  y: (v: number) => number,
  colorOf: (i: number) => string,
): void {
  for (let i = 0; i < bottom.length; i += 1) {
    for (const t of indices) {
      if (t % 6 !== 0) continue;
      const radius = 1.5 + 9 * u[i][t];
      if (radius < 2) continue;
      svg.appendChild(
        el("path", {
          d:
            symbol()
              .type(symbolStar)
              .size(radius * radius * 7)() ?? "",
          transform: `translate(${x(t)},${y((bottom[i][t] + top[i][t]) / 2)})`,
          fill: colorOf(i),
          stroke: "#ffffff",
          "stroke-width": 0.8,
          "fill-opacity": 0.9,
        }),
      );
    }
  }
}

function drawColorBlur(
  svg: SVGSVGElement,
  bottom: number[][],
  top: number[][],
  u: number[][],
  firstTime: number,
  lastTime: number,
  areaRange: (lo: number[], hi: number[], start: number, end: number) => string,
  colorOf: (i: number) => string,
): void {
  const defs = el("defs", {});
  svg.appendChild(defs);
  const length = bottom[0].length;
  const segment = Math.max(1, Math.ceil(length / 14));
  for (let i = 0; i < bottom.length; i += 1) {
    const mean = u[i].reduce((sum, value) => sum + value, 0) / length;
    const filterId = `color-blur-${i}`;
    const filter = el("filter", {
      id: filterId,
      x: "-20%",
      y: "-20%",
      width: "140%",
      height: "140%",
    });
    filter.appendChild(
      el("feGaussianBlur", { stdDeviation: 0.4 + 3.2 * mean }),
    );
    defs.appendChild(filter);
    const { h, l } = hsl(colorOf(i));
    for (let start = Math.floor(firstTime / segment) * segment; start <= lastTime; start += segment) {
      const end = Math.min(length - 1, start + segment);
      const visibleStart = Math.max(firstTime, start);
      const visibleEnd = Math.min(lastTime, end);
      const local =
        u[i].slice(start, end + 1).reduce((sum, value) => sum + value, 0) /
        (end - start + 1);
      svg.appendChild(
        el("path", {
          d: areaRange(bottom[i], top[i], visibleStart, visibleEnd),
          fill: `hsl(${h}, ${(12 + 78 * local).toFixed(0)}%, ${(l * 100).toFixed(0)}%)`,
          "fill-opacity": 0.85,
          filter: `url(#${filterId})`,
        }),
      );
    }
  }
}

export function baseGeometryInInputOrder(
  layers: Layer[],
  times: string[],
  baselineMode: "wiggle" | "sine" = "wiggle",
): BaseLayout {
  if (baselineMode === "sine")
    return computeSineBaseline(
      layers,
      layers.map((layer) => layer.id),
    );
  const ids = layers.map((layer) => layer.id);
  const rows = times.map(
    (_, t) =>
      Object.fromEntries(
        layers.map((layer) => [layer.id, (layer.magnitude ?? layer.q.p50)[t]]),
      ) as Record<string, number>,
  );
  const series = stack<Record<string, number>>()
    .keys(ids)
    .offset(stackOffsetWiggle)(rows);
  const yBottom = series.map((layer) => layer.map(([bottom]) => bottom));
  const yTop = series.map((layer) => layer.map(([, top]) => top));
  const shift = -(Math.min(...yBottom.flat()) + Math.max(...yTop.flat())) / 2;
  return {
    baseline: yBottom[0].map((value) => value + shift),
    yBottom: yBottom.map((layer) => layer.map((value) => value + shift)),
    yTop: yTop.map((layer) => layer.map((value) => value + shift)),
  };
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
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}
export function exportSvg(svg: SVGElement): void {
  downloadBlob(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    "braided-streamgraph.svg",
  );
}
export function exportPng(svg: SVGElement): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml;charset=utf-8",
    }),
  );
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * 2;
      canvas.height = H * 2;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("canvas 2d unavailable"));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) return reject(new Error("toBlob failed"));
        downloadBlob(blob, "braided-streamgraph.png");
        resolve();
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg rasterization failed"));
    };
    image.src = url;
  });
}
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
