/**
 * Inset renderer for before/after/diff/split layout comparisons.
 */
import * as d3 from "d3";
import { roiBounds } from "../core/roi";
import type { BraidLayout, InsetViewMode, LayerInput, PreparedDataset, ROI, StackLayout } from "../core/types";
import { clamp01, percentile, range } from "../core/utils";
import { createAreaPath } from "./paths";
import { angleAxisLabels, drawCrosshair, formatTimeTick, layoutExtentForIndices, readChartSize } from "./chartUtils";
import { diffColor, layerColor } from "../styles/palette";
import { boundaryUncertaintyAt } from "../core/validate";

export interface InsetRenderArgs {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  before: StackLayout;
  after: BraidLayout;
  roi: ROI | null;
  viewMode: InsetViewMode;
  yZoom: number;
  enableUncertaintyGap: boolean;
  enableJaggedEdge: boolean;
  jaggedAmplitude: number;
  jaggedFrequency: number;
  fixedSeed: number;
}

export interface InsetRenderResult {
  xScale: d3.ScaleLinear<number, number> | null;
  yScale: d3.ScaleLinear<number, number> | null;
  activeTimes: number[];
  activeStartIndex: number;
}

export class InsetChart {
  private readonly width: number;
  private readonly height: number;
  private readonly margin = { top: 24, right: 16, bottom: 44, left: 52 };
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
    const size = readChartSize(svg, 1180, 300, this.margin);
    this.width = size.width;
    this.height = size.height;
    this.innerWidth = size.innerWidth;
    this.innerHeight = size.innerHeight;

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
    const {
      dataset,
      orderedLayers,
      before,
      after,
      viewMode,
      yZoom,
      enableUncertaintyGap,
      enableJaggedEdge,
      jaggedAmplitude,
      jaggedFrequency,
      fixedSeed
    } = args;
    if (dataset.times.length === 0) {
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
        .text("No time points available");
      return { xScale: null, yScale: null, activeTimes: [], activeStartIndex: 0 };
    }

    const [left, right] = roiBounds(dataset.times.length, args.roi);
    const activeTimes = dataset.times.slice(left, right + 1);
    const activeIndices = range(left, right + 1);
    const xScale = d3.scaleLinear().domain([activeTimes[0], activeTimes[activeTimes.length - 1]]).range([0, this.innerWidth]);

    const eBefore = layoutExtentForIndices(before, activeIndices);
    const eAfter = layoutExtentForIndices(after, activeIndices);
    const minV = Math.min(eBefore[0], eAfter[0]);
    const maxV = Math.max(eBefore[1], eAfter[1]);
    const center = 0.5 * (minV + maxV);
    const half = 0.5 * (maxV - minV) / Math.max(0.2, yZoom);

    const yScale = d3.scaleLinear().domain([center - half * 1.06, center + half * 1.06]).range([this.innerHeight, 0]);

    this.drawTitle(viewMode, enableUncertaintyGap, enableJaggedEdge);
    this.drawBeforeAfter(
      dataset,
      orderedLayers,
      before,
      after,
      left,
      right,
      xScale,
      yScale,
      viewMode,
      enableJaggedEdge,
      jaggedAmplitude,
      jaggedFrequency,
      fixedSeed
    );
    this.drawDiffAndGapSemantic(orderedLayers, dataset, before, after, left, right, xScale, yScale, viewMode, enableUncertaintyGap);

    this.axisX
      .attr("transform", `translate(0,${this.innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(Math.max(3, Math.floor(this.innerWidth / 160)))
          .tickFormat((value) => formatTimeTick(Number(value)))
      );
    angleAxisLabels(this.axisX);
    this.axisY.call(d3.axisLeft(yScale).ticks(6));

    return { xScale, yScale, activeTimes, activeStartIndex: left };
  }

  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number> | null): void {
    drawCrosshair(this.hoverGroup, timeValue, xScale, this.innerHeight, "#7c2d12", 0.5, "4,2");
  }

  private drawTitle(viewMode: InsetViewMode, enableUncertaintyGap: boolean, enableJaggedEdge: boolean): void {
    const modeText = viewMode.toUpperCase();
    const staticText = "interactive";
    const text = `mode=${modeText} | uncertainty-gap=${enableUncertaintyGap ? "on" : "off"} | jagged-edge=${enableJaggedEdge ? "on" : "off"} | ${staticText}`;
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
    dataset: PreparedDataset,
    orderedLayers: LayerInput[],
    before: StackLayout,
    after: StackLayout,
    left: number,
    right: number,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    viewMode: InsetViewMode,
    enableJaggedEdge: boolean,
    jaggedAmplitude: number,
    jaggedFrequency: number,
    fixedSeed: number
  ): void {
    const split = viewMode === "split";
    const onlyBefore = viewMode === "before";
    const onlyAfter = viewMode === "after";
    const showBothInDiff = viewMode === "diff";

    const pathsBefore = orderedLayers.map((layer, k) => ({
      id: layer.id,
      path: createAreaPath(
        dataset.times.slice(left, right + 1),
        before.yBottom[k].slice(left, right + 1),
        before.yTop[k].slice(left, right + 1),
        xScale,
        yScale,
        {
          jagged: enableJaggedEdge,
          smoothInterpolation: true,
          interpolationSubsteps: 8,
          amplitudePx: jaggedAmplitude,
          frequency: jaggedFrequency,
          seed: `before:${layer.id}`,
          fixedSeed,
          uncertainty: layer.unc?.slice(left, right + 1)
        }
      ),
      color: layerColor(k, layer.id)
    }));
    const pathsAfter = orderedLayers.map((layer, k) => ({
      id: layer.id,
      path: createAreaPath(
        dataset.times.slice(left, right + 1),
        after.yBottom[k].slice(left, right + 1),
        after.yTop[k].slice(left, right + 1),
        xScale,
        yScale,
        {
          jagged: enableJaggedEdge,
          smoothInterpolation: true,
          interpolationSubsteps: 8,
          amplitudePx: jaggedAmplitude,
          frequency: jaggedFrequency,
          seed: `after:${layer.id}`,
          fixedSeed,
          uncertainty: layer.unc?.slice(left, right + 1)
        }
      ),
      color: layerColor(k, layer.id)
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
    orderedLayers: LayerInput[],
    dataset: PreparedDataset,
    before: StackLayout,
    after: BraidLayout,
    left: number,
    right: number,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    viewMode: InsetViewMode,
    enableUncertaintyGap: boolean
  ): void {
    const showDiff = viewMode === "diff";
    const gapCount = Math.max(0, orderedLayers.length - 1);
    const data: Array<{ key: string; path: string; opacity: number; fill: string; klass: string }> = [];

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
      .selectAll<SVGPathElement, (typeof data)[number]>("path.overlay")
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
