import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../code";
import { convertCovidJson } from "../code/data/covidConverter";
import { convertIllustrationCsv } from "../code/data/illustration";
import { convertTcmCsv } from "../code/data/tcmConverter";
import { measureMoments } from "../code/engine/measure";
import type { InputDataset } from "../code/input";

function checkCase(
  data: InputDataset,
  layerId: string,
  timeLabel: string,
  expected: {
    mean: number;
    variance: number;
    representative: number;
    low: number;
    high: number;
    modes: number;
    rankingHead: string;
  },
) {
  const result = runPipeline(data, { braided: { bandwidthRatio: 0.3, debug: true } });
  const inputLayer = data.layers.find((layer) => layer.id === layerId)!;
  const time = data.times.indexOf(timeLabel);
  const moments = measureMoments(inputLayer.measures[time]!);
  const geometry = result.braided.layers.find((layer) => layer.layerId === layerId)!;
  const point = geometry.debug![time];
  expect(moments.mean).toBeCloseTo(expected.mean, 10);
  expect(moments.variance).toBeCloseTo(expected.variance, 8);
  expect(point.H).toBeCloseTo(expected.representative, 10);
  expect(point.deviationLow).toBeCloseTo(expected.low, 10);
  expect(point.deviationHigh).toBeCloseTo(expected.high, 10);
  expect(point.branchCount).toBe(expected.modes);
  expect(result.pid.ranking[0]).toBe(expected.rankingHead);
  for (const layer of result.braided.layers) {
    for (const debug of layer.debug!) {
      expect(debug.branchIntervals.reduce((sum, branch) => sum + branch.y1 - branch.y0, 0)).toBeCloseTo(debug.H, 8);
      expect(debug.gaps.reduce((sum, gap) => sum + gap, 0)).toBeCloseTo(debug.dispersion, 8);
    }
  }
}

describe("real-case reconstructed-measure regression", () => {
  it("matches the pre-refactor TCM selected-cell baseline", () => {
    checkCase(
      convertTcmCsv(readFileSync("dataset/TCMRecord.csv", "utf8")),
      "凉血止血类", "visit 20",
      { mean: 8.75, variance: 54.6875, representative: 15, low: 6.25, high: 0, modes: 2, rankingHead: "凉血止血类" },
    );
  }, 30_000);

  it("matches the pre-refactor COVID mixture baseline, not official reference quantiles", () => {
    checkCase(
      convertCovidJson(readFileSync("dataset/covid_inc_case_trained_members.json", "utf8")),
      "Alabama", "2022-04-02",
      {
        mean: 1183.3561912506088,
        variance: 616269.7088186606,
        representative: 1263.068523373463,
        low: 349.85236324009423,
        high: 270.14003111723997,
        modes: 3,
        rankingHead: "Alabama",
      },
    );
  }, 30_000);

  it("matches the pre-refactor illustration atom-measure baseline", () => {
    checkCase(
      convertIllustrationCsv(readFileSync("dataset/illustration.csv", "utf8")),
      "A", "0.0",
      {
        mean: 0.48058935456745944,
        variance: 0.000473659580339153,
        representative: 0.47064080235770067,
        low: 0.003611301113038417,
        high: 0.013559853322797452,
        modes: 4,
        rankingHead: "A",
      },
    );
  }, 30_000);
});
