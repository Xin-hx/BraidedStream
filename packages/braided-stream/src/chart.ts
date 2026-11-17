import { dispatch, pointer, select } from "d3";
import { runPipeline, type InputDataset, type PipelineOptions, type PipelineResult } from "./core.js";
import {
  chartCoordinates, dimensions, renderChart, renderTimeFilter,
  type RenderInput, type TimeFilterInput,
} from "./render.js";

export interface PreparedChartDatum { dataset: InputDataset; result: PipelineResult }
export type ChartDatum = InputDataset | PreparedChartDatum;
export type ChartOptions = Partial<Omit<RenderInput, "times" | "result" | "hover">>;
export type TimeFilterOptions = Partial<Omit<TimeFilterInput, "times" | "result" | "onChange">>;
export interface HoverEvent {
  timeIndex: number;
  layerId: string | null;
  spaceKind?: string;
  sourceEvent: MouseEvent;
}
export interface RangeChangeEvent { start: number; end: number }
interface SVGSelection<D> {
  each(callback: (this: SVGSVGElement, datum: D) => void): unknown;
}
type Listener<T> = (this: SVGSVGElement, event: T) => void;
export interface BraidedStreamChart {
  (selection: SVGSelection<ChartDatum>): void;
  options(value: ChartOptions): BraidedStreamChart;
  pipelineOptions(value: PipelineOptions): BraidedStreamChart;
  on(name: `hover${"" | `.${string}`}`, listener: Listener<HoverEvent> | null): BraidedStreamChart;
  on(name: `leave${"" | `.${string}`}`, listener: Listener<MouseEvent> | null): BraidedStreamChart;
  destroy(selection: SVGSelection<unknown>): void;
}
export interface StreamTimeFilter {
  (selection: SVGSelection<PreparedChartDatum>): void;
  options(value: TimeFilterOptions): StreamTimeFilter;
  on(name: `rangechange${"" | `.${string}`}`, listener: Listener<RangeChangeEvent> | null): StreamTimeFilter;
  destroy(selection: SVGSelection<unknown>): void;
}

const defaults = {
  visMethod: "braided", smoothContours: true, showEnvelopeStroke: false,
  showRepresentativeStroke: false, showTimeCell: false, showBranchStroke: false,
  showYAxis: true, showDensityGradient: false,
  highlightLayer: null,
} satisfies ChartOptions;

export function timeRange(length: number, start = 0, end = length - 1): [number, number] {
  if (length < 1 || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("time range requires non-empty data and finite bounds");
  }
  const first = Math.max(0, Math.min(length - 1, Math.floor(start)));
  return [first, Math.max(first, Math.min(length - 1, Math.floor(end)))];
}

function prepare(datum: ChartDatum, options: PipelineOptions) {
  const dataset = "dataset" in datum ? datum.dataset : datum;
  const result = "dataset" in datum ? datum.result : runPipeline(dataset, options);
  if (!dataset.times.length || result.layoutOrder.length !== dataset.layers.length ||
      result.layoutOrder.some(id => !dataset.layers.some(layer => layer.id === id)) ||
      result.base.yTop.some(row => row.length !== dataset.times.length)) {
    throw new Error("precomputed result must match its dataset");
  }
  return { dataset, result };
}

function surface(host: SVGSVGElement, className: string) {
  const svg = host.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  host.append(svg);
  return svg;
}

function chartInput(dataset: InputDataset, result: PipelineResult, options: ChartOptions): RenderInput {
  const [start, end] = timeRange(dataset.times.length, options.start, options.end);
  return {
    ...defaults, ...options, layers: options.layers ?? dataset.layers,
    times: [...dataset.times], result, start, end, hover: null,
  };
}

/** Hit testing uses exactly the scales and visible window used by the renderer. */
export function hitTest(input: RenderInput, px: number, py: number) {
  return hitCoordinates(input, chartCoordinates(input), px, py);
}

function hitCoordinates(input: RenderInput, coords: ReturnType<typeof chartCoordinates>, px: number, py: number) {
  const { width, height, margin } = dimensions(input);
  if (px < margin.left || px > width - margin.right || py < margin.top || py > height - margin.bottom) return null;
  const { indices, x, xValues, y, bottom, top } = coords;
  const timeIndex = indices.reduce((best, t) => Math.abs(x(xValues[t]) - px) < Math.abs(x(xValues[best]) - px) ? t : best);
  const value = y.invert(py);
  const layer = input.result.layoutOrder.findIndex((_, i) =>
    !input.result.braided.layers[i].missing[timeIndex] && value >= bottom[i][timeIndex] && value <= top[i][timeIndex]);
  return { timeIndex, layerId: layer < 0 ? null : input.result.layoutOrder[layer] };
}

