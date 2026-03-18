import * as d3 from "d3";
import type { BraidLayout, LayerInput, RenderMode } from "../core/types";
import { boundaryUncertaintyAt } from "../core/validate";
import { createAreaPath } from "./paths";

interface GapBandDatum {
  key: string;
  path: string;
  color: string;
  opacity: number;
}

export interface UncertaintyRenderArgs {
  group: d3.Selection<SVGGElement, unknown, null, undefined>;
  mode: RenderMode;
  times: number[];
  orderedLayers: LayerInput[];
  braided: BraidLayout;
  xScale: d3.ScaleLinear<number, number>;
  yScale: d3.ScaleLinear<number, number>;
}

export function renderUncertaintyInGaps(args: UncertaintyRenderArgs): void {
  const { group, mode, times, orderedLayers, braided, xScale, yScale } = args;
  if (mode !== "mean+uncBandInGap" && mode !== "mean+uncBand" && mode !== "mean+gapSemantic") {
    group.selectAll("*").remove();
    return;
  }

  const gapCount = Math.max(0, orderedLayers.length - 1);
  const bands: GapBandDatum[] = [];

  for (let k = 0; k < gapCount; k += 1) {
    const uncSeries = times.map((_, t) => boundaryUncertaintyAt(orderedLayers[k], orderedLayers[k + 1], t));
    const robustHigh = percentile(uncSeries, 0.9);
    if (robustHigh <= 0) {
      continue;
    }

    const bandBottom = new Array<number>(times.length).fill(0);
    const bandTop = new Array<number>(times.length).fill(0);
    for (let t = 0; t < times.length; t += 1) {
      const gapLower = braided.yTop[k][t];
      const gapUpper = braided.yBottom[k + 1][t];
      const gapSize = Math.max(0, gapUpper - gapLower);
      const u = uncSeries[t];
      const normalized = Math.sqrt(clamp01(u / robustHigh));
      const bandThickness = Math.min(gapSize * 0.92, gapSize * normalized);
      const mid = gapLower + gapSize * 0.5;
      bandBottom[t] = mid - bandThickness * 0.5;
      bandTop[t] = mid + bandThickness * 0.5;
    }

    bands.push({
      key: `gap-${k}`,
      path: createAreaPath(times, bandBottom, bandTop, xScale, yScale),
      color: d3.interpolateTurbo((k + 0.5) / Math.max(1, gapCount)),
      opacity: 0.55
    });
  }

  const selection = group.selectAll<SVGPathElement, GapBandDatum>("path.unc-band").data(bands, (d) => d.key);
  selection
    .join(
      (enter) =>
        enter
          .append("path")
          .attr("class", "unc-band")
          .attr("stroke", "none"),
      (update) => update,
      (exit) => exit.remove()
    )
    .attr("d", (d) => d.path)
    .attr("fill", (d) => d.color)
    .attr("fill-opacity", (d) => d.opacity);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}
