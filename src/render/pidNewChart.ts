/**
 * Renderer for the PID-new contour boxplot and ordered river panels.
 */
import * as d3 from "d3";
import type { ContourPidResult, PidNewScene } from "../core/pid";
import { layoutExtent, nearestByValue, pickLayerAtY } from "../core/pid";
import type { LayerInput, PidBaselineMode, PreparedDataset, StackLayout } from "../core/types";
import { clamp } from "../core/utils";
import { angleAxisLabels, formatTimeTick } from "./chartUtils";
import { layerColor } from "../styles/palette";

export interface PidNewHoverPayload {
  x: number;
  y: number;
  text: string;
}

export interface PidNewChartDimensions {
  width: number;
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  contourHeight: number;
  riverHeight: number;
  panelGap: number;
}

export interface PidNewChartState {
  scene: PidNewScene;
  xScale: d3.ScaleLinear<number, number>;
  contourYScale: d3.ScaleLinear<number, number>;
  riverYScale: d3.ScaleLinear<number, number>;
  riverTop: number;
  dimensions: PidNewChartDimensions;
}

interface PidNewMaskLayer {
  key: string;
  label: string;
  mask: Float32Array;
  fill: string;
  stroke: string;
  opacity: number;
}

interface PidNewLayerDatum {
  id: string;
  index: number;
}

const PID_NEW_CHART_DIMENSIONS: PidNewChartDimensions = {
  width: 1140,
  margin: { top: 28, right: 28, bottom: 56, left: 64 },
  contourHeight: 280,
  riverHeight: 230,
  panelGap: 64
};

export function renderPidNewEmpty(svgElement: SVGSVGElement, message = "No data available for PID new"): void {
  const dimensions = PID_NEW_CHART_DIMENSIONS;
  const svg = d3.select(svgElement);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${dimensions.width} ${canvasHeight(dimensions)}`).attr("height", canvasHeight(dimensions));

  svg
    .append("g")
    .attr("transform", `translate(${dimensions.margin.left},${dimensions.margin.top})`)
    .append("text")
    .attr("x", 0)
    .attr("y", 18)
    .attr("fill", "#334155")
    .attr("font-size", 14)
    .text(message);
}

export function renderPidNewChart(
  svgElement: SVGSVGElement,
  scene: PidNewScene,
  baselineMode: PidBaselineMode,
  dimensions = PID_NEW_CHART_DIMENSIONS
): PidNewChartState {
  const svg = d3.select(svgElement);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${dimensions.width} ${canvasHeight(dimensions)}`).attr("height", canvasHeight(dimensions));

  const root = svg.append("g").attr("transform", `translate(${dimensions.margin.left},${dimensions.margin.top})`);
  const innerWidth = chartInnerWidth(dimensions);
  const xScale = d3
    .scaleLinear()
    .domain([scene.activeTimes[0], scene.activeTimes[scene.activeTimes.length - 1]])
    .range([0, innerWidth]);

  const contourYScale = d3
    .scaleLinear()
    .domain([scene.contourPid.grid.zMin, scene.contourPid.grid.zMax])
    .range([dimensions.contourHeight, 0]);
  const riverExtent = layoutExtent(scene.layout, scene.activeIndices);
  const riverPad = (riverExtent[1] - riverExtent[0]) * 0.06 + 1e-6;
  const riverYScale = d3
    .scaleLinear()
    .domain([riverExtent[0] - riverPad, riverExtent[1] + riverPad])
    .range([dimensions.riverHeight, 0]);

  drawContourPanel(root, scene, xScale, contourYScale, dimensions);
  const riverTop = dimensions.contourHeight + dimensions.panelGap;
  drawRiverPanel(root, scene, xScale, riverYScale, riverTop, baselineMode, dimensions);

  return {
    scene,
    xScale,
    contourYScale,
    riverYScale,
    riverTop,
    dimensions
  };
}

