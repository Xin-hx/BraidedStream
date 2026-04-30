import * as d3 from "d3";
import { createRoiBrush } from "../ui/brush.js";
export class OverviewChart {
    constructor(svg) {
        this.svg = svg;
        this.margin = { top: 10, right: 12, bottom: 34, left: 52 };
        this.lastOnRoiChange = null;
        this.width = Number(svg.getAttribute("width") ?? "1180");
        this.height = Number(svg.getAttribute("height") ?? "118");
        this.innerWidth = this.width - this.margin.left - this.margin.right;
        this.innerHeight = this.height - this.margin.top - this.margin.bottom;
        const rootSvg = d3.select(svg).attr("viewBox", `0 0 ${this.width} ${this.height}`);
        this.root = rootSvg.append("g").attr("transform", `translate(${this.margin.left},${this.margin.top})`);
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
        const totals = dataset.times.map((_, t) => d3.sum(dataset.layers, (layer) => layer.mean[t]) ?? 0);
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
        this.axisX
            .selectAll("text")
            .attr("text-anchor", "end")
            .attr("dx", "-0.45em")
            .attr("dy", "0.35em")
            .attr("transform", "rotate(-35)");
        this.lastOnRoiChange = onRoiChange;
        this.roiBrush.updateContext(dataset.times, xScale);
        this.roiBrush.sync(roi);
        return xScale;
    }
}
function formatTimeTick(value) {
    if (!Number.isFinite(value)) {
        return "";
    }
    return d3.utcFormat("%Y-%m-%d")(new Date(value));
}
