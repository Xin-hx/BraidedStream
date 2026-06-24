/**
 * PID contour boxplot chart — visualises the "deepest" (most-influential) layer
 * across the PID-derived contour grid as shaded union/intersection envelopes.
 *
 * The chart shows three nested bands:
 *   1. all-union       — every grid cell that exceeds the contour threshold.
 *   2. central-union   — subset belonging to the top central-fraction layers.
 *   3. central-intersection — cells where ALL top-central layers agree.
 *
 * The deepest layer's own low/high envelope is overlaid as a highlighted line.
 */
import * as d3 from "d3";
import { computeContourPid } from "../core/ordering/pid";
import { roiBounds } from "../interactions/roi";
import type { LayerInput, PidUncertaintySource, PreparedDataset, ROI } from "../core/types";
import { clamp } from "../core/utils";
import { createAreaPath } from "./paths";
import {
  createPlotContext,
  renderChartTitle,
  renderTimeAxis,
  type PlotContext
} from "./chartUtils";

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

interface Envelope {
  times: number[];
  low: number[];
  high: number[];
}

/** Shape description for a single contour envelope band. */
interface ContourBand {
  key: string;
  label: string;
  env: Envelope;
  fill: string;
  opacity: number;
  stroke: string;
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

    // Clamp user-facing parameters to sane ranges.
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

    // Build the three envelope bands in visual z-order (back to front).
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

    // ── envelope bands ─────────────────────────────────────────────────
    this.plotGroup
      .selectAll<SVGPathElement, ContourBand>("path.contour-boxplot-band")
      .data(
        bands.filter((item) => item.env.times.length > 1),
        (d) => d.key
      )
      .join(
        (enter) => enter.append("path").attr("class", "contour-boxplot-band"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) =>
        createAreaPath(d.env.times, d.env.low, d.env.high, xScale, yScale, {
          smoothInterpolation: true
        })
      )
      .attr("fill", (d) => d.fill)
      .attr("fill-opacity", (d) => d.opacity)
      .attr("stroke", (d) => d.stroke)
      .attr("stroke-width", 1);

    // ── deepest-layer overlay ──────────────────────────────────────────
    this.drawDeepestMember(deepestEnv, xScale, yScale, opacity);

    // ── annotation ─────────────────────────────────────────────────────
    this.drawLegend(bands, pid.deepestLayerId, opacity);
    renderChartTitle(
      this.titleGroup,
      `PID contour boxplot | source=${args.uncertaintySource} | top=${(centralFraction * 100).toFixed(0)}% | threshold=${threshold.toFixed(2)} | yBins=${yBins} | deepest=${pid.deepestLayerId ? pid.deepestLayerId.split("|")[0] : "N/A"}`,
      { y: -8 }
    );

    // ── axes ───────────────────────────────────────────────────────────
    renderTimeAxis(this.axisX, xScale, innerWidth, innerHeight, 170);
    this.axisY
      .attr("transform", `translate(0,0)`)
      .call(
        d3
          .axisLeft(yScale)
          .ticks(4)
          .tickFormat((value) => formatContourValue(Number(value), pid.grid.valueTransform, args.uncertaintySource))
      );
  }

  // ── private drawing helpers ──────────────────────────────────────────────

  /** Draw the deepest layer's low/high envelope as dashed Catmull-Rom curves. */
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

  /** Render colour legend below the chart area. */
  private drawLegend(
    bands: ContourBand[],
    deepestLayerId: string | null,
    opacity: number
  ): void {
    const items = [
      ...bands.map((band) => ({
        key: band.key,
        label: band.label,
        color: band.fill,
        opacity: band.opacity
      })),
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

// ── free helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a PID contour-grid mask into a low/high envelope time series.
 * Only time columns where at least one y-bin exceeds `threshold` contribute
 * a sample; gaps in the envelope correspond to regions where no bin qualifies.
 */
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
      if (value < threshold) {
        continue;
      }
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

/**
 * Format contour z-axis values back to the original data domain, applying
 * per-source shorthand (percentage vs. K/M suffixes).
 */
function formatContourValue(
  value: number,
  transform: "log1p" | "linear",
  uncertaintySource: PidUncertaintySource
): string {
  const raw = transform === "linear" ? value : Math.expm1(value);
  if (!Number.isFinite(raw)) {
    return "";
  }
  if (uncertaintySource === "poportion") {
    const pct = raw * 100;
    return `${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
  }
  if (Math.abs(raw) >= 1_000_000) {
    return `${(raw / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(raw) >= 1_000) {
    return `${(raw / 1_000).toFixed(0)}K`;
  }
  return raw.toFixed(raw >= 10 ? 0 : 2);
}