export function getPidNewHoverPayload(
  svgElement: SVGSVGElement,
  event: MouseEvent,
  state: PidNewChartState
): PidNewHoverPayload | null {
  const { scene, dimensions } = state;
  const innerWidth = chartInnerWidth(dimensions);
  const local = localPoint(svgElement, event, dimensions);
  const x = local.x - dimensions.margin.left;
  const y = local.y - dimensions.margin.top;
  if (x < 0 || x > innerWidth) {
    return null;
  }

  if (y >= state.riverTop && y <= state.riverTop + dimensions.riverHeight) {
    const timeValue = state.xScale.invert(x);
    const localIndex = nearestByValue(
      scene.activeIndices.map((index) => scene.dataset.times[index]),
      timeValue
    );
    const index = scene.activeIndices[localIndex] ?? scene.activeIndices[0] ?? 0;
    const yValue = state.riverYScale.invert(y - state.riverTop);
    const layer = pickLayerAtY(index, yValue, scene.layout, scene.orderedLayers);
    if (!layer) {
      return null;
    }
    const score = scene.contourPid.scoreByLayerId.get(layer.id);
    return {
      x: event.clientX,
      y: event.clientY,
      text: [
        "PID new river",
        `t=${formatTimeTick(scene.dataset.times[index])}`,
        `layer=${layerLabel(layer.id)} | depth=${score ? score.depth.toFixed(3) : "0.000"}`,
        `in=${score ? score.inScore.toFixed(3) : "0.000"} | out=${score ? score.outScore.toFixed(3) : "0.000"}`,
        `${scene.uncertaintySource === "poportion" ? "proportion" : "value"}=${formatAxisValue(layer.mean[index] ?? 0, scene.uncertaintySource)}`
      ].join("\n")
    };
  }

  if (y >= 0 && y <= dimensions.contourHeight) {
    const z = state.contourYScale.invert(y);
    return {
      x: event.clientX,
      y: event.clientY,
      text: [
        "PID new contour",
        `t=${formatTimeTick(state.xScale.invert(x))}`,
        `${scene.uncertaintySource === "poportion" ? "proportion" : "value"}=${formatAxisValue(z, scene.uncertaintySource)}`
      ].join("\n")
    };
  }

  return null;
}

function drawContourPanel(
  root: d3.Selection<SVGGElement, unknown, null, undefined>,
  scene: PidNewScene,
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  dimensions: PidNewChartDimensions
): void {
  const result = scene.contourPid;
  const innerWidth = chartInnerWidth(dimensions);
  const panel = root.append("g").attr("class", "pid-new-contour");
  panel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", dimensions.contourHeight)
    .attr("fill", "rgba(248, 250, 252, 0.82)")
    .attr("stroke", "rgba(148, 163, 184, 0.44)");
  panel
    .append("clipPath")
    .attr("id", "pid-new-contour-clip")
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", dimensions.contourHeight);

  for (const item of contourMaskLayers(result)) {
    const contours = contourFeatures(item.mask, result);
    panel
      .append("g")
      .attr("class", `pid-new-contour-${item.key}`)
      .attr("clip-path", "url(#pid-new-contour-clip)")
      .selectAll<SVGPathElement, d3.ContourMultiPolygon>("path")
      .data(contours)
      .join("path")
      .attr("d", contourPath(result, scene.dataset.times, xScale, yScale))
      .attr("fill", item.fill)
      .attr("fill-opacity", item.fill === "none" ? 0 : item.opacity)
      .attr("stroke", item.stroke)
      .attr("stroke-width", item.key === "deepest" ? 2.1 : 1.2)
      .attr("stroke-opacity", item.opacity);
  }

  const xAxis = panel
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${dimensions.contourHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(3, Math.floor(innerWidth / 220)))
          .tickFormat((value) => formatTimeTick(Number(value)))
    );
  angleAxisLabels(xAxis, "-0.42em", "0.34em");
  panel
    .append("g")
    .attr("class", "y-axis")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat((value) => formatYAxisTick(Number(value), scene.uncertaintySource)));

  const top = result.scores[0];
  panel
    .append("text")
    .attr("x", 0)
    .attr("y", -10)
    .attr("fill", "#0f172a")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text(scene.uncertaintySource === "poportion" ? "PID new: time-proportion fuzzy contour boxplot" : "PID new: time-value fuzzy contour boxplot");
  panel
    .append("text")
    .attr("x", innerWidth)
    .attr("y", -10)
    .attr("text-anchor", "end")
    .attr("fill", "#334155")
    .attr("font-size", 10.5)
    .text(`PID-Mean | deepest=${top ? layerLabel(top.id) : "N/A"} depth=${top ? top.depth.toFixed(3) : "0.000"}`);

  drawContourLegend(panel, result, innerWidth);
}

