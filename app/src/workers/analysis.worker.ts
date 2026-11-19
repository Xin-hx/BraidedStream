import { createAnalysisProcessor } from "../lib/analysis-processor";
import type { WorkerAnalysisRequest, AnalysisResult } from "../lib/analysis-task";
import type { TaskRequest, TaskReply } from "../lib/worker-task";
const process = createAnalysisProcessor();
self.addEventListener("message", (event: MessageEvent<TaskRequest<WorkerAnalysisRequest>>) => {
  const { id, payload } = event.data;
  let reply: TaskReply<AnalysisResult>;
  try {
    reply = { id, result: process(payload) };
  } catch (error) { reply = { id, error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(reply);
});
