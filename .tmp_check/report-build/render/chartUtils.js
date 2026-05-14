/**
 * Shared SVG chart helpers for render modules.
 *
 * Keep this file focused on rendering mechanics: dimensions, axes, extents,
 * and simple viewport geometry. Data and layout computation belong in core or
 * layout modules.
 */
import * as d3 from "d3";
import { clamp } from "../core/utils.js";
/** Read SVG dimensions and derive the inner plotting rectangle. */
export function readChartSize(svg, fallbackWidth, fallbackHeight, margin) {
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
export function plotAreaFromSize(size) {
    return {
        left: size.margin.left,
        top: size.margin.top,
        width: size.innerWidth,
        height: size.innerHeight
    };
}
/** Format UTC timestamps for compact axis ticks. */
export function formatTimeTick(value) {
    if (!Number.isFinite(value)) {
        return "";
    }
    return d3.utcFormat("%Y-%m-%d")(new Date(value));
}
/** Rotate tick labels on an axis group to reduce overlap on dense timelines. */
export function angleAxisLabels(axisGroup, dx = "-0.45em", dy = "0.35em") {
    axisGroup
        .selectAll("text")
        .attr("text-anchor", "end")
        .attr("dx", dx)
        .attr("dy", dy)
        .attr("transform", "rotate(-35)");
}
/** Extent of a full stack layout. */
export function layoutExtent(layout) {
    return layoutExtentForIndices(layout, Array.from({ length: layout.baseline.length }, (_value, index) => index));
}
/** Extent of a stack layout over a selected list of indices. */
export function layoutExtentForIndices(layout, indices) {
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
export function roiXRange(roi, times, xScale, innerWidth) {
    const left = xScale(times[clamp(Math.round(roi.t0Index), 0, times.length - 1)]);
    const right = xScale(times[clamp(Math.round(roi.t1Index), 0, times.length - 1)]);
    return [
        clamp(Math.min(left, right), 0, innerWidth),
        clamp(Math.max(left, right), 0, innerWidth)
    ];
}
/** Draw or clear a vertical crosshair line. */
export function drawCrosshair(group, timeValue, xScale, height, stroke, strokeOpacity, dashArray) {
    const data = timeValue === null || xScale === null ? [] : [timeValue];
    group
        .selectAll("line.crosshair")
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
