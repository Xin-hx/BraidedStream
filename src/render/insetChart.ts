import * as d3 from "d3";
import type { BraidLayout, GapSemanticMode, InsetViewMode, ROI, StackLayout } from "../core/types";
import type { DemoDataset } from "./chart";
import { createAreaPath } from "./paths";
import { diffColor, layerColor, uncertaintyColor } from "../styles/palette";
import { boundaryUncertaintyAt } from "../core/validate";

export interface InsetRenderArgs {
  dataset: DemoDataset;
  before: StackLayout;
  after: BraidLayout;
  roi: ROI | null;
  viewMode: InsetViewMode;
  semanticMode: GapSemanticMode;
  yZoom: number;
  staticMode: boolean;
}

export interface InsetRenderResult {
  xScale: d3.ScaleLinear<number, number> | null;
  roiTimes: number[];
}

export class InsetChart {
  private readonly width: number;
  private readonly height: number;
  private readonly margin = { top: 24, right: 16, bottom: 30, left: 52 };
  private readonly innerWidth: number;
  private readonly innerHeight: number;
  private readonly root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly titleGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly beforeGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly afterGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly overlayGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisY: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly hoverGroup: d3.Selection<SVGGElement, unknown, null, undefined>;

  constructor(private readonly svg: SVGSVGElement) {
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

  render(args: InsetRenderArgs): InsetRenderResult {
    const { dataset, before, after, roi, viewMode, semanticMode, yZoom, staticMode } = args;
    if (!roi) {
      this.root.selectAll("path, text, line").remove();
      this.axisX.selectAll("*").remove();
      this.axisY.selectAll("*").remove();
      this.titleGroup
        .selectAll<SVGTextElement, number>("text.title")
        .data([0])
        .join((enter) => enter.append("text").attr("class", "title"))
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "#334155")
        .text("ROI Local View (select ROI in overview)");
      return { xScale: null, roiTimes: [] };
    }

    const left = Math.max(0, roi.t0Index);
    const right = Math.min(dataset.times.length - 1, roi.t1Index);
    const roiTimes = dataset.times.slice(left, right + 1);
    const xScale = d3.scaleLinear().domain([roiTimes[0], roiTimes[roiTimes.length - 1]]).range([0, this.innerWidth]);

    const eBefore = extentCrop(before, left, right);
    const eAfter = extentCrop(after, left, right);
    const minV = Math.min(eBefore[0], eAfter[0]);
    const maxV = Math.max(eBefore[1], eAfter[1]);
    const center = 0.5 * (minV + maxV);
    const half = 0.5 * (maxV - minV) / Math.max(0.2, yZoom);

    const yScale = d3.scaleLinear().domain([center - half * 1.06, center + half * 1.06]).range([this.innerHeight, 0]);

    this.drawTitle(viewMode, staticMode, semanticMode);
    this.drawBeforeAfter(dataset, before, after, left, right, xScale, yScale, viewMode);
    this.drawDiffAndGapSemantic(dataset, before, after, left, right, xScale, yScale, viewMode, semanticMode);

    this.axisX.attr("transform", `translate(0,${this.innerHeight})`).call(d3.axisBottom(xScale).ticks(7).tickFormat(d3.format("d")));
    this.axisY.call(d3.axisLeft(yScale).ticks(6));

    return { xScale, roiTimes };
  }

  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number> | null): void {
    if (xScale === null || timeValue === null) {
      this.hoverGroup.selectAll("*").remove();
      return;
    }
    const lineSel = this.hoverGroup.selectAll<SVGLineElement, number>("line.crosshair").data([timeValue]);
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

  private drawTitle(viewMode: InsetViewMode, staticMode: boolean, semanticMode: GapSemanticMode): void {
    const modeText = viewMode.toUpperCase();
    const staticText = staticMode ? "publication/static" : "interactive";
    const text = `ROI Local View | mode=${modeText} | gap=${semanticMode} | ${staticText}`;
    this.titleGroup
      .selectAll<SVGTextElement, number>("text.title")
      .data([0])
      .join((enter) => enter.append("text").attr("class", "title"))
      .attr("x", 0)
      .attr("y", -6)
      .attr("fill", "#0f172a")
      .attr("font-weight", 700)
      .attr("font-size", 12)
      .text(text);
  }

  private drawBeforeAfter(
    dataset: DemoDataset,
    before: StackLayout,
    after: StackLayout,
    left: number,
    right: number,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    viewMode: InsetViewMode
  ): void {
    const split = viewMode === "split";
    const onlyBefore = viewMode === "before";
    const onlyAfter = viewMode === "after";
    const showBothInDiff = viewMode === "diff";

    const pathsBefore = dataset.layers.map((layer, k) => ({
      id: layer.id,
      path: createAreaPath(dataset.times.slice(left, right + 1), before.yBottom[k].slice(left, right + 1), before.yTop[k].slice(left, right + 1), xScale, yScale),
      color: layerColor(k)
    }));
    const pathsAfter = dataset.layers.map((layer, k) => ({
      id: layer.id,
      path: createAreaPath(dataset.times.slice(left, right + 1), after.yBottom[k].slice(left, right + 1), after.yTop[k].slice(left, right + 1), xScale, yScale),
      color: layerColor(k)
    }));

    this.beforeGroup
      .selectAll<SVGPathElement, (typeof pathsBefore)[number]>("path.before-band")
      .data(onlyBefore || split || showBothInDiff ? pathsBefore : [], (d) => d.id)
      .join((enter) => enter.append("path").attr("class", "before-band"), (update) => update, (exit) => exit.remove())
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", split ? 0.44 : showBothInDiff ? 0.25 : 0.8)
      .attr("stroke", "#1e293b")
      .attr("stroke-opacity", showBothInDiff ? 0.35 : 0.12)
      .attr("stroke-width", 0.8);

    this.afterGroup
      .selectAll<SVGPathElement, (typeof pathsAfter)[number]>("path.after-band")
      .data(onlyAfter || split || showBothInDiff ? pathsAfter : [], (d) => d.id)
      .join((enter) => enter.append("path").attr("class", "after-band"), (update) => update, (exit) => exit.remove())
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", split ? 0.78 : showBothInDiff ? 0.56 : 0.84)
      .attr("stroke", "#f8fafc")
      .attr("stroke-width", 0.8);
  }

  private drawDiffAndGapSemantic(
    dataset: DemoDataset,
    before: StackLayout,
    after: BraidLayout,
    left: number,
    right: number,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    viewMode: InsetViewMode,
    semanticMode: GapSemanticMode
  ): void {
    const showDiff = viewMode === "diff";
    const gapCount = Math.max(0, dataset.layers.length - 1);
    const data: Array<{ key: string; path: string; opacity: number; fill: string; klass: string }> = [];

    if (showDiff) {
      for (let k = 0; k < dataset.layers.length; k += 1) {
        const b0 = before.yTop[k].slice(left, right + 1);
        const b1 = after.yTop[k].slice(left, right + 1);
        const lo = b0.map((v, i) => Math.min(v, b1[i]));
        const hi = b0.map((v, i) => Math.max(v, b1[i]));
        const magnitude = d3.max(lo, (_, i) => Math.abs(hi[i] - lo[i])) ?? 0;
        data.push({
          key: `diff-${k}`,
          path: createAreaPath(dataset.times.slice(left, right + 1), lo, hi, xScale, yScale),
          opacity: 0.26,
          fill: diffColor(Math.min(1, magnitude / 3)),
          klass: "diff-zone"
        });
      }
    }

    for (let k = 0; k < gapCount; k += 1) {
      const gapLower = after.yTop[k].slice(left, right + 1);
      const gapUpper = after.yBottom[k + 1].slice(left, right + 1);
      const unc = dataset.times.slice(left, right + 1).map((_, i) => boundaryUncertaintyAt(dataset.layers[k], dataset.layers[k + 1], left + i));
      const maxUnc = d3.max(unc) ?? 1;
      const meanUnc = (d3.mean(unc) ?? 0) / Math.max(1e-9, maxUnc);

      if (semanticMode === "uncBand") {
        const mid = gapLower.map((v, i) => 0.5 * (v + gapUpper[i]));
        const half = gapLower.map((v, i) => Math.max(0, (gapUpper[i] - v) * 0.5 * (unc[i] / Math.max(1e-9, maxUnc))));
        const lo = mid.map((v, i) => v - half[i]);
        const hi = mid.map((v, i) => v + half[i]);
        data.push({
          key: `unc-${k}`,
          path: createAreaPath(dataset.times.slice(left, right + 1), lo, hi, xScale, yScale),
          opacity: 0.58,
          fill: uncertaintyColor(meanUnc),
          klass: "gap-semantic"
        });
      } else {
        data.push({
          key: `gap-${k}`,
          path: createAreaPath(dataset.times.slice(left, right + 1), gapLower, gapUpper, xScale, yScale),
          opacity: semanticMode === "heatStrip" ? 0.35 : 0.18,
          fill: semanticMode === "heatStrip" ? diffColor(meanUnc) : "#334155",
          klass: "gap-semantic"
        });
      }
    }

    this.overlayGroup
      .selectAll<SVGPathElement, (typeof data)[number]>("path.overlay")
      .data(data, (d) => d.key)
      .join((enter) => enter.append("path").attr("class", "overlay"), (update) => update, (exit) => exit.remove())
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.fill)
      .attr("fill-opacity", (d) => d.opacity)
      .attr("stroke", (d) => (d.klass === "diff-zone" ? "rgba(124, 45, 18, 0.6)" : "rgba(51, 65, 85, 0.35)"))
      .attr("stroke-width", 0.7)
      .attr("stroke-dasharray", (d) => (semanticMode === "hatch" && d.klass === "gap-semantic" ? "2,2" : null));

    if (semanticMode === "ruler") {
      const ticks = [] as Array<{ x: number; y0: number; y1: number }>;
      const times = dataset.times.slice(left, right + 1);
      for (let i = 0; i < times.length; i += Math.max(1, Math.floor(times.length / 14))) {
        for (let k = 0; k < gapCount; k += 1) {
          ticks.push({ x: xScale(times[i]), y0: yScale(after.yTop[k][left + i]), y1: yScale(after.yBottom[k + 1][left + i]) });
        }
      }
      this.overlayGroup
        .selectAll<SVGLineElement, (typeof ticks)[number]>("line.gap-ruler")
        .data(ticks)
        .join((enter) => enter.append("line").attr("class", "gap-ruler"), (update) => update, (exit) => exit.remove())
        .attr("x1", (d) => d.x)
        .attr("x2", (d) => d.x)
        .attr("y1", (d) => d.y0)
        .attr("y2", (d) => d.y1)
        .attr("stroke", "rgba(51,65,85,0.45)")
        .attr("stroke-width", 0.8);
    } else {
      this.overlayGroup.selectAll("line.gap-ruler").remove();
    }
  }
}

function extentCrop(layout: StackLayout, left: number, right: number): [number, number] {
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
