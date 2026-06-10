/**
 * Dataset loading and normalization for synthetic and Covid ensemble inputs.
 *
 * Rendering components consume PreparedDataset; this module owns parsing,
 * quantile interpolation, and uncertainty-band switching.
 */
import * as d3 from "d3";
import { generateSyntheticDataset } from "./synthetic";
import type { DatasetKind, LayerInput, PreparedDataset, QuantileBands, UncertaintyBandMode } from "./types";
import { hasFinite, nearlyEqual, sum, toFiniteNumber } from "./utils";

export interface DatasetBundle {
  kind: DatasetKind;
  dataset: PreparedDataset;
  notes: string[];
  uncNote: string | null;
}

interface EnsembleCovidRow {
  target_end_date: string;
  quantile: string;
  value: string;
  abbreviation: string;
  population?: string;
  poportion?: string;
  poportion_minmax?: string;
}

interface CovidLayerMeta {
  unc50Series?: number[];
  unc95Series?: number[];
  poportionUncSeries?: number[];
  lower50Series?: number[];
  upper50Series?: number[];
  lower95Series?: number[];
  upper95Series?: number[];
  quantiles?: QuantileBands;
  regionKey?: string;
  horizonKey?: string;
}

type CovidLayerInput = LayerInput & CovidLayerMeta;

interface CovidQuantileSeries {
  q025: number[];
  q10: number[];
  q25: number[];
  q50: number[];
  q75: number[];
  q90: number[];
  q975: number[];
}

/** Create the built-in synthetic example bundle. */
export function createSyntheticBundle(): DatasetBundle {
  return {
    kind: "synthetic",
    dataset: generateSyntheticDataset(190, 8),
    notes: ["source: synthetic generator"],
    uncNote: null
  };
}

/** Load, normalize, and select the Covid ensemble dataset. */
export async function loadCovidBundle(): Promise<DatasetBundle> {
  const rows = await fetchEnsembleCovidRows();
  if (rows.length === 0) {
    throw new Error("ensemble_covid.csv has no parseable rows");
  }

  const normalized = normalizeEnsembleCovidRows(rows);
  const selected = selectAllLayers(normalized.layers);
  applyCovidUncertaintyBand(
    {
      times: normalized.times,
      layers: selected.layers,
      order: selected.layers.map((layer) => layer.id)
    },
    "95"
  );

  const uniqueRegions = new Set(
    selected.layers.map((layer) => ((layer as CovidLayerMeta).regionKey ?? layer.id.split("|")[0] ?? layer.id))
  ).size;

  return {
    kind: "covid",
    dataset: {
      times: normalized.times,
      layers: selected.layers,
      order: selected.layers.map((layer) => layer.id)
    },
    notes: [
      "source: Covid Ensemble",
      "uncertainty method: q75-q25 (IQR) and q97.5-q2.5 (95% spread)",
      `timeline points: ${normalized.times.length}`,
      `categories parsed: ${normalized.layers.length}`,
      `categories shown: ${selected.layers.length} (full state set, no top-k)`,
      `regions shown: ${uniqueRegions}`
    ],
    uncNote: "unc mode: 95% spread (q97.5-q2.5), switchable to IQR (q75-q25)"
  };
}

/** Switch Covid layer uncertainty between IQR and 95% spread. */
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

