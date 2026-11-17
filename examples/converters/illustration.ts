/** Loader for the generated illustration ensembles: category,time,value. */
import { validateInput, type InputDataset } from "braided-stream/core";

export function convertIllustrationCsv(text: string): InputDataset {
  return convertIllustrationCase(text).dataset;
}

export function convertIllustrationCase(text: string): {
  dataset: InputDataset;
  metadata: { readonly sampleSize: Readonly<Record<string, readonly number[]>> };
} {
  const [header, ...rows] = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (header !== "category,time,value") {
    throw new Error("illustration CSV header must be category,time,value");
  }

  const samples = new Map<string, Map<string, number[]>>();
  const categories: string[] = [];
  const times: string[] = [];
  const timeSet = new Set<string>();

  for (const [rowIndex, row] of rows.entries()) {
    const fields = row.split(",").map((value) => value.trim());
    const [category, time, rawValue] = fields;
    const value = Number(rawValue);
    if (fields.length !== 3 || !category || !time || !rawValue || !Number.isFinite(value) || value < 0) {
      throw new Error(`invalid illustration CSV row ${rowIndex + 2}`);
    }
    if (!samples.has(category)) {
      samples.set(category, new Map());
      categories.push(category);
    }
    if (!timeSet.has(time)) {
      timeSet.add(time);
      times.push(time);
    }
    const byTime = samples.get(category)!;
    if (!byTime.has(time)) byTime.set(time, []);
    byTime.get(time)!.push(value);
  }
  if (!categories.length || !times.length) throw new Error("illustration CSV has no data rows");

  const dataset = validateInput({
    times,
    layers: categories.map((id) => ({
      id,
      measures: times.map((time) => {
        const values = samples.get(id)!.get(time);
        if (!values?.length) throw new Error(`missing category ${id} at ${time}`);
        return {
          components: values.map((value) => ({ kind: "atom" as const, value, mass: 1 / values.length })),
        };
      }),
    })),
  });
  return {
    dataset,
    metadata: {
      sampleSize: Object.fromEntries(categories.map((id) => [id, times.map((time) => samples.get(id)!.get(time)!.length)])),
    },
  };
}