function drawRiverPanel(
  root: d3.Selection<SVGGElement, unknown, null, undefined>,
  scene: PidNewScene,
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  top: number,
  baselineMode: PidBaselineMode,
  dimensions: PidNewChartDimensions
): void {
  const innerWidth = chartInnerWidth(dimensions);
  const panel = root.append("g").attr("class", "pid-new-river").attr("transform", `translate(0,${top})`);
  panel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", dimensions.riverHeight)
    .attr("fill", "rgba(248, 250, 252, 0.82)")
    .attr("stroke", "rgba(148, 163, 184, 0.44)");

  panel
    .selectAll<SVGPathElement, PidNewLayerDatum>("path.pid-new-layer")
    .data(
      scene.orderedLayers.map((layer, index) => ({ id: layer.id, index })),
      (d) => d.id
    )
    .join("path")
    .attr("class", "pid-new-layer")
    .attr("d", (d) =>
      d3
        .area<number>()
        .x((t) => xScale(scene.dataset.times[t]))
        .y0((t) => yScale(scene.layout.yBottom[d.index][t]))
        .y1((t) => yScale(scene.layout.yTop[d.index][t]))
        .curve(d3.curveMonotoneX)(scene.activeIndices) ?? ""
    )
    .attr("fill", (d) => layerColor(d.index, d.id))
    .attr("fill-opacity", 0.84)
    .attr("stroke", "#f8fafc")
    .attr("stroke-width", 0.75);

  const xAxis = panel
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${dimensions.riverHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(3, Math.floor(innerWidth / 220)))
          .tickFormat((value) => formatTimeTick(Number(value)))
    );
  angleAxisLabels(xAxis, "-0.42em", "0.34em");
  panel.append("g").attr("class", "y-axis").call(d3.axisLeft(yScale).ticks(5));

  const topScores = scene.contourPid.scores
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
    .text(`PID new river (${pidBaselineModeLabel(baselineMode)} baseline)`);
  panel
    .append("text")
    .attr("x", innerWidth)
    .attr("y", -10)
    .attr("text-anchor", "end")
    .attr("fill", "#334155")
    .attr("font-size", 10.5)
    .text(`top depth: ${topScores}`);
}

function drawContourLegend(
  panel: d3.Selection<SVGGElement, unknown, null, undefined>,
  result: ContourPidResult,
  innerWidth: number
): void {
  const legend = panel.append("g").attr("transform", `translate(${innerWidth - 520},14)`);
  contourMaskLayers(result).forEach((item, index) => {
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

function contourMaskLayers(result: ContourPidResult): PidNewMaskLayer[] {
  return [
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
}

function contourFeatures(mask: Float32Array, result: ContourPidResult): d3.ContourMultiPolygon[] {
  return d3
    .contours()
    .size([result.grid.xBins, result.grid.yBins])
    .thresholds([result.grid.contourThreshold])(Array.from(mask))
    .map(dominantEnvelopeFeature)
    .filter((feature) => feature.coordinates.length > 0);
}

function dominantEnvelopeFeature(feature: d3.ContourMultiPolygon): d3.ContourMultiPolygon {
  const components = feature.coordinates
    .map((polygon) => {
      const exteriorRing = polygon[0];
      return {
        polygon: exteriorRing ? [exteriorRing] : [],
        area: exteriorRing ? contourRingArea(exteriorRing) : 0
      };
    })
    .filter((component) => component.polygon.length > 0 && component.area > 0);
  if (components.length === 0) {
    return { ...feature, coordinates: [] };
  }

  components.sort((a, b) => b.area - a.area);
  return {
    ...feature,
    coordinates: [components[0].polygon]
  };
}

function contourRingArea(ring: number[][]): number {
  const points: Array<[number, number]> = ring.map((point) => [point[0] ?? 0, point[1] ?? 0]);
  return Math.abs(d3.polygonArea(points));
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

function localPoint(svg: SVGSVGElement, event: MouseEvent, dimensions: PidNewChartDimensions): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * dimensions.width) / Math.max(1e-6, rect.width),
    y: ((event.clientY - rect.top) * canvasHeight(dimensions)) / Math.max(1e-6, rect.height)
  };
}

function chartInnerWidth(dimensions: PidNewChartDimensions): number {
  return dimensions.width - dimensions.margin.left - dimensions.margin.right;
}

function canvasHeight(dimensions: PidNewChartDimensions): number {
  return dimensions.margin.top + dimensions.contourHeight + dimensions.panelGap + dimensions.riverHeight + dimensions.margin.bottom;
}

function formatYAxisTick(value: number, uncertaintySource: PidNewScene["uncertaintySource"]): string {
  return formatAxisValue(value, uncertaintySource);
}

function formatAxisValue(value: number, uncertaintySource: PidNewScene["uncertaintySource"]): string {
  if (uncertaintySource === "poportion") {
    return Number.isFinite(value) ? value.toFixed(3) : "-";
  }
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
