import { generateSyntheticDataset } from "./synthetic";
import type { DatasetKind, LayerInput } from "./types";

export interface PreparedDataset {
  times: number[];
  layers: LayerInput[];
  order: string[];
}

export interface DatasetBundle {
  kind: DatasetKind;
  dataset: PreparedDataset;
  notes: string[];
  uncNote: string | null;
}

interface RawLayerSeries {
  id: string;
  points: Array<{
    timeKey: string;
    sortValue: number;
    mean: number;
    unc?: number;
    lower?: number;
    upper?: number;
  }>;
}

export function createSyntheticBundle(): DatasetBundle {
  return {
    kind: "synthetic",
    dataset: generateSyntheticDataset(190, 8),
    notes: ["source: synthetic generator"],
    uncNote: null
  };
}

export async function loadCovidBundle(layerLimit = 24): Promise<DatasetBundle> {
  const raw = await fetchCovidRawJson();
  console.log("[covid-loader] raw json:", raw);

  const series = extractLayerSeries(raw);
  if (series.length === 0) {
    throw new Error("covid-data.json has no parseable layer series");
  }

  const normalized = normalizeSeries(series);
  const selected = selectTopLayers(normalized.layers, layerLimit);
  const proxyApplied = ensureUncertainty(selected.layers);

  return {
    kind: "covid",
    dataset: {
      times: normalized.times,
      layers: selected.layers,
      order: selected.layers.map((layer) => layer.id)
    },
    notes: [
      `source: covid-data.json`,
      `timeline points: ${normalized.times.length}`,
      `countries parsed: ${normalized.layers.length}`,
      `countries shown: ${selected.layers.length} (top by total daily confirmed)`
    ],
    uncNote: proxyApplied ? "unc is proxy (rollingStd window=7, globally normalized to [0,1])" : null
  };
}

