import type { InputDataset, PipelineOptions, PipelineResult } from "braided-stream/core";
import type { ImportedData } from "./import-data";
import { createWorkerTask } from "./worker-task";
export interface AnalysisRequest { dataset: InputDataset; options: PipelineOptions }
export interface AnalysisResult { result: PipelineResult; perfMs: number }
export interface ImportAcceptance { name: string; data: ImportedData; analysis: AnalysisResult }
export function createAnalysisTask() {
  return createWorkerTask<AnalysisRequest, AnalysisResult>(() => new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" }));
}
