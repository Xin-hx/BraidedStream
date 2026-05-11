<script setup lang="ts">
import * as d3 from "d3";
import { onMounted, ref, watch } from "vue";
import type { LayerInput, PreparedDataset } from "../core/types";
import { nearestIndexByValue, pointerToPlot } from "../interactions/hitTest";
import type { PlotArea } from "../render/chartUtils";
import { layerColor } from "../styles/palette";

const props = defineProps<{
  dataset: PreparedDataset | null;
  selectedStateIds: string[];
}>();

const emit = defineEmits<{
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);

let xScale: d3.ScaleLinear<number, number> | null = null;
let yScale: d3.ScaleLinear<number, number> | null = null;
let activeLayers: PreparedDataset["layers"] = [];
let hoverGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

const width = 1000;
const height = 380;
const margin = {
  top: height * 0.058,
  right: width * 0.014,
  bottom: height * 0.125,
  left: width * 0.048
};
const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;
const plotArea: PlotArea = { left: margin.left, top: margin.top, width: innerWidth, height: innerHeight };
const histogramGap = innerHeight * 0.045;
const histogramRowGap = innerHeight * 0.026;
const linePlotHeight = innerHeight * 0.66;
const histogramAvailable = innerHeight - linePlotHeight - histogramGap;
const histogramRowHeight = (histogramAvailable - histogramRowGap) / 2;
const iqrTop = linePlotHeight + histogramGap;
const iqrBottom = iqrTop + histogramRowHeight;
const poportionTop = iqrBottom + histogramRowGap;
const poportionBottom = poportionTop + histogramRowHeight;
const titleFontSize = height * 0.03;
const labelFontSize = height * 0.027;
const minorFontSize = height * 0.024;
const strokeScale = width / 1000;
const hoverDotRadius = width * 0.0021;

interface SpaghettiLineDatum {
  key: string;
  layerId: string;
  quantileValue: number;
  values: number[];
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  drawOrder: number;
}

interface QuantileEntry {
  key: string;
  value: number;
  series: number[];
}

interface UncertaintySummary {
  iqr: number[];
  poportion: number[];
}

onMounted(() => {
  renderChart();
});

watch(
  () => [props.dataset, props.selectedStateIds],
  () => {
    renderChart();
  },
  { deep: true }
);