async function fetchCovidRawJson(): Promise<unknown> {
  const urlCandidates = [
    new URL("../../data/covid-data.json", import.meta.url).toString(),
    "/data/covid-data.json",
    "/covid-data.json"
  ];
  let lastError: unknown = null;
  for (const url of urlCandidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to load covid-data.json: ${String(lastError)}`);
}

function extractLayerSeries(raw: unknown): RawLayerSeries[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return fromObjectMap(raw as Record<string, unknown>);
  }
  if (Array.isArray(raw)) {
    return fromArray(raw);
  }
  return [];
}

function fromObjectMap(raw: Record<string, unknown>): RawLayerSeries[] {
  const out: RawLayerSeries[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }
    const points = parseRows(value);
    if (points.length > 2) {
      out.push({ id, points });
    }
  }
  return out;
}

function fromArray(raw: unknown[]): RawLayerSeries[] {
  const out: RawLayerSeries[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const idRaw = obj.id ?? obj.name ?? obj.key;
    const rowsRaw = obj.rows ?? obj.points ?? obj.values ?? obj.series ?? obj.data;
    if (!idRaw || !rowsRaw || !Array.isArray(rowsRaw)) {
      continue;
    }
    const points = parseRows(rowsRaw);
    if (points.length > 2) {
      out.push({ id: String(idRaw), points });
    }
  }
  return out;
}

function parseRows(rows: unknown[]): RawLayerSeries["points"] {
  const out: RawLayerSeries["points"] = [];
  let previousConfirmed: number | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (typeof row === "number" && Number.isFinite(row)) {
      out.push({
        timeKey: `i:${i}`,
        sortValue: i,
        mean: row
      });
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }

    const obj = row as Record<string, unknown>;
    const timeRaw = obj.date ?? obj.time ?? obj.t ?? obj.timestamp ?? obj.day ?? i;
    const parsedTime = parseTimeToken(timeRaw, i);

    let mean: number | null = null;
    const confirmed = toFiniteNumber(obj.confirmed);
    if (confirmed !== null) {
      mean = previousConfirmed === null ? Math.max(0, confirmed) : Math.max(0, confirmed - previousConfirmed);
      previousConfirmed = confirmed;
    } else {
      const directValue =
        toFiniteNumber(obj.mean) ??
        toFiniteNumber(obj.value) ??
        toFiniteNumber(obj.count) ??
        toFiniteNumber(obj.cases) ??
        toFiniteNumber(obj.y);
      mean = directValue ?? firstNumericField(obj, ["date", "time", "t", "timestamp", "day", "id", "name"]);
    }
    if (mean === null) {
      continue;
    }

    const unc =
      toFiniteNumber(obj.unc) ??
      toFiniteNumber(obj.uncertainty) ??
      toFiniteNumber(obj.std) ??
      toFiniteNumber(obj.sigma);
    const lower = toFiniteNumber(obj.lower) ?? toFiniteNumber(obj.low);
    const upper = toFiniteNumber(obj.upper) ?? toFiniteNumber(obj.high);

    out.push({
      timeKey: parsedTime.key,
      sortValue: parsedTime.sortValue,
      mean,
      unc: unc === null ? undefined : unc,
      lower: lower === null ? undefined : lower,
      upper: upper === null ? undefined : upper
    });
  }
  return out;
}

function normalizeSeries(series: RawLayerSeries[]): { times: number[]; layers: LayerInput[] } {
  const keyToSort = new Map<string, number>();
  for (const layer of series) {
    for (const point of layer.points) {
      const prev = keyToSort.get(point.timeKey);
      if (prev === undefined || point.sortValue < prev) {
        keyToSort.set(point.timeKey, point.sortValue);
      }
    }
  }

  const orderedKeys = Array.from(keyToSort.entries())
    .sort((a, b) => {
      const [ka, sa] = a;
      const [kb, sb] = b;
      if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
        return sa - sb;
      }
      return ka.localeCompare(kb);
    })
    .map(([key]) => key);

  const indexByKey = new Map<string, number>(orderedKeys.map((key, i) => [key, i]));
  const tLength = orderedKeys.length;
  const layers: LayerInput[] = [];

  for (const layer of series) {
    const mean = new Array<number>(tLength).fill(0);
    const unc = new Array<number>(tLength).fill(0);
    const lower = new Array<number>(tLength).fill(0);
    const upper = new Array<number>(tLength).fill(0);

    let hasUnc = false;
    let hasLowerUpper = false;

    for (const point of layer.points) {
      const index = indexByKey.get(point.timeKey);
      if (index === undefined) {
        continue;
      }
      mean[index] = sanitizeNumber(point.mean, 0);
      if (point.unc !== undefined) {
        unc[index] = Math.max(0, point.unc);
        hasUnc = true;
      }
      if (point.lower !== undefined && point.upper !== undefined) {
        lower[index] = point.lower;
        upper[index] = point.upper;
        hasLowerUpper = true;
      }
    }

    normalizeNonNegative(mean, `layer ${layer.id} mean contains negative values; shifted up`);
    const output: LayerInput = { id: layer.id, mean };
    if (hasUnc) {
      output.unc = unc;
    }
    if (hasLowerUpper) {
      output.lower = lower.map((v) => Math.max(0, v));
      output.upper = upper.map((v) => Math.max(0, v));
    }
    layers.push(output);
  }

  return {
    times: Array.from({ length: tLength }, (_, i) => i),
    layers
  };
}

function ensureUncertainty(layers: LayerInput[]): boolean {
  const hasExplicitUncertainty = layers.some((layer) => {
    const hasUnc = layer.unc && layer.unc.some((v) => v > 0);
    const hasBand = layer.lower && layer.upper;
    return Boolean(hasUnc || hasBand);
  });
  if (hasExplicitUncertainty) {
    return false;
  }

  const proxies = layers.map((layer) => rollingStd(layer.mean, 7));
  let globalMax = 0;
  for (const arr of proxies) {
    for (const v of arr) {
      globalMax = Math.max(globalMax, v);
    }
  }
  const denom = globalMax > 0 ? globalMax : 1;

  for (let i = 0; i < layers.length; i += 1) {
    const unc = proxies[i].map((v) => v / denom);
    const mean = layers[i].mean;
    layers[i].unc = unc;
    layers[i].lower = mean.map((m, t) => Math.max(0, m - unc[t]));
    layers[i].upper = mean.map((m, t) => m + unc[t]);
  }
  return true;
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

function rollingStd(values: number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  const radius = Math.max(1, Math.floor(window / 2));
  for (let i = 0; i < values.length; i += 1) {
    const left = Math.max(0, i - radius);
    const right = Math.min(values.length - 1, i + radius);
    const n = right - left + 1;
    if (n <= 1) {
      out[i] = 0;
      continue;
    }
    let mean = 0;
    for (let t = left; t <= right; t += 1) {
      mean += values[t];
    }
    mean /= n;
    let acc = 0;
    for (let t = left; t <= right; t += 1) {
      const d = values[t] - mean;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / n);
  }
  return out;
}

function parseTimeToken(value: unknown, fallback: number): { key: string; sortValue: number } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { key: `n:${value}`, sortValue: value };
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return { key: `s:${value}`, sortValue: numeric };
    }
    const date = Date.parse(value);
    if (Number.isFinite(date)) {
      return { key: `s:${value}`, sortValue: date };
    }
    return { key: `s:${value}`, sortValue: fallback };
  }
  return { key: `i:${fallback}`, sortValue: fallback };
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

function firstNumericField(obj: Record<string, unknown>, exclude: string[]): number | null {
  for (const [key, value] of Object.entries(obj)) {
    if (exclude.includes(key)) {
      continue;
    }
    const n = toFiniteNumber(value);
    if (n !== null) {
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

function sanitizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeNonNegative(values: number[], warningMessage: string): void {
  let minValue = Number.POSITIVE_INFINITY;
  for (const v of values) {
    minValue = Math.min(minValue, v);
  }
  if (!Number.isFinite(minValue) || minValue >= 0) {
    return;
  }
  const shift = -minValue;
  for (let i = 0; i < values.length; i += 1) {
    values[i] += shift;
  }
  console.warn(`[covid-loader] ${warningMessage}; shift=${shift.toFixed(4)}`);
}
