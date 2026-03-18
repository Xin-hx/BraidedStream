import * as d3 from "d3";
import { computeBaseline } from "../core/baseline";
import { computeBraidLayout } from "../core/braid";
import { runInvariantChecks } from "../core/assertions";
import { computeStackedBoundaries } from "../core/stack";
import type { BaselineMode, GapMode, InvariantSummary, PreparedDataset, RenderMode, ROI, SmoothKernel } from "../core/types";
import { orderLayers, validateTimeLengths } from "../core/validate";
import { createRoiBrush, type RoiBrushController } from "../ui/brush";
import { createAreaPath } from "./paths";
import { renderUncertaintyInGaps } from "./uncertainty";

export type DemoDataset = PreparedDataset;

export interface DemoState {
  baseline: BaselineMode;
  gapMode: GapMode;
  renderMode: RenderMode;
  ROI: ROI | null;
  gapAlphaPx: number;
  maxExtraHeightPx: number;
  smoothKernel: SmoothKernel;
  assertEnabled: boolean;
  showOverlayOmega: boolean;
  showOverlaySumGap: boolean;
  showOverlaySampleGaps: boolean;
}

export interface GapRange {
  k: number;
  min: number;
  max: number;
}

export interface ChartDiagnostics {
  invariant: InvariantSummary;
  maxGapPerTimePx: number;
  minGapPerTimePx: number;
  sampleGapRanges: GapRange[];
  sampleGapIndices: number[];
  tau: number;
  hasRoiSupport: boolean;
}

interface LayerPathDatum {
  id: string;
  index: number;
  path: string;
}

export class BraidedChart {
  private readonly width: number;
  private readonly height: number;
  private readonly margin = { top: 20, right: 18, bottom: 44, left: 58 };
  private readonly innerWidth: number;
  private readonly innerHeight: number;

  private readonly svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly uncertaintyGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly layerGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly xAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly yAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly debugOverlayGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly brushGroup: d3.Selection<SVGGElement, unknown, null, undefined>;

  private readonly roiBrush: RoiBrushController;
  private debugGapIndices: number[] = [];
  private lastDiagnostics: ChartDiagnostics = {
    invariant: { checked: false, violations: [], maxThicknessError: 0 },
    maxGapPerTimePx: 0,
    minGapPerTimePx: 0,
    sampleGapRanges: [],
    sampleGapIndices: [],
    tau: 0,
    hasRoiSupport: false
  };

  constructor(
    svgElement: SVGSVGElement,
    private dataset: DemoDataset,
    private readonly state: DemoState,
    private readonly onROIChange: (roi: ROI | null) => void
  ) {
    this.validateDataset(dataset);

    this.width = Number(svgElement.getAttribute("width") ?? "1140");
    this.height = Number(svgElement.getAttribute("height") ?? "620");
    this.innerWidth = this.width - this.margin.left - this.margin.right;
    this.innerHeight = this.height - this.margin.top - this.margin.bottom;

    this.svg = d3.select(svgElement).attr("viewBox", `0 0 ${this.width} ${this.height}`);
    this.root = this.svg
      .append("g")
      .attr("transform", `translate(${this.margin.left},${this.margin.top})`);
    this.uncertaintyGroup = this.root.append("g").attr("class", "uncertainty-layer");
    this.layerGroup = this.root.append("g").attr("class", "mean-layer");
    this.yAxisGroup = this.root.append("g").attr("class", "y-axis");
    this.xAxisGroup = this.root.append("g").attr("class", "x-axis");
    this.debugOverlayGroup = this.root.append("g").attr("class", "debug-overlay");
    this.brushGroup = this.root.append("g").attr("class", "roi-brush");

    this.roiBrush = createRoiBrush(
      this.brushGroup,
      [
        [0, 0],
        [this.innerWidth, this.innerHeight]
      ],
      (roi) => this.onROIChange(roi)
    );
  }

