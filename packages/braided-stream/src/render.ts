/** SVG renderer. */
import {
  area,
  axisBottom,
  axisLeft,
  brushX,
  curveLinear,
  dragEnable,
  hsl,
  line,
  scaleLinear,
  select,
  schemePaired,
  schemeSet2,
  schemeTableau10,
} from "d3";
import type { PipelineResult } from "./engine/types.js";

export const W = 1180;
export const H = 620;
export const M = { top: 24, right: 28, bottom: 64, left: 64 };
const NS = "http://www.w3.org/2000/svg";
export type VisMethod = "braided" | "streamgraph";
export interface DisplayLayer { readonly id: string; readonly color?: string }


export const REFERENCE_PALETTE = [
  "#B3DE69", "#8DD3C7", "#FCCDE5", "#BEBADA", "#FFFFB3",
  "#FDB462", "#FB8072", "#80B1D3", "#D9D9D9", "#BC80BD",
];

export const LAYER_PALETTES = {
  reference: REFERENCE_PALETTE,
  tableau10: schemeTableau10,
  set2: schemeSet2,
  paired: schemePaired,
} as const;
export type PaletteId = keyof typeof LAYER_PALETTES;

export interface Dimensions {
  width?: number;
  height?: number;
  margin?: Partial<typeof M>;
}

export function dimensions(input: Dimensions) {
  const width = input.width ?? W;
  const height = input.height ?? H;
  const margin = { ...M, ...input.margin };
  if (![width, height, ...Object.values(margin)].every(Number.isFinite) ||
      Object.values(margin).some(value => value < 0) ||
      width <= margin.left + margin.right || height <= margin.top + margin.bottom) {
    throw new Error("chart dimensions must leave a positive plot area");
  }
  return { width, height, margin };
}

export interface RenderInput extends Dimensions {
  layers: readonly DisplayLayer[];
  times: readonly string[];
  result: PipelineResult;
  colorOverrides?: Readonly<Record<string, string>>;
  palette?: PaletteId;
  start: number;
  end: number;
  visMethod: VisMethod;
  smoothContours: boolean;
  showEnvelopeStroke: boolean;
  showRepresentativeStroke: boolean;
  showTimeCell: boolean;
  showBranchStroke: boolean;
  showYAxis: boolean;
  hover: number | null;
  highlightLayer: string | null;
}

export interface TimeFilterInput extends Dimensions {
  layers: readonly DisplayLayer[];
  times: readonly string[];
  result: PipelineResult;
  layoutOrder?: string[];
  colorOverrides?: Readonly<Record<string, string>>;
  palette?: PaletteId;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}

/** Stable within a dataset and independent of input/stack order. */
export function colorForLayer(
  layers: readonly DisplayLayer[],
  id: string,
  colorOverrides: Readonly<Record<string, string>> = {},
  paletteId: PaletteId = "reference",
): string {
  const override = Object.hasOwn(colorOverrides, id) ? colorOverrides[id] : undefined;
  if (override) return override;
  const layer = layers.find((item) => item.id === id);
  if (paletteId === "reference" && layer?.color) return layer.color;
  const ids = layers
    .filter((item) => paletteId !== "reference" || !item.color)
    .map((item) => item.id)
    .sort();
  const index = Math.max(0, ids.indexOf(id));
  const palette = LAYER_PALETTES[paletteId];
  return palette[index % palette.length];
}

