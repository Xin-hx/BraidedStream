/** TCM loader: patient visits aligned by ordinal visit number. */
import { inputDataset } from "./dataInput";

type CategorizedVisit = { date?: string; categories?: Record<string, number> };
type PrescriptionVisit = { scripts?: Record<string, { amount?: unknown }> };
// '附子' is not categorized in the original dataset
const MEDICINE_CATEGORY_OVERRIDES = { "附子": "温阳类" } as const;

/** Explicit TCM category palette; layer.color takes precedence over the shared fallback palette. */
export const TCM_COLORS: Record<string, string> = {
  "安神类": "#FB9A99",
  "活血类": "#E15759",
  "补脾益气类": "#FDBF6F",
  "凉血止血类": "#FF7F00",
  "泄浊毒类": "#B15928",
  "祛风止痒类": "#D9D9D9",
  "补肾类": "#6E3A8A",
  "清热类": "#B2DF8A",
  "降蛋白尿": "#000000",
  "止咳化痰类": "#33C193",
  "解表药": "#D9D9D9",
  "安神药": "#113291",
  "祛风湿类": "#D9A86B",
  "平肝潜阳类": "#B0B012",
  "祛湿类": "#A6CEE3",
  "消食药": "#FFB018",
  "活血祛瘀药": "#E15759",
  "收敛药": "#8DD3C7",
  "理气药": "#1F77B4",
  "补虚药": "#C6B4D9",
  "泻下药": "#B15928",
  "温阳类": "#F76D42",
  "利尿通淋类": "#118791",
  "止血药": "#FF7F00",
  "凉血活血类": "#11911B",
  "未分类": "#D9D9D9",
};

function applyMedicineOverrides(
  input: Record<string, number> | undefined,
  scripts: PrescriptionVisit["scripts"],
): Record<string, number> {
  const categories = { ...input };
  for (const [medicine, category] of Object.entries(MEDICINE_CATEGORY_OVERRIDES)) {
    const amount = Number(scripts?.[medicine]?.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const unclassified = Number(categories["未分类"] ?? 0);
    if (unclassified + Number.EPSILON < amount) {
      throw new Error(`${medicine} cannot be moved from 未分类 without preserving dose`);
    }
    categories["未分类"] = unclassified - amount;
    if (categories["未分类"] === 0) delete categories["未分类"];
    categories[category] = Number(categories[category] ?? 0) + amount;
  }
  return categories;
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

export function parseTcmCsv(text: string) {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const patientIndex = header?.indexOf("patient_id") ?? -1;
  const categoriesIndex = header?.indexOf("categorized_prescriptions_json") ?? -1;
  const prescriptionsIndex = header?.indexOf("prescriptions_json") ?? -1;
  if (patientIndex < 0 || categoriesIndex < 0) throw new Error("TCMRecord.csv requires patient_id and categorized_prescriptions_json columns");
  const rawRecords = rows.filter((row) => row.length > 1).map((row, rowIndex) => {
    try {
      const prescriptions = prescriptionsIndex < 0
        ? []
        : JSON.parse(row[prescriptionsIndex]) as PrescriptionVisit[];
      return {
        id: row[patientIndex],
        visits: (JSON.parse(row[categoriesIndex]) as CategorizedVisit[])
          .map((visit, visitIndex) => ({
            ...visit,
            categories: applyMedicineOverrides(visit.categories, prescriptions[visitIndex]?.scripts),
          }))
          .filter((visit) => visit.date && Number.isFinite(Date.parse(visit.date)))
          .sort((a, b) => a.date!.localeCompare(b.date!)),
      };
    } catch { throw new Error(`invalid visits_json at CSV row ${rowIndex + 2}`); }
  }).filter((record) => record.visits.length);
  const records = rawRecords.map((record) => ({
    id: record.id,
    visits: record.visits.map((visit) => {
      const categories: Record<string, number> = {};
      for (const [id, value] of Object.entries(visit.categories ?? {})) {
        const dose = Number(value);
        if (Number.isFinite(dose)) categories[id] = dose;
      }
      return { categories };
    }),
  }));
  if (!records.length) throw new Error("TCMRecord.csv has no patient visits");
  const visitCount = Math.max(...records.map((record) => record.visits.length));
  const categories = [...new Set(records.flatMap((record) => record.visits.flatMap((visit) => Object.keys(visit.categories))))].sort();
  const data = inputDataset({
    times: Array.from({ length: visitCount }, (_, index) => `visit ${index + 1}`),
    magnitudePolicy: "empirical-mean",
    layers: categories.map((id) => ({
      id,
      cells: Array.from({ length: visitCount }, (_, visitIndex) => ({
        kind: "empirical" as const,
        // No patient observed at this visit index: retain sampleSize=0,
        // but its representative stream thickness is the requested zero.
        emptyValue: 0,
        observations: records.map((record) => {
          const visit = record.visits[visitIndex];
          return { memberId: record.id, value: visit ? Number(visit.categories[id]) || 0 : Number.NaN };
        }),
      })),
    })),
  });
  return {
    ...data,
    layers: data.layers.map((layer) => TCM_COLORS[layer.id]
      ? { ...layer, color: TCM_COLORS[layer.id] }
      : layer),
  };
}
