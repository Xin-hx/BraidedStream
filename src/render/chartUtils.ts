/**
 * Shared SVG chart helpers — dimensions, axes, extents, hover, and simple viewport
 * geometry.  Rendering mechanics only; data / layout computation belong in core or
 * layout modules.
 */
import * as d3 from "d3";
import type { ROI, StackLayout } from "../core/types";
import { clamp } from "../core/utils";

// ── geometry interfaces ──────────────────────────────────────────────────────

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartSize {
  width: number;
  height: number;
  margin: ChartMargin;
  innerWidth: number;
  innerHeight: number;
}

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ChartFrame {
  size: ChartSize;
  plotArea: PlotArea;
  root: d3.Selection<SVGGElement, unknown, null, undefined>;
}

/** Pre-computed plot context: frame-derived geometry plus convenience fields. */
export interface PlotContext {
  size: ChartSize;
  plotArea: PlotArea;
  root: d3.Selection<SVGGElement, unknown, null, undefined>;
  innerWidth: number;
  innerHeight: number;
}

// ── frame construction ────────────────────────────────────────────────────────

/** Read SVG dimensions and derive the inner plotting rectangle. */
export function readChartSize(
  svg: SVGSVGElement,
  fallbackWidth: number,
  fallbackHeight: number,
  margin: ChartMargin
): ChartSize {
  const width = Number(svg.getAttribute("width") ?? String(fallbackWidth));
  const height = Number(svg.getAttribute("height") ?? String(fallbackHeight));
  return {
    width,
    height,
    margin,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom
  };
}

export function plotAreaFromSize(size: ChartSize): PlotArea {
  return {
    left: size.margin.left,
    top: size.margin.top,
    width: size.innerWidth,
    height: size.innerHeight
  };
}

