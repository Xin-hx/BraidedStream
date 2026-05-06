/**
 * Shared SVG chart helpers for render modules.
 *
 * Keep this file focused on rendering mechanics: dimensions, axes, extents,
 * and simple viewport geometry. Data and layout computation belong in core or
 * layout modules.
 */
import * as d3 from "d3";
import type { ROI, StackLayout } from "../core/types";
import { clamp } from "../core/utils";

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

/** Read SVG dimensions and derive the inner plotting rectangle. */
export function readChartSize(svg: SVGSVGElement, fallbackWidth: number, fallbackHeight: number, margin: ChartMargin): ChartSize {
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

/** Extent of a full stack layout. */
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