export function visibleTimeIndices(length: number, start: number, end: number): number[] {
  const first = Math.max(0, Math.min(Math.floor(start), length - 1));
  const last = Math.max(first, Math.min(Math.floor(end), length - 1));
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

type ChartCoordinates = ReturnType<typeof chartCoordinates>;
type RenderCache = {
  key: unknown[];
  coords: ChartCoordinates;
  geometry: InterpolatedBraidedGeometry;
  paths: Map<string, string>;
  axes?: boolean;
};
const renderCaches = new WeakMap<SVGSVGElement, RenderCache>();

function layerColorScale(input: Pick<RenderInput, "layers" | "colorOverrides" | "palette">) {
  const paletteId = input.palette ?? "reference";
  const palette = LAYER_PALETTES[paletteId];
  const ids = input.layers.filter(layer => paletteId !== "reference" || !layer.color).map(layer => layer.id).sort();
  const colors = new Map(ids.map((id, i) => [id, palette[i % palette.length]]));
  for (const layer of input.layers) {
    if (paletteId === "reference" && layer.color) colors.set(layer.id, layer.color);
    if (input.colorOverrides && Object.hasOwn(input.colorOverrides, layer.id) && input.colorOverrides[layer.id]) colors.set(layer.id, input.colorOverrides[layer.id]);
  }
  return (id: string) => colors.get(id) ?? palette[0];
}

export function renderChart(svg: SVGSVGElement, input: RenderInput): ChartCoordinates {
  if (input.visMethod !== "braided" && input.visMethod !== "streamgraph") throw new Error("visMethod must be braided or streamgraph");
  const { width: W, height: H, margin: M } = dimensions(input);
  const IW = W - M.left - M.right;
  const braided = input.visMethod === "braided";
  const envelopeOnly = !braided && !input.showRepresentativeStroke;
  const key = [input.result, input.times, input.start, input.end, input.smoothContours, envelopeOnly, W, H, M.top, M.right, M.bottom, M.left];
  let cached = renderCaches.get(svg);
  if (!cached || key.some((value, i) => value !== cached!.key[i])) {
    const coords = chartCoordinates(input);
    const { xValues, x, firstTime, lastTime } = coords;
    const geometry = interpolateBraidedGeometry(input.result.braided, xValues, firstTime, lastTime,
      input.smoothContours ? time => Math.max(1, Math.min(32, Math.ceil(Math.abs(x(xValues[time + 1]) - x(xValues[time])) / 2))) : 1,
      input.smoothContours, envelopeOnly);
    cached = { key, coords, geometry, paths: new Map() };
    renderCaches.set(svg, cached);
  }
  const cache = cached;
  const { indices, xValues, x, y, firstTime, lastTime } = cache.coords;
  const interpolated = cache.geometry;
  const renderIndices = interpolated.x.map((_, index) => index);
  const path = (id: string, build: () => string) => {
    let value = cache.paths.get(id);
    if (value === undefined) { value = build(); cache.paths.set(id, value); }
    return value;
  };
  const bandPath = (id: string, band: RenderBand, defined: boolean[]) => path(id, () => interpolated.segments.map(([start, end]) => area<number>()
    .defined(index => defined[index]).curve(curveLinear)
    .x(index => x(interpolated.x[index])).y0(index => y(band.y0[index])).y1(index => y(band.y1[index]))(renderIndices.slice(start, end)) ?? "").join(""));
  const linePath = (id: string, values: number[], defined: boolean[]) => path(id, () => interpolated.segments.map(([start, end]) => line<number>()
    .defined(index => defined[index] && Number.isFinite(values[index])).curve(curveLinear)
    .x(index => x(interpolated.x[index])).y(index => y(values[index]))(renderIndices.slice(start, end)) ?? "").join(""));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  const root = select(svg).classed("braided-stream", true);
  const axes = root.selectAll<SVGGElement, null>("g.chart-axes").data([null]).join("g").attr("class", "chart-axes");
  if (cache.axes !== input.showYAxis) {
    cache.axes = input.showYAxis;
    axes.selectAll("*").remove();
    if (input.showYAxis) axes.append("g").attr("class", "grid").attr("transform", `translate(${M.left},0)`)
      .call(axisLeft(y).ticks(5).tickSize(-IW).tickFormat(() => "")).select(".domain").remove();
    const xTicks: number[] = [];
    const step = Math.max(1, Math.ceil(indices.length / 10));
    for (let t = firstTime; t <= lastTime; t += step) xTicks.push(t);
    if (xTicks.at(-1) !== lastTime) xTicks.push(lastTime);
    const labels = new Map(xTicks.map(t => [xValues[t], tickLabel(input.times[t] ?? "")]));
    axes.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.bottom})`)
      .call(axisBottom(x).tickValues(xTicks.map(t => xValues[t])).tickFormat(value => labels.get(Number(value)) ?? ""));
    if (input.showYAxis) {
      axes.append("g").attr("class", "axis axis-y").attr("transform", `translate(${M.left},0)`)
        .call(axisLeft(y).ticks(5).tickFormat(() => ""));
      const maxThickness = Math.max(...input.result.base.yTop.flatMap((row, i) => row.map((top, t) => top - input.result.base.yBottom[i][t])));
      const rulerValue = niceRuler(maxThickness);
      const rulerPixels = Math.abs(y(rulerValue) - y(0));
      const rulerX = W - M.right - 8;
      const rulerBottom = H - M.bottom - 12;
      axes.append("line").attr("x1", rulerX).attr("x2", rulerX).attr("y1", rulerBottom).attr("y2", rulerBottom - rulerPixels)
        .attr("stroke", "var(--muted, #6b7280)").attr("stroke-width", 2);
      axes.append("text").attr("x", rulerX - 6).attr("y", rulerBottom - rulerPixels / 2).attr("text-anchor", "end")
        .attr("dominant-baseline", "middle").attr("class", "axis-label").text(`${fmtNum(rulerValue)} thickness units`);
      axes.append("text").attr("x", W - M.right).attr("y", M.top + 12).attr("text-anchor", "end").attr("class", "axis-label").text("high-value side ↑");
    }
  }
  type Mark = { key: string; tag: "path" | "line"; attrs: Record<string, string | number> };
  const marks: Mark[] = [];
  const color = layerColorScale(input);
  const sampleByX = new Map<number, number>();
  if (input.showTimeCell && braided) interpolated.x.forEach((value, index) => { if (!sampleByX.has(value)) sampleByX.set(value, index); });
  for (const [i, geometry] of input.result.braided.layers.entries()) {
    const visual = interpolated.layers[i];
    const layerColor = color(geometry.layerId);
    const dim = input.highlightLayer && geometry.layerId !== input.highlightLayer ? " dim" : "";
    const add = (key: string, className: string, attrs: Mark["attrs"], tag: Mark["tag"] = "path") => marks.push({ key: `${i}:${key}`, tag, attrs: { class: className, ...attrs } });
    const envelope = () => bandPath(`${i}:envelope`, visual.envelope, visual.defined);
    add("hit", "envelope-hit", { d: envelope(), fill: "transparent", stroke: "none", "pointer-events": "all", "data-owner-layer": geometry.layerId });
    const branchArea = braided ? path(`${i}:branches`, () => visual.branches.map((band, b) => band.y1.some((value, s) => value > band.y0[s]) ? bandPath(`${i}:branch:${b}`, band, visual.defined) : "").join("")) : envelope();
    add("fill", `layer ${braided ? "branch" : "streamgraph"}${dim}`, { d: branchArea, fill: layerColor, "fill-opacity": .82, stroke: "none", "data-id": geometry.layerId, "data-owner-layer": geometry.layerId, "data-visual-layer": geometry.layerId });
    if (braided) geometry.spaces.forEach((space, s) => {
      const d = bandPath(`${i}:space:${s}`, visual.spaces[s], visual.defined);
      add(`space:${s}`, `allocated-space${dim}`, { d, fill: lighterFamilyColor(layerColor), "fill-opacity": .68, stroke: "none", "pointer-events": "none", "data-visual-layer": geometry.layerId });
      add(`space-hit:${s}`, "space-hit", { d, fill: "transparent", stroke: "none", "pointer-events": "all", "data-owner-layer": space.ownerLayerId, "data-space-kind": space.kind, "data-gap-index": space.gapIndex });
    });
    const stroke = (key: string, className: string, d: string, color: string, width: number, extra: Mark["attrs"] = {}) =>
      add(key, `${className}${dim}`, { d, fill: "none", stroke: color, "stroke-width": width, "vector-effect": "non-scaling-stroke", "pointer-events": "none", "data-visual-layer": geometry.layerId, ...extra });
    if (input.showEnvelopeStroke) [visual.envelope.y0, visual.envelope.y1].forEach((values, side) =>
      stroke(`outline:${side}`, "envelope-stroke", linePath(`${i}:outline:${side}`, values, visual.defined), "var(--muted, #6b7280)", .9, { "data-owner-layer": geometry.layerId }));
    if (input.showBranchStroke && braided) visual.branches.forEach((branch, b) => {
      const defined = visual.defined.map((value, s) => value && branch.y1[s] > branch.y0[s]);
      if (!defined.some(Boolean)) return;
      [branch.y0, branch.y1].forEach((values, side) => stroke(`branch-line:${b}:${side}`, "branch-stroke", linePath(`${i}:branch-line:${b}:${side}`, values, defined), hsl(layerColor).darker(1.6).formatHex(), .75, { "stroke-opacity": .82 }));
    });
    if (input.showRepresentativeStroke) {
      const boundaries = representativeBoundaries(visual.branches);
      [boundaries.lower, boundaries.upper].forEach((values, side) => stroke(`representative:${side}`, "representative-stroke", linePath(`${i}:representative:${side}`, values, visual.defined), "var(--ink, #1a1a1a)", .9));
    }
    if (input.showTimeCell && braided) for (const time of indices) {
      const sample = sampleByX.get(xValues[time]);
      if (sample === undefined || !visual.defined[sample]) continue;
      add(`time:${time}`, `time-cell${dim}`, { x1: x(xValues[time]), x2: x(xValues[time]), y1: y(visual.envelope.y0[sample]), y2: y(visual.envelope.y1[sample]), stroke: "var(--ink, #1a1a1a)", "stroke-width": .7, "stroke-opacity": .55, "vector-effect": "non-scaling-stroke", "pointer-events": "none", "data-visual-layer": geometry.layerId }, "line");
    }
  }
  const layers = root.selectAll<SVGGElement, null>("g.layers").data([null]).join("g").attr("class", "layers");
  layers.selectAll<SVGElement, Mark>(".chart-mark").data(marks, mark => mark.key).join(
    enter => enter.append(mark => svg.ownerDocument.createElementNS(NS, mark.tag)),
    update => update,
    exit => exit.remove(),
  ).each(function(mark) {
    const attrs = { ...mark.attrs, class: `${mark.attrs.class} chart-mark` };
    for (const attr of this.getAttributeNames()) if (!(attr in attrs)) this.removeAttribute(attr);
    for (const [name, value] of Object.entries(attrs)) if (this.getAttribute(name) !== String(value)) this.setAttribute(name, String(value));
  });
  root.selectAll<SVGLineElement, number>(".hover-line").data(input.hover === null ? [] : [input.hover]).join("line")
    .attr("class", "hover-line").attr("pointer-events", "none")
    .attr("x1", t => x(xValues[t])).attr("x2", t => x(xValues[t])).attr("y1", M.top).attr("y2", H - M.bottom);
  return cache.coords;
}


/** Full-range streamgraph overview with a D3 brush that selects the visible time window. */
export function renderTimeFilter(svg: SVGSVGElement, input: TimeFilterInput): () => void {
  const tLen = input.times.length;
  const { width: W, margin: M } = dimensions(input);
  const IW = W - M.left - M.right;
  const filterHeight = 92;
  svg.setAttribute("viewBox", `0 0 ${W} ${filterHeight}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(filterHeight));
  const root = select(svg);
  root.classed("braided-stream", true);
  root.selectAll("*").remove();
  if (tLen < 2) return () => undefined;

  const layersById = new Map(input.layers.map((layer) => [layer.id, layer]));
  const order = input.layoutOrder ?? input.result.layoutOrder;
  const orderedLayers = order
    ? order.map((id) => {
        const layer = layersById.get(id);
        if (!layer) throw new Error(`time filter received unknown layer id: ${id}`);
        return layer;
      })
    : input.layers;
  const overview = input.result.base;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const rows of [overview.yBottom, overview.yTop]) for (const row of rows) for (const value of row) {
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  const pad = (maximum - minimum) * 0.08 || 1;
  const x = scaleLinear().domain([0, tLen - 1]).range([M.left, W - M.right]);
  const y = scaleLinear()
    .domain([minimum - pad, maximum + pad])
    .range([58, 12]);
  const indices = Array.from({ length: tLen }, (_, t) => t);
  const color = layerColorScale({ ...input, layers: orderedLayers });

  root
    .append("rect")
    .attr("x", M.left)
    .attr("y", 8)
    .attr("width", IW)
    .attr("height", 54)
    .attr("fill", "var(--accent-soft, #e8f1f8)")
    .attr("stroke", "var(--line, #e5e7eb)");
  for (let i = 0; i < orderedLayers.length; i += 1) {
    root
      .append("path")
      .attr(
        "d",
        area<number>()
          .defined((time) => !input.result.braided.layers[i].missing[time])
          .curve(curveLinear)
          .x((t) => x(t))
          .y0((t) => y(overview.yBottom[i][t]))
          .y1((t) => y(overview.yTop[i][t]))(indices) ?? "",
      )
      .attr(
        "fill",
        color(orderedLayers[i].id),
      )
      .attr("fill-opacity", 0.76);
  }

  const ticks = [0, Math.round((tLen - 1) / 2), tLen - 1].filter((value, i, all) => all.indexOf(value) === i);
  root
    .append("g")
    .attr("transform", "translate(0,62)")
    .call(axisBottom(x).tickValues(ticks).tickFormat((t) => tickLabel(input.times[Number(t)] ?? "")));

  let activeView: Window | null = null;
  const brush = brushX()
    .touchable(() => Boolean(svg.ownerDocument.defaultView?.navigator.maxTouchPoints))
    .extent([[M.left, 8], [W - M.right, 62]])
    .on("start", (event) => { activeView = event.sourceEvent?.view ?? null; })
    .on("end", (event) => {
      activeView = null;
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
  selection.select(".selection").attr("fill", "var(--accent, #0072b2)").attr("fill-opacity", 0.18);
  selection.selectAll(".handle").attr("fill", "var(--accent-soft, #e8f1f8)").attr("stroke", "var(--accent, #0072b2)");
  selection.select(".overlay").attr("cursor", "crosshair");
  return () => {
    selection.on(".brush", null);
    if (activeView) {
      select(activeView).on(".brush", null);
      dragEnable(activeView);
      activeView = null;
    }
  };
}

export function diseaseDay(label: string): number {
  const match = /^day (\d+)$/.exec(label);
  if (match) return Number(match[1]);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(label) ? Date.parse(`${label}T00:00:00Z`) : Number.NaN;
  return Number.isFinite(date) ? date / 86_400_000 : Number.NaN;
}

type RenderBand = { y0: number[]; y1: number[] };
export type InterpolatedBraidedGeometry = {
  x: number[];
  /** Separate interval paths permit invisible endpoint subdivisions to change. */
  segments: Array<[number, number]>;
  layers: Array<{
    defined: boolean[];
    envelope: RenderBand;
    branches: RenderBand[];
    spaces: RenderBand[];
  }>;
};

export type GapEndpoint = { branches: number[]; gaps: number[] };

/** Center the shorter internal-gap sequence; relative position resolves the two-way tie. */
export function alignGapEndpoints(a: GapEndpoint, b: GapEndpoint): [GapEndpoint, GapEndpoint] {
  if (a.branches.length === b.branches.length) return [a, b];
  const aIsLarger = a.branches.length > b.branches.length;
  const large = aIsLarger ? a : b;
  const small = aIsLarger ? b : a;
  const difference = large.branches.length - small.branches.length;
  const positions = (endpoint: GapEndpoint) => {
    const total = [...endpoint.branches, ...endpoint.gaps].reduce((s, v) => s + v, 0);
    let cursor = endpoint.gaps[0];
    return endpoint.branches.slice(0, -1).map((height, index) => {
      cursor += height;
      const center = cursor + endpoint.gaps[index + 1] / 2;
      cursor += endpoint.gaps[index + 1];
      return total > 0 ? center / total : 0;
    });
  };
  const largePositions = positions(large);
  const smallPositions = positions(small);
  const cost = (offset: number) => smallPositions.reduce(
    (sum, value, index) => sum + (value - largePositions[offset + index]) ** 2, 0,
  );
  const low = Math.floor(difference / 2);
  const high = Math.ceil(difference / 2);
  const lowCost = cost(low);
  const highCost = cost(high);
  // Numerical equality only: no user-facing matching tolerance.
  const offset = highCost < lowCost - Number.EPSILON * Math.max(1, lowCost, highCost) ? high : low;
  const refined: GapEndpoint = {
    branches: new Array(large.branches.length).fill(0),
    gaps: new Array(large.gaps.length).fill(0),
  };
  refined.gaps[0] = small.gaps[0];
  refined.gaps[refined.gaps.length - 1] = small.gaps.at(-1)!;
  let first = 0;
  small.branches.forEach((height, index) => {
    const last = index + 1 === small.branches.length
      ? large.branches.length - 1 : offset + index;
    const total = large.branches.slice(first, last + 1).reduce((s, v) => s + v, 0);
    for (let k = first; k <= last; k += 1) {
      refined.branches[k] = height * (total > 0 ? large.branches[k] / total : 1 / (last - first + 1));
    }
    if (index + 1 < small.branches.length) refined.gaps[last + 1] = small.gaps[index + 1];
    first = last + 1;
  });
  return aIsLarger ? [large, refined] : [refined, large];
}

/**
 * Smooth non-negative branch/gap thicknesses, then rebuild cumulative bounds.
 * This preserves non-negativity and packed envelopes between observations.
 * Distribution-derived ratios are guaranteed at observations only; interpolated
 * primitives do not define an inferred intermediate probability distribution.
 */
export function interpolateBraidedGeometry(
  layout: PipelineResult["braided"],
  xValues: number[],
  start: number,
  end: number,
  subdivisions: number | ((left: number) => number) = 8,
  smooth = true,
  envelopeOnly = false,
): InterpolatedBraidedGeometry {
  const samples: Array<{ x: number; left: number; right: number; fraction: number }> = [];
  const segments: Array<[number, number]> = [];
  for (let time = start; time < end; time += 1) {
    const steps = Math.max(1, Math.floor(typeof subdivisions === "number" ? subdivisions : subdivisions(time)));
    const segmentStart = samples.length;
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      samples.push({
        x: xValues[time] + fraction * (xValues[time + 1] - xValues[time]),
        left: time,
        right: time + 1,
        fraction,
      });
    }
    segments.push([segmentStart, samples.length]);
  }
  if (start === end) {
    samples.push({ x: xValues[end], left: end, right: end, fraction: 0 });
    segments.push([0, 1]);
  }

  const baseline = seriesInterpolator(xValues, layout.layers[0].slotY0, smooth);
  const aligned = envelopeOnly ? [] : layout.layers.map((layer) => {
    const endpoint = (time: number): GapEndpoint => {
      const count = Math.max(1, layer.branchCount[time]);
      return {
        branches: layer.branches.slice(0, count).map((band) => Math.max(0, band.y1[time] - band.y0[time])),
        gaps: [...layer.spaces.slice(0, count), layer.spaces.at(-1)!]
          .map((band) => Math.max(0, band.y1[time] - band.y0[time])),
      };
    };
    const endpoints = Array.from({ length: end - start + 1 }, (_, index) => endpoint(start + index));
    return Array.from({ length: Math.max(1, end - start) }, (_, index) =>
      alignGapEndpoints(endpoints[index], endpoints[Math.min(end - start, index + 1)])
    );
  });
  const layers = layout.layers.map((layer) => ({
    defined: new Array<boolean>(samples.length),
    envelope: { y0: new Array<number>(samples.length), y1: new Array<number>(samples.length) },
    branches: envelopeOnly ? [] : layer.branches.map(() => ({ y0: new Array<number>(samples.length), y1: new Array<number>(samples.length) })),
    spaces: envelopeOnly ? [] : layer.spaces.map(() => ({ y0: new Array<number>(samples.length), y1: new Array<number>(samples.length) })),
  }));

  samples.forEach((sample, sampleIndex) => {
    let slotBottom = baseline(sample.x, sample.left);
    layout.layers.forEach((layer, layerIndex) => {
      const output = layers[layerIndex];
      const s = sample.fraction;
      const weight = smooth ? s * s * (3 - 2 * s) : s;
      const blend = (a: number, b: number) => (1 - weight) * a + weight * b;
      output.defined[sampleIndex] = sample.left === sample.right || sample.fraction === 0
        ? !layer.missing[sample.left]
        : sample.fraction === 1 ? !layer.missing[sample.right]
        : !layer.missing[sample.left] && !layer.missing[sample.right];
      output.envelope.y0[sampleIndex] = slotBottom;
      if (envelopeOnly) {
        slotBottom += blend(layer.slotY1[sample.left] - layer.slotY0[sample.left], layer.slotY1[sample.right] - layer.slotY0[sample.right]);
        output.envelope.y1[sampleIndex] = slotBottom;
        return;
      }
      const [left, right] = aligned[layerIndex][sample.left - start];
      let cursor = slotBottom;
      const lower = blend(left.gaps[0], right.gaps[0]);
      output.spaces[0].y0[sampleIndex] = cursor;
      output.spaces[0].y1[sampleIndex] = cursor + lower;
      cursor += lower;
      for (let branch = 0; branch < output.branches.length; branch += 1) {
        const height = blend(left.branches[branch] ?? 0, right.branches[branch] ?? 0);
        output.branches[branch].y0[sampleIndex] = cursor;
        output.branches[branch].y1[sampleIndex] = cursor + height;
        cursor += height;
        if (branch + 1 < output.branches.length) {
          const gap = branch + 1 < left.branches.length
            ? blend(left.gaps[branch + 1], right.gaps[branch + 1]) : 0;
          output.spaces[branch + 1].y0[sampleIndex] = cursor;
          output.spaces[branch + 1].y1[sampleIndex] = cursor + gap;
          cursor += gap;
        }
      }
      const upperIndex = output.spaces.length - 1;
      const upper = blend(left.gaps.at(-1)!, right.gaps.at(-1)!);
      output.spaces[upperIndex].y0[sampleIndex] = cursor;
      output.spaces[upperIndex].y1[sampleIndex] = cursor + upper;
      cursor += upper;
      output.envelope.y1[sampleIndex] = cursor;
      slotBottom = cursor;
    });
  });
  return { x: samples.map((sample) => sample.x), segments, layers };
}

function representativeBoundaries(branches: RenderBand[]): { lower: number[]; upper: number[] } {
  const length = branches[0]?.y0.length ?? 0;
  const boundaryAt = (sample: number, upper: boolean): number => {
    const indices = upper
      ? Array.from({ length: branches.length }, (_, index) => branches.length - 1 - index)
      : Array.from({ length: branches.length }, (_, index) => index);
    for (const index of indices) {
      if (branches[index].y1[sample] > branches[index].y0[sample]) {
        return upper ? branches[index].y1[sample] : branches[index].y0[sample];
      }
    }
    return branches[0]?.y0[sample] ?? 0;
  };
  return {
    lower: Array.from({ length }, (_, sample) => boundaryAt(sample, false)),
    upper: Array.from({ length }, (_, sample) => boundaryAt(sample, true)),
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

function niceRuler(maximum: number): number {
  if (!(maximum > 0)) return 1;
  const target = maximum / 3;
  const power = 10 ** Math.floor(Math.log10(target));
  const scaled = target / power;
  return (scaled >= 5 ? 5 : scaled >= 2 ? 2 : 1) * power;
}

export function lighterFamilyColor(input: string): string {
  const tint = hsl(input);
  tint.s *= 0.72;
  tint.l = Math.min(0.94, tint.l + (1 - tint.l) * 0.58);
  return tint.formatHex();
}

function seriesInterpolator(x: number[], y: number[], smooth: boolean): (value: number, interval: number) => number {
  if (x.length !== y.length || !x.length) throw new Error("invalid interpolation series");
  if (x.length === 1) return () => y[0];
  const widths = x.slice(0, -1).map((value, index) => x[index + 1] - value);
  if (widths.some((width) => !(width > 0))) throw new Error("time coordinates must be strictly increasing");
  const slopes = widths.map((width, index) => (y[index + 1] - y[index]) / width);
  const tangents = new Array<number>(x.length);
  tangents[0] = slopes[0];
  tangents[tangents.length - 1] = slopes[slopes.length - 1];
  for (let index = 1; index + 1 < x.length; index += 1) {
    if (slopes[index - 1] * slopes[index] <= 0) tangents[index] = 0;
    else {
      const leftWeight = 2 * widths[index] + widths[index - 1];
      const rightWeight = widths[index] + 2 * widths[index - 1];
      tangents[index] = (leftWeight + rightWeight) /
        (leftWeight / slopes[index - 1] + rightWeight / slopes[index]);
    }
  }
  return (value, interval) => {
    const left = Math.max(0, Math.min(x.length - 2, interval));
    const fraction = (value - x[left]) / widths[left];
    if (!smooth) return y[left] + fraction * (y[left + 1] - y[left]);
    const f2 = fraction * fraction;
    const f3 = f2 * fraction;
    const valueAt = (2 * f3 - 3 * f2 + 1) * y[left] +
      (f3 - 2 * f2 + fraction) * widths[left] * tangents[left] +
      (-2 * f3 + 3 * f2) * y[left + 1] +
      (f3 - f2) * widths[left] * tangents[left + 1];
    return Math.max(Math.min(y[left], y[left + 1]), Math.min(Math.max(y[left], y[left + 1]), valueAt));
  };
}
/** Shared visible-window coordinates for drawing and hit testing. */
export function chartCoordinates(input: RenderInput) {
  const { width: W, height: H, margin: M } = dimensions(input);
  const tLen = input.times.length;
  const bottom = input.result.braided.layers.map((layer) => layer.slotY0);
  const top = input.result.braided.layers.map((layer) => layer.slotY1);
  const indices = visibleTimeIndices(tLen, input.start, input.end);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const rows of [bottom, top]) for (const row of rows) for (const time of indices) {
    minimum = Math.min(minimum, row[time]); maximum = Math.max(maximum, row[time]);
  }
  const pad = (maximum - minimum) * 0.06 || 1;
  const y = scaleLinear()
    .domain([minimum - pad, maximum + pad])
    .range([H - M.bottom, M.top]);
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

  return { indices, bottom, top, xValues, x, y, firstTime, lastTime };
}