/** Initialize the shared SVG viewport and translated plotting root. */
export function createChartFrame(
  svg: SVGSVGElement,
  fallbackWidth: number,
  fallbackHeight: number,
  margin: ChartMargin
): ChartFrame {
  const size = readChartSize(svg, fallbackWidth, fallbackHeight, margin);
  const rootSvg = d3.select(svg).attr("viewBox", `0 0 ${size.width} ${size.height}`);
  return {
    size,
    plotArea: plotAreaFromSize(size),
    root: rootSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`)
  };
}

/**
 * Convenience factory for chart constructors.  Wraps createChartFrame and unpacks
 * the most frequently used fields into a single PlotContext.
 */
export function createPlotContext(
  svg: SVGSVGElement,
  fallbackWidth: number,
  fallbackHeight: number,
  margin: ChartMargin
): PlotContext {
  const frame = createChartFrame(svg, fallbackWidth, fallbackHeight, margin);
  return {
    size: frame.size,
    plotArea: frame.plotArea,
    root: frame.root,
    innerWidth: frame.size.innerWidth,
    innerHeight: frame.size.innerHeight
  };
}

// ── axes ──────────────────────────────────────────────────────────────────────

/** Format UTC timestamps for compact axis ticks. */
export function formatTimeTick(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return d3.utcFormat("%Y-%m-%d")(new Date(value));
}

/** Rotate tick labels on an axis group to reduce overlap on dense timelines. */
export function angleAxisLabels(
  axisGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  dx = "-0.45em",
  dy = "0.35em"
): void {
  axisGroup
    .selectAll<SVGTextElement, unknown>("text")
    .attr("text-anchor", "end")
    .attr("dx", dx)
    .attr("dy", dy)
    .attr("transform", "rotate(-35)");
}

/**
 * Render a standard time X axis.  Used by all chart views to keep tick formatting
 * and label rotation consistent.
 */
export function renderTimeAxis(
  axisGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
  /** Suggested tick density (ticks per 140px) */
  density = 140
): void {
  axisGroup
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(4, Math.floor(innerWidth / density)))
        .tickFormat((value) => formatTimeTick(Number(value)))
    );
  angleAxisLabels(axisGroup);
}

/**
 * Render a standard value Y axis with the given tick count.
 */
export function renderValueAxis(
  axisGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  yScale: d3.ScaleLinear<number, number>,
  tickCount: number,
  /** Optional custom tick formatter. */
  tickFormat?: (value: number) => string
): void {
  const axis = d3.axisLeft(yScale).ticks(tickCount);
  if (tickFormat) {
    axis.tickFormat((value) => tickFormat(Number(value)));
  }
  axisGroup.call(axis);
}

// ── title ─────────────────────────────────────────────────────────────────────

/**
 * Render or update a single-line chart title.  Uses D3 data-join so later calls
 * seamlessly update text without leaking elements.
 */
export function renderChartTitle(
  titleGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  text: string,
  options?: {
    x?: number;
    y?: number;
    fill?: string;
    fontSize?: number;
    fontWeight?: number;
  }
): void {
  titleGroup
    .selectAll<SVGTextElement, number>("text.chart-title")
    .data([0])
    .join((enter) => enter.append("text").attr("class", "chart-title"))
    .attr("x", options?.x ?? 0)
    .attr("y", options?.y ?? -6)
    .attr("fill", options?.fill ?? "#0f172a")
    .attr("font-size", options?.fontSize ?? 12)
    .attr("font-weight", options?.fontWeight ?? 700)
    .text(text);
}

// ── extent helpers ────────────────────────────────────────────────────────────

/** Full extent of a stack layout over all time indices. */
export function layoutExtent(layout: StackLayout): [number, number] {
  return layoutExtentForIndices(
    layout,
    Array.from({ length: layout.baseline.length }, (_value, index) => index)
  );
}

/** Extent of a stack layout over a selected list of indices. */
export function layoutExtentForIndices(layout: StackLayout, indices: number[]): [number, number] {
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
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return [-1, 1];
  }
  if (minValue === maxValue) {
    return [minValue - 1, maxValue + 1];
  }
  return [minValue, maxValue];
}

// ── ROI viewport ──────────────────────────────────────────────────────────────

/** Convert ROI endpoints to a clamped x-pixel interval. */
export function roiXRange(
  roi: ROI,
  times: number[],
  xScale: d3.ScaleLinear<number, number>,
  innerWidth: number
): [number, number] {
  const left = xScale(times[clamp(Math.round(roi.t0Index), 0, times.length - 1)]);
  const right = xScale(times[clamp(Math.round(roi.t1Index), 0, times.length - 1)]);
  return [
    clamp(Math.min(left, right), 0, innerWidth),
    clamp(Math.max(left, right), 0, innerWidth)
  ];
}

// ── crosshair ─────────────────────────────────────────────────────────────────

/** Draw or clear a vertical crosshair line. */
export function drawCrosshair(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  timeValue: number | null,
  xScale: d3.ScaleLinear<number, number> | null,
  height: number,
  stroke: string,
  strokeOpacity: number,
  dashArray: string
): void {
  const data = timeValue === null || xScale === null ? [] : [timeValue];
  group
    .selectAll<SVGLineElement, number>("line.crosshair")
    .data(data)
    .join((enter) => enter.append("line").attr("class", "crosshair"), (update) => update, (exit) => exit.remove())
    .attr("x1", (value) => (xScale ? xScale(value) : 0))
    .attr("x2", (value) => (xScale ? xScale(value) : 0))
    .attr("y1", 0)
    .attr("y2", height)
    .attr("stroke", stroke)
    .attr("stroke-opacity", strokeOpacity)
    .attr("stroke-dasharray", dashArray);
}

// ── layer hover (merged from layerHoverHighlight.ts) ──────────────────────────

export interface LayerHoverDatum {
  id: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface LayerHoverHighlightOptions {
  dimFillOpacity: number;
  dimStrokeOpacity: number;
  hoverFillBoost: number;
  hoverStroke: string;
  hoverStrokeOpacity: number;
  hoverStrokeWidthFactor: number;
}

/**
 * Dim all layers except the hovered one, then boost the hovered layer and raise
 * it above siblings so its stroke is fully visible.
 */
export function applyLayerHoverHighlight<T extends LayerHoverDatum>(
  selection: d3.Selection<SVGPathElement, T, SVGGElement, unknown>,
  layerId: string | null,
  options: LayerHoverHighlightOptions
): void {
  let hasHoveredDatum = false;
  if (layerId !== null) {
    selection.each((d) => {
      if (d.id === layerId) {
        hasHoveredDatum = true;
      }
    });
  }
  const hasHover = layerId !== null && hasHoveredDatum;
  selection
    .attr("fill-opacity", (d) =>
      hasHover
        ? d.id === layerId
          ? Math.min(1, d.fillOpacity + options.hoverFillBoost)
          : options.dimFillOpacity
        : d.fillOpacity
    )
    .attr("stroke", (d) => (hasHover && d.id === layerId ? options.hoverStroke : d.stroke))
    .attr("stroke-opacity", (d) =>
      hasHover
        ? d.id === layerId
          ? options.hoverStrokeOpacity
          : options.dimStrokeOpacity
        : d.strokeOpacity
    )
    .attr("stroke-width", (d) =>
      hasHover && d.id === layerId
        ? Math.max(d.strokeWidth * options.hoverStrokeWidthFactor, d.strokeWidth + 0.8)
        : d.strokeWidth
    )
    .classed("is-hover-muted", (d) => hasHover && d.id !== layerId)
    .classed("is-hover-focused", (d) => hasHover && d.id === layerId);

  if (hasHover) {
    selection.filter((d) => d.id === layerId).raise();
  }
}
