<script setup lang="ts">
import * as d3 from "d3";
import { onMounted, ref, watch } from "vue";
import { computeBaseline, computeMultiscaleDistributedBaseline } from "../core/baseline";
import { computeContourPid, type ContourPidResult } from "../core/contourPid";
import { computeStackedBoundaries } from "../core/stack";
import type { BaselineMode, LayerInput, PidBaselineMode, PreparedDataset, ROI, StackLayout } from "../core/types";
import { orderLayers } from "../core/validate";
import type { AppState } from "../state/appState";
import { layerColor } from "../styles/palette";

const props = defineProps<{
  dataset: PreparedDataset | null;
  roi: ROI | null;
  state: AppState;
}>();

const emit = defineEmits<{
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const width = 1140;
const margin = { top: 28, right: 28, bottom: 56, left: 64 };
const innerWidth = width - margin.left - margin.right;
const contourHeight = 280;
const riverHeight = 230;
const panelGap = 64;
const canvasHeight = margin.top + contourHeight + panelGap + riverHeight + margin.bottom;

interface RenderState {
  contourPid: ContourPidResult;
  orderedLayers: LayerInput[];
  layout: StackLayout;
  activeIndices: number[];
  xScale: d3.ScaleLinear<number, number>;
  contourYScale: d3.ScaleLinear<number, number>;
  riverYScale: d3.ScaleLinear<number, number>;
  riverTop: number;
}

let currentRender: RenderState | null = null;

onMounted(() => {
  renderChart();
});

watch(
  () => [
    props.dataset,
    props.roi,
    props.state.pidBaselineMode,
    props.state.optimization.baselineUncertaintyWeight,
    props.state.optimization.wiggleWeightL1,
    props.state.optimization.wiggleWeightL2,
    props.state.optimization.centerAnchorWeight,
    props.state.optimization.irlsIterations,
    props.state.optimization.irlsEps,
    props.state.optimization.baselineCenterType
  ],
  () => {
    renderChart();
  },
  { deep: true }
);

function renderChart(): void {
  if (!svgRef.value) {
    return;
  }
  emit("hover", null);
  currentRender = null;

  const svg = d3.select(svgRef.value);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${canvasHeight}`).attr("height", canvasHeight);
  const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const dataset = props.dataset;
  if (!dataset || dataset.layers.length === 0 || dataset.times.length === 0) {
    root
      .append("text")
      .attr("x", 0)
      .attr("y", 18)
      .attr("fill", "#334155")
      .attr("font-size", 14)
      .text("No data available for PID new");
    return;
  }

  const [left, right] = roiBounds(dataset.times.length, props.roi);
  const activeIndices = d3.range(left, right + 1);
  const activeTimes = activeIndices.map((index) => dataset.times[index]);
  const contourPid = computeContourPid(dataset.layers, {
    yBins: 180,
    valueTransform: "log1p",
    centralFraction: 0.5,
    contourThreshold: 0.5
  });
  const orderedLayers = orderLayers(dataset.layers, contourPid.displayOrder);
  const hooks = baselineHooksFromState(props.state);
  const baseline = computePidBaseline(
    dataset.times,
    orderedLayers,
    props.state.pidBaselineMode,
    hooks,
    Math.max(0, props.state.optimization.baselineUncertaintyWeight ?? 0.45)
  );
  const layout = computeStackedBoundaries(baseline, orderedLayers);
  const xScale = d3
    .scaleLinear()
    .domain([activeTimes[0], activeTimes[activeTimes.length - 1]])
    .range([0, innerWidth]);

  const contourYScale = d3.scaleLinear().domain([contourPid.grid.zMin, contourPid.grid.zMax]).range([contourHeight, 0]);
  const riverExtent = layoutExtent(layout, activeIndices);
  const riverPad = (riverExtent[1] - riverExtent[0]) * 0.06 + 1e-6;
  const riverYScale = d3
    .scaleLinear()
    .domain([riverExtent[0] - riverPad, riverExtent[1] + riverPad])
    .range([riverHeight, 0]);

  drawContourPanel(root, dataset, contourPid, activeIndices, xScale, contourYScale);
  const riverTop = contourHeight + panelGap;
  drawRiverPanel(root, dataset, orderedLayers, contourPid, layout, activeIndices, xScale, riverYScale, riverTop);

  currentRender = {
    contourPid,
    orderedLayers,
    layout,
    activeIndices,
    xScale,
    contourYScale,
    riverYScale,
    riverTop
  };
}

function drawContourPanel(
  root: d3.Selection<SVGGElement, unknown, null, undefined>,
  dataset: PreparedDataset,
  result: ContourPidResult,
  activeIndices: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>
): void {
  const panel = root.append("g").attr("class", "pid-new-contour");
  panel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", contourHeight)
    .attr("fill", "rgba(248, 250, 252, 0.82)")
    .attr("stroke", "rgba(148, 163, 184, 0.44)");
  panel
    .append("clipPath")
    .attr("id", "pid-new-contour-clip")
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", contourHeight);

  const masks = [
    { key: "all", label: "all union", mask: result.allUnionMask, fill: "#bae6fd", stroke: "#0284c7", opacity: 0.42 },
    { key: "central", label: "central 50% union", mask: result.centralUnionMask, fill: "#bbf7d0", stroke: "#16a34a", opacity: 0.5 },
    {
      key: "intersection",
      label: "central 50% intersection",
      mask: result.centralIntersectionMask,
      fill: "#fef08a",
      stroke: "#ca8a04",
      opacity: 0.68
    },
    { key: "deepest", label: "deepest member", mask: result.deepestMask, fill: "none", stroke: "#be123c", opacity: 1 }
  ];

  for (const item of masks) {
    const contours = contourFeatures(item.mask, result);
    panel
      .append("g")
      .attr("class", `pid-new-contour-${item.key}`)
      .attr("clip-path", "url(#pid-new-contour-clip)")
      .selectAll<SVGPathElement, d3.ContourMultiPolygon>("path")
      .data(contours)
      .join("path")
      .attr("d", contourPath(result, dataset.times, xScale, yScale))
      .attr("fill", item.fill)
      .attr("fill-opacity", item.fill === "none" ? 0 : item.opacity)
      .attr("stroke", item.stroke)
      .attr("stroke-width", item.key === "deepest" ? 2.1 : 1.2)
      .attr("stroke-opacity", item.opacity);
  }

  panel
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${contourHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(3, Math.floor(innerWidth / 220)))
        .tickFormat((value) => formatTimeTick(Number(value)))
    );
  panel.selectAll<SVGTextElement, unknown>(".x-axis text").attr("text-anchor", "end").attr("dx", "-0.42em").attr("dy", "0.34em").attr("transform", "rotate(-35)");
  panel
    .append("g")
    .attr("class", "y-axis")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat((value) => formatLogValue(Number(value))));

  const top = result.scores[0];
  panel
    .append("text")
    .attr("x", 0)
    .attr("y", -10)
    .attr("fill", "#0f172a")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text("PID new: time-value fuzzy contour boxplot");
  panel
    .append("text")
    .attr("x", innerWidth)
    .attr("y", -10)
    .attr("text-anchor", "end")
    .attr("fill", "#334155")
    .attr("font-size", 10.5)
    .text(`PID-Mean | deepest=${top ? layerLabel(top.id) : "N/A"} depth=${top ? top.depth.toFixed(3) : "0.000"}`);

  const legend = panel.append("g").attr("transform", `translate(${innerWidth - 520},14)`);
  masks.forEach((item, index) => {
    const g = legend.append("g").attr("transform", `translate(${index * 130},0)`);
    g.append("rect")
      .attr("x", 0)
      .attr("y", -9)
      .attr("width", 18)
      .attr("height", 10)
      .attr("fill", item.fill)
      .attr("fill-opacity", item.fill === "none" ? 0 : item.opacity)
      .attr("stroke", item.stroke)
      .attr("stroke-width", item.key === "deepest" ? 2 : 1);
    g.append("text").attr("x", 24).attr("y", 0).attr("font-size", 10).attr("fill", "#334155").text(item.label);
  });
}

function drawRiverPanel(
  root: d3.Selection<SVGGElement, unknown, null, undefined>,
  dataset: PreparedDataset,
  orderedLayers: LayerInput[],
  result: ContourPidResult,
  layout: StackLayout,
  activeIndices: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  top: number
): void {
  const panel = root.append("g").attr("class", "pid-new-river").attr("transform", `translate(0,${top})`);
  panel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", riverHeight)
    .attr("fill", "rgba(248, 250, 252, 0.82)")
    .attr("stroke", "rgba(148, 163, 184, 0.44)");

  panel
    .selectAll<SVGPathElement, { id: string; index: number }>("path.pid-new-layer")
    .data(
      orderedLayers.map((layer, index) => ({ id: layer.id, index })),
      (d) => d.id
    )
    .join("path")
    .attr("class", "pid-new-layer")
    .attr("d", (d) =>
      d3
        .area<number>()
        .x((t) => xScale(dataset.times[t]))
        .y0((t) => yScale(layout.yBottom[d.index][t]))
        .y1((t) => yScale(layout.yTop[d.index][t]))
        .curve(d3.curveMonotoneX)(activeIndices) ?? ""
    )
    .attr("fill", (d) => layerColor(d.index, d.id))
    .attr("fill-opacity", 0.84)
    .attr("stroke", "#f8fafc")
    .attr("stroke-width", 0.75);

  panel
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${riverHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(3, Math.floor(innerWidth / 220)))
        .tickFormat((value) => formatTimeTick(Number(value)))
    );
  panel.selectAll<SVGTextElement, unknown>(".x-axis text").attr("text-anchor", "end").attr("dx", "-0.42em").attr("dy", "0.34em").attr("transform", "rotate(-35)");
  panel.append("g").attr("class", "y-axis").call(d3.axisLeft(yScale).ticks(5));

  const topScores = result.scores
    .slice(0, 4)
    .map((score) => `${layerLabel(score.id)}:${score.depth.toFixed(2)}`)
    .join("  ");
  panel
    .append("text")
    .attr("x", 0)
    .attr("y", -10)
    .attr("fill", "#0f172a")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text(`PID new river (${pidBaselineModeLabel(props.state.pidBaselineMode)} baseline)`);
  panel
    .append("text")
    .attr("x", innerWidth)
    .attr("y", -10)
    .attr("text-anchor", "end")
    .attr("fill", "#334155")
    .attr("font-size", 10.5)
    .text(`top depth: ${topScores}`);
}

function contourFeatures(mask: Float32Array, result: ContourPidResult): d3.ContourMultiPolygon[] {
  return d3
    .contours()
    .size([result.grid.xBins, result.grid.yBins])
    .thresholds([result.grid.contourThreshold])(Array.from(mask))
    .filter((feature) => feature.coordinates.length > 0);
}

function contourPath(
  result: ContourPidResult,
  times: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>
): (feature: d3.ContourMultiPolygon) => string {
  const grid = result.grid;
  const zScale = d3.scaleLinear().domain([0, Math.max(1, grid.yBins - 1)]).range([grid.zMin, grid.zMax]);
  const transform = d3.geoTransform({
    point(x, y) {
      this.stream.point(xScale(timeAtGridX(times, x)), yScale(zScale(y)));
    }
  });
  const path = d3.geoPath(transform);
  return (feature: d3.ContourMultiPolygon) => path(feature) ?? "";
}

function timeAtGridX(times: number[], x: number): number {
  if (times.length === 0) {
    return 0;
  }
  const clamped = clamp(x, 0, Math.max(0, times.length - 1));
  const left = Math.floor(clamped);
  const right = Math.min(times.length - 1, left + 1);
  const alpha = clamped - left;
  return times[left] + (times[right] - times[left]) * alpha;
}

function onMouseMove(event: MouseEvent): void {
  if (!svgRef.value || !currentRender) {
    return;
  }
  const local = localPoint(svgRef.value, event);
  const x = local.x - margin.left;
  const y = local.y - margin.top;
  if (x < 0 || x > innerWidth) {
    emit("hover", null);
    return;
  }
  if (y >= currentRender.riverTop && y <= currentRender.riverTop + riverHeight) {
    const timeValue = currentRender.xScale.invert(x);
    const localIndex = nearestByValue(
      currentRender.activeIndices.map((index) => props.dataset?.times[index] ?? 0),
      timeValue
    );
    const index = currentRender.activeIndices[localIndex] ?? currentRender.activeIndices[0] ?? 0;
    const yValue = currentRender.riverYScale.invert(y - currentRender.riverTop);
    const layer = pickLayerAtY(index, yValue, currentRender.layout, currentRender.orderedLayers);
    if (!layer || !props.dataset) {
      emit("hover", null);
      return;
    }
    const score = currentRender.contourPid.scoreByLayerId.get(layer.id);
    emit("hover", {
      x: event.clientX,
      y: event.clientY,
      text: [
        "PID new river",
        `t=${formatTimeTick(props.dataset.times[index])}`,
        `layer=${layerLabel(layer.id)} | depth=${score ? score.depth.toFixed(3) : "0.000"}`,
        `in=${score ? score.inScore.toFixed(3) : "0.000"} | out=${score ? score.outScore.toFixed(3) : "0.000"}`,
        `mean=${formatValue(layer.mean[index] ?? 0)}`
      ].join("\n")
    });
    return;
  }
  if (y >= 0 && y <= contourHeight) {
    const z = currentRender.contourYScale.invert(y);
    emit("hover", {
      x: event.clientX,
      y: event.clientY,
      text: ["PID new contour", `t=${formatTimeTick(currentRender.xScale.invert(x))}`, `value≈${formatValue(Math.expm1(z))}`].join("\n")
    });
    return;
  }
  emit("hover", null);
}

function onMouseLeave(): void {
  emit("hover", null);
}

function computePidBaseline(
  times: number[],
  orderedLayers: LayerInput[],
  mode: PidBaselineMode,
  hooks: ReturnType<typeof baselineHooksFromState>,
  uncertaintyStrength: number
): number[] {
  if (mode === "multiscale") {
    return computeMultiscaleDistributedBaseline(times, orderedLayers, uncertaintyStrength, hooks, 0.08).baseline;
  }
  return computeBaseline(times, orderedLayers, mode as BaselineMode, hooks);
}

function baselineHooksFromState(state: AppState) {
  return {
    centerType: state.optimization.baselineCenterType ?? "median",
    wiggleWeightL1: state.optimization.wiggleWeightL1,
    wiggleWeightL2: state.optimization.wiggleWeightL2,
    centerAnchorWeight: state.optimization.centerAnchorWeight,
    irlsIterations: state.optimization.irlsIterations,
    irlsEps: state.optimization.irlsEps
  };
}

function layoutExtent(layout: StackLayout, indices: number[]): [number, number] {
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const row of layout.yBottom) {
    for (const t of indices) {
      minValue = Math.min(minValue, row[t]);
      maxValue = Math.max(maxValue, row[t]);
    }
  }
  for (const row of layout.yTop) {
    for (const t of indices) {
      minValue = Math.min(minValue, row[t]);
      maxValue = Math.max(maxValue, row[t]);
    }
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
    return [-1, 1];
  }
  return [minValue, maxValue];
}

function pickLayerAtY(timeIndex: number, yValue: number, layout: StackLayout, orderedLayers: LayerInput[]): LayerInput | null {
  for (let k = orderedLayers.length - 1; k >= 0; k -= 1) {
    if (yValue >= layout.yBottom[k][timeIndex] && yValue <= layout.yTop[k][timeIndex]) {
      return orderedLayers[k];
    }
  }
  return null;
}

function nearestByValue(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const distance = Math.abs(values[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function localPoint(svg: SVGSVGElement, event: MouseEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * width) / Math.max(1e-6, rect.width),
    y: ((event.clientY - rect.top) * canvasHeight) / Math.max(1e-6, rect.height)
  };
}

function roiBounds(length: number, roi: ROI | null): [number, number] {
  if (length <= 0) {
    return [0, 0];
  }
  if (!roi) {
    return [0, length - 1];
  }
  const left = clamp(Math.round(roi.t0Index), 0, length - 1);
  const right = clamp(Math.round(roi.t1Index), 0, length - 1);
  return left <= right ? [left, right] : [right, left];
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function formatTimeTick(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return d3.utcFormat("%Y-%m-%d")(new Date(value));
}

function formatLogValue(value: number): string {
  return formatValue(Math.expm1(value));
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

function layerLabel(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}

function pidBaselineModeLabel(mode: PidBaselineMode): string {
  if (mode === "l1") {
    return "L1";
  }
  if (mode === "l2") {
    return "L2";
  }
  if (mode === "sineStream") {
    return "SineStream";
  }
  return "Multiscale";
}

defineExpose({
  getPidNewSvg: () => svgRef.value
});
</script>

<template>
  <section>
    <svg
      ref="svgRef"
      id="pid-new-chart"
      preserveAspectRatio="xMidYMid meet"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    />
  </section>
</template>
