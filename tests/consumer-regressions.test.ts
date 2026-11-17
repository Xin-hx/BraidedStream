import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const renderChart = vi.fn();
const runPipeline = vi.fn((dataset: { layers: Array<{ id: string }>; times: string[] }) => ({
  layoutOrder: dataset.layers.map((layer) => layer.id),
  base: {
    yBottom: dataset.layers.map(() => dataset.times.map(() => 0)),
    yTop: dataset.layers.map(() => dataset.times.map(() => 1)),
  },
  braided: {
    layers: dataset.layers.map((layer) => ({
      layerId: layer.id,
      slotY0: dataset.times.map(() => 0),
      slotY1: dataset.times.map(() => 1),
      balance: dataset.times.map(() => 0),
      branchCount: dataset.times.map(() => 1),
      missing: dataset.times.map(() => false),
      debug: dataset.times.map(() => ({
        dispersion: 0, deviationLow: 0, deviationHigh: 0,
        branchMasses: [1], gaps: [],
      })),
    })),
  },
  pid: {
    ranking: dataset.layers.map((layer) => layer.id),
    depth: Object.fromEntries(dataset.layers.map((layer) => [layer.id, 0])),
    defined: false,
  },
  costs: {},
}));

vi.mock("../code/index", () => ({ runPipeline }));
vi.mock("../demo/render", () => ({
  M: { left: 0, right: 0, top: 0, bottom: 0 }, W: 100, H: 100,
  diseaseDay: () => Number.NaN,
  exportSvg: vi.fn(),
  renderChart,
  renderTimeFilter: vi.fn(),
}));
vi.mock("../demo/legend", () => ({
  createLegendController: () => ({
    getLayoutOrder: (ids: string[]) => ids,
    getAppearance: () => ({ colorOverrides: {}, palette: "default" }),
    update: vi.fn(),
  }),
}));

type PendingFetch = {
  path: string;
  resolve: (response: { ok: boolean; status: number; text: () => Promise<string> }) => void;
  reject: (error: Error) => void;
};

describe("demo data consumer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("commits only the latest controlled fetch and renders tooltip labels as text", async () => {
    const dom = new JSDOM(readFileSync("index.html", "utf8"), { url: "http://localhost/" });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Element: dom.window.Element,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLSelectElement: dom.window.HTMLSelectElement,
      SVGElement: dom.window.SVGElement,
      SVGSVGElement: dom.window.SVGSVGElement,
    });
    const pending: PendingFetch[] = [];
    vi.stubGlobal("fetch", vi.fn((path: string) => new Promise((resolve, reject) => {
      pending.push({ path, resolve, reject });
    })));

    const module = await import("../demo/main");
    expect(pending.map((request) => request.path)).toEqual(["dataset/illustration.csv"]);
    pending.shift()!.resolve(ok("category,time,value\na,t1,1\na,t2,2"));
    await settle();

    const select = document.getElementById("ctl-dataset") as HTMLSelectElement;
    select.value = "tcm";
    select.dispatchEvent(new dom.window.Event("change"));
    select.value = "illustration";
    select.dispatchEvent(new dom.window.Event("change"));
    expect(pending.map((request) => request.path)).toEqual([
      "dataset/TCMRecord.csv", "dataset/illustration.csv",
    ]);

    pending[1].resolve(ok('category,time,value\n<img src=x onerror="this.dataset.executed=1">,t1,1\n<img src=x onerror="this.dataset.executed=1">,t2,2'));
    await settle();
    pending[0].resolve(ok(tcmText()));
    await settle();

    const malicious = '<img src=x onerror="this.dataset.executed=1">';
    expect(runPipeline.mock.calls.at(-1)![0].layers[0].id).toBe(malicious);
    expect(renderChart.mock.calls.at(-1)![1].layers[0]).toEqual({ id: malicious });
    module.showTooltip(0, malicious);
    const tooltip = document.getElementById("tooltip")!;
    expect(tooltip.textContent).toContain(malicious);
    expect(tooltip.querySelector("img")).toBeNull();

    pending.length = 0;
    select.value = "covid-inc";
    select.dispatchEvent(new dom.window.Event("change"));
    pending[0].reject(new Error("controlled failure"));
    await settle();
    expect(document.getElementById("costs")!.textContent).toContain("controlled failure");
  });
});

function ok(text: string) {
  return { ok: true, status: 200, text: async () => text };
}

function tcmText(): string {
  const visits = JSON.stringify([
    { date: "2022-01-01", categories: { A: 1 } },
    { date: "2022-01-02", categories: { A: 2 } },
  ]).replaceAll('"', '""');
  return `patient_id,weight,prescriptions_json,categorized_prescriptions_json\np,1,"[]","${visits}"`;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
