import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseImport } from "../src/lib/read-import";
import { convertSource, makePreview, jsonSource, IMPORT_LIMITS, type ImportSource, type ImportMapping } from "../src/lib/import-data";

const settings = { encoding: "utf-8", delimiter: "auto" } as const;
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
async function csv(text: string) { return parseImport(bytes(text), "csv", settings); }
function convert(source: ImportSource, overrides: Partial<ImportMapping> = {}, sheet = 0, header = 1) {
  const preview = makePreview(source, sheet, header);
  return convertSource(source, preview, { ...preview.mapping, ...overrides });
}

describe("local file adapters", () => {
  it("reads quoted CSV with a BOM, guesses a separator, sorts times and normalizes sample weights", async () => {
    const progress = vi.fn();
    const source = await parseImport(bytes('\uFEFFtime;category;value;weight\n2024-01-02;"A, group";0;1\n2024-01-01;"A, group";10;1\n2024-01-01;"A, group";20;3'), "csv", settings, progress);
    const data = convert(source);
    expect(data.dataset.times).toEqual(["2024-01-01", "2024-01-02"]);
    expect(data.dataset.layers[0].measures[0]?.components).toEqual([{ kind: "atom", value: 10, mass: .25 }, { kind: "atom", value: 20, mass: .75 }]);
    expect(data.dataset.layers[0].measures[1]?.components).toEqual([{ kind: "atom", value: 0, mass: 1 }]);
    expect(data.sampleSize["A, group"]).toEqual([2, 1]);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ label: "Parsing CSV rows", fraction: 1 }));
  });

  it("converts wide series columns, preserves prototype-named layers, and distinguishes blanks from zero", async () => {
    const source = await csv("time,__proto__,constructor\nt1,0,\nt2,3,4");
    const data = convert(source);
    expect(data.dataset.layers.map(layer => layer.id)).toEqual(["__proto__", "constructor"]);
    expect(data.dataset.layers[0].measures[0]?.components[0]).toMatchObject({ value: 0 });
    expect(data.dataset.layers[1].measures[0]).toBeNull();
    expect(Object.hasOwn(data.sampleSize, "__proto__")).toBe(true);
    expect(data.summary.missingCells).toBe(1);
    expect(() => convert(source, { missing: "error" })).toThrow(/Row 2.*constructor.*blank/);
  });

  it("combines member columns and preserves observation counts after equal-valued atoms merge", async () => {
    const source = await csv("time,category,m1,m2\nt1,A,2,2\nt2,A,3,\nt1,B,1,4");
    const data = convert(source);
    expect(data.dataset.layers[0].measures[0]?.components).toEqual([{ kind: "atom", value: 2, mass: 1 }]);
    expect(data.sampleSize.A).toEqual([2, 1]);
    expect(data.summary.observations).toBe(5);
  });

  it("reads a real multi-sheet XLSX, selects a header row and converts Excel date cells", async () => {
    const file = readFileSync(new URL("./fixtures/custom-data.xlsx", import.meta.url));
    const source = await parseImport(new Uint8Array(file).buffer, "xlsx", settings);
    expect(makePreview(source).sheets).toEqual(["Observations", "Series"]);
    expect(convert(source).summary.observations).toBe(4);
    const result = convert(source, {}, 1, 2);
    expect(result.dataset.times).toEqual(["2024-01-01", "2024-01-02"]);
    expect(result.dataset.layers.map(layer => layer.id)).toEqual(["A", "B"]);
    expect(result.dataset.layers[0].measures[0]?.components[0]).toMatchObject({ value: 0 });
    expect(result.dataset.layers[0].measures[1]).toBeNull();
  });

  it("accepts flat JSON records or unified measures without inventing sample counts", async () => {
    const source = await parseImport(bytes('[{"date":"t1","group":"A","value":2},{"date":"t1","group":"A","value":4}]'), "json", settings);
    expect(convert(source).dataset.layers[0].measures[0]?.components).toHaveLength(2);
    const unified = jsonSource({ times: ["t1"], layers: [{ id: "A", measures: [{ components: [{ kind: "uniform", low: 1, high: 4, mass: 1 }] }] }] });
    const result = convert(unified);
    expect(result.summary.observations).toBeNull();
    expect(result.sampleSize).toEqual({});
    expect(result.dataset.layers[0].measures[0]?.components[0].kind).toBe("uniform");
  });

  it.each([
    ["time,category,value\nt1,A,-1", /Row 2.*value/],
    ["time,category,value\nt1,A,Infinity", /Row 2.*value/],
    ["time,category,value\n,A,1", /Row 2.*time/],
    ["time,category,value\nt1,,1", /Row 2.*category/],
    ["time,category,value,weight\nt1,A,2,-1", /Row 2.*weight/],
    ["time,category,value,weight\nt1,A,2,0", /No usable observations/],
  ])("reports actionable diagnostics for invalid values: %s", async (text, message) => {
    const source = await csv(text);
    expect(() => convert(source)).toThrow(message);
  });

  it("rejects malformed input and conflicting column roles", async () => {
    await expect(csv('time,category,value\nt1,"A,2')).rejects.toThrow(/CSV/);
    await expect(parseImport(bytes("{"), "json", settings)).rejects.toThrow(/Invalid JSON/);
    expect(() => jsonSource([{ time: "t1", value: { samples: [1] } }])).toThrow(/nested/);
    const source = await csv("time,category,value\nt1,A,2");
    expect(() => convert(source, { values: ["0"] })).toThrow(/one role/);
    const dates = await csv("time,category,value\n2024-02-01,A,2\n2024-01-01,A,1");
    expect(() => convert(dates, { timeOrder: "file" })).toThrow(/must increase/);
    const duplicate = await csv("time,A,A\nt1,2,3");
    expect(() => convert(duplicate)).toThrow(/unique names/);
    const unquotedThousands = await csv("time,category,value\nt1,A,1,000");
    expect(() => convert(unquotedThousands)).toThrow(/more fields/);
  });

  it("enforces browser limits before constructing a large layer/time grid", async () => {
    const source: ImportSource = { kind: "table", sheets: [{ name: "Too large", rows: [
      ["time", ...Array.from({ length: 51 }, (_, i) => `Layer ${i}`)],
      ...Array.from({ length: 1000 }, (_, i) => [String(i), ...Array(51).fill(1)]),
    ] }] };
    expect(() => convert(source)).toThrow(/50,000/);
    await expect(parseImport(new ArrayBuffer(IMPORT_LIMITS.bytes + 1), "csv", settings)).rejects.toThrow(/25 MB/);
  });

  it("uses explicit composite groups and member IDs to define each ensemble", async () => {
    const source = await csv("time,region,scenario,member,value,weight\nt1,North,base,m1,10,1\nt1,North,base,m2,20,3\nt1,North,alternate,m1,50,1\nt2,North,base,m1,30,1");
    const data = convert(source, { groups: ["1", "2"], members: ["3"] });
    expect(data.dataset.layers.map(layer => layer.id)).toEqual(['["North","base"]', '["North","alternate"]']);
    expect(data.dataset.layers[0].measures[0]?.components).toEqual([{ kind: "atom", value: 10, mass: .25 }, { kind: "atom", value: 20, mass: .75 }]);
    expect(data.summary.distributions).toBe(3);
    expect(data.summary.memberRange).toEqual([1, 2]);
    expect(data.definition.grouping).toEqual(["time", "region", "scenario"]);
    expect(data.definition.members).toEqual(["member"]);
    const pooled = convert(source, { groups: [], members: [] });
    expect(pooled.dataset.layers.map(layer => layer.id)).toEqual(["All data"]);
    expect(pooled.summary.distributions).toBe(2);
  });

  it("rejects repeated identified members unless the user refines the identity or counts independent rows", async () => {
    const source = await csv("time,category,member,draw,value\nt1,A,m1,one,2\nt1,A,m1,two,4");
    expect(() => convert(source, { members: ["2"] })).toThrow(/duplicate member/);
    expect(convert(source, { members: ["2", "3"] }).summary.memberRange).toEqual([2, 2]);
    expect(convert(source, { members: [] }).summary.memberRange).toEqual([2, 2]);
    const missing = await csv("time,category,member,value\nt1,A,,2");
    expect(() => convert(missing, { members: ["2"] })).toThrow(/member field.*missing/);
  });

  it("imports weighted support points without treating bins as ensemble members", async () => {
    const source = await csv("time,category,value,count\nt1,A,2,1\nt1,A,4,3");
    const data = convert(source, { representation: "distribution", weight: "3" });
    expect(data.dataset.layers[0].measures[0]?.components).toEqual([{ kind: "atom", value: 2, mass: .25 }, { kind: "atom", value: 4, mass: .75 }]);
    expect(data.summary.memberRange).toBeNull();
    expect(data.summary.observations).toBeNull();
    expect(data.sampleSize).toEqual({});
    expect(() => convert(source, { representation: "distribution", weight: "" })).toThrow(/probability.*frequency/);
  });

  it("imports user-selected interval bounds and probability masses", async () => {
    const source = await csv("time,category,low,high,mass\nt1,A,0,2,1\nt1,A,2,4,3");
    const mapping = { representation: "distribution", layout: "long", support: "intervals", lower: "2", upper: "3", weight: "4" } as const;
    const data = convert(source, mapping);
    expect(data.dataset.layers[0].measures[0]?.components).toEqual([{ kind: "uniform", low: 0, high: 2, mass: .25 }, { kind: "uniform", low: 2, high: 4, mass: .75 }]);
    const invalid = await csv("time,category,low,high,mass\nt1,A,2,1,1");
    expect(() => convert(invalid, mapping)).toThrow(/upper bound/);
  });
});

