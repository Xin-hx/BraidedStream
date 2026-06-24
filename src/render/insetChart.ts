/**
 * Inset comparison chart — renders before/after/diff/split views of the base
 * stack vs. the braided (uncertainty-gap-enhanced) layout within the inset ROI.
 *
 * View modes:
 *   before  — base layout only (greyed, background)
 *   after   — braided layout only (full colour)
 *   diff    — overlay both, plus diff-envelope shading and gap-semantic fill
 *   split   — side-by-side (both shown at lower opacity for spatial comparison)
 */
import * as d3 from "d3";
import { roiBounds } from "../interactions/roi";
import type { BraidLayout, InsetViewMode, LayerInput, PreparedDataset, ROI, StackLayout } from "../core/types";
import { clamp01, percentile, range } from "../core/utils";
import { createAreaPath } from "./paths";
import {
  angleAxisLabels,
  applyLayerHoverHighlight,
  createPlotContext,
  drawCrosshair,
  formatTimeTick,
  layoutExtentForIndices,
  renderChartTitle,
  type LayerHoverDatum,
  type PlotArea,
  type PlotContext
} from "./chartUtils";
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
  plotArea: PlotArea;
}

/** Per-layer path geometry + styling, also carries hover metadata. */
interface InsetBandDatum extends LayerHoverDatum {
  path: string;
  color: string;
}

export class InsetChart {
  private readonly margin = { top: 24, right: 16, bottom: 44, left: 52 };
  private readonly ctx: PlotContext;

