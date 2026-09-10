/**
 * Quantile validation and missing-value handling (METHOD.md M1).
 */
import {
  QUANTILE_KEYS,
  type QuantileKey,
  type QuantileMatrix,
  type ValidationIssue,
  type ValidationResult,
} from "./types";

const KEYS: QuantileKey[] = [...QUANTILE_KEYS];

/** Fill missing (NaN) entries by linear interpolation over time; endpoints clamp to nearest. */
export function fillMissingTimeSeries(values: number[]): number[] {
  const out = values.slice();
  const n = out.length;
  let i = 0;
  while (i < n) {
    if (!Number.isFinite(out[i])) {
      let j = i;
      while (j < n && !Number.isFinite(out[j])) j += 1;
      // [i, j) is a NaN run; interpolate from out[i-1] to out[j] (or clamp at edges)
      const y0 = i > 0 ? out[i - 1] : out[j];
      const y1 = j < n ? out[j] : y0;
      for (let k = i; k < j; k += 1) {
        if (j < n && i > 0) {
          out[k] = y0 + ((y1 - y0) * (k - i + 1)) / (j - i + 1);
        } else {
          out[k] = y1;
        }
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * Validate a single layer's quantile matrix:
 *  - all quantiles finite (after fill) and >= 0
 *  - monotone non-decreasing in p (tolerance 1e-9)
 * Returns the (possibly interpolated) matrix plus issues.
 */
export function validateLayerQuantiles(
  layerId: string,
  q: QuantileMatrix,
  fillMissing: boolean
): { matrix: QuantileMatrix; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const matrix = {} as QuantileMatrix;
  const tLen = q.p50.length;

  for (const key of KEYS) {
    const series = q[key];
    if (series.length !== tLen) {
      throw new Error(`layer ${layerId}: quantile ${key} length ${series.length} != ${tLen}`);
    }
    matrix[key] = fillMissing ? fillMissingTimeSeries(series) : series.slice();
  }

  for (let t = 0; t < tLen; t += 1) {
    let prev = -Infinity;
    for (const key of KEYS) {
      const v = matrix[key][t];
      if (!Number.isFinite(v)) {
        issues.push({ layerId, timeIndex: t, message: `non-finite ${key}` });
      } else if (v < 0) {
        issues.push({ layerId, timeIndex: t, message: `negative ${key}=${v}` });
      } else if (v < prev - 1e-9) {
        issues.push({ layerId, timeIndex: t, message: `monotonicity broken at ${key}` });
      }
      if (v > prev) prev = v;
    }
  }
  return { matrix, issues };
}

export function validateData(
  layers: { id: string; q: QuantileMatrix }[],
  fillMissing = true
): { layers: { id: string; q: QuantileMatrix }[]; result: ValidationResult } {
  const issues: ValidationIssue[] = [];
  const out: { id: string; q: QuantileMatrix }[] = [];
  for (const layer of layers) {
    const { matrix, issues: layerIssues } = validateLayerQuantiles(layer.id, layer.q, fillMissing);
    issues.push(...layerIssues);
    out.push({ id: layer.id, q: matrix });
  }
  return { layers: out, result: { ok: issues.length === 0, issues } };
}
