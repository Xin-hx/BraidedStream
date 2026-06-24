/**
 * Main streamgraph renderer with inset-ROI brushing.
 */
import * as d3 from "d3";
import { roiBounds } from "../interactions/roi";
import { createAreaPath } from "./paths";
import { angleAxisLabels, createChartFrame, drawCrosshair, formatTimeTick, layoutExtent, roiXRange } from "./chartUtils";
import { layerColor } from "../styles/palette";
import { createRoiBrush } from "../interactions/brush";
export class MainChart {
    constructor(svg) {
        this.svg = svg;
        this.margin = { top: 22, right: 16, bottom: 44, left: 52 };
        this.lastOnInsetRoiChange = null;
        const frame = createChartFrame(svg, 1180, 360, this.margin);
        const size = frame.size;
        this.width = size.width;
        this.height = size.height;
        this.innerWidth = size.innerWidth;
        this.innerHeight = size.innerHeight;
        this.plotArea = frame.plotArea;
        this.root = frame.root;
        this.layersGroup = this.root.append("g").attr("class", "main-layers");
        this.roiGroup = this.root.append("g").attr("class", "main-roi");
        this.insetRoiGroup = this.root.append("g").attr("class", "main-inset-roi");
        this.insetBrushGroup = this.root.append("g").attr("class", "main-inset-brush");
        this.hoverGroup = this.root.append("g").attr("class", "main-hover");
        this.axisX = this.root.append("g").attr("class", "x-axis");
        this.axisY = this.root.append("g").attr("class", "y-axis");
        this.insetBrush = createRoiBrush(this.insetBrushGroup, [
            [0, 0],
            [this.innerWidth, this.innerHeight]
        ], (roi) => {
            this.lastOnInsetRoiChange?.(roi);
        });
    }
    render(args) {
        const { dataset, orderedLayers, layout, insetRoi, onInsetRoiChange } = args;
        const [left, right] = roiBounds(dataset.times.length, args.roi);
        const domainStart = dataset.times[left];
        const domainEnd = dataset.times[right];
        const xScale = d3
            .scaleLinear()
            .domain([domainStart, domainEnd])
            .range([0, this.innerWidth]);
        const extent = layoutExtent(layout);
        const yScale = d3
            .scaleLinear()
            .domain([extent[0] - (extent[1] - extent[0]) * 0.04, extent[1] + (extent[1] - extent[0]) * 0.04])
            .range([this.innerHeight, 0]);
        const paths = orderedLayers.map((layer, k) => ({
            id: layer.id,
            path: createAreaPath(dataset.times.slice(Math.min(left, right), Math.max(left, right) + 1), layout.yBottom[k].slice(Math.min(left, right), Math.max(left, right) + 1), layout.yTop[k].slice(Math.min(left, right), Math.max(left, right) + 1), xScale, yScale, {
                smoothInterpolation: true,
                interpolationSubsteps: 8
            }),
            color: layerColor(k, layer)
        }));
        this.layersGroup
            .selectAll("path.main-band")
            .data(paths, (d) => d.id)
            .join((enter) => enter.append("path").attr("class", "main-band"), (update) => update, (exit) => exit.remove())
            .attr("d", (d) => d.path)
            .attr("fill", (d) => d.color)
            .attr("fill-opacity", 0.83)
            .attr("stroke", "#f8fafc")
            .attr("stroke-width", 0.7);
        this.drawRoi(null, dataset.times, xScale);
        this.drawInsetRoi(insetRoi, dataset.times, xScale);
        this.lastOnInsetRoiChange = onInsetRoiChange;
        this.insetBrush.updateContext(dataset.times, xScale);
        this.insetBrush.sync(insetRoi);
        this.axisX
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3
            .axisBottom(xScale)
            .ticks(Math.max(4, Math.floor(this.innerWidth / 140)))
            .tickFormat((value) => formatTimeTick(Number(value))));
        angleAxisLabels(this.axisX);
        this.axisY.call(d3.axisLeft(yScale).ticks(7));
        return { xScale, yScale, plotArea: this.plotArea };
    }
    drawInsetRoi(roi, times, xScale) {
        if (!roi || times.length === 0) {
            this.insetRoiGroup.selectAll("*").remove();
            return;
        }
        const [x0, x1] = roiXRange(roi, times, xScale, this.innerWidth);
        const width = Math.max(1, x1 - x0);
        this.insetRoiGroup
            .selectAll("rect.inset-roi")
            .data([0])
            .join((enter) => enter.append("rect").attr("class", "inset-roi"))
            .attr("x", x0)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", this.innerHeight)
            .attr("fill", "rgba(180, 83, 9, 0.14)")
            .attr("stroke", "#b45309")
            .attr("stroke-width", 1.2);
        this.insetRoiGroup
            .selectAll("text.inset-roi-tag")
            .data([0])
            .join((enter) => enter.append("text").attr("class", "inset-roi-tag"))
            .attr("x", x0 + 6)
            .attr("y", 28)
            .attr("fill", "#7c2d12")
            .attr("font-size", 11)
            .attr("font-weight", 700)
            .text("Inset ROI");
    }
    setHover(timeValue, xScale) {
        drawCrosshair(this.hoverGroup, timeValue, xScale, this.innerHeight, "#0f172a", 0.45, "4,3");
    }
    drawRoi(roi, times, xScale) {
        if (!roi) {
            this.roiGroup.selectAll("*").remove();
            return;
        }
        const [left, right] = roiXRange(roi, times, xScale, this.innerWidth);
        const width = Math.max(1, right - left);
        const box = this.roiGroup.selectAll("rect.roi-window").data([0]);
        box.join((enter) => enter.append("rect").attr("class", "roi-window"))
            .attr("x", left)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", this.innerHeight)
            .attr("fill", "rgba(14, 165, 233, 0.13)")
            .attr("stroke", "#0369a1")
            .attr("stroke-width", 1.2);
        const labels = this.roiGroup.selectAll("text.roi-tag").data([0]);
        labels
            .join((enter) => enter.append("text").attr("class", "roi-tag"))
            .attr("x", left + 6)
            .attr("y", 14)
            .attr("fill", "#0c4a6e")
            .attr("font-size", 11)
            .attr("font-weight", 700)
            .text("ROI A");
        const leaders = this.roiGroup.selectAll("line.roi-leader").data([0, 1]);
        leaders
            .join((enter) => enter.append("line").attr("class", "roi-leader"))
            .attr("x1", (d) => (d === 0 ? left : right))
            .attr("x2", (d) => (d === 0 ? left - 18 : right + 18))
            .attr("y1", this.innerHeight)
            .attr("y2", this.innerHeight + 18)
            .attr("stroke", "#0c4a6e")
            .attr("stroke-width", 1.1)
            .attr("stroke-dasharray", "4,3")
            .attr("opacity", 0.85);
    }
}
