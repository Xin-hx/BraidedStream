/**
 * Streamgraph chart views and shared SVG infrastructure.
 *
 * Merged from chartUtils, mainChart, overviewChart, contourBoxplotChart, and insetChart.
 * Keeps only the necessary, most concise, most elegant implementation.
 *
 * Sections:
 *   1. Interfaces & types
 *   2. Chart infrastructure (frame, axes, title, extents, ROI, crosshair, hover)
 *   3. MainChart
 *   4. OverviewChart
 *   5. ContourBoxplotChart
 *   6. InsetChart
 */
import * as d3 from "d3";
import { computeContourPid } from "../core/ordering/pid";
import { roiBounds } from "../interactions/roi";
import type {
  InsetViewMode,
  LayerInput,
  PidUncertaintySource,
  PreparedDataset,
  ROI,
  StackLayout
} from "../core/types";
import { clamp, clamp01, percentile, range } from "../core/utils";
import { createAreaPath } from "./paths";
import { diffColor, layerColor } from "../styles/palette";
import { createRoiBrush, type RoiBrushController } from "../interactions/brush";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Interfaces & types
// ═══════════════════════════════════════════════════════════════════════════════

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

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlotContext {
  size: ChartSize;
  plotArea: PlotArea;
  root: d3.Selection<SVGGElement, unknown, null, undefined>;
  innerWidth: number;
  innerHeight: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Chart infrastructure
// ═══════════════════════════════════════════════════════════════════════════════

/** Initialize a plot context: read SVG dimensions, set viewBox, create translated root group. */
export function createPlotContext(
  svg: SVGSVGElement,
  fallbackWidth: number,
  fallbackHeight: number,
  margin: ChartMargin
): PlotContext {
  const width = Number(svg.getAttribute("width") ?? String(fallbackWidth));
  const height = Number(svg.getAttribute("height") ?? String(fallbackHeight));
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  d3.select(svg).attr("viewBox", `0 0 ${width} ${height}`);
  const root = d3
    .select(svg)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  return {
    size: { width, height, margin, innerWidth, innerHeight },
    plotArea: { left: margin.left, top: margin.top, width: innerWidth, height: innerHeight },
    root,
    innerWidth,
    innerHeight
  };
}

// ── axes ──────────────────────────────────────────────────────────────────────

function formatTimeTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  return d3.utcFormat("%Y-%m-%d")(new Date(value));
}

function angleAxisLabels(
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

export function renderTimeAxis(
  axisGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
  density = 140
): void {
  axisGroup
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(4, Math.floor(innerWidth / density)))
        .tickFormat((v) => formatTimeTick(Number(v)))
    );
  angleAxisLabels(axisGroup);
}

export function renderValueAxis(
  axisGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  yScale: d3.ScaleLinear<number, number>,
  tickCount: number,
  tickFormat?: (value: number) => string
): void {
  const axis = d3.axisLeft(yScale).ticks(tickCount);
  if (tickFormat) axis.tickFormat((v) => tickFormat(Number(v)));
  axisGroup.call(axis);
}

// ── title ─────────────────────────────────────────────────────────────────────

export function renderChartTitle(
  titleGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  text: string,
  options?: { x?: number; y?: number; fill?: string; fontSize?: number; fontWeight?: number }
): void {
  titleGroup
    .selectAll<SVGTextElement, number>("text.chart-title")
    .data([0])
    .join((enter) => enter.append("text").attr("class", "chart-title"))
    .attr("x", options?.x ?? 0)
    .attr("y", options?.y ?? -6)
    .attr("fill", options?.fill ?? "#0f172a")
    .attr("font-size", options?.fontSize ?? 12)
    .attr("font-weight", options?.fontWeight ?? 700)
    .text(text);
}

// ── extent helpers ────────────────────────────────────────────────────────────

export function layoutExtent(layout: StackLayout): [number, number] {
  return layoutExtentForIndices(layout, range(0, layout.baseline.length));
}

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
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [-1, 1];
  if (minValue === maxValue) return [minValue - 1, maxValue + 1];
  return [minValue, maxValue];
}

