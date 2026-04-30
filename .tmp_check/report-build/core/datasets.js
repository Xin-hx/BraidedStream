import * as d3 from "d3";
import { generateSyntheticDataset } from "./synthetic.js";
export function createSyntheticBundle() {
    return {
        kind: "synthetic",
        dataset: generateSyntheticDataset(190, 8),
        notes: ["source: synthetic generator"],
        uncNote: null
    };
}
export async function loadCovidBundle() {
    const rows = await fetchEnsembleCovidRows();
    if (rows.length === 0) {
        throw new Error("ensemble_covid.csv has no parseable rows");
    }
    const normalized = normalizeEnsembleCovidRows(rows);
    const selected = selectAllLayers(normalized.layers);
    applyCovidUncertaintyBand({
        times: normalized.times,
        layers: selected.layers,
        order: selected.layers.map((layer) => layer.id)
    }, "95");
    const uniqueRegions = new Set(selected.layers.map((layer) => (layer.regionKey ?? layer.id.split("|")[0] ?? layer.id))).size;
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
export function applyCovidUncertaintyBand(dataset, mode) {
    let changed = false;
    for (const layer of dataset.layers) {
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
async function fetchEnsembleCovidRows() {
    const urlCandidates = [
        new URL("../../Data/ensemble_covid.csv", import.meta.url).toString(),
        "/Data/ensemble_covid.csv",
        "/data/ensemble_covid.csv",
        "/ensemble_covid.csv"
    ];
    let lastError = null;
    for (const url of urlCandidates) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const csvText = await response.text();
            const normalizedCsvText = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
            return d3.csvParse(normalizedCsvText);
        }
        catch (error) {
            lastError = error;
        }
    }
    throw new Error(`Unable to load ensemble_covid.csv: ${String(lastError)}`);
}
function normalizeEnsembleCovidRows(rows) {
    const filtered = rows.filter((row) => {
        const abbreviation = String(row.abbreviation ?? "").trim().toUpperCase();
        const time = Date.parse(String(row.target_end_date ?? ""));
        const quantile = toFiniteNumber(row.quantile);
        const value = toFiniteNumber(row.value);
        return abbreviation !== "" && abbreviation !== "US" && Number.isFinite(time) && quantile !== null && value !== null;
    });
    const dates = Array.from(new Set(filtered
        .map((row) => Date.parse(String(row.target_end_date)))
        .filter((v) => Number.isFinite(v)))).sort((a, b) => a - b);
    const indexByDate = new Map(dates.map((value, i) => [value, i]));
    const byLocation = new Map();
    for (const row of filtered) {
        const abbreviation = String(row.abbreviation ?? "").trim().toUpperCase();
        if (!byLocation.has(abbreviation)) {
            byLocation.set(abbreviation, []);
        }
        byLocation.get(abbreviation).push(row);
    }
    const layers = [];
    for (const [abbreviation, locationRows] of byLocation.entries()) {
        const q025 = filledSeries(dates.length);
        const q10 = filledSeries(dates.length);
        const q25 = filledSeries(dates.length);
        const q50 = filledSeries(dates.length);
        const q75 = filledSeries(dates.length);
        const q90 = filledSeries(dates.length);
        const q975 = filledSeries(dates.length);
        const poportionQ025 = filledSeries(dates.length);
        const poportionQ10 = filledSeries(dates.length);
        const poportionQ25 = filledSeries(dates.length);
        const poportionQ50 = filledSeries(dates.length);
        const poportionQ75 = filledSeries(dates.length);
        const poportionQ90 = filledSeries(dates.length);
        const poportionQ975 = filledSeries(dates.length);
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
            const poportionValue = toFiniteNumber(row.poportion_minmax) ?? toFiniteNumber(row.poportion);
            const v = Math.max(0, value);
            if (nearlyEqual(quantile, 0.025)) {
                q025[index] = v;
                if (poportionValue !== null) {
                    poportionQ025[index] = poportionValue;
                }
            }
            else if (nearlyEqual(quantile, 0.1)) {
                q10[index] = v;
                if (poportionValue !== null) {
                    poportionQ10[index] = poportionValue;
                }
            }
            else if (nearlyEqual(quantile, 0.25)) {
                q25[index] = v;
                if (poportionValue !== null) {
                    poportionQ25[index] = poportionValue;
                }
            }
            else if (nearlyEqual(quantile, 0.5)) {
                q50[index] = v;
                if (poportionValue !== null) {
                    poportionQ50[index] = poportionValue;
                }
            }
            else if (nearlyEqual(quantile, 0.75)) {
                q75[index] = v;
                if (poportionValue !== null) {
                    poportionQ75[index] = poportionValue;
                }
            }
            else if (nearlyEqual(quantile, 0.9)) {
                q90[index] = v;
                if (poportionValue !== null) {
                    poportionQ90[index] = poportionValue;
                }
            }
            else if (nearlyEqual(quantile, 0.975)) {
                q975[index] = v;
                if (poportionValue !== null) {
                    poportionQ975[index] = poportionValue;
                }
            }
        }
        const q025Series = interpolateFinite(q025);
        const q10Series = interpolateFinite(q10);
        const q25Series = interpolateFinite(q25);
        const q50Series = interpolateFinite(q50);
        const q75Series = interpolateFinite(q75);
        const q90Series = interpolateFinite(q90);
        const q975Series = interpolateFinite(q975);
        const poportionQ025Series = interpolateFinite(poportionQ025);
        const poportionQ10Series = interpolateFinite(poportionQ10);
        const poportionQ25Series = interpolateFinite(poportionQ25);
        const poportionQ50Series = interpolateFinite(poportionQ50);
        const poportionQ75Series = interpolateFinite(poportionQ75);
        const poportionQ90Series = interpolateFinite(poportionQ90);
        const poportionQ975Series = interpolateFinite(poportionQ975);
        enforceMonotonicQuantiles([q025Series, q10Series, q25Series, q50Series, q75Series, q90Series, q975Series]);
        enforceMonotonicQuantiles([
            poportionQ025Series,
            poportionQ10Series,
            poportionQ25Series,
            poportionQ50Series,
            poportionQ75Series,
            poportionQ90Series,
            poportionQ975Series
        ]);
        const hasQ025 = hasFinite(q025);
        const hasQ975 = hasFinite(q975);
        const lower95Series = hasQ025 ? q025Series : q10Series;
        const upper95Series = hasQ975 ? q975Series : q90Series;
        const hasPoportionQ025 = hasFinite(poportionQ025);
        const hasPoportionQ975 = hasFinite(poportionQ975);
        const poportionLowerSeries = hasPoportionQ025 ? poportionQ025Series : poportionQ10Series;
        const poportionUpperSeries = hasPoportionQ975 ? poportionQ975Series : poportionQ90Series;
        const iqrSeries = q50Series.map((_, i) => Math.max(0, q75Series[i] - q25Series[i]));
        const wideSeries = q50Series.map((_, i) => Math.max(0, upper95Series[i] - lower95Series[i]));
        const poportionUncSeries = poportionQ50Series.map((_, i) => Math.max(0, poportionUpperSeries[i] - poportionLowerSeries[i]));
        layers.push({
            id: `${abbreviation}|h1`,
            mean: q50Series.slice(),
            unc: wideSeries.slice(),
            poportionUnc: poportionUncSeries.slice(),
            lower: lower95Series.slice(),
            upper: upper95Series.slice(),
            unc50Series: iqrSeries.slice(),
            unc95Series: wideSeries.slice(),
            poportionUncSeries: poportionUncSeries.slice(),
            lower50Series: q25Series.slice(),
            upper50Series: q75Series.slice(),
            lower95Series: lower95Series.slice(),
            upper95Series: upper95Series.slice(),
            quantiles: {
                // Keep legacy keys for compatibility, and include full quantile set for spaghetti.
                p05: lower95Series.slice(),
                p25: q25Series.slice(),
                p50: q50Series.slice(),
                p75: q75Series.slice(),
                p95: upper95Series.slice(),
                p025: lower95Series.slice(),
                p10: q10Series.slice(),
                p90: q90Series.slice(),
                p975: upper95Series.slice()
            },
            regionKey: abbreviation,
            horizonKey: "h1"
        });
    }
    return {
        times: dates.slice(),
        layers
    };
}
function selectAllLayers(layers) {
    const sorted = layers
        .slice()
        .sort((a, b) => {
        const sa = sum(a.mean);
        const sb = sum(b.mean);
        if (sb !== sa) {
            return sb - sa;
        }
        return a.id.localeCompare(b.id);
    });
    return { layers: sorted };
}
function filledSeries(length, fill = Number.NaN) {
    return new Array(length).fill(fill);
}
function interpolateFinite(values) {
    const out = values.slice();
    let firstFinite = -1;
    for (let i = 0; i < out.length; i += 1) {
        if (Number.isFinite(out[i])) {
            firstFinite = i;
            break;
        }
    }
    if (firstFinite < 0) {
        return new Array(out.length).fill(0);
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
function toFiniteNumber(value) {
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
function nearlyEqual(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}
function hasFinite(values) {
    return values.some((v) => Number.isFinite(v));
}
function enforceMonotonicQuantiles(series) {
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
function sum(values) {
    let out = 0;
    for (const v of values) {
        out += v;
    }
    return out;
}
