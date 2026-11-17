// @vitest-environment jsdom
import { select } from "d3";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
function prepared() { return { dataset, result: runPipeline(dataset, { densityProfileBins: 4 }) }; }
function host() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.body.append(svg);
  return svg;
}
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("D3 package", () => {
  it("accepts raw input, updates a precomputed chart, and preserves consumer nodes", () => {
    const svg = host();
    const title = document.createElementNS(svg.namespaceURI, "title");
    svg.append(title);
    const chart = braidedStream();
    select(svg).datum<ChartDatum>(dataset).call(chart);
    expect(svg.querySelectorAll(".branch")).toHaveLength(2);
    select(svg).datum(prepared()).call(chart.options({ width: 800, height: 400, showDensityGradient: true }));
    expect(svg.getAttribute("viewBox")).toBe("0 0 800 400");
    expect(svg.querySelectorAll(".braided-stream-surface")).toHaveLength(1);
    expect(svg.querySelector("linearGradient")).not.toBeNull();
    chart.destroy(select(svg));
    chart.destroy(select(svg));
    expect([...svg.children]).toEqual([title]);
  });

  it("isolates SVG definitions and event state across multiple hosts", () => {
    const a = host(), b = host();
    const chart = braidedStream().options({ showDensityGradient: true });
    select(a).datum(prepared()).call(chart);
    select(b).datum(prepared()).call(chart);
    const idsA = [...a.querySelectorAll("[id]")].map(node => node.id);
    const idsB = [...b.querySelectorAll("[id]")].map(node => node.id);
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsA.some(id => idsB.includes(id))).toBe(false);
    chart.destroy(select(a));
    expect(b.querySelectorAll(".branch")).toHaveLength(2);
  });

  it("uses the cropped Y domain and actual nonuniform dates for hit testing", () => {
    const { result } = prepared();
    const input: RenderInput = {
      layers: dataset.layers, times: [...dataset.times], result,
      start: 0, end: 1, visMethod: "braided", smoothContours: true,
      showEnvelopeStroke: false, showRepresentativeStroke: false, showTimeCell: false,
      showBranchStroke: false, showYAxis: true, showDensityGradient: false,
      collapseBranches: false, hover: null, highlightLayer: null,
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
    for (const visMethod of ["braided", "star", "color-blur"] as const) {
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
  });
});