async function fetchEnsembleCovidRows(): Promise<EnsembleCovidRow[]> {
  const urlCandidates = [
    new URL("../../Data/ensemble_covid.csv", import.meta.url).toString(),
    "/Data/ensemble_covid.csv",
    "/data/ensemble_covid.csv",
    "/ensemble_covid.csv"
  ];
  let lastError: unknown = null;
  for (const url of urlCandidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const csvText = await response.text();
      const normalizedCsvText = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
      return d3.csvParse(normalizedCsvText) as unknown as EnsembleCovidRow[];
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to load ensemble_covid.csv: ${String(lastError)}`);
}

function normalizeEnsembleCovidRows(rows: EnsembleCovidRow[]): { times: number[]; layers: CovidLayerInput[] } {
  const filtered = rows.filter((row) => {
    const abbreviation = String(row.abbreviation ?? "").trim().toUpperCase();
    const time = Date.parse(String(row.target_end_date ?? ""));
    const quantile = toFiniteNumber(row.quantile);
    const value = toFiniteNumber(row.value);
    return abbreviation !== "" && abbreviation !== "US" && Number.isFinite(time) && quantile !== null && value !== null;
  });

  const dates = Array.from(
    new Set(
      filtered
        .map((row) => Date.parse(String(row.target_end_date)))
        .filter((v): v is number => Number.isFinite(v))
    )
  ).sort((a, b) => a - b);
  const indexByDate = new Map<number, number>(dates.map((value, i) => [value, i]));

  const byLocation = new Map<string, EnsembleCovidRow[]>();
  for (const row of filtered) {
    const abbreviation = String(row.abbreviation ?? "").trim().toUpperCase();
    if (!byLocation.has(abbreviation)) {
      byLocation.set(abbreviation, []);
    }
    byLocation.get(abbreviation)!.push(row);
  }

  const layers: CovidLayerInput[] = [];
  for (const [abbreviation, locationRows] of byLocation.entries()) {
    const rawCounts = createCovidQuantileSeries(dates.length);
    const rawPoportion = createCovidQuantileSeries(dates.length);

    for (const row of locationRows) {
      const time = Date.parse(String(row.target_end_date));
      const index = indexByDate.get(time);
      if (index === undefined) {
        continue;
      }
      const quantile = toFiniteNumber(row.quantile);
      const value = toFiniteNumber(row.value);
      if (quantile === null || value === null) {
        continue;
      }
      const poportionValue = toFiniteNumber(row.poportion) ?? toFiniteNumber(row.poportion_minmax);
      const v = Math.max(0, value);
      const assigned = assignCovidQuantile(rawCounts, quantile, index, v);
      if (assigned && poportionValue !== null) {
        assignCovidQuantile(rawPoportion, quantile, index, poportionValue);
      }
    }

    const counts = interpolateCovidQuantileSeries(rawCounts);
    const poportion = interpolateCovidQuantileSeries(rawPoportion);
    enforceMonotonicQuantiles(covidQuantileRows(counts));
    enforceMonotonicQuantiles(covidQuantileRows(poportion));
    layers.push(buildCovidLayer(abbreviation, rawCounts, counts, rawPoportion, poportion));
  }

  return {
    times: dates.slice(),
    layers
  };
}

function createCovidQuantileSeries(length: number): CovidQuantileSeries {
  return {
    q025: filledSeries(length),
    q10: filledSeries(length),
    q25: filledSeries(length),
    q50: filledSeries(length),
    q75: filledSeries(length),
    q90: filledSeries(length),
    q975: filledSeries(length)
  };
}

function assignCovidQuantile(series: CovidQuantileSeries, quantile: number, index: number, value: number): boolean {
  const target = covidQuantileTarget(series, quantile);
  if (!target) {
    return false;
  }
  target[index] = value;
  return true;
}

function covidQuantileTarget(series: CovidQuantileSeries, quantile: number): number[] | null {
  if (nearlyEqual(quantile, 0.025)) {
    return series.q025;
  }
  if (nearlyEqual(quantile, 0.1)) {
    return series.q10;
  }
  if (nearlyEqual(quantile, 0.25)) {
    return series.q25;
  }
  if (nearlyEqual(quantile, 0.5)) {
    return series.q50;
  }
  if (nearlyEqual(quantile, 0.75)) {
    return series.q75;
  }
  if (nearlyEqual(quantile, 0.9)) {
    return series.q90;
  }
  if (nearlyEqual(quantile, 0.975)) {
    return series.q975;
  }
  return null;
}

function interpolateCovidQuantileSeries(series: CovidQuantileSeries): CovidQuantileSeries {
  return {
    q025: interpolateFinite(series.q025),
    q10: interpolateFinite(series.q10),
    q25: interpolateFinite(series.q25),
    q50: interpolateFinite(series.q50),
    q75: interpolateFinite(series.q75),
    q90: interpolateFinite(series.q90),
    q975: interpolateFinite(series.q975)
  };
}

function covidQuantileRows(series: CovidQuantileSeries): number[][] {
  return [series.q025, series.q10, series.q25, series.q50, series.q75, series.q90, series.q975];
}

function buildCovidLayer(
  abbreviation: string,
  rawCounts: CovidQuantileSeries,
  counts: CovidQuantileSeries,
  rawPoportion: CovidQuantileSeries,
  poportion: CovidQuantileSeries
): CovidLayerInput {
  const lower95Series = hasFinite(rawCounts.q025) ? counts.q025 : counts.q10;
  const upper95Series = hasFinite(rawCounts.q975) ? counts.q975 : counts.q90;
  const poportionLowerSeries = hasFinite(rawPoportion.q025) ? poportion.q025 : poportion.q10;
  const poportionUpperSeries = hasFinite(rawPoportion.q975) ? poportion.q975 : poportion.q90;
  const iqrSeries = counts.q50.map((_value, i) => Math.max(0, counts.q75[i] - counts.q25[i]));
  const wideSeries = counts.q50.map((_value, i) => Math.max(0, upper95Series[i] - lower95Series[i]));
  const poportionUncSeries = poportion.q50.map((_value, i) => Math.max(0, poportionUpperSeries[i] - poportionLowerSeries[i]));

  return {
    id: `${abbreviation}|h1`,
    // Representative per-time value for plotting: use q50 (median) for ensemble.
    height: counts.q50.slice(),
    unc: wideSeries.slice(),
    poportionMean: poportion.q50.slice(),
    poportionUnc: poportionUncSeries.slice(),
    poportionLower: poportionLowerSeries.slice(),
    poportionUpper: poportionUpperSeries.slice(),
    lower: lower95Series.slice(),
    upper: upper95Series.slice(),
    unc50Series: iqrSeries.slice(),
    unc95Series: wideSeries.slice(),
    poportionUncSeries: poportionUncSeries.slice(),
    lower50Series: counts.q25.slice(),
    upper50Series: counts.q75.slice(),
    lower95Series: lower95Series.slice(),
    upper95Series: upper95Series.slice(),
    poportionQuantiles: {
      p05: poportionLowerSeries.slice(),
      p25: poportion.q25.slice(),
      p50: poportion.q50.slice(),
      p75: poportion.q75.slice(),
      p95: poportionUpperSeries.slice(),
      p025: poportionLowerSeries.slice(),
      p10: poportion.q10.slice(),
      p90: poportion.q90.slice(),
      p975: poportionUpperSeries.slice()
    },
    quantiles: {
      // Keep legacy keys for compatibility, and include the full quantile set for spaghetti views.
      p05: lower95Series.slice(),
      p25: counts.q25.slice(),
      p50: counts.q50.slice(),
      p75: counts.q75.slice(),
      p95: upper95Series.slice(),
      p025: lower95Series.slice(),
      p10: counts.q10.slice(),
      p90: counts.q90.slice(),
      p975: upper95Series.slice()
    },
    regionKey: abbreviation,
    horizonKey: "h1"
  };
}

function selectAllLayers(layers: LayerInput[]): { layers: LayerInput[] } {
  const sorted = layers
    .slice()
    .sort((a, b) => {
      const sa = sum(a.height);
      const sb = sum(b.height);
      if (sb !== sa) {
        return sb - sa;
      }
      return a.id.localeCompare(b.id);
    });
  return { layers: sorted };
}

function filledSeries(length: number, fill = Number.NaN): number[] {
  return new Array<number>(length).fill(fill);
}

function interpolateFinite(values: number[]): number[] {
  const out = values.slice();
  let firstFinite = -1;
  for (let i = 0; i < out.length; i += 1) {
    if (Number.isFinite(out[i])) {
      firstFinite = i;
      break;
    }
  }
  if (firstFinite < 0) {
    return new Array<number>(out.length).fill(0);
  }
  for (let i = 0; i < firstFinite; i += 1) {
    out[i] = out[firstFinite];
  }
  let lastFinite = firstFinite;
  for (let i = firstFinite + 1; i < out.length; i += 1) {
    if (Number.isFinite(out[i])) {
      const start = out[lastFinite];
      const end = out[i];
      const span = i - lastFinite;
      for (let j = 1; j < span; j += 1) {
        out[lastFinite + j] = start + (end - start) * (j / span);
      }
      lastFinite = i;
    }
  }
  for (let i = lastFinite + 1; i < out.length; i += 1) {
    out[i] = out[lastFinite];
  }
  return out.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
}

function enforceMonotonicQuantiles(series: number[][]): void {
  if (series.length === 0) {
    return;
  }
  const tLength = series[0].length;
  for (let t = 0; t < tLength; t += 1) {
    for (let i = 1; i < series.length; i += 1) {
      series[i][t] = Math.max(series[i][t], series[i - 1][t]);
    }
  }
}
