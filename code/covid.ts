/**
 * COVID-19 Forecast Hub ensemble loader (METHOD.md M11).
 *
 * Source: Demo/code/dataset/ensemble_covid_inc_case.csv (COVIDhub-ensemble
 * "1 wk ahead inc case", 2020-07 .. 2023-02, weekly, 7 quantiles). Columns:
 * target_end_date, quantile, value, abbreviation, population.
 *
 * State forecasts are aggregated into the four standard US Census regions.
 * Missing (date,region) cells are NaN and filled by the pipeline.
 */
import type { Layer } from "./types";
import censusRegions from "./dataset/us-census-regions.json";

type StateInfo = { fips: string; region: string };
const stateToRegion = Object.fromEntries(Object.entries(censusRegions.states as Record<string, StateInfo>).map(([state, info]) => [state, info.region]));
export const US_REGIONS = censusRegions.region_order;

const QUANTILE_MAP: Record<string, keyof Layer["q"]> = {
  "0.025": "p025",
  "0.1": "p10",
  "0.25": "p25",
  "0.5": "p50",
  "0.75": "p75",
  "0.9": "p90",
  "0.975": "p975",
};

export function parseCovidCsv(text: string): {
  layers: Layer[];
  times: string[];
} {
  // (date -> Census region -> quantileKey -> summed state values)
  const cells = new Map<string, Map<string, Partial<Record<keyof Layer["q"], number>>>>();
  const dateSet = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("target_end_date")) continue;
    const parts = line.split(",");
    if (parts.length < 4) continue;
    const [date, quantileStr, valueStr, state] = parts;
    const region = stateToRegion[state];
    if (!region) continue;
    const quantile = Number(quantileStr);
    const value = Number(valueStr);
    const key = QUANTILE_MAP[String(quantile)];
    if (!key || !Number.isFinite(value)) continue;

    dateSet.add(date);
    let byState = cells.get(date);
    if (!byState) {
      byState = new Map();
      cells.set(date, byState);
    }
    let byQ = byState.get(region);
    if (!byQ) {
      byQ = {};
      byState.set(region, byQ);
    }
    byQ[key] = (byQ[key] ?? 0) + value;
  }

  const times = Array.from(dateSet).sort();
  const tLen = times.length;

  const layers: Layer[] = US_REGIONS.map((region) => {
    const q = { p025: [], p10: [], p25: [], p50: [], p75: [], p90: [], p975: [] } as Layer["q"];
    for (let t = 0; t < tLen; t += 1) {
      const byQ = cells.get(times[t])?.get(region);
      for (const key of Object.keys(q) as (keyof Layer["q"])[]) {
        const v = byQ?.[key];
        q[key].push(v !== undefined ? v : Number.NaN);
      }
    }
    return { id: region, q };
  });

  return { layers, times };
}
