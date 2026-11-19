import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalysisTask, type WorkerAnalysisRequest, type AnalysisResult } from "../src/lib/analysis-task";
import type { TaskRequest } from "../src/lib/worker-task";

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  reply(id: number) { this.onmessage?.({ data: { id, result: { result: {}, perfMs: 1 } as AnalysisResult } } as MessageEvent); }
  payload(call: number) { return (this.postMessage.mock.calls[call][0] as TaskRequest<WorkerAnalysisRequest>).payload; }
}
const dataset = { times: ["t"], layers: [{ id: "a", measures: [{ components: [{ kind: "atom" as const, value: 1, mass: 1 }] }] }] };
afterEach(() => { TestWorker.instances = []; vi.unstubAllGlobals(); });

describe("persistent analysis scheduling", () => {
  it("registers data once, retains the worker and only runs the newest waiting request", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const task = createAnalysisTask();
    const first = task.run({ dataset, options: {} });
    const worker = TestWorker.instances[0];
    expect(worker.payload(0).dataset).toBe(dataset);
    worker.reply(1); await first;
    const active = task.run({ dataset, options: { baselineMode: "sine" } });
    const activeCancelled = expect(active).rejects.toMatchObject({ name: "AbortError" });
    const middle = task.run({ dataset, options: { braided: { bandwidthRatio: .4 } } });
    const middleCancelled = expect(middle).rejects.toMatchObject({ name: "AbortError" });
    const latest = task.run({ dataset, options: { braided: { bandwidthRatio: .8 } } });
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.payload(1).dataset).toBeUndefined();
    worker.reply(2);
    await activeCancelled; await middleCancelled;
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    expect(worker.payload(2).options.braided?.bandwidthRatio).toBe(.8);
    expect(worker.payload(2).dataset).toBeUndefined();
    worker.reply(3); await latest;
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(TestWorker.instances).toHaveLength(1);
    task.cancel();
  });

  it("registers the latest dataset after queued changes and recovers from hard cancellation", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const task = createAnalysisTask();
    const first = task.run({ dataset, options: {} });
    const firstCancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const secondDataset = structuredClone(dataset);
    const second = task.run({ dataset: secondDataset, options: {} });
    const secondCancelled = expect(second).rejects.toMatchObject({ name: "AbortError" });
    const thirdDataset = structuredClone(dataset);
    const third = task.run({ dataset: thirdDataset, options: {} });
    const worker = TestWorker.instances[0];
    worker.reply(1); await firstCancelled; await secondCancelled;
    expect(worker.payload(1).dataset).toBe(thirdDataset);
    expect(worker.payload(1).version).toBe(2);
    const thirdCancelled = expect(third).rejects.toMatchObject({ name: "AbortError" });
    task.cancel(); await thirdCancelled;
    const retry = task.run({ dataset: thirdDataset, options: {} });
    expect(TestWorker.instances[1].payload(0).dataset).toBe(thirdDataset);
    worker.reply(2);
    TestWorker.instances[1].reply(3); await retry;
    task.cancel();
  });
});
