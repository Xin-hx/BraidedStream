import { validateInput, type InputDataset, type MeasureComponent } from "../input";

type CategorizedVisit = { date?: unknown; categories?: unknown };
type PrescriptionVisit = { scripts?: Record<string, { amount?: unknown }> };
type ParsedVisit = { categories: Record<string, number> };
type Patient = { id: string; weight: number; visits: ParsedVisit[] };

const MEDICINE_CATEGORY_OVERRIDES = { "附子": "温阳类" } as const;

export const TCM_COLORS: Readonly<Record<string, string>> = {
  "安神类": "#FB9A99", "活血类": "#E15759", "补脾益气类": "#FDBF6F",
  "凉血止血类": "#FF7F00", "泄浊毒类": "#B15928", "祛风止痒类": "#D9D9D9",
  "补肾类": "#6E3A8A", "清热类": "#B2DF8A", "降蛋白尿": "#000000",
  "止咳化痰类": "#33C193", "解表药": "#D9D9D9", "安神药": "#113291",
  "祛风湿类": "#D9A86B", "平肝潜阳类": "#B0B012", "祛湿类": "#A6CEE3",
  "消食药": "#FFB018", "活血祛瘀药": "#E15759", "收敛药": "#8DD3C7",
  "理气药": "#1F77B4", "补虚药": "#00A5CF", "泻下药": "#B15928",
  "温阳类": "#F76D42", "利尿通淋类": "#118791", "止血药": "#FF7F00",
  "凉血活血类": "#11911B", "未分类": "#D9D9D9",
};

export interface TcmDisplayMetadata {
  readonly patientIds: Readonly<Record<string, readonly (readonly string[])[]>>;
  readonly values: Readonly<Record<string, readonly (readonly number[])[]>>;
  readonly sampleSize: Readonly<Record<string, readonly number[]>>;
}

export function convertTcmCsv(text: string): InputDataset {
  return convertTcmCase(text).dataset;
}

