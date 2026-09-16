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
  interpolateLab,
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
  showEnvelopeStroke: boolean;
  showRepresentativeStroke: boolean;
  showTimeCell: boolean;
  showBranchStroke: boolean;
  showYAxis: boolean;
  showDensityGradient: boolean;
  /** Render each envelope as a single, unsplit band. */
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
  const makeArea = (lo: number[], hi: number[], defined?: boolean[]) =>
    area<number>()
      .defined((t) => (defined ? defined[t] : true) && Number.isFinite(lo[t]) && Number.isFinite(hi[t]))
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
  const interpolated = braided
    ? interpolateBraidedGeometry(
        input.result.braided,
        xValues,
        firstTime,
        lastTime,
        input.smoothContours ? 8 : 1,
        input.smoothContours,
      )
    : null;
  const renderIndices = interpolated?.x.map((_, index) => index) ?? [];
  const makeBraidedArea = (band: RenderBand, defined: boolean[]) =>
    interpolated!.segments.map(([start, end]) => area<number>()
      .defined((index) => defined[index])
      .curve(curveLinear)
      .x((index) => x(interpolated!.x[index]))
      .y0((index) => y(band.y0[index]))
      .y1((index) => y(band.y1[index]))(renderIndices.slice(start, end)) ?? "").join("");
  const makeBraidedLine = (values: number[], defined: boolean[]) =>
    interpolated!.segments.map(([start, end]) => line<number>()
      .defined((index) => defined[index] && Number.isFinite(values[index]))
      .curve(curveLinear)
      .x((index) => x(interpolated!.x[index]))
      .y((index) => y(values[index]))(renderIndices.slice(start, end)) ?? "").join("");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  const root = select(svg);
  root.selectAll("*").remove();
  const densityEnabled = braided && input.showDensityGradient && !input.collapseBranches &&
    Boolean(input.result.densityProfiles);
  const definitions = densityEnabled ? root.append("defs") : null;
  const ticks = 5;
  if (input.showYAxis) {
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
  }
  const xTicks: number[] = [];
  const step = Math.max(1, Math.ceil(indices.length / 10));
  for (let t = firstTime; t <= lastTime; t += step) xTicks.push(t);
  if (xTicks.at(-1) !== lastTime) xTicks.push(lastTime);
  const xAxis = root
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`);
  const coordinateTicks = xTicks.map((t) => xValues[t]);
  xAxis.call(
    axisBottom(x)
      .tickValues(coordinateTicks)
      .tickFormat((value) => {
        const index = xValues.reduce((best, coordinate, candidate) =>
          Math.abs(coordinate - Number(value)) < Math.abs(xValues[best] - Number(value)) ? candidate : best,
        firstTime);
        return tickLabel(input.times[index] ?? "");
      }),
  );
  if (input.showYAxis) {
    root
      .append("g")
      .attr("class", "axis axis-y")
      .attr("transform", `translate(${M.left},0)`)
      .call(
        axisLeft(y)
          .ticks(ticks)
          .tickFormat((value) => braided ? "" : fmtNum(Number(value))),
      );
  }
  if (braided && input.showYAxis) {
    const maxThickness = Math.max(...input.result.base.yTop.flatMap((row, i) =>
      row.map((top, t) => top - input.result.base.yBottom[i][t])
    ));
    const rulerValue = niceRuler(maxThickness);
    const rulerPixels = Math.abs(y(rulerValue) - y(0));
    const rulerX = W - M.right - 8;
    const rulerBottom = H - M.bottom - 12;
    root.append("line")
      .attr("x1", rulerX).attr("x2", rulerX)
      .attr("y1", rulerBottom).attr("y2", rulerBottom - rulerPixels)
      .attr("stroke", "#48576a").attr("stroke-width", 2);
    root.append("text")
      .attr("x", rulerX - 6).attr("y", rulerBottom - rulerPixels / 2)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .attr("class", "axis-label")
      .text(`${fmtNum(rulerValue)} thickness units`);
    root.append("text")
      .attr("x", W - M.right).attr("y", M.top + 12)
      .attr("text-anchor", "end").attr("class", "axis-label")
      .text("high-value side ↑");
  }
  const colorOf = (idx: number): string => colorForLayer(input.layers, layerIds[idx]);
  if (braided) {
    const layers = root.append("g").attr("class", "layers");
    for (const [i, geometry] of input.result.braided.layers.entries()) {
      const visual = interpolated!.layers[i];
      const dim =
        input.highlightLayer && geometry.layerId !== input.highlightLayer
          ? " dim"
          : "";
      layers
        .append("path")
        .attr("d", makeBraidedArea(visual.envelope, visual.defined))
        .attr("class", "envelope-hit")
        .attr("fill", "transparent")
        .attr("stroke", "none")
        .attr("pointer-events", "all")
        .attr("data-owner-layer", geometry.layerId);
      const branchAreas = input.collapseBranches
        ? [makeBraidedArea(visual.envelope, visual.defined)]
        : visual.branches.map((branch) =>
            renderIndices.some((sample) => branch.y1[sample] > branch.y0[sample])
              ? makeBraidedArea(branch, visual.defined)
              : "",
          );
      layers
        .append("path")
        .attr("d", branchAreas.join(""))
        .attr("class", `layer branch${dim}`)
        .attr("fill", densityEnabled ? densityColor(colorOf(i), 0) : colorOf(i))
        .attr("fill-opacity", densityEnabled ? 1 : 0.82)
        .attr("stroke", "none")
        .attr("data-id", geometry.layerId)
        .attr("data-owner-layer", geometry.layerId);
      if (densityEnabled) {
        const clipId = `density-clip-${i}`;
        definitions!
          .append("clipPath")
          .attr("id", clipId)
          .append("path")
          .attr("d", branchAreas.join(""));
        const densityGroup = layers
          .append("g")
          .attr("class", `density-bands${dim}`)
          .attr("clip-path", `url(#${clipId})`)
          .attr("pointer-events", "none");
        const profiles = input.result.densityProfiles?.[i] ?? [];
        const bins = profiles.find((profile) => profile !== null)?.length ?? 0;
        for (let bin = 0; bin < bins; bin += 1) {
          const gradientId = `density-gradient-${i}-${bin}`;
          const gradient = definitions!
            .append("linearGradient")
            .attr("id", gradientId)
            .attr("gradientUnits", "userSpaceOnUse")
            .attr("x1", x(xValues[firstTime]))
            .attr("x2", x(xValues[lastTime]));
          for (const time of indices) {
            gradient
              .append("stop")
              .attr("offset", `${100 * (x(xValues[time]) - M.left) / IW}%`)
              .attr("stop-color", densityColor(colorOf(i), profiles[time]?.[bin] ?? 0));
          }
          densityGroup
            .append("path")
            .attr("d", makeBraidedArea(
              densityQuantileBand(visual.branches, bin / bins, (bin + 1) / bins),
              visual.defined,
            ))
            .attr("fill", `url(#${gradientId})`)
            .attr("fill-opacity", 1)
            .attr("stroke", "none");
        }
      }
      if (!input.collapseBranches) {
        const tint = lighterFamilyColor(colorOf(i));
        for (const [spaceIndex, space] of geometry.spaces.entries()) {
          const visualSpace = visual.spaces[spaceIndex];
          layers
            .append("path")
            .attr("d", makeBraidedArea(visualSpace, visual.defined))
            .attr("class", `allocated-space${dim}`)
            .attr("fill", tint)
            .attr("fill-opacity", 0.68)
            .attr("stroke", "none")
            .attr("pointer-events", "none");
          layers
            .append("path")
            .attr("d", makeBraidedArea(visualSpace, visual.defined))
            .attr("class", "space-hit")
            .attr("fill", "transparent")
            .attr("stroke", "none")
            .attr("pointer-events", "all")
            .attr("data-owner-layer", space.ownerLayerId)
            .attr("data-space-kind", space.kind)
            .attr("data-gap-index", space.gapIndex);
        }
      }
      if (input.showEnvelopeStroke) {
        for (const boundary of [visual.envelope.y0, visual.envelope.y1]) {
          layers
            .append("path")
            .attr("d", makeBraidedLine(boundary, visual.defined))
            .attr("class", `envelope-stroke${dim}`)
            .attr("fill", "none")
            .attr("stroke", "#7a8793")
            .attr("stroke-width", 0.9)
            .attr("vector-effect", "non-scaling-stroke")
            .attr("pointer-events", "none");
        }
      }
      if (input.showBranchStroke && !input.collapseBranches) {
        for (const branch of visual.branches) {
          const defined = visual.defined.map((value, sample) =>
            value && branch.y1[sample] > branch.y0[sample]
          );
          if (!defined.some(Boolean)) continue;
          for (const boundary of [branch.y0, branch.y1]) {
            layers
              .append("path")
              .attr("d", makeBraidedLine(boundary, defined))
              .attr("class", `branch-stroke${dim}`)
              .attr("fill", "none")
              .attr("stroke", densityColor(colorOf(i), 1))
              .attr("stroke-width", 0.75)
              .attr("stroke-opacity", 0.82)
              .attr("vector-effect", "non-scaling-stroke")
              .attr("pointer-events", "none");
          }
        }
      }
      if (input.showRepresentativeStroke) {
        const boundaries = representativeBoundaries(visual.branches);
        for (const boundary of [boundaries.lower, boundaries.upper]) {
          layers
            .append("path")
            .attr("d", makeBraidedLine(boundary, visual.defined))
            .attr("class", `representative-stroke${dim}`)
            .attr("fill", "none")
            .attr("stroke", "#4f5b66")
            .attr("stroke-width", 0.9)
            .attr("vector-effect", "non-scaling-stroke")
            .attr("pointer-events", "none");
        }
      }
      if (input.showTimeCell && !input.collapseBranches) {
        for (const time of indices) {
          const sample = interpolated!.x.findIndex((value) => value === xValues[time]);
          if (sample < 0 || !visual.defined[sample]) continue;
          layers
            .append("line")
            .attr("class", `time-cell${dim}`)
            .attr("x1", x(xValues[time])).attr("x2", x(xValues[time]))
            .attr("y1", y(visual.envelope.y0[sample])).attr("y2", y(visual.envelope.y1[sample]))
            .attr("stroke", "#4f5b66")
            .attr("stroke-width", 0.7)
            .attr("stroke-opacity", 0.55)
            .attr("vector-effect", "non-scaling-stroke")
            .attr("pointer-events", "none");
        }
      }
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
      .attr("stroke", "none")
      .attr("stroke-width", 0)
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
  subdivisions = 8,
  smooth = true,
): InterpolatedBraidedGeometry {
  const steps = Math.max(1, Math.floor(subdivisions));
  const samples: Array<{ x: number; left: number; right: number; fraction: number }> = [];
  const segments: Array<[number, number]> = [];
  for (let time = start; time < end; time += 1) {
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
  const aligned = layout.layers.map((layer) => {
    const endpoint = (time: number): GapEndpoint => {
      const count = Math.max(1, layer.branchCount[time]);
      return {
        branches: layer.branches.slice(0, count).map((band) => Math.max(0, band.y1[time] - band.y0[time])),
        gaps: [...layer.spaces.slice(0, count), layer.spaces.at(-1)!]
          .map((band) => Math.max(0, band.y1[time] - band.y0[time])),
      };
    };
    return Array.from({ length: Math.max(1, end - start) }, (_, index) =>
      alignGapEndpoints(endpoint(start + index), endpoint(Math.min(end, start + index + 1)))
    );
  });
  const layers = layout.layers.map((layer) => ({
    defined: new Array<boolean>(samples.length),
    envelope: { y0: new Array<number>(samples.length), y1: new Array<number>(samples.length) },
    branches: layer.branches.map(() => ({ y0: new Array<number>(samples.length), y1: new Array<number>(samples.length) })),
    spaces: layer.spaces.map(() => ({ y0: new Array<number>(samples.length), y1: new Array<number>(samples.length) })),
  }));

  samples.forEach((sample, sampleIndex) => {
    let slotBottom = baseline(sample.x);
    layout.layers.forEach((layer, layerIndex) => {
      const output = layers[layerIndex];
      const [left, right] = aligned[layerIndex][sample.left - start];
      const s = sample.fraction;
      const weight = smooth ? s * s * (3 - 2 * s) : s;
      const blend = (a: number, b: number) => (1 - weight) * a + weight * b;
      output.defined[sampleIndex] = sample.left === sample.right || sample.fraction === 0
        ? !layer.missing[sample.left]
        : sample.fraction === 1 ? !layer.missing[sample.right]
        : !layer.missing[sample.left] && !layer.missing[sample.right];
      output.envelope.y0[sampleIndex] = slotBottom;
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

function densityQuantileBand(
  branches: RenderBand[],
  lower: number,
  upper: number,
): RenderBand {
  const length = branches[0]?.y0.length ?? 0;
  return {
    y0: Array.from({ length }, (_, sample) => solidQuantileY(branches, sample, lower, false)),
    y1: Array.from({ length }, (_, sample) => solidQuantileY(branches, sample, upper, true)),
  };
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

/** Map a cumulative probability position onto packed branch thickness, skipping allocated gaps. */
function solidQuantileY(
  branches: RenderBand[],
  sample: number,
  probability: number,
  upperEdge: boolean,
): number {
  const heights = branches.map((branch) => Math.max(0, branch.y1[sample] - branch.y0[sample]));
  const total = heights.reduce((sum, height) => sum + height, 0);
  if (!(total > 0)) return branches[0]?.y0[sample] ?? 0;
  const target = Math.max(0, Math.min(1, probability)) * total;
  let cumulative = 0;
  for (let index = 0; index < branches.length; index += 1) {
    const height = heights[index];
    const end = cumulative + height;
    if (height > 0 && (target < end || (upperEdge && target <= end))) {
      return branches[index].y0[sample] + target - cumulative;
    }
    cumulative = end;
  }
  for (let index = branches.length - 1; index >= 0; index -= 1) {
    if (heights[index] > 0) return branches[index].y1[sample];
  }
  return branches[0]?.y0[sample] ?? 0;
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

function densityColor(input: string, level: number): string {
  const normalized = Math.max(0, Math.min(1, level));
  const light = hsl(input);
  light.s *= 0.45;
  light.l = 0.95;
  const dark = hsl(input);
  dark.s = Math.min(1, dark.s * 1.12);
  dark.l = Math.max(0.16, dark.l * 0.55);
  return interpolateLab(light.formatHex(), dark.formatHex())(normalized ** 0.65);
}

function seriesInterpolator(x: number[], y: number[], smooth: boolean): (value: number) => number {
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
  return (value) => {
    let left = Math.max(0, Math.min(x.length - 2, x.findIndex((next) => next > value) - 1));
    if (value >= x.at(-1)!) left = x.length - 2;
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
function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}
export function exportSvg(svg: SVGElement): void {
  const graphic = svg.cloneNode(true) as SVGElement;
  graphic.querySelectorAll(".grid, .axis, .axis-label, .hover-line, text, line").forEach((node) => node.remove());
  downloadBlob(
    new Blob([new XMLSerializer().serializeToString(graphic)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    "braided-streamgraph.svg",
  );
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
