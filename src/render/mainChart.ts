/**
 * Main streamgraph renderer with inset-ROI brushing.
 */
import * as d3 from "d3";
import { roiBounds } from "../core/roi";
import type { LayerInput, PreparedDataset, ROI, StackLayout } from "../core/types";
import { createAreaPath } from "./paths";
import { angleAxisLabels, drawCrosshair, formatTimeTick, layoutExtent, readChartSize, roiXRange } from "./chartUtils";
import { layerColor } from "../styles/palette";
import { createRoiBrush, type RoiBrushController } from "../ui/brush";

export interface MainChartRenderArgs {
  dataset: PreparedDataset;
  orderedLayers: LayerInput[];
  layout: StackLayout;
  roi: ROI | null;
  insetRoi: ROI | null;
  onInsetRoiChange: (roi: ROI | null) => void;
}

export class MainChart {
  private readonly width: number;
  private readonly height: number;
  private readonly margin = { top: 22, right: 16, bottom: 44, left: 52 };
  private readonly innerWidth: number;
  private readonly innerHeight: number;
  private readonly root: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly layersGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly roiGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisX: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly axisY: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly hoverGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly insetRoiGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly insetBrushGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly insetBrush: RoiBrushController;
  private lastOnInsetRoiChange: ((roi: ROI | null) => void) | null = null;

  constructor(private readonly svg: SVGSVGElement) {
    const size = readChartSize(svg, 1180, 360, this.margin);
    this.width = size.width;
    this.height = size.height;
    this.innerWidth = size.innerWidth;
    this.innerHeight = size.innerHeight;

    const rootSvg = d3.select(svg).attr("viewBox", `0 0 ${this.width} ${this.height}`);
    this.root = rootSvg.append("g").attr("transform", `translate(${this.margin.left},${this.margin.top})`);
    this.layersGroup = this.root.append("g").attr("class", "main-layers");
    this.roiGroup = this.root.append("g").attr("class", "main-roi");
    this.insetRoiGroup = this.root.append("g").attr("class", "main-inset-roi");
    this.insetBrushGroup = this.root.append("g").attr("class", "main-inset-brush");
    this.hoverGroup = this.root.append("g").attr("class", "main-hover");
    this.axisX = this.root.append("g").attr("class", "x-axis");
    this.axisY = this.root.append("g").attr("class", "y-axis");
    this.insetBrush = createRoiBrush(
      this.insetBrushGroup,
      [
        [0, 0],
        [this.innerWidth, this.innerHeight]
      ],
      (roi) => {
        this.lastOnInsetRoiChange?.(roi);
      }
    );
  }

  render(args: MainChartRenderArgs): { xScale: d3.ScaleLinear<number, number>; yScale: d3.ScaleLinear<number, number> } {
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
      path: createAreaPath(
        dataset.times.slice(Math.min(left, right), Math.max(left, right) + 1),
        layout.yBottom[k].slice(Math.min(left, right), Math.max(left, right) + 1),
        layout.yTop[k].slice(Math.min(left, right), Math.max(left, right) + 1),
        xScale,
        yScale,
        {
          smoothInterpolation: true,
          interpolationSubsteps: 8
        }
      ),
      color: layerColor(k, layer.id)
    }));

    this.layersGroup
      .selectAll<SVGPathElement, (typeof paths)[number]>("path.main-band")
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
      .call(
        d3
          .axisBottom(xScale)
          .ticks(Math.max(4, Math.floor(this.innerWidth / 140)))
          .tickFormat((value) => formatTimeTick(Number(value)))
      );
    angleAxisLabels(this.axisX);
    this.axisY.call(d3.axisLeft(yScale).ticks(7));

    return { xScale, yScale };
  }

  private drawInsetRoi(roi: ROI | null, times: number[], xScale: d3.ScaleLinear<number, number>): void {
    if (!roi || times.length === 0) {
      this.insetRoiGroup.selectAll("*").remove();
      return;
    }
    const [x0, x1] = roiXRange(roi, times, xScale, this.innerWidth);
    const width = Math.max(1, x1 - x0);

    this.insetRoiGroup
      .selectAll<SVGRectElement, number>("rect.inset-roi")
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

  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number>): void {
    drawCrosshair(this.hoverGroup, timeValue, xScale, this.innerHeight, "#0f172a", 0.45, "4,3");
  }

  private drawRoi(roi: ROI | null, times: number[], xScale: d3.ScaleLinear<number, number>): void {
    if (!roi) {
      this.roiGroup.selectAll("*").remove();
      return;
    }
    const [left, right] = roiXRange(roi, times, xScale, this.innerWidth);
    const width = Math.max(1, right - left);

    const box = this.roiGroup.selectAll<SVGRectElement, number>("rect.roi-window").data([0]);
    box.join((enter) => enter.append("rect").attr("class", "roi-window"))
      .attr("x", left)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", this.innerHeight)
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
      .attr("y1", this.innerHeight)
      .attr("y2", this.innerHeight + 18)
      .attr("stroke", "#0c4a6e")
      .attr("stroke-width", 1.1)
      .attr("stroke-dasharray", "4,3")
      .attr("opacity", 0.85);
  }
}
