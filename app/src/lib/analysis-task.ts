import type { InputDataset, PipelineOptions, PipelineResult } from "braided-stream/core";
import type { ImportedData } from "./import-data";
import { createWorkerTask } from "./worker-task";
export type ExampleId = "illustration" | "tcm" | "covid-inc";
export type ExampleSource = { id: ExampleId; text: string; sort?: "tpid" | "category" };
export type AnalysisRequest = ({ dataset: InputDataset } | { example: ExampleSource }) & { options: PipelineOptions };
export interface WorkerAnalysisRequest { dataset?: InputDataset; example?: ExampleSource; version: number; options: PipelineOptions }
export interface AnalysisResult {
  result: PipelineResult; perfMs: number;
  converted?: { dataset: InputDataset; metadata: { sampleSize: Readonly<Record<string, readonly number[]>> } };
}
export interface ImportAcceptance { name: string; data: ImportedData; analysis: AnalysisResult }
export function createAnalysisTask() {
  const worker = createWorkerTask<WorkerAnalysisRequest, AnalysisResult>(() => new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" }));
  type Job = { request: AnalysisRequest; resolve: (result: AnalysisResult) => void; reject: (error: unknown) => void };
  let running: Job | undefined;
  let queued: Job | undefined;
  let registered: object | undefined;
  let version = 0;
  const aborted = () => new DOMException("Cancelled", "AbortError");
  async function start(job: Job) {
    running = job;
    const source = "dataset" in job.request ? job.request.dataset : job.request.example;
    const changed = source !== registered;
    if (changed) { version++; registered = source; }
    const payload: WorkerAnalysisRequest = { version, options: job.request.options,
      ...(changed ? "dataset" in job.request ? { dataset: job.request.dataset } : { example: job.request.example } : {}) };
    try {
      const result = await worker.run(payload);
      if (running !== job) return;
      if (result.converted) registered = result.converted.dataset;
      job.resolve(result);
    } catch (error) {
      if (running !== job) return;
      registered = undefined; job.reject(error);
    } finally {
      if (running === job) {
        running = undefined;
        const next = queued; queued = undefined;
        if (next) void start(next);
      }
    }
  }
  return {
    run(request: AnalysisRequest): Promise<AnalysisResult> {
      return new Promise((resolve, reject) => {
        const job = { request, resolve, reject };
        if (running) {
          running.reject(aborted()); queued?.reject(aborted()); queued = job;
        } else void start(job);
      });
    },
    cancel() {
      running?.reject(aborted()); queued?.reject(aborted());
      running = undefined; queued = undefined; registered = undefined; worker.cancel();
    },
  };
}
