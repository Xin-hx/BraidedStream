// @vitest-environment jsdom
import { select } from "d3";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  braidedStream, streamTimeFilter, chartCoordinates, hitTest, timeRange,
  type ChartDatum, type RenderInput,
} from "braided-stream";
import { runPipeline, type InputDataset } from "braided-stream/core";

const dataset: InputDataset = {
  times: ["2022-01-01", "2022-01-02", "2022-01-10"],
  layers: ["a", "b"].map((id, i) => ({ id, measures: [1, 3, 1000].map(value => ({
    components: [{ kind: "uniform" as const, low: value, high: value * (2 + i), mass: 1 }],
  })) })),
};
function prepared() { return { dataset, result: runPipeline(dataset) }; }
function host() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.append(svg);
  return svg;
}
beforeEach(() => { vi.stubGlobal("requestAnimationFrame", undefined); });
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("D3 package", () => {
  it("reuses nodes and path strings for colors, focus and decoration changes", () => {
    const svg = host();
    const chart = braidedStream();
    const selection = select(svg).datum(prepared());
    selection.call(chart);
    const branch = svg.querySelector<SVGPathElement>(".branch")!;
    const d = branch.getAttribute("d");
    const set = vi.spyOn(branch, "setAttribute");
    selection.call(chart.options({ colorOverrides: { [branch.dataset.id!]: "#123456" }, highlightLayer: branch.dataset.id! }));
    expect(svg.querySelector(".branch")).toBe(branch);
    expect(branch.getAttribute("fill")).toBe("#123456");
    expect(set.mock.calls.some(([name]) => name === "d")).toBe(false);
    selection.call(chart.options({ showEnvelopeStroke: true, showYAxis: false }));
    expect(svg.querySelector(".branch")).toBe(branch);
    expect(branch.getAttribute("d")).toBe(d);
    expect(svg.querySelector(".envelope-stroke")).not.toBeNull();
    expect(svg.querySelector(".axis-y")).toBeNull();
    chart.destroy(selection);
  });

  it("coalesces pointer events per frame and cancels pending work on leave and destroy", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++next, callback); return next; }));
    const cancel = vi.fn((id: number) => { frames.delete(id); });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const svg = host();
    const hover = vi.fn();
    const chart = braidedStream().on("hover.test", hover);
    const selection = select(svg).datum(prepared());
    selection.call(chart);
    const branch = svg.querySelector(".branch")!;
    for (const clientX of [100, 110, 120]) branch.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY: 200 }));
    expect(frames.size).toBe(1);
    expect(hover).not.toHaveBeenCalled();
    frames.get(1)!(0); frames.delete(1);
    expect(hover).toHaveBeenCalledOnce();
    expect(hover.mock.calls[0][0].sourceEvent.clientX).toBe(120);
    branch.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 200, clientY: 200 }));
    svg.querySelector("svg")!.dispatchEvent(new MouseEvent("mouseleave"));
    expect(frames.size).toBe(0);
    branch.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 300, clientY: 200 }));
    chart.destroy(selection);
    expect(frames.size).toBe(0);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(hover).toHaveBeenCalledOnce();
  });

  it("accepts raw input, updates a precomputed chart, and preserves consumer nodes", () => {
    const svg = host();
    const title = document.createElementNS(svg.namespaceURI, "title");
    svg.append(title);
    const chart = braidedStream();
    select(svg).datum<ChartDatum>(dataset).call(chart);
    expect(svg.querySelectorAll(".branch")).toHaveLength(2);
    select(svg).datum(prepared()).call(chart.options({ width: 800, height: 400 }));
    expect(svg.getAttribute("viewBox")).toBe("0 0 800 400");
    expect(svg.querySelectorAll(".braided-stream-surface")).toHaveLength(1);
    expect(svg.querySelector("linearGradient")).toBeNull();
    chart.destroy(select(svg));
    chart.destroy(select(svg));
    expect([...svg.children]).toEqual([title]);
  });

  it("isolates SVG definitions and event state across multiple hosts", () => {
    const a = host(), b = host();
    const chart = braidedStream();
    select(a).datum(prepared()).call(chart);
    select(b).datum(prepared()).call(chart);
    const idsA = [...a.querySelectorAll("[id]")].map(node => node.id);
    const idsB = [...b.querySelectorAll("[id]")].map(node => node.id);
    expect(a.querySelector("linearGradient")).toBeNull();
    expect(idsA.some(id => idsB.includes(id))).toBe(false);
    chart.destroy(select(a));
    expect(b.querySelectorAll(".branch")).toHaveLength(2);
  });

  it("renders streamgraph as unsplit envelopes and restores braided-only marks when switching back", () => {
    const svg = host();
    const datum = prepared();
    const before = JSON.stringify(datum.result);
    const hover = vi.fn();
    const chart = braidedStream().options({
      visMethod: "streamgraph", showBranchStroke: true, showTimeCell: true,
    }).on("hover.test", hover);
    const selection = select(svg).datum(datum);
    selection.call(chart);
    expect(svg.querySelectorAll(".streamgraph")).toHaveLength(dataset.layers.length);
    for (const path of svg.querySelectorAll(".streamgraph")) {
      const id = path.getAttribute("data-owner-layer");
      expect(path.getAttribute("d")).toBe(svg.querySelector(`.envelope-hit[data-owner-layer="${id}"]`)!.getAttribute("d"));
    }
    expect(svg.querySelector(".branch, .space-hit, .allocated-space, .branch-stroke, .time-cell, .density-bands")).toBeNull();
    const path = svg.querySelector(".streamgraph")!;
    path.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 200 }));
    expect(hover.mock.calls[0][0].layerId).toBe(path.getAttribute("data-owner-layer"));
    selection.call(chart.options({ visMethod: "braided" }));
    expect(svg.querySelector(".streamgraph")).toBeNull();
    for (const mark of [".branch", ".space-hit", ".branch-stroke", ".time-cell"]) {
      expect(svg.querySelector(mark)).not.toBeNull();
    }
    expect(JSON.stringify(datum.result)).toBe(before);
  });

  it("uses the cropped Y domain and actual nonuniform dates for hit testing", () => {
    const { result } = prepared();
    const input: RenderInput = {
      layers: dataset.layers, times: [...dataset.times], result,
      start: 0, end: 1, visMethod: "braided", smoothContours: true,
      showEnvelopeStroke: false, showRepresentativeStroke: false, showTimeCell: false,
      showBranchStroke: false, showYAxis: true,
      hover: null, highlightLayer: null,
    };
    const crop = chartCoordinates(input);
    const mid = (crop.bottom[0][1] + crop.top[0][1]) / 2;
    expect(hitTest(input, crop.x(crop.xValues[1]), crop.y(mid))).toMatchObject({ timeIndex: 1, layerId: result.layoutOrder[0] });
    expect(hitTest(input, 0, 0)).toBeNull();
    input.end = 2;
    const all = chartCoordinates(input);
    expect(hitTest(input, 64 + 1088 * 0.15, 200)?.timeIndex).toBe(1);
    expect(all.x(all.xValues[1])).toBeLessThan(250);
  });

  it("does not accumulate listeners or redraw paths while hovering", () => {
    const svg = host();
    const callback = vi.fn(), leave = vi.fn();
    const chart = braidedStream().on("hover.test", callback).on("leave.test", leave);
    const selection = select(svg).datum(prepared());
    selection.call(chart).call(chart);
    const path = svg.querySelector(".branch")!;
    path.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 200 }));
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].layerId).toBe(path.getAttribute("data-owner-layer"));
    expect(svg.querySelector(".branch")).toBe(path);
    expect(svg.querySelector(".hover-line")).not.toBeNull();
    const surface = svg.querySelector("svg")!;
    surface.dispatchEvent(new MouseEvent("mouseleave"));
    expect(leave).toHaveBeenCalledOnce();
    expect(svg.querySelector(".hover-line")).toBeNull();
    chart.on("hover.test", null);
    path.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 200 }));
    expect(callback).toHaveBeenCalledOnce();
    chart.destroy(selection);
    surface.dispatchEvent(new MouseEvent("mouseleave"));
    expect(leave).toHaveBeenCalledOnce();
  });

  it("brushes a time interval without emitting for programmatic updates", () => {
    // A fresh window avoids Vitest 2's global proxy replacement in jsdom 30.
    const dom = new JSDOM('<svg id="filter"></svg>');
    const svg = dom.window.document.getElementById("filter") as unknown as SVGSVGElement;
    const callback = vi.fn();
    const filter = streamTimeFilter().on("rangechange.test", callback);
    const selection = select(svg).datum(prepared());
    selection.call(filter).call(filter.options({ start: 1, end: 2 }));
    expect(callback).not.toHaveBeenCalled();
    const view = dom.window;
    svg.querySelector(".overlay")!.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 30, view }));
    view.dispatchEvent(new view.MouseEvent("mousemove", { clientX: 700, clientY: 30, view }));
    view.dispatchEvent(new view.MouseEvent("mouseup", { clientX: 700, clientY: 30, view }));
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toEqual({ start: 0, end: 1 });
    svg.querySelector(".overlay")!.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 30, view }));
    filter.destroy(selection);
    view.dispatchEvent(new view.MouseEvent("mousemove", { clientX: 800, clientY: 30, view }));
    view.dispatchEvent(new view.MouseEvent("mouseup", { clientX: 800, clientY: 30, view }));
    expect(callback).toHaveBeenCalledOnce();
    expect(svg.children).toHaveLength(0);
  });

  it("renders all methods with the target ownerDocument and no global document", () => {
    const svg = host();
    const { result } = prepared();
    const chart = braidedStream();
    vi.stubGlobal("document", undefined);
    for (const visMethod of ["braided", "streamgraph"] as const) {
      select(svg).datum({ dataset, result }).call(chart.options({ visMethod }));
      expect(svg.querySelector("path")).not.toBeNull();
      expect(svg.outerHTML).not.toMatch(/NaN|undefined/);
    }
    chart.destroy(select(svg));
  });

  it("normalizes time bounds, supports one time point, and rejects invalid dimensions", () => {
    expect(timeRange(3, -10, 99)).toEqual([0, 2]);
    expect(timeRange(3, 2, 0)).toEqual([2, 2]);
    expect(() => timeRange(0)).toThrow();
    expect(() => timeRange(3, NaN)).toThrow();
    const svg = host();
    const single = { ...dataset, times: ["t1"], layers: dataset.layers.map(layer => ({ ...layer, measures: [layer.measures[0]] })) };
    select(svg).datum(single).call(braidedStream());
    expect(svg.outerHTML).not.toMatch(/NaN|undefined/);
    expect(() => select(svg).datum(dataset).call(braidedStream().options({ width: 10 }))).toThrow(/dimensions/);
    expect(() => {
      // @ts-expect-error Exercise a removed method supplied by an old JavaScript caller.
      select(svg).datum(dataset).call(braidedStream().options({ visMethod: "star" }));
    }).toThrow(/visMethod/);
  });
});
