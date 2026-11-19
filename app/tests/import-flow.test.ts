// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalysisProcessor } from "../src/lib/analysis-processor";
import App from "../src/App.vue";
import { parseImport } from "../src/lib/read-import";
import { convertSource, makePreview, type ImportSource, type ImportPreview } from "../src/lib/import-data";
import type { ImportCommand } from "../src/lib/import-task";
import type { WorkerAnalysisRequest } from "../src/lib/analysis-task";
import type { TaskRequest } from "../src/lib/worker-task";

const workers: BrowserWorker[] = [];
const waiting: (() => void)[] = [];
let holdAnalysis = false;
class BrowserWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  source?: ImportSource;
  preview?: ImportPreview;
  process = createAnalysisProcessor();
  constructor() { workers.push(this); }
  terminate() { this.terminated = true; }
  postMessage(request: TaskRequest<ImportCommand | WorkerAnalysisRequest>) {
    queueMicrotask(async () => {
      if (this.terminated) return;
      const { id, payload } = request;
      const send = (data: unknown) => this.onmessage?.({ data: { id, ...data as object } } as MessageEvent);
      try {
        if (!("type" in payload)) {
          const complete = () => send({ result: this.process(payload) });
          if (holdAnalysis) waiting.push(complete); else complete();
        } else if (payload.type === "read") {
          const bytes = await new Promise<ArrayBuffer>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(payload.file); });
          if (this.terminated) return;
          this.source = await parseImport(bytes, payload.file.name.split(".").at(-1)!, payload.settings);
          this.preview = makePreview(this.source);
          send({ result: { type: "preview", preview: this.preview } });
        } else if (payload.type === "preview") {
          this.preview = makePreview(this.source!, payload.sheet, payload.headerRow);
          send({ result: { type: "preview", preview: this.preview } });
        } else {
          send({ result: { type: "converted", data: convertSource(this.source!, this.preview!, payload.mapping) } });
        }
      } catch (error) { send({ error: error instanceof Error ? error.message : String(error) }); }
    });
  }
}
let wrapper: VueWrapper | undefined;
beforeEach(() => {
  vi.stubGlobal("Worker", BrowserWorker);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "category,time,value\nExample,t1,1\nExample,t2,2" })));
  holdAnalysis = false; workers.length = 0; waiting.length = 0;
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals();
});
async function start() {
  wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  await wrapper.get("#btn-import").trigger("click");
  await vi.waitFor(() => expect(wrapper!.find("#import-title").exists()).toBe(true));
  return wrapper;
}
async function choose(wrapper: VueWrapper, text: string, name = "private-data.csv") {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", { configurable: true, value: [new File([text], name)] });
  await input.trigger("change");
  await vi.waitFor(() => expect(wrapper.find(".import-layouts, .import-unified").exists()).toBe(true));
}
function button(wrapper: VueWrapper, text: string) { return wrapper.findAll("button").find(button => button.text() === text)!; }