export function convertTcmCase(text: string): { dataset: InputDataset; metadata: TcmDisplayMetadata } {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  const patientIndex = header?.indexOf("patient_id") ?? -1;
  const categoriesIndex = header?.indexOf("categorized_prescriptions_json") ?? -1;
  const prescriptionsIndex = header?.indexOf("prescriptions_json") ?? -1;
  const observationWeightIndex = header?.indexOf("observation_weight") ?? -1;
  const fallbackWeightIndex = header?.indexOf("weight") ?? -1;
  const weightIndex = observationWeightIndex >= 0 ? observationWeightIndex : fallbackWeightIndex;
  if (patientIndex < 0 || categoriesIndex < 0) {
    throw new Error("TCM CSV requires patient_id and categorized_prescriptions_json columns");
  }

  const patients = rows.filter((row) => row.length > 1).map((row, rowIndex): Patient | null => {
    try {
      const id = row[patientIndex];
      if (!id) throw new Error("patient_id is empty");
      const rawWeight = weightIndex >= 0 ? row[weightIndex] : "";
      const weight = rawWeight === undefined || rawWeight.trim() === "" ? 1 : Number(rawWeight);
      if (!Number.isFinite(weight) || weight <= 0) throw new Error("patient weight must be positive");
      const prescriptions = prescriptionsIndex < 0 || !row[prescriptionsIndex]
        ? []
        : JSON.parse(row[prescriptionsIndex]) as PrescriptionVisit[];
      const visits = (JSON.parse(row[categoriesIndex]) as CategorizedVisit[])
        .map((visit, visitIndex) => parseVisit(visit, prescriptions[visitIndex]?.scripts, visitIndex))
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(({ categories }) => ({ categories }));
      return visits.length ? { id, weight, visits } : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid TCM input at CSV row ${rowIndex + 2}: ${message}`);
    }
  }).filter((patient): patient is Patient => patient !== null);
  if (!patients.length) throw new Error("TCM CSV has no patient visits");

  const visitCount = Math.max(...patients.map((patient) => patient.visits.length));
  const categories = [...new Set(patients.flatMap((patient) =>
    patient.visits.flatMap((visit) => Object.keys(visit.categories))
  ))].sort();
  if (!categories.length) throw new Error("TCM CSV has no medicine categories");
  const dataset = validateInput({
    times: Array.from({ length: visitCount }, (_, index) => `visit ${index + 1}`),
    layers: categories.map((id) => ({
      id,
      measures: Array.from({ length: visitCount }, (_, visitIndex) => {
        const observations = patients.flatMap((patient) => {
          const visit = patient.visits[visitIndex];
          return visit ? [{ value: visit.categories[id] ?? 0, weight: patient.weight }] : [];
        });
        if (!observations.length) return null;
        const total = observations.reduce((sum, observation) => sum + observation.weight, 0);
        const byValue = new Map<number, number>();
        for (const observation of observations) {
          byValue.set(observation.value, (byValue.get(observation.value) ?? 0) + observation.weight / total);
        }
        const components: MeasureComponent[] = [...byValue].sort(([a], [b]) => a - b)
          .map(([value, mass]) => ({ kind: "atom", value, mass }));
        return { components };
      }),
    })),
  });
  const patientIds = Object.fromEntries(categories.map((id) => [id,
    Array.from({ length: visitCount }, (_, visitIndex) => patients
      .filter((patient) => patient.visits[visitIndex] !== undefined)
      .map((patient) => patient.id)),
  ]));
  return {
    dataset,
    metadata: {
      patientIds,
      values: Object.fromEntries(categories.map((id) => [id,
        Array.from({ length: visitCount }, (_, visitIndex) => patients.flatMap((patient) => {
          const visit = patient.visits[visitIndex];
          return visit ? [visit.categories[id] ?? 0] : [];
        })),
      ])),
      sampleSize: Object.fromEntries(categories.map((id) => [id, patientIds[id].map((ids) => ids.length)])),
    },
  };
}

function parseVisit(
  visit: CategorizedVisit,
  scripts: PrescriptionVisit["scripts"],
  visitIndex: number,
): { timestamp: number; categories: Record<string, number> } {
  const label = `visit ${visitIndex + 1}`;
  if (typeof visit?.date !== "string" || !visit.date.trim()) {
    throw new Error(`${label} date must be a valid date string`);
  }
  const timestamp = Date.parse(visit.date);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} date must be valid`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(visit.date) &&
      new Date(timestamp).toISOString().slice(0, 10) !== visit.date) {
    throw new Error(`${label} date must be valid`);
  }
  const rawCategories = visit.categories;
  if (rawCategories === null || typeof rawCategories !== "object" || Array.isArray(rawCategories)) {
    throw new Error(`${label} categories must be an object`);
  }
  const categories = Object.create(null) as Record<string, number>;
  for (const [id, rawDose] of Object.entries(rawCategories as Record<string, unknown>)) {
    if (typeof rawDose !== "number" || !Number.isFinite(rawDose) || rawDose < 0) {
      throw new Error(`${label} dose for ${id} must be a finite non-negative number`);
    }
    categories[id] = rawDose;
  }
  for (const [medicine, category] of Object.entries(MEDICINE_CATEGORY_OVERRIDES)) {
    if (!scripts || !Object.hasOwn(scripts, medicine)) continue;
    const rawAmount = scripts[medicine]?.amount;
    if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount) || rawAmount < 0) {
      throw new Error(`dose for ${medicine} must be a finite non-negative number`);
    }
    if (rawAmount === 0) continue;
    const unclassified = categories["未分类"] ?? 0;
    if (unclassified + Number.EPSILON < rawAmount) {
      throw new Error(`${medicine} cannot be moved from 未分类 without preserving dose`);
    }
    if (unclassified === rawAmount) delete categories["未分类"];
    else categories["未分类"] = unclassified - rawAmount;
    categories[category] = (categories[category] ?? 0) + rawAmount;
  }
  return { timestamp, categories };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += character; index += 1; } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("TCM CSV has an unclosed quoted field");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
