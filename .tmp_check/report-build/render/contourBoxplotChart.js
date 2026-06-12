import * as d3 from "d3";
import { computeContourPid } from "../core/ordering/pid.js";
import { roiBounds } from "../interactions/roi.js";
import { clamp } from "../core/utils.js";
import { createAreaPath } from "./paths.js";
import { angleAxisLabels, createChartFrame, formatTimeTick } from "./chartUtils.js";
export class ContourBoxplotChart {
    constructor(svg) {
        this.svg = svg;
        this.margin = { top: 26, right: 18, bottom: 40, left: 52 };
        const frame = createChartFrame(svg, 1180, 190, this.margin);
        const size = frame.size;
        this.width = size.width;
        this.height = size.height;
        this.innerWidth = size.innerWidth;
        this.innerHeight = size.innerHeight;
        this.root = frame.root;
        this.plotGroup = this.root.append("g").attr("class", "contour-boxplot-layers");
        this.titleGroup = this.root.append("g").attr("class", "contour-boxplot-title");
        this.axisX = this.root.append("g").attr("class", "x-axis");
        this.axisY = this.root.append("g").attr("class", "y-axis");
    }
    clear() {
        this.plotGroup.selectAll("*").remove();
        this.titleGroup.selectAll("*").remove();
        this.axisX.selectAll("*").remove();
        this.axisY.selectAll("*").remove();
    }
    render(args) {
        const { dataset, orderedLayers } = args;
        if (dataset.times.length === 0 || orderedLayers.length === 0) {
            this.clear();
            return;
        }
        const yBins = Math.max(24, Math.round(args.yBins));
        const threshold = clamp(args.contourThreshold, 0.01, 0.99);
        const centralFraction = clamp(args.centralFraction, 0.05, 1);
        const opacity = clamp(args.opacity, 0.1, 1);
        const pid = computeContourPid(orderedLayers, {
            yBins,
            contourThreshold: threshold,
            centralFraction,
            uncertaintySource: args.uncertaintySource
        });
        const [left, right] = roiBounds(dataset.times.length, args.roi);
        const activeTimes = dataset.times.slice(left, right + 1);
        if (activeTimes.length === 0) {
            this.clear();
            return;
        }
        const xScale = d3.scaleLinear().domain([activeTimes[0], activeTimes[activeTimes.length - 1]]).range([0, this.innerWidth]);
        const yScale = d3.scaleLinear().domain([pid.grid.zMin, pid.grid.zMax]).range([this.innerHeight, 0]);
        const envelopes = [
            {
                key: "all-union",
                label: "all union",
                env: envelopeFromMask(pid.allUnionMask, pid.grid, dataset.times, left, right, threshold),
                fill: "#cbd5e1",
                opacity: 0.2 * opacity,
                stroke: "rgba(71, 85, 105, 0.5)"
            },
            {
                key: "central-union",
                label: `top ${(centralFraction * 100).toFixed(0)}% union`,
                env: envelopeFromMask(pid.centralUnionMask, pid.grid, dataset.times, left, right, threshold),
                fill: "#38bdf8",
                opacity: 0.28 * opacity,
                stroke: "rgba(2, 132, 199, 0.65)"
            },
            {
                key: "central-intersection",
                label: `top ${(centralFraction * 100).toFixed(0)}% intersection`,
                env: envelopeFromMask(pid.centralIntersectionMask, pid.grid, dataset.times, left, right, threshold),
                fill: "#0f766e",
                opacity: 0.32 * opacity,
                stroke: "rgba(15, 118, 110, 0.72)"
            }
        ];
        const deepest = envelopeFromMask(pid.deepestMask, pid.grid, dataset.times, left, right, threshold);
        this.plotGroup
            .selectAll("path.contour-boxplot-band")
            .data(envelopes.filter((item) => item.env.times.length > 1), (d) => d.key)
            .join((enter) => enter.append("path").attr("class", "contour-boxplot-band"), (update) => update, (exit) => exit.remove())
            .attr("d", (d) => createAreaPath(d.env.times, d.env.low, d.env.high, xScale, yScale, { smoothInterpolation: true }))
            .attr("fill", (d) => d.fill)
            .attr("fill-opacity", (d) => d.opacity)
            .attr("stroke", (d) => d.stroke)
            .attr("stroke-width", 1);
        this.drawDeepestMember(deepest, xScale, yScale, opacity);
        this.drawLegend(envelopes, pid.deepestLayerId, opacity);
        this.drawTitle(pid.deepestLayerId, yBins, threshold, centralFraction, args.uncertaintySource);
        this.axisX
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3
            .axisBottom(xScale)
            .ticks(Math.max(3, Math.floor(this.innerWidth / 170)))
            .tickFormat((value) => formatTimeTick(Number(value))));
        angleAxisLabels(this.axisX);
        this.axisY.call(d3
            .axisLeft(yScale)
            .ticks(4)
            .tickFormat((value) => formatContourValue(Number(value), pid.grid.valueTransform, args.uncertaintySource)));
    }
    drawDeepestMember(env, xScale, yScale, opacity) {
        const line = d3
            .line()
            .x((_d, i) => xScale(env.times[i]))
            .y((d) => yScale(d))
            .curve(d3.curveCatmullRom.alpha(0.5));
        const data = env.times.length > 1
            ? [
                { key: "deepest-low", values: env.low },
                { key: "deepest-high", values: env.high }
            ]
            : [];
        this.plotGroup
            .selectAll("path.contour-boxplot-deepest")
            .data(data, (d) => d.key)
            .join((enter) => enter.append("path").attr("class", "contour-boxplot-deepest"), (update) => update, (exit) => exit.remove())
            .attr("d", (d) => line(d.values) ?? "")
            .attr("fill", "none")
            .attr("stroke", "#be123c")
            .attr("stroke-opacity", 0.88 * opacity)
            .attr("stroke-width", 1.7);
    }
    drawLegend(bands, deepestLayerId, opacity) {
        const data = [
            ...bands.map((band) => ({ key: band.key, label: band.label, color: band.fill, opacity: band.opacity })),
            {
                key: "deepest",
                label: `deepest ${deepestLayerId ? deepestLayerId.split("|")[0] : "N/A"}`,
                color: "#be123c",
                opacity: 0.9 * opacity
            }
        ];
        const legend = this.plotGroup
            .selectAll("g.contour-boxplot-legend-item")
            .data(data, (d) => d.key)
            .join((enter) => {
            const g = enter.append("g").attr("class", "contour-boxplot-legend-item");
            g.append("rect");
            g.append("text");
            return g;
        }, (update) => update, (exit) => exit.remove())
            .attr("transform", (_d, i) => `translate(${i * 178},${this.innerHeight + 33})`);
        legend
            .select("rect")
            .attr("width", 12)
            .attr("height", 8)
            .attr("rx", 2)
            .attr("fill", (d) => d.color)
            .attr("fill-opacity", (d) => d.opacity)
            .attr("stroke", "rgba(15, 23, 42, 0.2)");
        legend
            .select("text")
            .attr("x", 17)
            .attr("y", 8)
            .attr("font-size", 10)
            .attr("fill", "#475569")
            .text((d) => d.label);
    }
    drawTitle(deepestLayerId, yBins, threshold, centralFraction, uncertaintySource) {
        const text = `PID contour boxplot | source=${uncertaintySource} | top=${(centralFraction * 100).toFixed(0)}% | threshold=${threshold.toFixed(2)} | yBins=${yBins} | deepest=${deepestLayerId ? deepestLayerId.split("|")[0] : "N/A"}`;
        this.titleGroup
            .selectAll("text.title")
            .data([0])
            .join((enter) => enter.append("text").attr("class", "title"))
            .attr("x", 0)
            .attr("y", -8)
            .attr("fill", "#0f172a")
            .attr("font-size", 12)
            .attr("font-weight", 700)
            .text(text);
    }
}
function envelopeFromMask(mask, grid, times, left, right, threshold) {
    const dz = grid.yBins <= 1 ? 1 : (grid.zMax - grid.zMin) / (grid.yBins - 1);
    const out = { times: [], low: [], high: [] };
    for (let t = left; t <= right; t += 1) {
        let low = null;
        let high = null;
        for (let y = 0; y < grid.yBins; y += 1) {
            const value = mask[y * grid.xBins + t] ?? 0;
            if (value < threshold) {
                continue;
            }
            const z = grid.zMin + y * dz;
            low = low === null ? z : Math.min(low, z);
            high = high === null ? z : Math.max(high, z);
        }
        if (low !== null && high !== null) {
            out.times.push(times[t]);
            out.low.push(low);
            out.high.push(high);
        }
    }
    return out;
}
function formatContourValue(value, transform, uncertaintySource) {
    const raw = transform === "linear" ? value : Math.expm1(value);
    if (!Number.isFinite(raw)) {
        return "";
    }
    if (uncertaintySource === "poportion") {
        const pct = raw * 100;
        return `${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
    }
    if (Math.abs(raw) >= 1000000) {
        return `${(raw / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(raw) >= 1000) {
        return `${(raw / 1000).toFixed(0)}K`;
    }
    return raw.toFixed(raw >= 10 ? 0 : 2);
}
