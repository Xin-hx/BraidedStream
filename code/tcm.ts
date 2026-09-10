/** TCM patient-record loader: one patient becomes one streamgraph layer. */
import type { Layer } from "./types";

type CategorizedVisit = { date?: string; categories?: Record<string, number> };
const PROBS = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975] as const;

function quantile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += char; i += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("TCMRecord.csv has an unclosed quoted field");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseTcmCsv(text: string): { layers: Layer[]; times: string[] } {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const patientIndex = header?.indexOf("patient_id") ?? -1;
  const categoriesIndex = header?.indexOf("categorized_prescriptions_json") ?? -1;
  if (patientIndex < 0 || categoriesIndex < 0) throw new Error("TCMRecord.csv requires patient_id and categorized_prescriptions_json columns");

  const records = rows.filter((row) => row.length > 1).map((row, rowIndex) => {
    try {
      return { id: row[patientIndex], visits: JSON.parse(row[categoriesIndex]) as CategorizedVisit[] };
    } catch {
      throw new Error(`invalid visits_json at CSV row ${rowIndex + 2}`);
    }
  });
  const orderedRecords = records.map(({ id, visits }) => ({ id, visits: visits.filter((visit) => visit.date).sort((a, b) => a.date!.localeCompare(b.date!)) }));
  const maxVisitCount = Math.max(...orderedRecords.map(({ visits }) => visits.length));
  if (!records.length || !maxVisitCount) throw new Error("TCMRecord.csv has no patient visits");
  const categories = [...new Set(orderedRecords.flatMap(({ visits }) => visits.flatMap((visit) => Object.keys(visit.categories ?? {}))))].sort();
  const times = Array.from({ length: maxVisitCount }, (_, index) => `visit ${index + 1}`);

  return {
    times,
    layers: categories.map((id) => {
      const values = times.map((_, visitIndex) => orderedRecords.map(({ visits }) => Number(visits[visitIndex]?.categories?.[id]) || 0).filter(Boolean));
      const quantiles = PROBS.map((probability) => values.map((amounts) => quantile(amounts, probability)));
      return { id, q: { p025: quantiles[0], p10: quantiles[1], p25: quantiles[2], p50: quantiles[3], p75: quantiles[4], p90: quantiles[5], p975: quantiles[6] } };
    }),
  };
}
