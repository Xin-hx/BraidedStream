import { preparePipeline } from "braided-stream/core";
import { convertIllustrationCase } from "../../../examples/converters/illustration";
import { convertCovidCase, DEFAULT_COVID_STATES } from "../../../examples/converters/covidConverter";
import { convertTcmCase } from "../../../examples/converters/tcmConverter";
import type { AnalysisResult, WorkerAnalysisRequest } from "./analysis-task";

/** Worker-owned snapshot: raw data and analysis closures never round-trip between layouts. */
export function createAnalysisProcessor() {
  let version = -1;
  let pipeline: ReturnType<typeof preparePipeline> | undefined;
  return (request: WorkerAnalysisRequest): AnalysisResult => {
    const start = performance.now();
    let converted: AnalysisResult["converted"];
    if (request.example) {
      const { id, text } = request.example;
      if (id === "tcm" && !__LOCAL_TCM__) throw new Error("TCM records are available only in a local development session");
      converted = id === "illustration" ? convertIllustrationCase(text)
        : id === "covid-inc" ? convertCovidCase(text, { states: DEFAULT_COVID_STATES }) : convertTcmCase(text);
    }
    const dataset = converted?.dataset ?? request.dataset;
    if (dataset) { pipeline = preparePipeline(dataset); version = request.version; }
    if (!pipeline || version !== request.version) throw new Error("Dataset is not registered. Load it again.");
    const options = converted && request.example?.sort === "category"
      ? { ...request.options, layoutOrder: converted.dataset.layers.map(layer => layer.id).sort((a, b) => a.localeCompare(b)) }
      : request.options;
    const result = pipeline.run(options);
    return { result, perfMs: performance.now() - start, ...(converted ? { converted } : {}) };
  };
}