function renderChart(): void {
  if (!svgRef.value) {
    return;
  }
  const svg = d3.select(svgRef.value).attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const axisX = root.append("g").attr("class", "x-axis");
  const axisY = root.append("g").attr("class", "y-axis");
  const linesGroup = root.append("g").attr("class", "spaghetti-lines");
  const histogramGroup = root.append("g").attr("class", "spaghetti-histogram");
  hoverGroup = root.append("g").attr("class", "spaghetti-hover");

  if (!props.dataset || props.dataset.times.length === 0) {
    xScale = null;
    yScale = null;
    activeLayers = [];
    hoverGroup = null;
    root
      .append("text")
      .attr("x", 0)
      .attr("y", labelFontSize)
      .attr("fill", "#334155")
      .attr("font-size", labelFontSize)
      .text("No spaghetti data");
    emit("hover", null);
    return;
  }

  const selected = new Set(props.selectedStateIds);
  activeLayers = props.dataset.layers.filter((layer) => selected.has(layer.id));
  if (activeLayers.length === 0) {
    xScale = null;
    yScale = null;
    hoverGroup = null;
    root
      .append("text")
      .attr("x", 0)
      .attr("y", labelFontSize)
      .attr("fill", "#334155")
      .attr("font-size", labelFontSize)
      .text("No state selected");
    emit("hover", null);
    return;
  }

  xScale = d3
    .scaleLinear()
    .domain([props.dataset.times[0], props.dataset.times[props.dataset.times.length - 1]])
    .range([0, innerWidth]);

  const spaghettiLines = buildSpaghettiLines(activeLayers);
  const maxY = d3.max(spaghettiLines, (lineItem) => d3.max(lineItem.values) ?? 0) ?? 0;
  yScale = d3.scaleLinear().domain([0, Math.max(1, maxY)]).nice().range([linePlotHeight, 0]);

  const line = d3
    .line<number>()
    .x((_, i) => xScale!(props.dataset!.times[i]))
    .y((v) => yScale!(v))
    .curve(d3.curveMonotoneX);

  linesGroup
    .selectAll<SVGPathElement, SpaghettiLineDatum>("path.spaghetti-line")
    .data(spaghettiLines, (d) => d.key)
    .join((enter) => enter.append("path").attr("class", "spaghetti-line"), (update) => update, (exit) => exit.remove())
    .attr("d", (d) => line(d.values) ?? "")
    .attr("fill", "none")
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-opacity", (d) => d.strokeOpacity)
    .attr("stroke-width", (d) => d.strokeWidth);

  const uncertainty = summarizeUncertainty(activeLayers, props.dataset.times.length);
  drawUncertaintyHistogram(histogramGroup, props.dataset.times, xScale, uncertainty);

  axisX
    .attr("transform", `translate(0,${poportionBottom})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(4, Math.floor(innerWidth / 140)))
        .tickFormat((value) => formatTimeTick(Number(value)))
    );
  axisX
    .selectAll<SVGTextElement, unknown>("text")
    .attr("text-anchor", "end")
    .attr("dx", "-0.45em")
    .attr("dy", "0.35em")
    .attr("transform", "rotate(-35)");
  axisY.call(d3.axisLeft(yScale).ticks(6));

  root
    .append("line")
    .attr("x1", 0)
    .attr("x2", innerWidth)
    .attr("y1", iqrTop - 4)
    .attr("y2", iqrTop - 4)
    .attr("stroke", "rgba(148, 163, 184, 0.45)")
    .attr("stroke-dasharray", `${width * 0.003},${width * 0.003}`);

  root
    .append("text")
    .attr("x", 0)
    .attr("y", -height * 0.016)
    .attr("fill", "#0f172a")
    .attr("font-size", titleFontSize)
    .attr("font-weight", 700)
    .text(`selected states=${activeLayers.length} | lines=${spaghettiLines.length}`);
}

function onMouseMove(event: MouseEvent): void {
  if (!props.dataset || !svgRef.value || !xScale || !yScale || activeLayers.length === 0) {
    return;
  }
  const pointer = pointerToPlot(svgRef.value, event, plotArea);
  const i = nearestIndexByValue(props.dataset.times, xScale.invert(pointer.x));
  const focusLayer = pointer.insideY && pointer.y <= linePlotHeight
    ? pickFocusLayerByMedian(i, yScale.invert(pointer.y), activeLayers)
    : null;
  updateHover(i, focusLayer);
  const text = buildSpaghettiTooltip(i, props.dataset.times, focusLayer, activeLayers);
  emit("hover", { x: event.clientX, y: event.clientY, text });
}

function onMouseLeave(): void {
  if (hoverGroup) {
    hoverGroup.selectAll("*").remove();
  }
  emit("hover", null);
}

function formatTimeTick(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return d3.utcFormat("%Y-%m-%d")(new Date(value));
}

function buildSpaghettiLines(layers: LayerInput[]): SpaghettiLineDatum[] {
  const lines: SpaghettiLineDatum[] = [];
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    const baseColor = layerColor(i, layer.id);
    if (!layer.quantiles) {
      lines.push({
        key: `${layer.id}:mean`,
        layerId: layer.id,
        quantileValue: 0.5,
        values: layer.mean,
        stroke: baseColor,
        strokeOpacity: 0.86,
        strokeWidth: 1.6 * strokeScale,
        drawOrder: 999
      });
      continue;
    }
    const quantileEntries = getSortedQuantileEntries(layer.quantiles);
    if (quantileEntries.length === 0) {
      lines.push({
        key: `${layer.id}:mean`,
        layerId: layer.id,
        quantileValue: 0.5,
        values: layer.mean,
        stroke: baseColor,
        strokeOpacity: 0.86,
        strokeWidth: 1.6 * strokeScale,
        drawOrder: 999
      });
      continue;
    }
    const quantilePalette = buildQuantilePalette(baseColor, quantileEntries.length);
    for (let q = 0; q < quantileEntries.length; q += 1) {
      const entry = quantileEntries[q];
      const closeness = 1 - Math.min(1, Math.abs(entry.value - 0.5) / 0.5);
      lines.push({
        key: `${layer.id}:${entry.key}`,
        layerId: layer.id,
        quantileValue: entry.value,
        values: entry.series,
        stroke: quantilePalette[q],
        strokeOpacity: 0.5 + 0.42 * closeness,
        strokeWidth: (0.85 + 0.95 * closeness) * strokeScale,
        drawOrder: Math.abs(entry.value - 0.5)
      });
    }
  }
  return lines.sort(
    (a, b) =>
      b.drawOrder - a.drawOrder ||
      a.quantileValue - b.quantileValue ||
      a.layerId.localeCompare(b.layerId)
  );
}

function summarizeUncertainty(layers: LayerInput[], tLength: number): UncertaintySummary {
  const iqr = new Array<number>(tLength).fill(0);
  const poportion = new Array<number>(tLength).fill(0);
  for (let t = 0; t < tLength; t += 1) {
    const iqrValues: number[] = [];
    const poportionValues: number[] = [];
    for (const layer of layers) {
      iqrValues.push(iqrAt(layer, t));
      const p = layer.poportionUnc?.[t];
      if (Number.isFinite(p)) {
        poportionValues.push(Math.max(0, p ?? 0));
      }
    }
    iqr[t] = d3.mean(iqrValues) ?? 0;
    poportion[t] = d3.mean(poportionValues) ?? 0;
  }
  return { iqr, poportion };
}

function drawUncertaintyHistogram(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  times: number[],
  x: d3.ScaleLinear<number, number>,
  uncertainty: UncertaintySummary
): void {
  const xValues = times.map((v) => x(v));
  const barWidth =
    xValues.length > 1
      ? Math.max(
          1,
          Math.min(
            innerWidth * 0.012,
            (d3.min(xValues.slice(1).map((v, i) => v - xValues[i])) ?? (innerWidth / Math.max(1, xValues.length))) * 0.86
          )
        )
      : innerWidth * 0.006;

  const maxIqr = Math.max(1e-6, d3.max(uncertainty.iqr) ?? 0);
  const maxPoportion = Math.max(1e-6, d3.max(uncertainty.poportion) ?? 0);
  const iqrScale = d3.scaleLinear().domain([0, maxIqr]).range([iqrBottom, iqrTop]);
  const poportionScale = d3.scaleLinear().domain([0, maxPoportion]).range([poportionBottom, poportionTop]);

  group
    .append("rect")
    .attr("x", 0)
    .attr("y", iqrTop)
    .attr("width", innerWidth)
    .attr("height", iqrBottom - iqrTop)
    .attr("fill", "rgba(245, 158, 11, 0.08)")
    .attr("stroke", "rgba(245, 158, 11, 0.2)");
  group
    .append("rect")
    .attr("x", 0)
    .attr("y", poportionTop)
    .attr("width", innerWidth)
    .attr("height", poportionBottom - poportionTop)
    .attr("fill", "rgba(14, 165, 233, 0.08)")
    .attr("stroke", "rgba(14, 165, 233, 0.2)");

  group
    .append("text")
    .attr("x", 4)
    .attr("y", iqrTop + labelFontSize)
    .attr("fill", "#9a3412")
    .attr("font-size", labelFontSize)
    .attr("font-weight", 700)
    .text("IQR uncertainty");
  group
    .append("text")
    .attr("x", 4)
    .attr("y", poportionTop + labelFontSize)
    .attr("fill", "#0c4a6e")
    .attr("font-size", labelFontSize)
    .attr("font-weight", 700)
    .text("poportion uncertainty");
  group
    .append("text")
    .attr("x", innerWidth - 4)
    .attr("y", iqrTop + labelFontSize)
    .attr("fill", "#9a3412")
    .attr("font-size", minorFontSize)
    .attr("text-anchor", "end")
    .text(`max=${formatCompactNumber(maxIqr)}`);
  group
    .append("text")
    .attr("x", innerWidth - 4)
    .attr("y", poportionTop + labelFontSize)
    .attr("fill", "#0c4a6e")
    .attr("font-size", minorFontSize)
    .attr("text-anchor", "end")
    .text(`max=${formatCompactNumber(maxPoportion)}`);

  const iqrBars = times.map((time, i) => ({ key: `${time}`, x: x(time), value: uncertainty.iqr[i] ?? 0 }));
  const poportionBars = times.map((time, i) => ({ key: `${time}`, x: x(time), value: uncertainty.poportion[i] ?? 0 }));

  group
    .selectAll<SVGRectElement, (typeof iqrBars)[number]>("rect.iqr-bar")
    .data(iqrBars, (d) => d.key)
    .join((enter) => enter.append("rect").attr("class", "iqr-bar"), (update) => update, (exit) => exit.remove())
    .attr("x", (d) => d.x - barWidth * 0.5)
    .attr("width", barWidth)
    .attr("y", (d) => iqrScale(Math.max(0, d.value)))
    .attr("height", (d) => Math.max(0, iqrBottom - iqrScale(Math.max(0, d.value))))
    .attr("fill", "rgba(249, 115, 22, 0.74)");

  group
    .selectAll<SVGRectElement, (typeof poportionBars)[number]>("rect.poportion-bar")
    .data(poportionBars, (d) => d.key)
    .join((enter) => enter.append("rect").attr("class", "poportion-bar"), (update) => update, (exit) => exit.remove())
    .attr("x", (d) => d.x - barWidth * 0.5)
    .attr("width", barWidth)
    .attr("y", (d) => poportionScale(Math.max(0, d.value)))
    .attr("height", (d) => Math.max(0, poportionBottom - poportionScale(Math.max(0, d.value))))
    .attr("fill", "rgba(14, 165, 233, 0.76)");
}

function updateHover(timeIndex: number, focusLayer: LayerInput | null): void {
  if (!hoverGroup || !props.dataset || !xScale || !yScale) {
    return;
  }
  const t = props.dataset.times[timeIndex];
  const x = xScale(t);
  hoverGroup
    .selectAll<SVGLineElement, number>("line.crosshair")
    .data([x])
    .join((enter) => enter.append("line").attr("class", "crosshair"), (update) => update, (exit) => exit.remove())
    .attr("x1", (d) => d)
    .attr("x2", (d) => d)
    .attr("y1", 0)
    .attr("y2", poportionBottom)
    .attr("stroke", "#334155")
    .attr("stroke-opacity", 0.45)
    .attr("stroke-dasharray", `${width * 0.003},${width * 0.003}`);

  const points = activeLayers.map((layer, i) => ({
    id: layer.id,
    x,
    y: yScale!(medianAt(layer, timeIndex)),
    color: layerColor(i, layer.id),
    focused: layer.id === focusLayer?.id
  }));

  hoverGroup
    .selectAll<SVGCircleElement, (typeof points)[number]>("circle.median-dot")
    .data(points, (d) => d.id)
    .join((enter) => enter.append("circle").attr("class", "median-dot"), (update) => update, (exit) => exit.remove())
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", (d) => (d.focused ? hoverDotRadius * 1.45 : hoverDotRadius))
    .attr("fill", "#ffffff")
    .attr("stroke", (d) => d.color)
    .attr("stroke-width", (d) => (d.focused ? 1.7 * strokeScale : 1.1 * strokeScale))
    .attr("opacity", 0.98);
}

function pickFocusLayerByMedian(timeIndex: number, targetY: number, layers: LayerInput[]): LayerInput | null {
  if (layers.length === 0) {
    return null;
  }
  let best = layers[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const layer of layers) {
    const dist = Math.abs(medianAt(layer, timeIndex) - targetY);
    if (dist < bestDist) {
      bestDist = dist;
      best = layer;
    }
  }
  return best;
}

function buildSpaghettiTooltip(timeIndex: number, times: number[], focusLayer: LayerInput | null, layers: LayerInput[]): string {
  const timeLabel = formatTimeTick(times[timeIndex]);
  const iqrMean = d3.mean(layers.map((layer) => iqrAt(layer, timeIndex))) ?? 0;
  const poportionValues = layers.map((layer) => layer.poportionUnc?.[timeIndex]).filter((v): v is number => Number.isFinite(v));
  const poportionMean = d3.mean(poportionValues) ?? 0;

  if (!focusLayer) {
    return [
      `t=${timeLabel} | selected states=${layers.length}`,
      `mean(IQR)=${formatCompactNumber(iqrMean)}`,
      `mean(poportion_unc)=${formatCompactNumber(poportionMean)}`
    ].join("\n");
  }

  const quantiles = quantilesAt(focusLayer, timeIndex);
  const iqr = iqrAt(focusLayer, timeIndex);
  const poportion = focusLayer.poportionUnc?.[timeIndex];
  const header = `t=${timeLabel} | state=${formatLayerShort(focusLayer.id)}`;
  const qLines = quantiles.map((q) => `${q.key}=${formatCompactNumber(q.value)}`);
  return [
    header,
    `median=${formatCompactNumber(medianAt(focusLayer, timeIndex))}`,
    `IQR=${formatCompactNumber(iqr)} | poportion_unc=${formatCompactNumber(poportion ?? 0)}`,
    `mean(IQR)=${formatCompactNumber(iqrMean)} | mean(poportion_unc)=${formatCompactNumber(poportionMean)}`,
    ...qLines
  ].join("\n");
}

function quantilesAt(layer: LayerInput, timeIndex: number): Array<{ key: string; value: number }> {
  if (!layer.quantiles) {
    return [{ key: "p50", value: layer.mean[timeIndex] ?? 0 }];
  }
  return getSortedQuantileEntries(layer.quantiles)
    .map((entry) => ({ key: entry.key, value: entry.series[timeIndex] ?? 0 }))
    .filter((item) => Number.isFinite(item.value));
}

function medianAt(layer: LayerInput, timeIndex: number): number {
  const q50 = layer.quantiles?.p50?.[timeIndex];
  if (Number.isFinite(q50)) {
    return Math.max(0, q50 ?? 0);
  }
  return Math.max(0, layer.mean[timeIndex] ?? 0);
}

function iqrAt(layer: LayerInput, timeIndex: number): number {
  const p25 = layer.quantiles?.p25?.[timeIndex];
  const p75 = layer.quantiles?.p75?.[timeIndex];
  if (Number.isFinite(p25) && Number.isFinite(p75)) {
    return Math.max(0, (p75 ?? 0) - (p25 ?? 0));
  }
  return Math.max(0, layer.unc?.[timeIndex] ?? 0);
}

function buildQuantilePalette(baseColor: string, count: number): string[] {
  if (count <= 1) {
    return [baseColor];
  }
  const light = d3.color(baseColor)?.brighter(1.45).formatHex() ?? baseColor;
  const dark = d3.color(baseColor)?.darker(1.2).formatHex() ?? baseColor;
  const mix = d3.interpolateHsl(light, dark);
  return Array.from({ length: count }, (_, i) => mix(i / (count - 1)));
}

function getSortedQuantileEntries(
  quantiles: Record<string, number[]>
): QuantileEntry[] {
  const entries: QuantileEntry[] = [];
  const hasEquivalentP025 = areSameSeries(quantiles.p05, quantiles.p025);
  const hasEquivalentP975 = areSameSeries(quantiles.p95, quantiles.p975);
  for (const [key, series] of Object.entries(quantiles)) {
    if (key === "p05" && hasEquivalentP025) {
      continue;
    }
    if (key === "p95" && hasEquivalentP975) {
      continue;
    }
    const quantileValue = parseQuantileKey(key);
    if (quantileValue === null) {
      continue;
    }
    entries.push({ key, value: quantileValue, series });
  }
  return entries.sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
}

function parseQuantileKey(key: string): number | null {
  const match = /^p(\d+)$/.exec(key.trim());
  if (!match) {
    return null;
  }
  const digits = match[1];
  const num = Number(digits);
  if (!Number.isFinite(num)) {
    return null;
  }
  const value = num / Math.pow(10, digits.length);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

function areSameSeries(a?: number[], b?: number[]): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function formatLayerShort(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(1);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

defineExpose({
  getSpaghettiSvg: () => svgRef.value
});
</script>

<template>
  <section>
    <svg ref="svgRef" id="spaghetti-chart" preserveAspectRatio="xMidYMid meet" @mousemove="onMouseMove" @mouseleave="onMouseLeave" />
  </section>
</template>
