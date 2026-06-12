import * as d3 from "d3";
import type { ROI } from "../core/types";

export interface RoiBrushController {
  updateContext(times: number[], xScale: d3.ScaleLinear<number, number>): void;
  sync(roi: ROI | null): void;
}

export function createRoiBrush(
  host: d3.Selection<SVGGElement, unknown, null, undefined>,
  extent: [[number, number], [number, number]],
  onChange: (roi: ROI | null) => void,
  eventNames = "end"
): RoiBrushController {
  let times: number[] = [];
  let xScale = d3.scaleLinear().domain([0, 1]).range([extent[0][0], extent[1][0]]);
  let suppressEvent = false;

  const brush = d3
    .brushX<unknown>()
    .extent(extent)
    .on(eventNames, (event: d3.D3BrushEvent<unknown>) => {
      if (suppressEvent) {
        return;
      }
      if (!event.selection) {
        onChange(null);
        return;
      }
      if (times.length === 0) {
        return;
      }
      const [rawX0, rawX1] = event.selection as [number, number];
      const x0 = Math.min(rawX0, rawX1);
      const x1 = Math.max(rawX0, rawX1);
      const v0 = xScale.invert(x0);
      const v1 = xScale.invert(x1);
      const i0 = nearestIndex(times, v0);
      const i1 = nearestIndex(times, v1);
      onChange({
        t0Index: Math.min(i0, i1),
        t1Index: Math.max(i0, i1)
      });
    });

  host.call(brush);

  return {
    updateContext(nextTimes: number[], nextScale: d3.ScaleLinear<number, number>): void {
      times = nextTimes;
      xScale = nextScale;
    },
    sync(roi: ROI | null): void {
      suppressEvent = true;
      if (!roi || times.length === 0) {
        host.call(brush.move as unknown as (g: d3.Selection<SVGGElement, unknown, null, undefined>, sel: null) => void, null);
        suppressEvent = false;
        return;
      }
      const left = clamp(roi.t0Index, 0, times.length - 1);
      const right = clamp(roi.t1Index, 0, times.length - 1);
      const x0 = xScale(times[left]);
      const x1 = xScale(times[right]);
      host.call(
        brush.move as unknown as (
          g: d3.Selection<SVGGElement, unknown, null, undefined>,
          sel: [number, number]
        ) => void,
        [x0, x1]
      );
      suppressEvent = false;
    }
  };
}

function nearestIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const d = Math.abs(values[i] - target);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}