export function braidedStream(): BraidedStreamChart {
  let options: ChartOptions = {};
  let pipelineOptions: PipelineOptions = {};
  let revision = 0;
  const events = dispatch<SVGSVGElement, { hover: [HoverEvent]; leave: [MouseEvent] }>("hover", "leave");
  const states = new WeakMap<SVGSVGElement, {
    svg: SVGSVGElement; datum: ChartDatum; revision: number;
    prepared: ReturnType<typeof prepare>;
  }>();

  function chart(selection: SVGSelection<ChartDatum>): void {
    selection.each(function(datum) {
      let state = states.get(this);
      if (!state) {
        const prepared = prepare(datum, pipelineOptions);
        state = { svg: surface(this, "braided-stream-surface"), datum, revision, prepared };
        states.set(this, state);
      } else if (state.datum !== datum || state.revision !== revision) {
        state.prepared = prepare(datum, pipelineOptions);
        state.datum = datum;
        state.revision = revision;
      }
      const { dataset, result } = state.prepared;
      const input = chartInput(dataset, result, options);
      const { width, height } = dimensions(input);
      this.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const host = this;
      const svg = state.svg;
      renderChart(svg, input);
      svg.setAttribute("height", String(height));
      const root = select(svg);
      const coords = chartCoordinates(input);
      function highlight(id: string | null) {
        root.selectAll<SVGElement, unknown>("[data-owner-layer]")
          .filter(function() { return !this.classList.contains("envelope-hit") && !this.classList.contains("space-hit"); })
          .classed("dim", function() { return Boolean(id && this.dataset.ownerLayer !== id); });
        // Decorative marks share the owning layer, even though they are not hit targets.
        root.selectAll<SVGElement, unknown>("[data-visual-layer]")
          .classed("dim", function() { return Boolean(id && this.dataset.visualLayer !== id); });
      }
      const leave = (event: MouseEvent) => {
        root.selectAll(".hover-line").remove();
        highlight(input.highlightLayer);
        events.call("leave", host, event);
      };
      root.on("mousemove.braided-stream", (event: MouseEvent) => {
        const [px, py] = pointer(event, svg);
        const hit = hitCoordinates(input, coords, px, py);
        if (!hit) { leave(event); return; }
        const target = event.target as Element | null;
        const owner = target?.closest?.("[data-owner-layer]");
        const layerId = owner?.getAttribute("data-owner-layer") ?? hit.layerId;
        const spaceKind = owner?.getAttribute("data-space-kind") ?? undefined;
        const { margin } = dimensions(input);
        root.selectAll(".hover-line").data([hit.timeIndex]).join("line")
          .attr("class", "hover-line").attr("pointer-events", "none")
          .attr("x1", coords.x(coords.xValues[hit.timeIndex])).attr("x2", coords.x(coords.xValues[hit.timeIndex]))
          .attr("y1", margin.top).attr("y2", height - margin.bottom);
        highlight(layerId ?? input.highlightLayer);
        events.call("hover", host, { ...hit, layerId, spaceKind, sourceEvent: event } satisfies HoverEvent);
      }).on("mouseleave.braided-stream", leave);
    });
  }
  chart.options = (value: ChartOptions) => { options = { ...options, ...value }; return chart; };
  chart.pipelineOptions = (value: PipelineOptions) => { pipelineOptions = { ...pipelineOptions, ...value }; revision++; return chart; };
  function on(name: `hover${"" | `.${string}`}`, listener: Listener<HoverEvent> | null): BraidedStreamChart;
  function on(name: `leave${"" | `.${string}`}`, listener: Listener<MouseEvent> | null): BraidedStreamChart;
  function on(name: string, listener: Listener<HoverEvent> | Listener<MouseEvent> | null): BraidedStreamChart {
    events.on(name as "hover", listener as Listener<HoverEvent> | null);
    return chart;
  }
  chart.on = on;
  chart.destroy = (selection: SVGSelection<unknown>) => {
    selection.each(function() {
      const state = states.get(this);
      if (state) { select(state.svg).on(".braided-stream", null); state.svg.remove(); states.delete(this); }
    });
  };
  return chart;
}

export function streamTimeFilter(): StreamTimeFilter {
  let options: TimeFilterOptions = {};
  const events = dispatch<SVGSVGElement, { rangechange: [RangeChangeEvent] }>("rangechange");
  const states = new WeakMap<SVGSVGElement, { svg: SVGSVGElement; dispose: () => void }>();
  function chart(selection: SVGSelection<PreparedChartDatum>): void {
    selection.each(function(datum) {
      if (!("dataset" in datum)) throw new Error("time filter requires { dataset, result } from runPipeline");
      let state = states.get(this);
      if (!state) {
        state = { svg: surface(this, "braided-stream-overview"), dispose: () => undefined };
        states.set(this, state);
      }
      state.dispose();
      const host = this;
      const [start, end] = timeRange(datum.dataset.times.length, options.start, options.end);
      this.setAttribute("viewBox", `0 0 ${options.width ?? 1180} 92`);
      state.dispose = renderTimeFilter(state.svg, {
        ...options, layers: options.layers ?? datum.dataset.layers, times: [...datum.dataset.times],
        result: datum.result, start, end,
        onChange: (left, right) => {
          const [start, end] = timeRange(datum.dataset.times.length, left, right);
          events.call("rangechange", host, { start, end });
        },
      });
    });
  }
  chart.options = (value: TimeFilterOptions) => { options = { ...options, ...value }; return chart; };
  chart.on = (name: string, listener: Listener<RangeChangeEvent> | null) => {
    events.on(name as "rangechange", listener);
    return chart;
  };
  chart.destroy = (selection: SVGSelection<unknown>) => {
    selection.each(function() {
      const state = states.get(this);
      if (state) { state.dispose(); state.svg.remove(); states.delete(this); }
    });
  };
  return chart;
}
