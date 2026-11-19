// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { createAnalysisProcessor } from "../src/lib/analysis-processor";
import type { WorkerAnalysisRequest } from "../src/lib/analysis-task";
import type { TaskRequest } from "../src/lib/worker-task";
const runAnalysis = vi.fn();
class AnalysisWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  process = createAnalysisProcessor();
  terminated = false;
  terminate() { this.terminated = true; }
  postMessage({ id, payload }: TaskRequest<WorkerAnalysisRequest>) {
    queueMicrotask(() => {
      if (this.terminated) return;
      runAnalysis(payload);
      try { this.onmessage?.({ data: { id, result: this.process(payload) } } as MessageEvent); }
      catch (error) { this.onmessage?.({ data: { id, error: String(error) } } as MessageEvent); }
    });
  }
}

type PendingFetch = {
  path: string;
  resolve: (response: { ok: boolean; status: number; text: () => Promise<string> }) => void;
  reject: (error: Error) => void;
};
const wrappers: ReturnType<typeof mount>[] = [];
function setup() {
  vi.stubGlobal("Worker", AnalysisWorker);
  vi.stubGlobal("requestAnimationFrame", undefined);
  const pending: PendingFetch[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string) => new Promise((resolve, reject) => {
    pending.push({ path, resolve, reject });
  })));
  const wrapper = mount(App, { attachTo: document.body });
  wrappers.push(wrapper);
  return { wrapper, pending };
}
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Vue app consumer", () => {
  it("commits only the latest fetch and renders tooltip labels as text", async () => {
    const { wrapper, pending } = setup();
    expect(pending.map(request => request.path)).toEqual(["dataset/illustration.csv"]);
    pending.shift()!.resolve(ok("category,time,value\na,t1,1\na,t2,2"));
    await flushPromises();
    await wrapper.get("#ctl-dataset").setValue("tcm");
    await wrapper.get("#ctl-dataset").setValue("illustration");
    expect(pending.map(request => request.path)).toEqual(["dataset/TCMRecord.csv", "dataset/illustration.csv"]);
    const malicious = '<img src=x onerror="this.dataset.executed=1">';
    pending[1].resolve(ok(`category,time,value\n${malicious},t1,1\n${malicious},t2,2`));
    await flushPromises();
    pending[0].resolve(ok(tcmText()));
    await flushPromises();
    expect(wrapper.findAll(".branch").map(path => path.attributes("data-id"))).toEqual([malicious]);
    await wrapper.get(".branch").trigger("mousemove", { clientX: 100, clientY: 150 });
    expect(wrapper.get("#tooltip").text()).toContain(malicious);
    expect(wrapper.get("#tooltip").find("img").exists()).toBe(false);
    await wrapper.get(".braided-stream-surface").trigger("mouseleave");
    expect(wrapper.get("#tooltip").classes()).toContain("hidden");
    pending.length = 0;
    await wrapper.get("#ctl-dataset").setValue("covid-inc");
    pending[0].reject(new Error("controlled failure"));
    await flushPromises();
    expect(wrapper.get("#costs").text()).toContain("controlled failure");
  });

  it("updates appearance without recomputing, persists colors, and cleans up on unmount", async () => {
    const { wrapper, pending } = setup();
    pending[0].resolve(ok("category,time,value\na,t1,1\na,t2,2\nb,t1,2\nb,t2,3"));
    await flushPromises();
    const count = runAnalysis.mock.calls.length;
    const overviewPath = wrapper.get("#time-filter path").element;
    const chartPath = wrapper.get(".branch").element;
    await wrapper.get("#ctl-y-axis").setValue(false);
    expect(wrapper.get("#time-filter path").element).toBe(overviewPath);
    await wrapper.get("#ctl-legend-palette").setValue("set2");
    await wrapper.get('.legend-color[aria-label="Color for a"]').setValue("#123456");
    await wrapper.get('.legend-select[aria-label="Focus layer a"]').trigger("click");
    expect(runAnalysis.mock.calls).toHaveLength(count);
    expect(JSON.parse(localStorage.getItem("braidedstream:appearance:v1")!).colors["illustration:a"]).toBe("#123456");
    expect(wrapper.get('[data-id="a"]').attributes("fill")).toBe("#123456");
    expect(wrapper.get(".branch").element).toBe(chartPath);
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:chart-test");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) {
      expect(this.download).toBe("braided-streamgraph.svg");
      expect(this.href).toBe("blob:chart-test");
    });
    await wrapper.get("#btn-svg").trigger("click");
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0].size).toBeGreaterThan(0);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    const surface = wrapper.get(".braided-stream-surface").element;
    wrapper.unmount();
    wrappers.pop();
    expect(surface.isConnected).toBe(false);
  });

  it("recomputes for algorithm changes and aborts a pending load on unmount", async () => {
    const { wrapper, pending } = setup();
    const fetchMock = vi.mocked(fetch);
    pending[0].resolve(ok("category,time,value\na,t1,1\na,t2,2"));
    await flushPromises();
    const count = runAnalysis.mock.calls.length;
    await wrapper.get("#ctl-bandwidth-ratio").setValue("0.5");
    expect(runAnalysis.mock.calls.length).toBe(count + 1);
    await wrapper.get("#ctl-dataset").setValue("tcm");
    const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
    wrapper.unmount();
    wrappers.pop();
    expect(signal.aborted).toBe(true);
    pending[1].resolve(ok(tcmText()));
    await flushPromises();
    expect(runAnalysis.mock.calls.length).toBe(count + 1);
  });

  it("keeps legend order and focus consistent when collapsing, expanding and hiding", async () => {
    const { wrapper, pending } = setup();
    pending[0].resolve(ok("category,time,value\na,t1,1\na,t2,2\nb,t1,2\nb,t2,3\nc,t1,4\nc,t2,2"));
    await flushPromises();
    const names = () => wrapper.findAll(".legend-name").map(item => item.text());
    const expandedOrder = names();
    const header = wrapper.get(".legend-header").element;
    expect(wrapper.get("#legend").element.parentElement).toBe(wrapper.get(".chart-stage").element);
    await wrapper.get('[aria-label="Minimize legend"]').trigger("click");
    expect(names()).toEqual(expandedOrder);
    expect(wrapper.get(".legend-header").element).toBe(header);
    expect(wrapper.get('[aria-label="Restore legend"]').attributes("aria-expanded")).toBe("false");
    await wrapper.get('[aria-label="Focus layer a"]').trigger("click");
    expect(wrapper.get('[aria-label="Focus layer a"]').attributes("aria-pressed")).toBe("true");
    await wrapper.get('[aria-label="Restore legend"]').trigger("click");
    expect(names()).toEqual(expandedOrder);
    expect(wrapper.get('[aria-label="Focus layer a"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.findAll(".legend-color")).toHaveLength(3);
    await wrapper.get('[aria-label="Hide legend"]').trigger("click");
    expect(wrapper.get("#legend").isVisible()).toBe(false);
    await wrapper.get("#ctl-legend").setValue(true);
    expect(wrapper.get("#legend").isVisible()).toBe(true);
  });

  it("offers streamgraph as the base method without a collapse button or legacy effects", async () => {
    const { wrapper, pending } = setup();
    pending[0].resolve(ok("category,time,value\na,t1,1\na,t2,2\nb,t1,2\nb,t2,3"));
    await flushPromises();
    expect(wrapper.findAll("#ctl-vis-method option").map(option => option.attributes("value"))).toEqual(["streamgraph", "braided"]);
    expect(wrapper.find("#btn-collapse").exists()).toBe(false);
    expect(wrapper.find("#ctl-density-gradient").exists()).toBe(false);
    const count = runAnalysis.mock.calls.length;
    await wrapper.get("#ctl-vis-method").setValue("streamgraph");
    expect(wrapper.findAll(".streamgraph")).toHaveLength(2);
    for (const id of ["time-cell", "branch-stroke"]) {
      expect(wrapper.get(`#ctl-${id}`).attributes("disabled")).toBeDefined();
    }
    expect(wrapper.find(".density-bands").exists()).toBe(false);
    expect(runAnalysis.mock.calls).toHaveLength(count);
    await wrapper.get("#ctl-vis-method").setValue("braided");
    expect(wrapper.findAll(".branch")).toHaveLength(2);
    expect(wrapper.find(".density-bands").exists()).toBe(false);
    expect(runAnalysis.mock.calls).toHaveLength(count);
  });
});

function ok(text: string) { return { ok: true, status: 200, text: async () => text }; }
function tcmText(): string {
  const visits = JSON.stringify([
    { date: "2022-01-01", categories: { A: 1 } },
    { date: "2022-01-02", categories: { A: 2 } },
  ]).replaceAll('"', '""');
  return `patient_id,weight,prescriptions_json,categorized_prescriptions_json\np,1,"[]","${visits}"`;
}