  // Layered SVG groups — order matters for z-stacking.
  private readonly titleGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  /** Before (base) layout bands, rendered below after-bands. */
  private readonly beforeGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  /** After (braided) layout bands. */
  private readonly afterGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  /** Diff envelopes and gap-semantic fill — on top of bands. */
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
      renderChartTitle(this.titleGroup, "No time points available", {
        y: 0,
        fill: "#334155"
      });
      return { xScale: null, yScale: null, activeTimes: [], activeStartIndex: 0, plotArea: this.ctx.plotArea };
    }

    const { innerWidth, innerHeight } = this.ctx;
    const [left, right] = roiBounds(dataset.times.length, args.roi);
    const activeTimes = dataset.times.slice(left, right + 1);
    const activeIndices = range(left, right + 1);

    // ── scales ──────────────────────────────────────────────────────────
    const xScale = d3
      .scaleLinear()
      .domain([activeTimes[0], activeTimes[activeTimes.length - 1]])
      .range([0, innerWidth]);

    const eBefore = layoutExtentForIndices(before, activeIndices);
    const eAfter = layoutExtentForIndices(after, activeIndices);
    const minV = Math.min(eBefore[0], eAfter[0]);
    const maxV = Math.max(eBefore[1], eAfter[1]);
    const center = 0.5 * (minV + maxV);
    const half = 0.5 * (maxV - minV) / Math.max(0.2, yZoom);
    const yScale = d3
      .scaleLinear()
      .domain([center - half * 1.06, center + half * 1.06])
      .range([innerHeight, 0]);

    // ── title ───────────────────────────────────────────────────────────
    renderChartTitle(
      this.titleGroup,
      `mode=${viewMode.toUpperCase()} | uncertainty-gap=${enableUncertaintyGap ? "on" : "off"} | jagged-edge=${enableJaggedEdge ? "on" : "off"} | interactive`
    );

    // ── layer bands ─────────────────────────────────────────────────────
    this.drawBeforeAfter(
      dataset, orderedLayers, before, after,
      left, right, xScale, yScale, viewMode,
      enableJaggedEdge, jaggedAmplitude, jaggedFrequency, fixedSeed
    );

    // ── overlay (diff + gap semantics) ──────────────────────────────────
    this.drawDiffAndGapOverlay(
      orderedLayers, dataset, before, after,
      left, right, xScale, yScale, viewMode, enableUncertaintyGap
    );

    this.applyLayerHoverHighlight();

    // ── axes ────────────────────────────────────────────────────────────
    this.axisX
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(Math.max(3, Math.floor(innerWidth / 160)))
          .tickFormat((value) => formatTimeTick(Number(value)))
      );
    angleAxisLabels(this.axisX);
    this.axisY.call(d3.axisLeft(yScale).ticks(6));

    return { xScale, yScale, activeTimes, activeStartIndex: left, plotArea: this.ctx.plotArea };
  }

  /** Draw or clear the vertical hover crosshair. */
  setHover(timeValue: number | null, xScale: d3.ScaleLinear<number, number> | null): void {
    drawCrosshair(this.hoverGroup, timeValue, xScale, this.ctx.innerHeight, "#7c2d12", 0.5, "4,2");
  }

  /** Set the currently hovered layer and refresh highlights. */
  setLayerHover(layerId: string | null): void {
    if (this.hoveredLayerId === layerId) {
      return;
    }
    this.hoveredLayerId = layerId;
    this.applyLayerHoverHighlight();
  }

  // ── private rendering ─────────────────────────────────────────────────────

  /**
   * Build and render the before/after layer-band paths.  View mode controls
   * which group is visible and at what opacity.
   */
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

    // ── common path-creation options shared by before/after ────────
    const buildPath = (
      layout: StackLayout,
      layer: LayerInput,
      k: number,
      seed: string
    ): string =>
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

    // Per-mode visual tuning.
    const split = viewMode === "split";
    const onlyBefore = viewMode === "before";
    const onlyAfter = viewMode === "after";
    const showBothInDiff = viewMode === "diff";

    const beforeFillOpacity = split ? 0.44 : showBothInDiff ? 0.25 : 0.8;
    const beforeStrokeOpacity = showBothInDiff ? 0.35 : 0.12;
    const afterFillOpacity = split ? 0.78 : showBothInDiff ? 0.56 : 0.84;

    const shouldShowBefore = onlyBefore || split || showBothInDiff;
    const shouldShowAfter = onlyAfter || split || showBothInDiff;

    // ── before paths ────────────────────────────────────────────────
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

    // ── after paths ─────────────────────────────────────────────────
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

  /** Dim all layers except the hovered one, then boost and raise it. */
  private applyLayerHoverHighlight(): void {
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

  /**
   * Diff-view overlay: per-layer before→after envelope differences, plus
   * semitransparent gap-semantic fill rings for uncertainty-driven gaps.
   */
  private drawDiffAndGapOverlay(
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
    const TIMES_SLICE = [left, right + 1] as const;
    const timesSlice = dataset.times.slice(...TIMES_SLICE);
    const showDiff = viewMode === "diff";
    const gapCount = Math.max(0, orderedLayers.length - 1);

    type OverlayDatum = { key: string; path: string; opacity: number; fill: string; stroke: string; strokeWidth: number };
    const data: OverlayDatum[] = [];

    // ── diff envelopes (per-layer before-vs-after span) ───────────────
    if (showDiff) {
      for (let k = 0; k < orderedLayers.length; k += 1) {
        const b0 = before.yTop[k].slice(...TIMES_SLICE);
        const b1 = after.yTop[k].slice(...TIMES_SLICE);
        const lo = b0.map((v, i) => Math.min(v, b1[i]));
        const hi = b0.map((v, i) => Math.max(v, b1[i]));
        const magnitude = d3.max(lo, (_, i) => Math.abs(hi[i] - lo[i])) ?? 0;

        data.push({
          key: `diff-${k}`,
          path: createAreaPath(timesSlice, lo, hi, xScale, yScale, {
            smoothInterpolation: true,
            interpolationSubsteps: 8
          }),
          opacity: 0.26,
          fill: diffColor(Math.min(1, magnitude / 3)),
          stroke: "rgba(124, 45, 18, 0.6)",
          strokeWidth: 0.7
        });
      }
    }

    // ── gap-semantic fill ─────────────────────────────────────────────
    if (enableUncertaintyGap) {
      for (let k = 0; k < gapCount; k += 1) {
        const meanGapPx = d3.mean(after.gapsPx[k].slice(...TIMES_SLICE)) ?? 0;
        if (meanGapPx < 0.7) {
          continue; // skip negligible gaps to reduce visual noise
        }

        const gapLower = after.yTop[k].slice(...TIMES_SLICE);
        const gapUpper = after.yBottom[k + 1].slice(...TIMES_SLICE);
        const unc = timesSlice.map((_, i) =>
          boundaryUncertaintyAt(orderedLayers[k], orderedLayers[k + 1], left + i)
        );
        const robustHigh = percentile(unc, 0.9);

        // Draw concentric layers of semitransparent fill to encode gap
        // magnitude — thicker in the centre, tapering outward.
        const levels = [0.9, 0.68, 0.46, 0.24];
        for (let q = 0; q < levels.length; q += 1) {
          const mid = gapLower.map((v, i) => 0.5 * (v + gapUpper[i]));
          const half = gapLower.map((v, i) => {
            const ratio = robustHigh > 0 ? Math.sqrt(clamp01(unc[i] / robustHigh)) : 0;
            return Math.max(0, (gapUpper[i] - v) * 0.5 * ratio * levels[q]);
          });
          data.push({
            key: `unc-${k}-${q}`,
            path: createAreaPath(timesSlice, mid.map((v, i) => v - half[i]), mid.map((v, i) => v + half[i]), xScale, yScale, {
              smoothInterpolation: true,
              interpolationSubsteps: 8
            }),
            opacity: 0.16 + 0.12 * q,
            fill: "#ffffff",
            stroke: "rgba(51, 65, 85, 0.35)",
            strokeWidth: 0.7
          });
        }
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

  /** Convenience getter for the SVG root selection. */
  private get root(): d3.Selection<SVGGElement, unknown, null, undefined> {
    return this.ctx.root;
  }
}
