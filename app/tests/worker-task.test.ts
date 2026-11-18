import { describe, expect, it, vi } from "vitest";
import { createWorkerTask } from "../src/lib/worker-task";
class TestWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
describe("cancellable background tasks", () => {
  it("reports measured progress and ignores replies/errors from a cancelled worker", async () => {
    const workers: TestWorker[] = [];
    const task = createWorkerTask<string, string>(() => { const worker = new TestWorker(); workers.push(worker); return worker; });
    const progress = vi.fn();
    const old = task.run("first", progress);
    const cancelled = expect(old).rejects.toMatchObject({ name: "AbortError" });
    workers[0].reply({ id: 1, progress: { label: "Reading", fraction: .5 } });
    expect(progress).toHaveBeenCalledWith({ label: "Reading", fraction: .5 });
    task.cancel(); await cancelled;
    const current = task.run("second");
    workers[0].reply({ id: 1, result: "stale" });
    workers[0].onerror?.({ message: "stale failure" } as ErrorEvent);
    workers[1].reply({ id: 2, result: "new" });
    await expect(current).resolves.toBe("new");
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it("surfaces worker errors and supports retry", async () => {
    const worker = new TestWorker();
    const task = createWorkerTask<string, string>(() => worker);
    const failed = task.run("bad");
    worker.reply({ id: 1, error: "Row 4: invalid value" });
    await expect(failed).rejects.toThrow(/Row 4/);
    const retry = task.run("fixed");
    worker.reply({ id: 2, result: "ok" });
    await expect(retry).resolves.toBe("ok");
  });
});
