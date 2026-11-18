import { createWorkerTask } from "./worker-task";
import type { ImportMapping, ImportPreview, ImportedData } from "./import-data";
import type { ReadSettings } from "./read-import";
export type ImportCommand = { type: "read"; file: File; settings: ReadSettings } | { type: "preview"; sheet: number; headerRow: number } | { type: "convert"; mapping: ImportMapping };
export type ImportOutcome = { type: "preview"; preview: ImportPreview } | { type: "converted"; data: ImportedData };
export function createImportTask() {
  return createWorkerTask<ImportCommand, ImportOutcome>(() => new Worker(new URL("../workers/import.worker.ts", import.meta.url), { type: "module" }));
}
