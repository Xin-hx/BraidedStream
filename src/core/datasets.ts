import { generateSyntheticDataset } from "./synthetic";
import type { DatasetKind, LayerInput, PreparedDataset, UncertaintyBandMode } from "./types";
import * as d3 from "d3";

export interface DatasetBundle {
  kind: DatasetKind;
  dataset: PreparedDataset;
  notes: string[];
  uncNote: string | null;
}

interface CovidCsvRow {
  time: string;
  time_index: string;
  category: string;
  location: string;
  location_level: string;
  horizon_weeks: string;
  forecast_date: string;
  target_end_date: string;
  median: string;
  low50: string;
  high50: string;
  low95: string;
  high95: string;
  uncertainty50: string;
  uncertainty95: string;
  stream_size: string;
}

interface CovidLayerMeta {
  unc50Series?: number[];
  unc95Series?: number[];
  lower50Series?: number[];
  upper50Series?: number[];
  lower95Series?: number[];
  upper95Series?: number[];
  regionKey?: string;
  horizonKey?: string;
}

type CovidLayerInput = LayerInput & CovidLayerMeta;

export function createSyntheticBundle(): DatasetBundle {
  return {
    kind: "synthetic",
    dataset: generateSyntheticDataset(190, 8),
    notes: ["source: synthetic generator"],
    uncNote: null
  };
}

export async function loadCovidBundle(layerLimit = 24): Promise<DatasetBundle> {
  const rows = await fetchCovidBraidedRows();
  if (rows.length === 0) {
    throw new Error("demo_braided_stream.csv has no parseable rows");
  }

  const normalized = normalizeCovidRows(rows);
  const selected = selectTopLayers(normalized.layers, layerLimit);
  applyCovidUncertaintyBand(
    {
      times: normalized.times,
      layers: selected.layers,
      order: selected.layers.map((layer) => layer.id)
    },
    "95"
  );

  const uniqueRegions = new Set(selected.layers.map((layer) => ((layer as CovidLayerMeta).regionKey ?? layer.id.split("|")[0] ?? layer.id))).size;

  return {
    kind: "covid",
    dataset: {
      times: normalized.times,
      layers: selected.layers,
      order: selected.layers.map((layer) => layer.id)
    },
    notes: [
      "source: demo_braided_stream.csv",
      `timeline points: ${normalized.times.length}`,
      `categories parsed: ${normalized.layers.length}`,
      `categories shown: ${selected.layers.length} (top by total stream size)`,
      `regions shown: ${uniqueRegions}`
    ],
    uncNote: "unc mode: uncertainty95 (switchable to uncertainty50)"
  };
}

export function applyCovidUncertaintyBand(dataset: PreparedDataset, mode: UncertaintyBandMode): boolean {
  let changed = false;
  for (const layer of dataset.layers as CovidLayerInput[]) {
    const nextUnc = mode === "50" ? layer.unc50Series : layer.unc95Series;
    if (!nextUnc) {
      continue;
    }
    layer.unc = nextUnc.slice();

    const nextLower = mode === "50" ? layer.lower50Series : layer.lower95Series;
    const nextUpper = mode === "50" ? layer.upper50Series : layer.upper95Series;
    if (nextLower && nextUpper) {
      layer.lower = nextLower.slice();
      layer.upper = nextUpper.slice();
    }
    changed = true;
  }
  return changed;
}