describe("guided data import", () => {
  it("previews, maps and imports locally without persisting records, then recalculates custom data in a worker", async () => {
    const view = await start();
    await choose(view, "time,category,value\nt1,Private cohort,3\nt1,Private cohort,7\nt2,Private cohort,4");
    expect(view.get(".import-table").text()).toContain("Private cohort");
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-stats").exists()).toBe(true));
    await button(view, "Import & visualize").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-dialog").exists()).toBe(false));
    expect((view.get("#ctl-dataset").element as HTMLSelectElement).value).toBe("custom");
    expect(view.find('[data-id="Private cohort"]').exists()).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(3); // Built-in analysis, file parsing, and import analysis have separate workers.
    await view.get('.legend-color[aria-label="Color for Private cohort"]').setValue("#123456");
    expect(localStorage.getItem("braidedstream:appearance:v1")).not.toContain("Private cohort");
    expect(localStorage.getItem("braidedstream:appearance:v1")).not.toContain("private-data.csv");
    await view.get("#ctl-bandwidth-ratio").setValue("0.5");
    await flushPromises();
    expect(workers).toHaveLength(4);
    await button(view, "Remove data").trigger("click");
    await flushPromises();
    expect(view.find('#ctl-dataset option[value="custom"]').exists()).toBe(false);
  });

  it("shows a cancellable calculation indicator and retains the previous chart on cancellation", async () => {
    const view = await start();
    const previous = view.get(".branch").attributes("d");
    await choose(view, "time,category,value\nt1,New layer,4\nt2,New layer,5");
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-stats").exists()).toBe(true));
    holdAnalysis = true;
    await button(view, "Import & visualize").trigger("click");
    await flushPromises();
    expect(view.get(".import-progress").text()).toContain("Calculating layout");
    expect(view.find(".import-progress progress").exists()).toBe(false); // No invented percentage for opaque analysis.
    expect(view.get(".branch").attributes("d")).toBe(previous);
    await button(view, "Cancel import").trigger("click");
    waiting.splice(0).forEach(complete => complete());
    await flushPromises();
    expect(view.find(".import-dialog").exists()).toBe(false);
    expect(view.get(".branch").attributes("d")).toBe(previous);
    expect((view.get("#ctl-dataset").element as HTMLSelectElement).value).toBe("illustration");
    expect(workers[0].terminated).toBe(false);
    expect(workers.slice(1).every(worker => worker.terminated)).toBe(true);
  });

  it("keeps malformed data out of the chart and renders preview labels as text", async () => {
    const view = await start();
    const name = '<img src=x onerror="alert(1)">';
    await choose(view, `time,category,value\nt1,${name},-1\nt2,${name},2`);
    expect(view.get(".import-table").text()).toContain(name);
    expect(view.get(".import-table").find("img").exists()).toBe(false);
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-error").exists()).toBe(true));
    expect(view.get(".import-error").text()).toContain("Row 2");
    expect(view.find(".import-stats").exists()).toBe(false);
    expect(view.find('[data-id="Example"]').exists()).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it("accepts the unified JSON format without column mapping", async () => {
    const view = await start();
    await choose(view, JSON.stringify({ times: ["t1"], layers: [{ id: "JSON layer", measures: [{ components: [{ kind: "atom", value: 2, mass: 1 }] }] }] }), "input.json");
    expect(view.find(".import-layouts").exists()).toBe(false);
    expect(view.get(".import-unified").text()).toContain("Unified JSON detected");
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-stats").exists()).toBe(true));
    await button(view, "Import & visualize").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-dialog").exists()).toBe(false));
    expect(view.find('[data-id="JSON layer"]').exists()).toBe(true);
  });

  it("lets users define a distribution by multiple fields and select its ensemble member identity", async () => {
    const view = await start();
    await choose(view, "time,category,scenario,member,value,weight\nt1,A,base,m1,2,1\nt1,A,base,m2,4,3\nt1,A,alternate,m1,8,1");
    await view.get('.import-groups input[value="2"]').setValue(true);
    await view.get('.import-members input[value="3"]').setValue(true);
    expect(view.get(".import-definition").text()).toContain("time × category × scenario");
    expect(view.get(".import-definition").text()).toContain("member");
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-stats").exists()).toBe(true));
    expect(view.get(".import-definition").text()).toContain("category × scenario");
    expect(view.get(".import-stats").text()).toContain("1–2");
    expect(view.find(".import-notes").exists()).toBe(false);
    expect(view.text()).not.toContain("Validated against the same input contract");
    await button(view, "Import & visualize").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-dialog").exists()).toBe(false));
    expect(view.findAll(".branch").map(path => path.attributes("data-id"))).toEqual(expect.arrayContaining(['["A","base"]', '["A","alternate"]']));
  });

  it("reports duplicate identified members and allows choosing independent observations instead", async () => {
    const view = await start();
    await choose(view, "time,category,member,value\nt1,A,m1,2\nt1,A,m1,4");
    await view.get('.import-members input[value="2"]').setValue(true);
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-error").exists()).toBe(true));
    expect(view.get(".import-error").text()).toContain("duplicate member");
    await view.get('.import-members input[value="2"]').setValue(false);
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-stats").exists()).toBe(true));
    expect(view.find(".import-error").exists()).toBe(false);
    expect(view.get(".import-definition").text()).toContain("row");
  });

  it("lets users map histogram intervals without inventing ensemble members", async () => {
    const view = await start();
    await choose(view, "time,category,low,high,mass\nt1,A,0,2,1\nt1,A,2,4,3");
    await view.get("#import-representation").setValue("distribution");
    expect((view.get("#import-support").element as HTMLSelectElement).value).toBe("intervals");
    expect(view.find(".import-members").exists()).toBe(false);
    expect((view.get("#import-weight").element as HTMLSelectElement).value).toBe("4");
    await button(view, "Validate & review").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-stats").exists()).toBe(true));
    expect(view.get(".import-definition").text()).toContain("Weighted intervals");
    expect(view.get(".import-stats").text()).not.toContain("Members / distribution");
    await button(view, "Import & visualize").trigger("click");
    await vi.waitFor(() => expect(view.find(".import-dialog").exists()).toBe(false));
    expect(view.find('[data-id="A"]').exists()).toBe(true);
  });
});
