/**
 * Compact overview renderer showing the total-thickness silhouette and the
 * primary ROI brush for timeline navigation.
 */
import * as d3 from "d3";
import type { PreparedDataset, ROI } from "../core/types";
import {
  createPlotContext,
  renderTimeAxis,
  type PlotArea,
  type PlotContext
} from "./chartUtils";
import { createRoiBrush, type RoiBrushController } from "../interactions/brush";

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

    // Aggregate all layer heights into a single silhouette to show global
    // thickness trends without per-layer detail.
    const totals = dataset.times.map((_, t) => d3.sum(dataset.layers, (layer) => layer.height[t]) ?? 0);
    const yMax = d3.max(totals) ?? 1;
    const yScale = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0]);

    const area = d3
      .area<number>()
      .x((_, i) => xScale(dataset.times[i]))
      .y0(innerHeight)
      .y1((v) => yScale(v))
      .curve(d3.curveLinear); // linear preserves raw-sample alignment

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
