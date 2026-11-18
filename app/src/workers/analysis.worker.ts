import { runPipeline } from "braided-stream/core";
import type { AnalysisRequest, AnalysisResult } from "../lib/analysis-task";
import type { TaskRequest, TaskReply } from "../lib/worker-task";
self.addEventListener("message", (event: MessageEvent<TaskRequest<AnalysisRequest>>) => {
  const { id, payload } = event.data;
  let reply: TaskReply<AnalysisResult>;
  try {
    const start = performance.now();
    const result = runPipeline(payload.dataset, payload.options);
    reply = { id, result: { result, perfMs: performance.now() - start } };
  } catch (error) { reply = { id, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(reply);
});
