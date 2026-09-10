/** TCM loader: each expert category is a member-aligned empirical distribution. */
import { inputDataset } from "./dataInput";

type CategorizedVisit = { date?: string; categories?: Record<string, number> };

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

export function parseTcmCsv(text: string) {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const patientIndex = header?.indexOf("patient_id") ?? -1;
  const categoriesIndex = header?.indexOf("categorized_prescriptions_json") ?? -1;
  if (patientIndex < 0 || categoriesIndex < 0) throw new Error("TCMRecord.csv requires patient_id and categorized_prescriptions_json columns");
  const records = rows.filter((row) => row.length > 1).map((row, rowIndex) => {
    try {
      return { id: row[patientIndex], visits: (JSON.parse(row[categoriesIndex]) as CategorizedVisit[]).filter((visit) => visit.date).sort((a, b) => a.date!.localeCompare(b.date!)) };
    } catch { throw new Error(`invalid visits_json at CSV row ${rowIndex + 2}`); }
  });
  if (!records.length) throw new Error("TCMRecord.csv has no patient visits");
  const visitCounts = new Map<number, number>();
  for (const record of records) visitCounts.set(record.visits.length, (visitCounts.get(record.visits.length) ?? 0) + 1);
  const largestFrequency = Math.max(...visitCounts.values());
  // Keep the longest series when multiple visit counts share the modal frequency.
  const alignedVisitCount = Math.max(...[...visitCounts].filter(([, count]) => count === largestFrequency).map(([count]) => count));
  if (!alignedVisitCount) throw new Error("TCMRecord.csv has no patient visits");
  const alignedRecords = records.filter((record) => record.visits.length === alignedVisitCount);
  const categories = [...new Set(alignedRecords.flatMap((record) => record.visits.flatMap((visit) => Object.keys(visit.categories ?? {}))))].sort();
  const times = Array.from({ length: alignedVisitCount }, (_, index) => `visit ${index + 1}`);
  return inputDataset({
    times,
    magnitudePolicy: "empirical-mean",
    layers: categories.map((id) => ({
      id,
      cells: times.map((_, visitIndex) => ({
        kind: "empirical" as const,
        observations: alignedRecords.map((record) => {
          const visit = record.visits[visitIndex];
          return { memberId: record.id, value: Number(visit.categories?.[id]) || 0 };
        }),
      })),
    })),
  });
}