  render(): ChartDiagnostics {
    const orderedLayers = orderLayers(this.dataset.layers, this.dataset.order);
    const baseline = computeBaseline(this.dataset.times, orderedLayers, this.state.baseline);
    const base = computeStackedBoundaries(baseline, orderedLayers);

    const provisionalYScale = this.buildYScale(extentOfLayout(base));
    let braided = computeBraidLayout({
      base,
      orderedLayers,
      roi: this.state.ROI,
      baselineMode: this.state.baseline,
      gapMode: this.state.gapMode,
      gapAlphaPx: this.state.gapAlphaPx,
      maxExtraHeightPx: this.state.maxExtraHeightPx,
      smoothKernel: this.state.smoothKernel,
      yScale: (v: number) => provisionalYScale(v)
    });

    const finalYScale = this.buildYScale(extentOfLayout(braided));
    braided = computeBraidLayout({
      base,
      orderedLayers,
      roi: this.state.ROI,
      baselineMode: this.state.baseline,
      gapMode: this.state.gapMode,
      gapAlphaPx: this.state.gapAlphaPx,
      maxExtraHeightPx: this.state.maxExtraHeightPx,
      smoothKernel: this.state.smoothKernel,
      yScale: (v: number) => finalYScale(v)
    });

    const invariant = runInvariantChecks(orderedLayers, base, braided, this.state.ROI, {
      enabled: this.state.assertEnabled,
      throwOnError: false
    });

    const timeDomain = [this.dataset.times[0], this.dataset.times[this.dataset.times.length - 1]] as [number, number];
    const xScale = d3.scaleLinear().domain(timeDomain).range([0, this.innerWidth]);

    const layerPaths: LayerPathDatum[] = orderedLayers.map((layer, index) => ({
      id: layer.id,
      index,
      path: createAreaPath(this.dataset.times, braided.yBottom[index], braided.yTop[index], xScale, finalYScale)
    }));
    this.drawLayers(layerPaths);

    renderUncertaintyInGaps({
      group: this.uncertaintyGroup,
      mode: this.state.renderMode,
      times: this.dataset.times,
      orderedLayers,
      braided,
      xScale,
      yScale: finalYScale
    });

    this.xAxisGroup
      .attr("transform", `translate(0,${this.innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.format("d")));

    this.yAxisGroup.call(d3.axisLeft(finalYScale).ticks(8));

    const debugInfo = this.drawDebugOverlays(xScale, braided);

    this.roiBrush.updateContext(this.dataset.times, xScale);
    this.roiBrush.sync(this.state.ROI);

    this.lastDiagnostics = {
      invariant,
      maxGapPerTimePx: debugInfo.maxGapPx,
      minGapPerTimePx: debugInfo.minGapPx,
      sampleGapRanges: debugInfo.sampleGapRanges,
      sampleGapIndices: debugInfo.sampleGapIndices,
      tau: braided.roiSupport?.tau ?? 0,
      hasRoiSupport: braided.roiSupport !== null
    };
    return this.lastDiagnostics;
  }

  setDataset(nextDataset: DemoDataset): void {
    this.validateDataset(nextDataset);
    this.dataset = nextDataset;
    this.debugGapIndices = [];
  }

  getDiagnostics(): ChartDiagnostics {
    return this.lastDiagnostics;
  }

  private validateDataset(dataset: DemoDataset): void {
    validateTimeLengths(dataset.times, dataset.layers);
    if (dataset.times.length < 2) {
      throw new Error("Dataset must have at least 2 time points");
    }
  }

  private buildYScale(extent: [number, number]): d3.ScaleLinear<number, number> {
    const [minV, maxV] = padExtent(extent, 0.06);
    return d3.scaleLinear().domain([minV, maxV]).range([this.innerHeight, 0]);
  }

  private drawLayers(data: LayerPathDatum[]): void {
    const selection = this.layerGroup.selectAll<SVGPathElement, LayerPathDatum>("path.mean-band").data(data, (d) => d.id);

    selection
      .join(
        (enter) => enter.append("path").attr("class", "mean-band"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => d.path)
      .attr("fill", (d) => layerColor(d.index, data.length))
      .attr("fill-opacity", 0.86)
      .attr("stroke", "#f8fafc")
      .attr("stroke-width", 0.7);
  }

  private drawDebugOverlays(
    xScale: d3.ScaleLinear<number, number>,
    braided: { omega: number[]; sumGapPx: number[]; gapsPx: number[][] }
  ): { maxGapPx: number; minGapPx: number; sampleGapRanges: GapRange[]; sampleGapIndices: number[] } {
    const sumGapPx = braided.sumGapPx;
    let maxGapPx = 0;
    let minGapPx = Number.POSITIVE_INFINITY;
    for (const v of sumGapPx) {
      maxGapPx = Math.max(maxGapPx, v);
      minGapPx = Math.min(minGapPx, v);
    }
    if (!Number.isFinite(minGapPx)) {
      minGapPx = 0;
    }

    const sampleGapIndices = this.ensureDebugGapIndices(braided.gapsPx.length);
    const sampleGapRanges = sampleGapIndices.map((k) => ({
      k,
      min: d3.min(braided.gapsPx[k]) ?? 0,
      max: d3.max(braided.gapsPx[k]) ?? 0
    }));

    const showAny = this.state.showOverlayOmega || this.state.showOverlaySumGap || this.state.showOverlaySampleGaps;
    if (!showAny) {
      this.debugOverlayGroup.selectAll("*").remove();
      return { maxGapPx, minGapPx, sampleGapRanges, sampleGapIndices };
    }

    const panelHeight = 94;
    const panelBottom = this.innerHeight - 4;
    const panelTop = panelBottom - panelHeight;
    const panelWidth = this.innerWidth;

    const series: Array<{ key: string; label: string; color: string; values: number[]; normalizeMax: number }> = [];
    if (this.state.showOverlayOmega) {
      series.push({
        key: "omega",
        label: "omega(t)",
        color: "#0ea5e9",
        values: braided.omega,
        normalizeMax: 1
      });
    }
    if (this.state.showOverlaySumGap) {
      series.push({
        key: "sumGap",
        label: "sumGap(t) px",
        color: "#f97316",
        values: sumGapPx,
        normalizeMax: Math.max(1e-6, maxGapPx)
      });
    }
    if (this.state.showOverlaySampleGaps) {
      sampleGapIndices.forEach((k, idx) => {
        const color = idx === 0 ? "#22c55e" : "#8b5cf6";
        const arr = braided.gapsPx[k] ?? [];
        const maxValue = d3.max(arr) ?? 0;
        series.push({
          key: `g-${k}`,
          label: `g[${k}](t) px`,
          color,
          values: arr,
          normalizeMax: Math.max(1e-6, maxValue)
        });
      });
    }

    const line = d3
      .line<number>()
      .x((_, i) => xScale(this.dataset.times[i]))
      .y((v) => panelBottom - v * panelHeight)
      .curve(d3.curveMonotoneX);

    const bg = this.debugOverlayGroup.selectAll<SVGRectElement, number>("rect.debug-bg").data([0]);
    bg.join((enter) => enter.append("rect").attr("class", "debug-bg"))
      .attr("x", 0)
      .attr("y", panelTop)
      .attr("width", panelWidth)
      .attr("height", panelHeight)
      .attr("fill", "rgba(15, 23, 42, 0.06)")
      .attr("stroke", "rgba(15, 23, 42, 0.25)")
      .attr("stroke-width", 0.8);

    const normalizedSeries = series.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      values: s.values.map((v) => clamp01(v / s.normalizeMax))
    }));

    const pathSel = this.debugOverlayGroup
      .selectAll<SVGPathElement, { key: string; label: string; color: string; values: number[] }>("path.debug-line")
      .data(normalizedSeries, (d) => d.key);
    pathSel
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("class", "debug-line")
            .attr("fill", "none")
            .attr("stroke-width", 1.5),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("stroke", (d) => d.color)
      .attr("d", (d) => line(d.values) ?? "");

    const labels = this.debugOverlayGroup
      .selectAll<SVGTextElement, { key: string; label: string; color: string; values: number[] }>("text.debug-label")
      .data(normalizedSeries, (d) => d.key);
    labels
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "debug-label")
            .attr("font-size", 10)
            .attr("font-weight", 600),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("x", (_, i) => 8 + i * 150)
      .attr("y", panelTop + 12)
      .attr("fill", (d) => d.color)
      .text((d) => d.label);

    return { maxGapPx, minGapPx, sampleGapRanges, sampleGapIndices };
  }

  private ensureDebugGapIndices(gapCount: number): number[] {
    if (gapCount <= 0) {
      return [];
    }
    const stillValid =
      this.debugGapIndices.length > 0 && this.debugGapIndices.every((idx) => idx >= 0 && idx < gapCount);
    if (stillValid) {
      return this.debugGapIndices;
    }
    if (gapCount === 1) {
      this.debugGapIndices = [0];
      return this.debugGapIndices;
    }
    const first = Math.floor(Math.random() * gapCount);
    let second = Math.floor(Math.random() * gapCount);
    while (second === first) {
      second = Math.floor(Math.random() * gapCount);
    }
    this.debugGapIndices = [Math.min(first, second), Math.max(first, second)];
    return this.debugGapIndices;
  }
}

function extentOfLayout(layout: { yBottom: number[][]; yTop: number[][] }): [number, number] {
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const row of layout.yBottom) {
    for (const v of row) {
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  for (const row of layout.yTop) {
    for (const v of row) {
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return [-1, 1];
  }
  if (Math.abs(maxV - minV) < 1e-9) {
    return [minV - 1, maxV + 1];
  }
  return [minV, maxV];
}

function padExtent(extent: [number, number], ratio: number): [number, number] {
  const span = extent[1] - extent[0];
  const pad = span * ratio;
  return [extent[0] - pad, extent[1] + pad];
}

function layerColor(index: number, total: number): string {
  const denom = Math.max(1, total - 1);
  return d3.interpolateRainbow(index / denom);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
