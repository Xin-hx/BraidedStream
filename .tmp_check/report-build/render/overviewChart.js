/**
 * Compact overview renderer and primary ROI brush.
 */
import * as d3 from "d3";
import { angleAxisLabels, createChartFrame, formatTimeTick } from "./chartUtils.js";
import { createRoiBrush } from "../ui/brush.js";
export class OverviewChart {
    constructor(svg) {
        this.svg = svg;
        this.margin = { top: 10, right: 12, bottom: 34, left: 52 };
        this.lastOnRoiChange = null;
        const frame = createChartFrame(svg, 1180, 118, this.margin);
        const size = frame.size;
        this.width = size.width;
        this.height = size.height;
        this.innerWidth = size.innerWidth;
        this.innerHeight = size.innerHeight;
        this.plotArea = frame.plotArea;
        this.root = frame.root;
        this.trendGroup = this.root.append("g").attr("class", "overview-trend");
        this.brushGroup = this.root.append("g").attr("class", "overview-brush");
        this.axisX = this.root.append("g").attr("class", "x-axis");
        this.roiBrush = createRoiBrush(this.brushGroup, [
            [0, 0],
            [this.innerWidth, this.innerHeight]
        ], (roi) => {
            this.lastOnRoiChange?.(roi);
        }, "brush end");
    }
    render(args) {
        const { dataset, roi, onRoiChange } = args;
        const xScale = d3
            .scaleLinear()
            .domain([dataset.times[0], dataset.times[dataset.times.length - 1]])
            .range([0, this.innerWidth]);
        const totals = dataset.times.map((_, t) => d3.sum(dataset.layers, (layer) => layer.height[t]) ?? 0);
        const yMax = d3.max(totals) ?? 1;
        const yScale = d3.scaleLinear().domain([0, yMax]).range([this.innerHeight, 0]);
        const area = d3
            .area()
            .x((_, i) => xScale(dataset.times[i]))
            .y0(this.innerHeight)
            .y1((v) => yScale(v))
            // Keep overview aligned with raw sampling cadence.
            .curve(d3.curveLinear);
        this.trendGroup
            .selectAll("path.overview-area")
            .data([totals])
            .join((enter) => enter.append("path").attr("class", "overview-area"))
            .attr("d", (d) => area(d) ?? "")
            .attr("fill", "rgba(15, 118, 110, 0.23)")
            .attr("stroke", "#0f766e")
            .attr("stroke-width", 1);
        this.axisX
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3
            .axisBottom(xScale)
            .ticks(Math.max(4, Math.floor(this.innerWidth / 140)))
            .tickFormat((value) => formatTimeTick(Number(value))));
        angleAxisLabels(this.axisX);
        this.lastOnRoiChange = onRoiChange;
        this.roiBrush.updateContext(dataset.times, xScale);
        this.roiBrush.sync(roi);
        return { xScale, plotArea: this.plotArea };
    }
}