async function fetchCovidBraidedRows(): Promise<CovidCsvRow[]> {
  const urlCandidates = [
    new URL("../../data/demo_braided_stream.csv", import.meta.url).toString(),
    "/data/demo_braided_stream.csv",
    "/demo_braided_stream.csv"
  ];
  let lastError: unknown = null;
  for (const url of urlCandidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const csvText = await response.text();
      const rows = d3.csvParse(csvText) as unknown as CovidCsvRow[];
      return rows;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to load demo_braided_stream.csv: ${String(lastError)}`);
}

function normalizeCovidRows(rows: CovidCsvRow[]): { times: number[]; layers: CovidLayerInput[] } {
  const filtered = rows.filter((row) => {
    const idx = toFiniteNumber(row.time_index);
    const category = row.category?.trim();
    const horizon = toFiniteNumber(row.horizon_weeks);
    const level = row.location_level?.trim().toLowerCase();
    const location = row.location?.trim().toUpperCase();
    return (
      idx !== null &&
      Boolean(category) &&
      level === "state" &&
      location !== "US" &&
      horizon !== null &&
      horizon >= 1 &&
      horizon <= 4
    );
  });

  const orderedTimeIndices = Array.from(
    new Set(
      filtered
        .map((row) => toFiniteNumber(row.time_index))
        .filter((v): v is number => v !== null)
    )
  ).sort((a, b) => a - b);
  const indexByTime = new Map<number, number>(orderedTimeIndices.map((value, i) => [value, i]));

  const byCategory = new Map<string, CovidCsvRow[]>();
  for (const row of filtered) {
    const category = row.category.trim();
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(row);
  }

  const layers: CovidLayerInput[] = [];
  for (const [category, groupRows] of byCategory.entries()) {
    const mean = new Array<number>(orderedTimeIndices.length).fill(0);
    const unc50 = new Array<number>(orderedTimeIndices.length).fill(0);
    const unc95 = new Array<number>(orderedTimeIndices.length).fill(0);
    const lower50 = new Array<number>(orderedTimeIndices.length).fill(0);
    const upper50 = new Array<number>(orderedTimeIndices.length).fill(0);
    const lower95 = new Array<number>(orderedTimeIndices.length).fill(0);
    const upper95 = new Array<number>(orderedTimeIndices.length).fill(0);

    let regionKey = "";
    let horizonKey = "";

    for (const row of groupRows) {
      const rawTime = toFiniteNumber(row.time_index);
      if (rawTime === null) {
        continue;
      }
      const timeIndex = indexByTime.get(rawTime);
      if (timeIndex === undefined) {
        continue;
      }

      mean[timeIndex] = Math.max(0, toFiniteNumber(row.stream_size) ?? toFiniteNumber(row.median) ?? 0);
      unc50[timeIndex] = Math.max(0, toFiniteNumber(row.uncertainty50) ?? 0);
      unc95[timeIndex] = Math.max(0, toFiniteNumber(row.uncertainty95) ?? 0);
      lower50[timeIndex] = Math.max(0, toFiniteNumber(row.low50) ?? mean[timeIndex]);
      upper50[timeIndex] = Math.max(lower50[timeIndex], toFiniteNumber(row.high50) ?? mean[timeIndex]);
      lower95[timeIndex] = Math.max(0, toFiniteNumber(row.low95) ?? lower50[timeIndex]);
      upper95[timeIndex] = Math.max(lower95[timeIndex], toFiniteNumber(row.high95) ?? upper50[timeIndex]);

      regionKey = row.location?.trim() || category.split("|")[0] || "unknown";
      const horizonParsed = Math.round(toFiniteNumber(row.horizon_weeks) ?? 0);
      horizonKey = horizonParsed > 0 ? `h${horizonParsed}` : category.split("|")[1] ?? "h0";
    }

    layers.push({
      id: category,
      mean,
      unc: unc95.slice(),
      lower: lower95.slice(),
      upper: upper95.slice(),
      unc50Series: unc50,
      unc95Series: unc95,
      lower50Series: lower50,
      upper50Series: upper50,
      lower95Series: lower95,
      upper95Series: upper95,
      regionKey,
      horizonKey
    });
  }

  return {
    times: Array.from({ length: orderedTimeIndices.length }, (_, i) => i),
    layers
  };
}

function selectTopLayers(layers: LayerInput[], limit: number): { layers: LayerInput[] } {
  const selected = layers
    .slice()
    .sort((a, b) => {
      const sa = sum(a.mean);
      const sb = sum(b.mean);
      if (sb !== sa) {
        return sb - sa;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(1, limit));
  return { layers: selected };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

function sum(values: number[]): number {
  let out = 0;
  for (const v of values) {
    out += v;
  }
  return out;
}
