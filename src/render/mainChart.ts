/**
 * Main streamgraph renderer with inset-ROI brushing.
 *
 * Each layer band is drawn as an SVG <path> whose bottom/top curves are
 * shape-preserving PCHIP-smoothed to reduce blocky linear-segment artefacts.
 */
import * as d3 from "d3";
import { roiBounds } from "../interactions/roi";
import type { LayerInput, PreparedDataset, ROI, StackLayout } from "../core/types";
import { createAreaPath } from "./paths";
import {
  angleAxisLabels,
  createPlotContext,
  drawCrosshair,
  layoutExtent,
  renderTimeAxis,
  renderValueAxis,
  roiXRange,
  type PlotArea,
  type PlotContext
} from "./chartUtils";
import { layerColor } from "../styles/palette";
import { createRoiBrush, type RoiBrushController } from "../interactions/brush";

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

/** Per-layer path geometry and styling. */
interface MainBandDatum {
  id: string;
  path: string;
  color: string;
}

export class MainChart {
  private readonly margin = { top: 22, right: 16, bottom: 44, left: 52 };
  private readonly ctx: PlotContext;

  // SVG layer groups — one per semantic z-order.
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

    // Group order matters for z-stacking — bottom to top:
    // hover > inset overlay > bands > ROI backgrounds
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

    // ── scales ────────────────────────────────────────────────────────
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

    // ── layer bands ───────────────────────────────────────────────────
    const sliceArgs = [Math.min(left, right), Math.max(left, right) + 1] as const;
    const paths: MainBandDatum[] = orderedLayers.map((layer, k) => ({
      id: layer.id,
      // PCHIP-smoothed area path: each layer's top and bottom curves are
      // independently shape-preserving-spline interpolated to avoid
      // jagged linear-segment artefacts on sparse timelines.
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

    // ── ROI overlays ──────────────────────────────────────────────────
    this.drawRoi(null, dataset.times, xScale);
    this.drawInsetRoi(insetRoi, dataset.times, xScale);
    this.lastOnInsetRoiChange = onInsetRoiChange;
    this.insetBrush.updateContext(dataset.times, xScale);
    this.insetBrush.sync(insetRoi);

    // ── axes ──────────────────────────────────────────────────────────
    renderTimeAxis(this.axisX, xScale, innerWidth, innerHeight);
    renderValueAxis(this.axisY, yScale, 7);

    return { xScale, yScale, plotArea: this.ctx.plotArea };
  }

  /** Draw or clear the vertical hover crosshair. */
  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number>): void {
    drawCrosshair(this.hoverGroup, timeValue, xScale, this.ctx.innerHeight, "#0f172a", 0.45, "4,3");
  }

  // ── private helpers ──────────────────────────────────────────────────────

  /** Highlights the inset-ROI window within the main chart. */
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

  /** Draws the primary-ROI translucent background. */
  private drawRoi(roi: ROI | null, times: number[], xScale: d3.ScaleLinear<number, number>): void {
    if (!roi) {
      this.roiGroup.selectAll("*").remove();
      return;
    }
    const [left, right] = roiXRange(roi, times, xScale, this.ctx.innerWidth);
    const width = Math.max(1, right - left);

    const box = this.roiGroup.selectAll<SVGRectElement, number>("rect.roi-window").data([0]);
    box.join((enter) => enter.append("rect").attr("class", "roi-window"))
      .attr("x", left)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", this.ctx.innerHeight)
      .attr("fill", "rgba(14, 165, 233, 0.13)")
      .attr("stroke", "#0369a1")
      .attr("stroke-width", 1.2);

    const labels = this.roiGroup.selectAll<SVGTextElement, number>("text.roi-tag").data([0]);
    labels
      .join((enter) => enter.append("text").attr("class", "roi-tag"))
      .attr("x", left + 6)
      .attr("y", 14)
      .attr("fill", "#0c4a6e")
      .attr("font-size", 11)
      .attr("font-weight", 700)
      .text("ROI A");

    const leaders = this.roiGroup.selectAll<SVGLineElement, number>("line.roi-leader").data([0, 1]);
    leaders
      .join((enter) => enter.append("line").attr("class", "roi-leader"))
      .attr("x1", (d) => (d === 0 ? left : right))
      .attr("x2", (d) => (d === 0 ? left - 18 : right + 18))
      .attr("y1", this.ctx.innerHeight)
      .attr("y2", this.ctx.innerHeight + 18)
      .attr("stroke", "#0c4a6e")
      .attr("stroke-width", 1.1)
      .attr("stroke-dasharray", "4,3")
      .attr("opacity", 0.85);
  }
}
