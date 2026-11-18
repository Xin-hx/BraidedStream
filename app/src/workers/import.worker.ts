import { convertSource, makePreview, IMPORT_LIMITS, type ImportSource, type ImportPreview, type ProgressCallback } from "../lib/import-data";
import { parseImport } from "../lib/read-import";
import type { ImportCommand, ImportOutcome } from "../lib/import-task";
import type { TaskRequest, TaskReply } from "../lib/worker-task";

let source: ImportSource | undefined;
let preview: ImportPreview | undefined;
async function command(payload: ImportCommand, progress: ProgressCallback): Promise<ImportOutcome> {
  if (payload.type === "read") {
    if (payload.file.size > IMPORT_LIMITS.bytes) throw new Error("Choose a file smaller than 25 MB.");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = event => progress({ label: "Reading file locally", fraction: event.lengthComputable ? event.loaded / event.total : undefined });
      reader.onerror = () => reject(new Error("Could not read this file. Select it again."));
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(payload.file);
    });
    source = await parseImport(bytes, payload.file.name.split(".").at(-1)!.toLowerCase(), payload.settings, progress);
    preview = makePreview(source);
    return { type: "preview", preview };
  }
  if (!source || !preview) throw new Error("Choose a file first.");
  if (payload.type === "preview") {
    preview = makePreview(source, payload.sheet, payload.headerRow);
    return { type: "preview", preview };
  }
  return { type: "converted", data: convertSource(source, preview, payload.mapping, progress) };
}
self.addEventListener("message", async (event: MessageEvent<TaskRequest<ImportCommand>>) => {
  const { id, payload } = event.data;
  const send = (reply: TaskReply<ImportOutcome>) => self.postMessage(reply);
  try { send({ id, result: await command(payload, progress => send({ id, progress })) }); }
  catch (error) { send({ id, error: error instanceof Error ? error.message : String(error) }); }
});
