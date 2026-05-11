/**
 * Compact overview renderer and primary ROI brush.
 */
import * as d3 from "d3";
import type { PreparedDataset, ROI } from "../core/types";
import { angleAxisLabels, formatTimeTick, plotAreaFromSize, readChartSize, type PlotArea } from "./chartUtils";
import { createRoiBrush, type RoiBrushController } from "../ui/brush";

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
  private readonly width: number;
  private readonly height: number;
  private readonly margin = { top: 10, right: 12, bottom: 34, left: 52 };
  private readonly innerWidth: number;
  private readonly innerHeight: number;
  private readonly plotArea: PlotArea;
  private readonly root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly trendGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly brushGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly roiBrush: RoiBrushController;

  constructor(private readonly svg: SVGSVGElement) {
    const size = readChartSize(svg, 1180, 118, this.margin);
    this.width = size.width;
    this.height = size.height;
    this.innerWidth = size.innerWidth;
    this.innerHeight = size.innerHeight;
    this.plotArea = plotAreaFromSize(size);

    const rootSvg = d3.select(svg).attr("viewBox", `0 0 ${this.width} ${this.height}`);
    this.root = rootSvg.append("g").attr("transform", `translate(${this.margin.left},${this.margin.top})`);
    this.trendGroup = this.root.append("g").attr("class", "overview-trend");
    this.brushGroup = this.root.append("g").attr("class", "overview-brush");
    this.axisX = this.root.append("g").attr("class", "x-axis");
    this.roiBrush = createRoiBrush(
      this.brushGroup,
      [
        [0, 0],
        [this.innerWidth, this.innerHeight]
      ],
      (roi) => {
        this.lastOnRoiChange?.(roi);
      },
      "brush end"
    );
  }

  private lastOnRoiChange: ((roi: ROI | null) => void) | null = null;

  render(args: OverviewRenderArgs): OverviewRenderResult {
    const { dataset, roi, onRoiChange } = args;
    const xScale = d3
      .scaleLinear()
      .domain([dataset.times[0], dataset.times[dataset.times.length - 1]])
      .range([0, this.innerWidth]);

    const totals = dataset.times.map((_, t) => d3.sum(dataset.layers, (layer) => layer.mean[t]) ?? 0);
    const yMax = d3.max(totals) ?? 1;
    const yScale = d3.scaleLinear().domain([0, yMax]).range([this.innerHeight, 0]);

    const area = d3
      .area<number>()
      .x((_, i) => xScale(dataset.times[i]))
      .y0(this.innerHeight)
      .y1((v) => yScale(v))
      // Keep overview aligned with raw sampling cadence.
      .curve(d3.curveLinear);

    this.trendGroup
      .selectAll<SVGPathElement, number[]>("path.overview-area")
      .data([totals])
      .join((enter) => enter.append("path").attr("class", "overview-area"))
      .attr("d", (d) => area(d) ?? "")
      .attr("fill", "rgba(15, 118, 110, 0.23)")
      .attr("stroke", "#0f766e")
      .attr("stroke-width", 1);

    this.axisX
      .attr("transform", `translate(0,${this.innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(Math.max(4, Math.floor(this.innerWidth / 140)))
          .tickFormat((value) => formatTimeTick(Number(value)))
      );
    angleAxisLabels(this.axisX);

    this.lastOnRoiChange = onRoiChange;
    this.roiBrush.updateContext(dataset.times, xScale);
    this.roiBrush.sync(roi);
    return { xScale, plotArea: this.plotArea };
  }
}
