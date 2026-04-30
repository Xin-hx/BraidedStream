import * as d3 from "d3";
import { createAreaPath } from "./paths.js";
import { diffColor, layerColor } from "../styles/palette.js";
import { boundaryUncertaintyAt } from "../core/validate.js";
export class InsetChart {
    constructor(svg) {
        this.svg = svg;
        this.margin = { top: 24, right: 16, bottom: 44, left: 52 };
        this.width = Number(svg.getAttribute("width") ?? "1180");
        this.height = Number(svg.getAttribute("height") ?? "300");
        this.innerWidth = this.width - this.margin.left - this.margin.right;
        this.innerHeight = this.height - this.margin.top - this.margin.bottom;
        const rootSvg = d3.select(svg).attr("viewBox", `0 0 ${this.width} ${this.height}`);
        this.root = rootSvg.append("g").attr("transform", `translate(${this.margin.left},${this.margin.top})`);
        this.titleGroup = this.root.append("g").attr("class", "inset-title");
        this.beforeGroup = this.root.append("g").attr("class", "inset-before");
        this.afterGroup = this.root.append("g").attr("class", "inset-after");
        this.overlayGroup = this.root.append("g").attr("class", "inset-overlay");
        this.hoverGroup = this.root.append("g").attr("class", "inset-hover");
        this.axisX = this.root.append("g").attr("class", "x-axis");
        this.axisY = this.root.append("g").attr("class", "y-axis");
    }
    render(args) {
        const { dataset, orderedLayers, before, after, viewMode, yZoom, enableUncertaintyGap, enableJaggedEdge, jaggedAmplitude, jaggedFrequency, fixedSeed } = args;
        if (dataset.times.length === 0) {
            this.root.selectAll("path, text, line").remove();
            this.axisX.selectAll("*").remove();
            this.axisY.selectAll("*").remove();
            this.titleGroup
                .selectAll("text.title")
                .data([0])
                .join((enter) => enter.append("text").attr("class", "title"))
                .attr("x", 0)
                .attr("y", 0)
                .attr("fill", "#334155")
                .text("No time points available");
            return { xScale: null, yScale: null, activeTimes: [], activeStartIndex: 0 };
        }
        const [left, right] = roiBounds(dataset.times.length, args.roi);
        const activeTimes = dataset.times.slice(left, right + 1);
        const xScale = d3.scaleLinear().domain([activeTimes[0], activeTimes[activeTimes.length - 1]]).range([0, this.innerWidth]);
        const eBefore = extentCrop(before, left, right);
        const eAfter = extentCrop(after, left, right);
        const minV = Math.min(eBefore[0], eAfter[0]);
        const maxV = Math.max(eBefore[1], eAfter[1]);
        const center = 0.5 * (minV + maxV);
        const half = 0.5 * (maxV - minV) / Math.max(0.2, yZoom);
        const yScale = d3.scaleLinear().domain([center - half * 1.06, center + half * 1.06]).range([this.innerHeight, 0]);
        this.drawTitle(viewMode, enableUncertaintyGap, enableJaggedEdge);
        this.drawBeforeAfter(dataset, orderedLayers, before, after, left, right, xScale, yScale, viewMode, enableJaggedEdge, jaggedAmplitude, jaggedFrequency, fixedSeed);
        this.drawDiffAndGapSemantic(orderedLayers, dataset, before, after, left, right, xScale, yScale, viewMode, enableUncertaintyGap);
        this.axisX
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3
            .axisBottom(xScale)
            .ticks(Math.max(3, Math.floor(this.innerWidth / 160)))
            .tickFormat((value) => formatTimeTick(Number(value))));
        this.axisX
            .selectAll("text")
            .attr("text-anchor", "end")
            .attr("dx", "-0.45em")
            .attr("dy", "0.35em")
            .attr("transform", "rotate(-35)");
        this.axisY.call(d3.axisLeft(yScale).ticks(6));
        return { xScale, yScale, activeTimes, activeStartIndex: left };
    }
    setHover(timeValue, xScale) {
        if (xScale === null || timeValue === null) {
            this.hoverGroup.selectAll("*").remove();
            return;
        }
        const lineSel = this.hoverGroup.selectAll("line.crosshair").data([timeValue]);
        lineSel
            .join((enter) => enter.append("line").attr("class", "crosshair"), (update) => update, (exit) => exit.remove())
            .attr("x1", (d) => xScale(d))
            .attr("x2", (d) => xScale(d))
            .attr("y1", 0)
            .attr("y2", this.innerHeight)
            .attr("stroke", "#7c2d12")
            .attr("stroke-opacity", 0.5)
            .attr("stroke-dasharray", "4,2");
    }
    drawTitle(viewMode, enableUncertaintyGap, enableJaggedEdge) {
        const modeText = viewMode.toUpperCase();
        const staticText = "interactive";
        const text = `mode=${modeText} | uncertainty-gap=${enableUncertaintyGap ? "on" : "off"} | jagged-edge=${enableJaggedEdge ? "on" : "off"} | ${staticText}`;
        this.titleGroup
            .selectAll("text.title")
            .data([0])
            .join((enter) => enter.append("text").attr("class", "title"))
            .attr("x", 0)
            .attr("y", -6)
            .attr("fill", "#0f172a")
            .attr("font-weight", 700)
            .attr("font-size", 12)
            .text(text);
    }
    drawBeforeAfter(dataset, orderedLayers, before, after, left, right, xScale, yScale, viewMode, enableJaggedEdge, jaggedAmplitude, jaggedFrequency, fixedSeed) {
        const split = viewMode === "split";
        const onlyBefore = viewMode === "before";
        const onlyAfter = viewMode === "after";
        const showBothInDiff = viewMode === "diff";
        const pathsBefore = orderedLayers.map((layer, k) => ({
            id: layer.id,
            path: createAreaPath(dataset.times.slice(left, right + 1), before.yBottom[k].slice(left, right + 1), before.yTop[k].slice(left, right + 1), xScale, yScale, {
                jagged: enableJaggedEdge,
                smoothInterpolation: true,
                interpolationSubsteps: 8,
                amplitudePx: jaggedAmplitude,
                frequency: jaggedFrequency,
                seed: `before:${layer.id}`,
                fixedSeed,
                uncertainty: layer.unc?.slice(left, right + 1)
            }),
            color: layerColor(k, layer.id)
        }));
        const pathsAfter = orderedLayers.map((layer, k) => ({
            id: layer.id,
            path: createAreaPath(dataset.times.slice(left, right + 1), after.yBottom[k].slice(left, right + 1), after.yTop[k].slice(left, right + 1), xScale, yScale, {
                jagged: enableJaggedEdge,
                smoothInterpolation: true,
                interpolationSubsteps: 8,
                amplitudePx: jaggedAmplitude,
                frequency: jaggedFrequency,
                seed: `after:${layer.id}`,
                fixedSeed,
                uncertainty: layer.unc?.slice(left, right + 1)
            }),
            color: layerColor(k, layer.id)
        }));
        this.beforeGroup
            .selectAll("path.before-band")
            .data(onlyBefore || split || showBothInDiff ? pathsBefore : [], (d) => d.id)
            .join((enter) => enter.append("path").attr("class", "before-band"), (update) => update, (exit) => exit.remove())
            .attr("d", (d) => d.path)
            .attr("fill", (d) => d.color)
            .attr("fill-opacity", split ? 0.44 : showBothInDiff ? 0.25 : 0.8)
            .attr("stroke", "#1e293b")
            .attr("stroke-opacity", showBothInDiff ? 0.35 : 0.12)
            .attr("stroke-width", 0.8);
        this.afterGroup
            .selectAll("path.after-band")
            .data(onlyAfter || split || showBothInDiff ? pathsAfter : [], (d) => d.id)
            .join((enter) => enter.append("path").attr("class", "after-band"), (update) => update, (exit) => exit.remove())
            .attr("d", (d) => d.path)
            .attr("fill", (d) => d.color)
            .attr("fill-opacity", split ? 0.78 : showBothInDiff ? 0.56 : 0.84)
            .attr("stroke", "#f8fafc")
            .attr("stroke-width", 0.8);
    }
    drawDiffAndGapSemantic(orderedLayers, dataset, before, after, left, right, xScale, yScale, viewMode, enableUncertaintyGap) {
        const showDiff = viewMode === "diff";
        const gapCount = Math.max(0, orderedLayers.length - 1);
        const data = [];
        if (showDiff) {
            for (let k = 0; k < orderedLayers.length; k += 1) {
                const b0 = before.yTop[k].slice(left, right + 1);
                const b1 = after.yTop[k].slice(left, right + 1);
                const lo = b0.map((v, i) => Math.min(v, b1[i]));
                const hi = b0.map((v, i) => Math.max(v, b1[i]));
                const magnitude = d3.max(lo, (_, i) => Math.abs(hi[i] - lo[i])) ?? 0;
                data.push({
                    key: `diff-${k}`,
                    path: createAreaPath(dataset.times.slice(left, right + 1), lo, hi, xScale, yScale, {
                        smoothInterpolation: true,
                        interpolationSubsteps: 8
                    }),
                    opacity: 0.26,
                    fill: diffColor(Math.min(1, magnitude / 3)),
                    klass: "diff-zone"
                });
            }
        }
        for (let k = 0; k < gapCount; k += 1) {
            if (!enableUncertaintyGap) {
                continue;
            }
            const meanGapPx = d3.mean(after.gapsPx[k].slice(left, right + 1)) ?? 0;
            if (meanGapPx < 0.7) {
                continue;
            }
            const gapLower = after.yTop[k].slice(left, right + 1);
            const gapUpper = after.yBottom[k + 1].slice(left, right + 1);
            const unc = dataset.times
                .slice(left, right + 1)
                .map((_, i) => boundaryUncertaintyAt(orderedLayers[k], orderedLayers[k + 1], left + i));
            const robustHigh = percentile(unc, 0.9);
            const levels = [0.9, 0.68, 0.46, 0.24];
            for (let q = 0; q < levels.length; q += 1) {
                const mid = gapLower.map((v, i) => 0.5 * (v + gapUpper[i]));
                const half = gapLower.map((v, i) => {
                    const ratio = robustHigh > 0 ? Math.sqrt(clamp01(unc[i] / robustHigh)) : 0;
                    return Math.max(0, (gapUpper[i] - v) * 0.5 * ratio * levels[q]);
                });
                const lo = mid.map((v, i) => v - half[i]);
                const hi = mid.map((v, i) => v + half[i]);
                data.push({
                    key: `unc-${k}-${q}`,
                    path: createAreaPath(dataset.times.slice(left, right + 1), lo, hi, xScale, yScale, {
                        smoothInterpolation: true,
                        interpolationSubsteps: 8
                    }),
                    opacity: 0.16 + 0.12 * q,
                    fill: "#ffffff",
                    klass: "gap-semantic"
                });
            }
        }
        this.overlayGroup
            .selectAll("path.overlay")
            .data(data, (d) => d.key)
            .join((enter) => enter.append("path").attr("class", "overlay"), (update) => update, (exit) => exit.remove())
            .attr("d", (d) => d.path)
            .attr("fill", (d) => d.fill)
            .attr("fill-opacity", (d) => d.opacity)
            .attr("stroke", (d) => (d.klass === "diff-zone" ? "rgba(124, 45, 18, 0.6)" : "rgba(51, 65, 85, 0.35)"))
            .attr("stroke-width", 0.7);
        this.overlayGroup.selectAll("line.gap-ruler").remove();
    }
}
function extentCrop(layout, left, right) {
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const row of layout.yBottom) {
        for (let t = left; t <= right; t += 1) {
            minV = Math.min(minV, row[t]);
            maxV = Math.max(maxV, row[t]);
        }
    }
    for (const row of layout.yTop) {
        for (let t = left; t <= right; t += 1) {
            minV = Math.min(minV, row[t]);
            maxV = Math.max(maxV, row[t]);
        }
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
        return [-1, 1];
    }
    if (minV === maxV) {
        return [minV - 1, maxV + 1];
    }
    return [minV, maxV];
}
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
function percentile(values, q) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
    return sorted[idx];
}
function roiBounds(length, roi) {
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
function clamp(v, low, high) {
    return Math.max(low, Math.min(high, v));
}
function formatTimeTick(value) {
    if (!Number.isFinite(value)) {
        return "";
    }
    return d3.utcFormat("%Y-%m-%d")(new Date(value));
}