// ── ROI viewport ──────────────────────────────────────────────────────────────

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

// ── crosshair ─────────────────────────────────────────────────────────────────

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
    .join(
      (enter) => enter.append("line").attr("class", "crosshair"),
      (update) => update,
      (exit) => exit.remove()
    )
    .attr("x1", (v) => (xScale ? xScale(v) : 0))
    .attr("x2", (v) => (xScale ? xScale(v) : 0))
    .attr("y1", 0)
    .attr("y2", height)
    .attr("stroke", stroke)
    .attr("stroke-opacity", strokeOpacity)
    .attr("stroke-dasharray", dashArray);
}

// ── layer hover ───────────────────────────────────────────────────────────────

export interface LayerHoverDatum {
  id: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
}

interface LayerHoverHighlightOptions {
  dimFillOpacity: number;
  dimStrokeOpacity: number;
  hoverFillBoost: number;
  hoverStroke: string;
  hoverStrokeOpacity: number;
  hoverStrokeWidthFactor: number;
}

export function applyLayerHoverHighlight<T extends LayerHoverDatum>(
  selection: d3.Selection<SVGPathElement, T, SVGGElement, unknown>,
  layerId: string | null,
  options: LayerHoverHighlightOptions
): void {
  let hasHoveredDatum = false;
  if (layerId !== null) {
    selection.each((d) => {
      if (d.id === layerId) hasHoveredDatum = true;
    });
  }
  const hasHover = layerId !== null && hasHoveredDatum;
  selection
    .attr("fill-opacity", (d) =>
      hasHover ? (d.id === layerId ? Math.min(1, d.fillOpacity + options.hoverFillBoost) : options.dimFillOpacity) : d.fillOpacity
    )
    .attr("stroke", (d) => (hasHover && d.id === layerId ? options.hoverStroke : d.stroke))
    .attr("stroke-opacity", (d) =>
      hasHover ? (d.id === layerId ? options.hoverStrokeOpacity : options.dimStrokeOpacity) : d.strokeOpacity
    )
    .attr("stroke-width", (d) =>
      hasHover && d.id === layerId
        ? Math.max(d.strokeWidth * options.hoverStrokeWidthFactor, d.strokeWidth + 0.8)
        : d.strokeWidth
    )
    .classed("is-hover-muted", (d) => hasHover && d.id !== layerId)
    .classed("is-hover-focused", (d) => hasHover && d.id === layerId);

  if (hasHover) selection.filter((d) => d.id === layerId).raise();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MainChart
// ═══════════════════════════════════════════════════════════════════════════════

interface MainBandDatum {
  id: string;
  path: string;
  color: string;
}

export interface MainChartRenderArgs {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  layout: StackLayout;
  roi: ROI | null;
  insetRoi: ROI | null;
  onInsetRoiChange: (roi: ROI | null) => void;
}

export interface MainChartRenderResult {
  xScale: d3.ScaleLinear<number, number>;
  yScale: d3.ScaleLinear<number, number>;
  plotArea: PlotArea;
}

export class MainChart {
  private readonly margin = { top: 22, right: 16, bottom: 44, left: 52 };
  private readonly ctx: PlotContext;

  private readonly layersGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly roiGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly insetRoiGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly insetBrushGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly hoverGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisY: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly insetBrush: RoiBrushController;
  private lastOnInsetRoiChange: ((roi: ROI | null) => void) | null = null;

  constructor(private readonly svg: SVGSVGElement) {
    this.ctx = createPlotContext(svg, 1180, 360, this.margin);

    this.layersGroup = this.ctx.root.append("g").attr("class", "main-layers");
    this.roiGroup = this.ctx.root.append("g").attr("class", "main-roi");
    this.insetRoiGroup = this.ctx.root.append("g").attr("class", "main-inset-roi");
    this.insetBrushGroup = this.ctx.root.append("g").attr("class", "main-inset-brush");
    this.hoverGroup = this.ctx.root.append("g").attr("class", "main-hover");
    this.axisX = this.ctx.root.append("g").attr("class", "x-axis");
    this.axisY = this.ctx.root.append("g").attr("class", "y-axis");

    this.insetBrush = createRoiBrush(
      this.insetBrushGroup,
      [
        [0, 0],
        [this.ctx.innerWidth, this.ctx.innerHeight]
      ],
      (roi) => this.lastOnInsetRoiChange?.(roi)
    );
  }

  render(args: MainChartRenderArgs): MainChartRenderResult {
    const { dataset, orderedLayers, layout, insetRoi, onInsetRoiChange } = args;
    const { innerWidth, innerHeight } = this.ctx;

    // Scales
    const [left, right] = roiBounds(dataset.times.length, args.roi);
    const xScale = d3
      .scaleLinear()
      .domain([dataset.times[left], dataset.times[right]])
      .range([0, innerWidth]);

    const extent = layoutExtent(layout);
    const yPad = (extent[1] - extent[0]) * 0.04;
    const yScale = d3
      .scaleLinear()
      .domain([extent[0] - yPad, extent[1] + yPad])
      .range([innerHeight, 0]);

    // Layer bands
    const sliceArgs = [Math.min(left, right), Math.max(left, right) + 1] as const;
    const paths: MainBandDatum[] = orderedLayers.map((layer, k) => ({
      id: layer.id,
      path: createAreaPath(
        dataset.times.slice(...sliceArgs),
        layout.yBottom[k].slice(...sliceArgs),
        layout.yTop[k].slice(...sliceArgs),
        xScale,
        yScale,
        { smoothInterpolation: true, interpolationSubsteps: 8 }
      ),
      color: layerColor(k, layer)
    }));

    this.layersGroup
      .selectAll<SVGPathElement, MainBandDatum>("path.main-band")
      .data(paths, (d) => d.id)
      .join(
        (enter) => enter.append("path").attr("class", "main-band"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.83)
      .attr("stroke", "#f8fafc")
      .attr("stroke-width", 0.7);

    // ROI overlays
    this.roiGroup.selectAll("*").remove();
    this.drawInsetRoi(insetRoi, dataset.times, xScale);
    this.lastOnInsetRoiChange = onInsetRoiChange;
    this.insetBrush.updateContext(dataset.times, xScale);
    this.insetBrush.sync(insetRoi);

    // Axes
    renderTimeAxis(this.axisX, xScale, innerWidth, innerHeight);
    renderValueAxis(this.axisY, yScale, 7);

    return { xScale, yScale, plotArea: this.ctx.plotArea };
  }

  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number>): void {
    drawCrosshair(this.hoverGroup, timeValue, xScale, this.ctx.innerHeight, "#0f172a", 0.45, "4,3");
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private drawInsetRoi(roi: ROI | null, times: number[], xScale: d3.ScaleLinear<number, number>): void {
    if (!roi || times.length === 0) {
      this.insetRoiGroup.selectAll("*").remove();
      return;
    }
    const [x0, x1] = roiXRange(roi, times, xScale, this.ctx.innerWidth);
    const width = Math.max(1, x1 - x0);

    this.insetRoiGroup
      .selectAll<SVGRectElement, number>("rect.inset-roi")
      .data([0])
      .join((enter) => enter.append("rect").attr("class", "inset-roi"))
      .attr("x", x0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", this.ctx.innerHeight)
      .attr("fill", "rgba(180, 83, 9, 0.14)")
      .attr("stroke", "#b45309")
      .attr("stroke-width", 1.2);

    this.insetRoiGroup
      .selectAll<SVGTextElement, number>("text.inset-roi-tag")
      .data([0])
      .join((enter) => enter.append("text").attr("class", "inset-roi-tag"))
      .attr("x", x0 + 6)
      .attr("y", 28)
      .attr("fill", "#7c2d12")
      .attr("font-size", 11)
      .attr("font-weight", 700)
      .text("Inset ROI");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. OverviewChart
// ═══════════════════════════════════════════════════════════════════════════════

export interface OverviewRenderArgs {
  dataset: PreparedDataset;
  roi: ROI | null;
  onRoiChange: (roi: ROI | null) => void;
}

export interface OverviewRenderResult {
  xScale: d3.ScaleLinear<number, number>;
  plotArea: PlotArea;
}

export class OverviewChart {
  private readonly margin = { top: 10, right: 12, bottom: 34, left: 52 };
  private readonly ctx: PlotContext;
  private readonly trendGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly brushGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly roiBrush: RoiBrushController;
  private lastOnRoiChange: ((roi: ROI | null) => void) | null = null;

  constructor(private readonly svg: SVGSVGElement) {
    this.ctx = createPlotContext(svg, 1180, 118, this.margin);

    this.trendGroup = this.ctx.root.append("g").attr("class", "overview-trend");
    this.brushGroup = this.ctx.root.append("g").attr("class", "overview-brush");
    this.axisX = this.ctx.root.append("g").attr("class", "x-axis");

    this.roiBrush = createRoiBrush(
      this.brushGroup,
      [
        [0, 0],
        [this.ctx.innerWidth, this.ctx.innerHeight]
      ],
      (roi) => this.lastOnRoiChange?.(roi),
      "brush end"
    );
  }

  render(args: OverviewRenderArgs): OverviewRenderResult {
    const { dataset, roi, onRoiChange } = args;
    const { innerWidth, innerHeight } = this.ctx;

    const xScale = d3
      .scaleLinear()
      .domain([dataset.times[0], dataset.times[dataset.times.length - 1]])
      .range([0, innerWidth]);

    const totals = dataset.times.map((_, t) => d3.sum(dataset.layers, (l) => l.height[t]) ?? 0);
    const yMax = d3.max(totals) ?? 1;
    const yScale = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0]);

    const area = d3
      .area<number>()
      .x((_, i) => xScale(dataset.times[i]))
      .y0(innerHeight)
      .y1((v) => yScale(v))
      .curve(d3.curveLinear);

    this.trendGroup
      .selectAll<SVGPathElement, number[]>("path.overview-area")
      .data([totals])
      .join((enter) => enter.append("path").attr("class", "overview-area"))
      .attr("d", (d) => area(d) ?? "")
      .attr("fill", "rgba(15, 118, 110, 0.23)")
      .attr("stroke", "#0f766e")
      .attr("stroke-width", 1);

    renderTimeAxis(this.axisX, xScale, innerWidth, innerHeight);

    this.lastOnRoiChange = onRoiChange;
    this.roiBrush.updateContext(dataset.times, xScale);
    this.roiBrush.sync(roi);

    return { xScale, plotArea: this.ctx.plotArea };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ContourBoxplotChart
// ═══════════════════════════════════════════════════════════════════════════════

interface Envelope {
  times: number[];
  low: number[];
  high: number[];
}

interface ContourBand {
  key: string;
  label: string;
  env: Envelope;
  fill: string;
  opacity: number;
  stroke: string;
}

export interface ContourBoxplotRenderArgs {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  roi: ROI | null;
  uncertaintySource: PidUncertaintySource;
  yBins: number;
  contourThreshold: number;
  centralFraction: number;
  opacity: number;
}

export class ContourBoxplotChart {
  private readonly margin = { top: 26, right: 18, bottom: 40, left: 52 };
  private readonly ctx: PlotContext;
  private readonly plotGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly titleGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisY: d3.Selection<SVGGElement, unknown, null, undefined>;

  constructor(private readonly svg: SVGSVGElement) {
    this.ctx = createPlotContext(svg, 1180, 190, this.margin);
    this.plotGroup = this.ctx.root.append("g").attr("class", "contour-boxplot-layers");
    this.titleGroup = this.ctx.root.append("g").attr("class", "contour-boxplot-title");
    this.axisX = this.ctx.root.append("g").attr("class", "x-axis");
    this.axisY = this.ctx.root.append("g").attr("class", "y-axis");
  }

  clear(): void {
    this.plotGroup.selectAll("*").remove();
    this.titleGroup.selectAll("*").remove();
    this.axisX.selectAll("*").remove();
    this.axisY.selectAll("*").remove();
  }

  render(args: ContourBoxplotRenderArgs): void {
    const { dataset, orderedLayers } = args;
    if (dataset.times.length === 0 || orderedLayers.length === 0) {
      this.clear();
      return;
    }

    const { innerWidth, innerHeight } = this.ctx;
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

    const xScale = d3
      .scaleLinear()
      .domain([activeTimes[0], activeTimes[activeTimes.length - 1]])
      .range([0, innerWidth]);

    const yScale = d3
      .scaleLinear()
      .domain([pid.grid.zMin, pid.grid.zMax])
      .range([innerHeight, 0]);

    // Three envelope bands (back to front)
    const bands: ContourBand[] = [
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

    const deepestEnv = envelopeFromMask(pid.deepestMask, pid.grid, dataset.times, left, right, threshold);

    // Envelope bands
    this.plotGroup
      .selectAll<SVGPathElement, ContourBand>("path.contour-boxplot-band")
      .data(bands.filter((b) => b.env.times.length > 1), (d) => d.key)
      .join(
        (enter) => enter.append("path").attr("class", "contour-boxplot-band"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) =>
        createAreaPath(d.env.times, d.env.low, d.env.high, xScale, yScale, { smoothInterpolation: true })
      )
      .attr("fill", (d) => d.fill)
      .attr("fill-opacity", (d) => d.opacity)
      .attr("stroke", (d) => d.stroke)
      .attr("stroke-width", 1);

    // Deepest-layer overlay
    this.drawDeepestMember(deepestEnv, xScale, yScale, opacity);

    // Annotation
    this.drawLegend(bands, pid.deepestLayerId, opacity);
    renderChartTitle(
      this.titleGroup,
      `PID contour boxplot | source=${args.uncertaintySource} | top=${(centralFraction * 100).toFixed(0)}% | threshold=${threshold.toFixed(2)} | yBins=${yBins} | deepest=${pid.deepestLayerId ? pid.deepestLayerId.split("|")[0] : "N/A"}`,
      { y: -8 }
    );

    // Axes
    renderTimeAxis(this.axisX, xScale, innerWidth, innerHeight, 170);
    renderValueAxis(this.axisY, yScale, 4, (v) =>
      formatContourValue(v, pid.grid.valueTransform, args.uncertaintySource)
    );
  }

  // ── private ──────────────────────────────────────────────────────────────────

  private drawDeepestMember(
    env: Envelope,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    opacity: number
  ): void {
    const line = d3
      .line<number>()
      .x((_d, i) => xScale(env.times[i]))
      .y((d) => yScale(d))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const data =
      env.times.length > 1
        ? [
            { key: "deepest-low", values: env.low },
            { key: "deepest-high", values: env.high }
          ]
        : [];

    this.plotGroup
      .selectAll<SVGPathElement, (typeof data)[number]>("path.contour-boxplot-deepest")
      .data(data, (d) => d.key)
      .join(
        (enter) => enter.append("path").attr("class", "contour-boxplot-deepest"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => line(d.values) ?? "")
      .attr("fill", "none")
      .attr("stroke", "#be123c")
      .attr("stroke-opacity", 0.88 * opacity)
      .attr("stroke-width", 1.7);
  }

  private drawLegend(bands: ContourBand[], deepestLayerId: string | null, opacity: number): void {
    const items = [
      ...bands.map((b) => ({ key: b.key, label: b.label, color: b.fill, opacity: b.opacity })),
      {
        key: "deepest",
        label: `deepest ${deepestLayerId ? deepestLayerId.split("|")[0] : "N/A"}`,
        color: "#be123c",
        opacity: 0.9 * opacity
      }
    ];

    const legend = this.plotGroup
      .selectAll<SVGGElement, (typeof items)[number]>("g.contour-boxplot-legend-item")
      .data(items, (d) => d.key)
      .join(
        (enter) => {
          const g = enter.append("g").attr("class", "contour-boxplot-legend-item");
          g.append("rect");
          g.append("text");
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("transform", (_d, i) => `translate(${i * 178},${this.ctx.innerHeight + 33})`);

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
}

// ── ContourBoxplotChart helpers ────────────────────────────────────────────────

function envelopeFromMask(
  mask: Float32Array,
  grid: { xBins: number; yBins: number; zMin: number; zMax: number },
  times: number[],
  left: number,
  right: number,
  threshold: number
): Envelope {
  const dz = grid.yBins <= 1 ? 1 : (grid.zMax - grid.zMin) / (grid.yBins - 1);
  const out: Envelope = { times: [], low: [], high: [] };

  for (let t = left; t <= right; t += 1) {
    let low: number | null = null;
    let high: number | null = null;
    for (let y = 0; y < grid.yBins; y += 1) {
      const value = mask[y * grid.xBins + t] ?? 0;
      if (value < threshold) continue;
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

function formatContourValue(value: number, transform: "log1p" | "linear", source: PidUncertaintySource): string {
  const raw = transform === "linear" ? value : Math.expm1(value);
  if (!Number.isFinite(raw)) return "";
  if (source === "poportion") {
    const pct = raw * 100;
    return `${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
  }
  if (Math.abs(raw) >= 1_000_000) return `${(raw / 1_000_000).toFixed(1)}M`;
  if (Math.abs(raw) >= 1_000) return `${(raw / 1_000).toFixed(0)}K`;
  return raw.toFixed(raw >= 10 ? 0 : 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. InsetChart
// ═══════════════════════════════════════════════════════════════════════════════

interface InsetBandDatum extends LayerHoverDatum {
  path: string;
  color: string;
}

export interface InsetRenderArgs {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  before: StackLayout;
  after: StackLayout;
  roi: ROI | null;
  viewMode: InsetViewMode;
  yZoom: number;
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
  plotArea: PlotArea;
}

export class InsetChart {
  private readonly margin = { top: 24, right: 16, bottom: 44, left: 52 };
  private readonly ctx: PlotContext;

  private readonly titleGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly beforeGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly afterGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly overlayGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisY: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly hoverGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private hoveredLayerId: string | null = null;

  constructor(private readonly svg: SVGSVGElement) {
    this.ctx = createPlotContext(svg, 1180, 300, this.margin);

    this.titleGroup = this.ctx.root.append("g").attr("class", "inset-title");
    this.beforeGroup = this.ctx.root.append("g").attr("class", "inset-before");
    this.afterGroup = this.ctx.root.append("g").attr("class", "inset-after");
    this.overlayGroup = this.ctx.root.append("g").attr("class", "inset-overlay");
    this.hoverGroup = this.ctx.root.append("g").attr("class", "inset-hover");
    this.axisX = this.ctx.root.append("g").attr("class", "x-axis");
    this.axisY = this.ctx.root.append("g").attr("class", "y-axis");
  }

  render(args: InsetRenderArgs): InsetRenderResult {
    const {
      dataset, orderedLayers, before, after, viewMode, yZoom,
      enableJaggedEdge, jaggedAmplitude, jaggedFrequency, fixedSeed
    } = args;

    if (dataset.times.length === 0) {
      this.ctx.root.selectAll("path, text, line").remove();
      this.axisX.selectAll("*").remove();
      this.axisY.selectAll("*").remove();
      renderChartTitle(this.titleGroup, "No time points available", { y: 0, fill: "#334155" });
      return { xScale: null, yScale: null, activeTimes: [], activeStartIndex: 0, plotArea: this.ctx.plotArea };
    }

    const { innerWidth, innerHeight } = this.ctx;
    const [left, right] = roiBounds(dataset.times.length, args.roi);
    const activeTimes = dataset.times.slice(left, right + 1);
    const activeIndices = range(left, right + 1);

    // Scales
    const xScale = d3
      .scaleLinear()
      .domain([activeTimes[0], activeTimes[activeTimes.length - 1]])
      .range([0, innerWidth]);

    const eBefore = layoutExtentForIndices(before, activeIndices);
    const eAfter = layoutExtentForIndices(after, activeIndices);
    const center = 0.5 * (Math.min(eBefore[0], eAfter[0]) + Math.max(eBefore[1], eAfter[1]));
    const half = 0.5 * (Math.max(eBefore[1], eAfter[1]) - Math.min(eBefore[0], eAfter[0])) / Math.max(0.2, yZoom);
    const yScale = d3
      .scaleLinear()
      .domain([center - half * 1.06, center + half * 1.06])
      .range([innerHeight, 0]);

    // Title
    renderChartTitle(
      this.titleGroup,
      `mode=${viewMode.toUpperCase()} | jagged-edge=${enableJaggedEdge ? "on" : "off"} | interactive`
    );

    // Layer bands
    this.drawBeforeAfter(
      dataset, orderedLayers, before, after,
      left, right, xScale, yScale, viewMode,
      enableJaggedEdge, jaggedAmplitude, jaggedFrequency, fixedSeed
    );

    this.drawDiffOverlay(
      orderedLayers, dataset, before, after,
      left, right, xScale, yScale, viewMode
    );

    this.applyLayerHover();

    // Axes
    renderTimeAxis(this.axisX, xScale, innerWidth, innerHeight, 160);
    renderValueAxis(this.axisY, yScale, 6);

    return { xScale, yScale, activeTimes, activeStartIndex: left, plotArea: this.ctx.plotArea };
  }

  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number> | null): void {
    drawCrosshair(this.hoverGroup, timeValue, xScale, this.ctx.innerHeight, "#7c2d12", 0.5, "4,2");
  }

  setLayerHover(layerId: string | null): void {
    if (this.hoveredLayerId === layerId) return;
    this.hoveredLayerId = layerId;
    this.applyLayerHover();
  }

  // ── private ──────────────────────────────────────────────────────────────────

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
    const TIMES_SLICE = [left, right + 1] as const;

    const buildPath = (layout: StackLayout, layer: LayerInput, k: number, seed: string): string =>
      createAreaPath(
        dataset.times.slice(...TIMES_SLICE),
        layout.yBottom[k].slice(...TIMES_SLICE),
        layout.yTop[k].slice(...TIMES_SLICE),
        xScale,
        yScale,
        {
          jagged: enableJaggedEdge,
          smoothInterpolation: true,
          interpolationSubsteps: 8,
          amplitudePx: jaggedAmplitude,
          frequency: jaggedFrequency,
          seed,
          fixedSeed,
          uncertainty: layer.unc?.slice(left, right + 1)
        }
      );

    const split = viewMode === "split";
    const onlyBefore = viewMode === "before";
    const onlyAfter = viewMode === "after";
    const showBothInDiff = viewMode === "diff";

    const beforeFillOpacity = split ? 0.44 : showBothInDiff ? 0.25 : 0.8;
    const beforeStrokeOpacity = showBothInDiff ? 0.35 : 0.12;
    const afterFillOpacity = split ? 0.78 : showBothInDiff ? 0.56 : 0.84;

    const shouldShowBefore = onlyBefore || split || showBothInDiff;
    const shouldShowAfter = onlyAfter || split || showBothInDiff;

    // Before paths
    const pathsBefore: InsetBandDatum[] = shouldShowBefore
      ? orderedLayers.map((layer, k) => ({
          id: layer.id,
          path: buildPath(before, layer, k, `before:${layer.id}`),
          color: layerColor(k, layer),
          fillOpacity: beforeFillOpacity,
          stroke: "#1e293b",
          strokeOpacity: beforeStrokeOpacity,
          strokeWidth: 0.8
        }))
      : [];

    this.beforeGroup
      .selectAll<SVGPathElement, InsetBandDatum>("path.before-band")
      .data(pathsBefore, (d) => d.id)
      .join(
        (enter) => enter.append("path").attr("class", "before-band"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", (d) => d.fillOpacity)
      .attr("stroke", (d) => d.stroke)
      .attr("stroke-opacity", (d) => d.strokeOpacity)
      .attr("stroke-width", (d) => d.strokeWidth);

    // After paths
    const pathsAfter: InsetBandDatum[] = shouldShowAfter
      ? orderedLayers.map((layer, k) => ({
          id: layer.id,
          path: buildPath(after, layer, k, `after:${layer.id}`),
          color: layerColor(k, layer),
          fillOpacity: afterFillOpacity,
          stroke: "#f8fafc",
          strokeOpacity: 1,
          strokeWidth: 0.8
        }))
      : [];

    this.afterGroup
      .selectAll<SVGPathElement, InsetBandDatum>("path.after-band")
      .data(pathsAfter, (d) => d.id)
      .join(
        (enter) => enter.append("path").attr("class", "after-band"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", (d) => d.fillOpacity)
      .attr("stroke", (d) => d.stroke)
      .attr("stroke-opacity", (d) => d.strokeOpacity)
      .attr("stroke-width", (d) => d.strokeWidth);
  }

  private applyLayerHover(): void {
    const opts = {
      dimFillOpacity: 0.2,
      dimStrokeOpacity: 0.06,
      hoverFillBoost: 0.16,
      hoverStroke: "#0f172a",
      hoverStrokeOpacity: 0.88,
      hoverStrokeWidthFactor: 2.2
    };
    applyLayerHoverHighlight(
      this.beforeGroup.selectAll<SVGPathElement, InsetBandDatum>("path.before-band"),
      this.hoveredLayerId,
      { ...opts, dimFillOpacity: 0.14 }
    );
    applyLayerHoverHighlight(
      this.afterGroup.selectAll<SVGPathElement, InsetBandDatum>("path.after-band"),
      this.hoveredLayerId,
      opts
    );
    this.overlayGroup.attr("opacity", this.hoveredLayerId ? 0.45 : 1);
  }

  private drawDiffOverlay(
    orderedLayers: LayerInput[],
    dataset: PreparedDataset,
    before: StackLayout,
    after: StackLayout,
    left: number,
    right: number,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    viewMode: InsetViewMode
  ): void {
    const TIMES_SLICE = [left, right + 1] as const;
    const timesSlice = dataset.times.slice(...TIMES_SLICE);
    const showDiff = viewMode === "diff";

    type OverlayDatum = { key: string; path: string; opacity: number; fill: string; stroke: string; strokeWidth: number };
    const data: OverlayDatum[] = [];

    // Diff envelopes
    if (showDiff) {
      for (let k = 0; k < orderedLayers.length; k += 1) {
        const b0 = before.yTop[k].slice(...TIMES_SLICE);
        const b1 = after.yTop[k].slice(...TIMES_SLICE);
        const lo = b0.map((v, i) => Math.min(v, b1[i]));
        const hi = b0.map((v, i) => Math.max(v, b1[i]));
        const magnitude = d3.max(lo, (_, i) => Math.abs(hi[i] - lo[i])) ?? 0;

        data.push({
          key: `diff-${k}`,
          path: createAreaPath(timesSlice, lo, hi, xScale, yScale, { smoothInterpolation: true, interpolationSubsteps: 8 }),
          opacity: 0.26,
          fill: diffColor(Math.min(1, magnitude / 3)),
          stroke: "rgba(124, 45, 18, 0.6)",
          strokeWidth: 0.7
        });
      }
    }

    this.overlayGroup
      .selectAll<SVGPathElement, OverlayDatum>("path.overlay")
      .data(data, (d) => d.key)
      .join(
        (enter) => enter.append("path").attr("class", "overlay"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => d.path)
      .attr("fill", (d) => d.fill)
      .attr("fill-opacity", (d) => d.opacity)
      .attr("stroke", (d) => d.stroke)
      .attr("stroke-width", (d) => d.strokeWidth);

    this.overlayGroup.selectAll("line.gap-ruler").remove();
  }
}
