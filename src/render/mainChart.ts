import * as d3 from "d3";
import { createAreaPath } from "./paths";
import { layerColor } from "../styles/palette";
import type { PreparedDataset, ROI, StackLayout } from "../core/types";
import { createRoiBrush, type RoiBrushController } from "../ui/brush";

export interface MainChartRenderArgs {
  dataset: PreparedDataset;
  layout: StackLayout;
  roi: ROI | null;
  insetRoi: ROI | null;
  onInsetRoiChange: (roi: ROI | null) => void;
  staticMode: boolean;
}

export class MainChart {
  private readonly width: number;
  private readonly height: number;
  private readonly margin = { top: 22, right: 16, bottom: 30, left: 52 };
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
    this.width = Number(svg.getAttribute("width") ?? "1180");
    this.height = Number(svg.getAttribute("height") ?? "360");
    this.innerWidth = this.width - this.margin.left - this.margin.right;
    this.innerHeight = this.height - this.margin.top - this.margin.bottom;

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
    const { dataset, layout, roi, insetRoi, onInsetRoiChange, staticMode } = args;
    const domainStart = roi ? dataset.times[Math.max(0, roi.t0Index)] : dataset.times[0];
    const domainEnd = roi ? dataset.times[Math.min(dataset.times.length - 1, roi.t1Index)] : dataset.times[dataset.times.length - 1];
    const xScale = d3
      .scaleLinear()
      .domain([domainStart, domainEnd])
      .range([0, this.innerWidth]);

    const extent = extentLayout(layout);
    const yScale = d3
      .scaleLinear()
      .domain([extent[0] - (extent[1] - extent[0]) * 0.04, extent[1] + (extent[1] - extent[0]) * 0.04])
      .range([this.innerHeight, 0]);

    const paths = dataset.layers.map((layer, k) => ({
      id: layer.id,
      path: createAreaPath(dataset.times, layout.yBottom[k], layout.yTop[k], xScale, yScale),
      color: layerColor(k)
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

    this.drawRoi(null, dataset.times, xScale, staticMode);
    this.drawInsetRoi(insetRoi, dataset.times, xScale);
    this.lastOnInsetRoiChange = onInsetRoiChange;
    this.insetBrush.updateContext(dataset.times, xScale);
    this.insetBrush.sync(insetRoi);

    this.axisX.attr("transform", `translate(0,${this.innerHeight})`).call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.format("d")));
    this.axisY.call(d3.axisLeft(yScale).ticks(7));

    return { xScale, yScale };
  }

  private drawInsetRoi(roi: ROI | null, times: number[], xScale: d3.ScaleLinear<number, number>): void {
    if (!roi || times.length === 0) {
      this.insetRoiGroup.selectAll("*").remove();
      return;
    }
    const left = xScale(times[Math.max(0, roi.t0Index)]);
    const right = xScale(times[Math.min(times.length - 1, roi.t1Index)]);
    const x0 = Math.max(0, Math.min(this.innerWidth, Math.min(left, right)));
    const x1 = Math.max(0, Math.min(this.innerWidth, Math.max(left, right)));
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
    const lineSel = this.hoverGroup.selectAll<SVGLineElement, number>("line.crosshair").data(timeValue === null ? [] : [timeValue]);
    lineSel
      .join((enter) => enter.append("line").attr("class", "crosshair"), (update) => update, (exit) => exit.remove())
      .attr("x1", (d) => xScale(d))
      .attr("x2", (d) => xScale(d))
      .attr("y1", 0)
      .attr("y2", this.innerHeight)
      .attr("stroke", "#0f172a")
      .attr("stroke-opacity", 0.45)
      .attr("stroke-dasharray", "4,3");
  }

  private drawRoi(roi: ROI | null, times: number[], xScale: d3.ScaleLinear<number, number>, staticMode: boolean): void {
    if (!roi) {
      this.roiGroup.selectAll("*").remove();
      return;
    }
    const left = xScale(times[Math.max(0, roi.t0Index)]);
    const right = xScale(times[Math.min(times.length - 1, roi.t1Index)]);
    const width = Math.max(1, right - left);

    const box = this.roiGroup.selectAll<SVGRectElement, number>("rect.roi-window").data([0]);
    box.join((enter) => enter.append("rect").attr("class", "roi-window"))
      .attr("x", left)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", this.innerHeight)
      .attr("fill", staticMode ? "rgba(14, 116, 144, 0.14)" : "rgba(14, 165, 233, 0.13)")
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

function extentLayout(layout: StackLayout): [number, number] {
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
  if (minV === maxV) {
    return [minV - 1, maxV + 1];
  }
  return [minV, maxV];
}
