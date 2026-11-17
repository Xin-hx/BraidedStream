import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { colorForLayer, renderTimeFilter } from "braided-stream";
import type { PipelineResult } from "braided-stream/core";

describe("time filter consumer", () => {
  it("falls back to the pipeline layout order when no override is supplied", () => {
    const dom = new JSDOM('<svg id="filter"></svg>');
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      SVGElement: dom.window.SVGElement,
    });
    const layers = [{ id: "a" }, { id: "b" }];
    const result = {
      layoutOrder: ["b", "a"],
      base: { baseline: [0, 0], yBottom: [[0, 0], [1, 1]], yTop: [[1, 1], [2, 2]] },
      braided: { layers: [
        { missing: [false, false] },
        { missing: [false, false] },
      ] },
    } as unknown as PipelineResult;
    const svg = document.getElementById("filter") as unknown as SVGSVGElement;
    renderTimeFilter(svg, {
      layers,
      times: ["t1", "t2"],
      result,
      start: 0,
      end: 1,
      onChange: () => undefined,
    });
    const fills = [...svg.querySelectorAll("path[fill]")].map((path) => path.getAttribute("fill"));
    expect(fills).toEqual([
      colorForLayer(layers, "b"),
      colorForLayer(layers, "a"),
    ]);
  });
});
