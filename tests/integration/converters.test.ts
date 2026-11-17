import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertTcmCase, convertTcmCsv } from "../../examples/converters/tcmConverter";
import { convertCovidJson } from "../../examples/converters/covidConverter";
import { convertIllustrationCsv } from "../../examples/converters/illustration";
import { measureCdf, measureQuantile } from "../../packages/braided-stream/src/engine/measure";

function csvField(value: unknown): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tcmCsv(records: Array<{ id: string; weight?: number; visits: unknown[]; prescriptions?: unknown[] }>): string {
  const header = "patient_id,weight,prescriptions_json,categorized_prescriptions_json";
  return [header, ...records.map((record) => [
    csvField(record.id),
    csvField(record.weight ?? ""),
    csvField(JSON.stringify(record.prescriptions ?? [])),
    csvField(JSON.stringify(record.visits)),
  ].join(","))].join("\n");
}

function tcmCsvWithHeader(header: string[], row: unknown[]): string {
  return [header.join(","), row.map(csvField).join(",")].join("\n");
}

function covidJson(members: Array<Record<string, unknown>>, state = "Test State"): string {
  return JSON.stringify({
    meta: {
      target: "1 wk ahead inc case",
      time_field: "target_end_date",
      ensemble: "COVIDhub-trained_ensemble",
      member_weight: "test",
    },
    states: [{
      state,
      location: "00",
      series: [{
        forecast_date: "2022-01-01",
        target_end_date: "2022-01-08",
        ensemble: { q025: 1, q10: 2, q25: 3, q50: 4, q75: 5, q90: 6, q975: 7 },
        actual: null,
        available_weight_sum: 1,
        members,
      }],
    }],
  });
}

const member = (weight: number, values: number[]) => Object.fromEntries([
  ["model", `m-${weight}`], ["official_weight", weight], ["weight", weight],
  ...["q025", "q10", "q25", "q50", "q75", "q90", "q975"].map((key, index) => [key, values[index]]),
]);

describe("TCM converter", () => {
  it("keeps real zeros, excludes missing visits, and normalizes observation weights", () => {
    const data = convertTcmCsv(tcmCsv([
      { id: "p1", weight: 1, visits: [{ date: "2020-01-01", categories: { A: 0 } }, { date: "2020-02-01", categories: { A: 4 } }] },
      { id: "p2", weight: 2, visits: [{ date: "2020-01-02", categories: { B: 2 } }] },
      { id: "p3", weight: 3, visits: [{ date: "2020-01-03", categories: { A: 6 } }] },
    ]));
    const layerA = data.layers.find((layer) => layer.id === "A")!;
    expect(data.times).toEqual(["visit 1", "visit 2"]);
    expect(layerA.measures[0]!.components).toEqual([
      { kind: "atom", value: 0, mass: 0.5 },
      { kind: "atom", value: 6, mass: 0.5 },
    ]);
    expect(layerA.measures[1]!.components).toEqual([{ kind: "atom", value: 4, mass: 1 }]);
  });

  it("rejects corrupt dose values instead of treating them as zero", () => {
    expect(() => convertTcmCsv(tcmCsv([
      { id: "p", visits: [{ date: "2020-01-01", categories: { A: "bad" } }] },
    ]))).toThrow(/dose/i);
  });

  it("rejects missing dates and categories with the CSV row and visit index", () => {
    expect(() => convertTcmCsv(tcmCsv([
      { id: "p", visits: [
        { date: "2022-01-01", categories: { A: 1 } },
        { date: "bad", categories: { A: 2 } },
        { date: "2022-01-03", categories: { A: 3 } },
      ] },
    ]))).toThrow(/CSV row 2.*visit 2.*date/i);
    expect(() => convertTcmCsv(tcmCsv([
      { id: "p", visits: [{ date: "2022-01-01" }] },
    ]))).toThrow(/CSV row 2.*visit 1.*categories/i);
    expect(() => convertTcmCsv(tcmCsv([
      { id: "p", visits: [{ date: "2022-01-01", categories: null }] },
    ]))).toThrow(/CSV row 2.*visit 1.*categories/i);
    expect(() => convertTcmCsv(tcmCsv([
      { id: "p", visits: [{ date: "2022-02-30", categories: { A: 1 } }] },
    ]))).toThrow(/CSV row 2.*visit 1.*date/i);
  });

  it("sorts accepted dates by timestamp and preserves prototype-named categories", () => {
    const visits = JSON.parse('[{"date":"2/1/2022","categories":{"__proto__":5,"constructor":4,"toString":3,"a":1}},{"date":"10/1/2022","categories":{"__proto__":10,"constructor":9,"toString":8,"a":2}}]');
    const converted = convertTcmCase(tcmCsv([{ id: "p", visits }]));
    expect(converted.dataset.layers.map((layer) => layer.id)).toEqual([
      "__proto__", "a", "constructor", "toString",
    ]);
    expect(converted.dataset.layers.find((layer) => layer.id === "__proto__")!.measures
      .map((measure) => measure!.components[0])).toEqual([
        { kind: "atom", value: 5, mass: 1 },
        { kind: "atom", value: 10, mass: 1 },
      ]);
    expect(Object.hasOwn(converted.metadata.values, "__proto__")).toBe(true);
    expect(converted.metadata.values.__proto__[0]).toEqual([5]);
  });

  it("prefers observation_weight regardless of column order", () => {
    const visits = JSON.stringify([{ date: "2022-01-01", categories: { A: 1 } }]);
    const prescriptions = JSON.stringify([]);
    const first = convertTcmCsv(tcmCsvWithHeader(
      ["patient_id", "observation_weight", "weight", "prescriptions_json", "categorized_prescriptions_json"],
      ["p", "2", "bad", prescriptions, visits],
    ));
    const second = convertTcmCsv(tcmCsvWithHeader(
      ["patient_id", "weight", "observation_weight", "prescriptions_json", "categorized_prescriptions_json"],
      ["p", "bad", "2", prescriptions, visits],
    ));
    expect(first.layers[0].measures[0]!.components).toEqual(second.layers[0].measures[0]!.components);
  });
});

