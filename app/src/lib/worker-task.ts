import type { ImportProgress, ProgressCallback } from "./import-data";
export interface TaskRequest<T> { id: number; payload: T }
export type TaskReply<T> = { id: number; result: T } | { id: number; error: string } | { id: number; progress: ImportProgress };
type TaskWorker = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;

/** One cancellable task at a time; terminating the worker also stops synchronous parsing/analysis. */
export function createWorkerTask<Input, Output>(factory: () => TaskWorker) {
  let worker: TaskWorker | undefined;
  let sequence = 0;
  let pending: { id: number; resolve: (result: Output) => void; reject: (error: Error) => void; progress?: ProgressCallback } | undefined;
  function cancel() {
    worker?.terminate(); worker = undefined;
    pending?.reject(new DOMException("Cancelled", "AbortError")); pending = undefined;
  }
  function run(payload: Input, progress?: ProgressCallback): Promise<Output> {
    if (pending) cancel();
    return new Promise((resolve, reject) => {
      try {
        if (!worker) {
          worker = factory();
          const activeWorker = worker;
          worker.onmessage = (event: MessageEvent<TaskReply<Output>>) => {
            const reply = event.data;
            if (!pending || reply.id !== pending.id) return;
            if ("progress" in reply) { pending.progress?.(reply.progress); return; }
            const task = pending; pending = undefined;
            if ("error" in reply) task.reject(new Error(reply.error)); else task.resolve(reply.result);
          };
          worker.onerror = (event: ErrorEvent) => {
            if (worker !== activeWorker) return;
            pending?.reject(new Error(event.message || "Background processing failed. Try a smaller file."));
            pending = undefined; worker?.terminate(); worker = undefined;
          };
        }
        pending = { id: ++sequence, resolve, reject, progress };
        worker.postMessage({ id: sequence, payload } satisfies TaskRequest<Input>);
      } catch (error) { pending = undefined; worker?.terminate(); worker = undefined; reject(error); }
    });
  }
  return { run, cancel };
}