describe("illustration converter", () => {
  it("rejects blank numeric fields instead of converting them to zero", () => {
    expect(() => convertIllustrationCsv("category,time,value\na,t1,\na,t2,5"))
      .toThrow(/row 2/i);
    expect(() => convertIllustrationCsv("category,time,value\na,t1,   \na,t2,5"))
      .toThrow(/row 2/i);
  });
});

describe("COVID converter", () => {
  it("normalizes member weights and reconstructs clamped tails and flat intervals", () => {
    const data = convertCovidJson(covidJson([
      member(2, [0, 0, 2, 4, 4, 8, 10]),
      member(6, [20, 20, 20, 20, 20, 20, 20]),
    ]), { states: "all" });
    const measure = data.layers[0].measures[0]!;

    expect(measure.components.reduce((sum, component) => sum + component.mass, 0)).toBeCloseTo(1, 14);
    expect(measureCdf(measure, 0)).toBeCloseTo(0.025, 14);
    expect(measureCdf(measure, 10)).toBeCloseTo(0.25, 14);
    expect(measureCdf(measure, 19)).toBeCloseTo(0.25, 14);
    expect(measureQuantile(measure, 0.25)).toBeCloseTo(10, 14);
    expect(measureQuantile(measure, 0.250001)).toBe(20);
    expect(measure.components.some((component) => component.kind === "atom" && component.value === 4 && component.mass === 0.0625)).toBe(true);
  });

  it.each([
    [member(1, [0, 2, 1, 4, 5, 6, 7]), /quantile/i],
    [member(0, [0, 1, 2, 3, 4, 5, 6]), /weight/i],
  ])("rejects invalid member input %#", (invalidMember, message) => {
    expect(() => convertCovidJson(covidJson([invalidMember]), { states: "all" })).toThrow(message);
  });
});

describe("real converter smoke", () => {
  it("loads the public datasets into the same contract", () => {
    const datasets = [
      convertCovidJson(readFileSync("examples/data/covid_inc_case_trained_members.json", "utf8")),
      convertIllustrationCsv(readFileSync("examples/data/illustration.csv", "utf8")),
    ];
    expect(datasets.map((data) => data.layers.length)).toEqual([4, 3]);
    expect(datasets.every((data) => data.layers.every((layer) =>
      layer.measures.every((measure) => measure === null || measure.components.every((component) =>
        component.kind === "atom" || component.kind === "uniform"
      ))
    ))).toBe(true);
  });
  it.skipIf(!existsSync("examples/data/private/TCMRecord.csv"))("loads local private TCM records", () => {
    expect(convertTcmCsv(readFileSync("examples/data/private/TCMRecord.csv", "utf8")).layers).toHaveLength(24);
  });
});
