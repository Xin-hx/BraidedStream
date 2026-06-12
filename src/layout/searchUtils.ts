/**
 * Shared utilities for layout parameter searches.
 *
 * Multiscale-only and PID-vs-Sine experiments use different setup logic but
 * share range sanitization, candidate summaries, and sorting rules.
 */
import { clamp, round } from "../core/utils";
import type { MetricRow } from "./metrics";

export const CORE_METRIC_KEYS = ["meanSlope", "wiggle", "illusion"] as const;

export type CoreMetricKey = (typeof CORE_METRIC_KEYS)[number];
export type SearchCenterType = "median" | "mean" | "geometric" | "harmonic";

export interface SearchRange {
  min: number;
  max: number;
  step: number;
}

export interface CoreMetricDelta {
  key: CoreMetricKey;
  label: string;
  before: number;
  after: number;
  delta: number;
  improvementPct: number;
}

export interface ScopeSummary {
  metrics: CoreMetricDelta[];
  maxImprovementPct: number;
  avgImprovementPct: number;
}

export interface SearchCandidateForSort {
  pass: boolean;
  roi: ScopeSummary;
  global: ScopeSummary;
  sortKey: string;
}

export interface SearchCandidateParams {
  baselineCenterType: SearchCenterType;
  baselineUncertaintyWeight: number;
  energyThreshold: number;
}

export interface SearchCandidateDiagnostics {
  fallbackUsed: boolean;
  fallbackReason: string | null;
  verified: boolean;
  effectiveScaleCount: number;
  threshold: number;
}

export interface SearchSummary {
  totalCandidates: number;
  passCount: number;
  failCount: number;
}

export interface ParameterGridSearchOptions<TCandidate extends SearchCandidateForSort> {
  centerTypes: SearchCenterType[];
  baselineUncertaintyWeights: number[];
  energyThresholds: number[];
  topN: number;
  buildCandidate: (params: SearchCandidateParams) => TCandidate;
}

export interface ParameterGridSearchResult<TCandidate extends SearchCandidateForSort> {
  summary: SearchSummary;
  best: TCandidate | null;
  candidates: TCandidate[];
  topCandidates: TCandidate[];
}

/** Normalize user-provided center type sets. */
export function sanitizeCenterTypes(values: SearchCenterType[]): SearchCenterType[] {
  const centerTypes = Array.from(new Set(values)).filter((value): value is SearchCenterType =>
    value === "median" || value === "mean" || value === "geometric" || value === "harmonic"
  );
  return centerTypes.length > 0 ? centerTypes : ["median"];
}

/** Sanitize numeric search range bounds and step size. */
export function sanitizeRange(
  range: SearchRange,
  fallback: SearchRange,
  hardMin = Number.NEGATIVE_INFINITY,
  hardMax = Number.POSITIVE_INFINITY
): SearchRange {
  const minRaw = finiteNumber(range.min, fallback.min);
  const maxRaw = finiteNumber(range.max, fallback.max);
  const stepRaw = finiteNumber(range.step, fallback.step);
  const min = clamp(Math.min(minRaw, maxRaw), hardMin, hardMax);
  const max = clamp(Math.max(minRaw, maxRaw), hardMin, hardMax);
  const step = Math.max(1e-6, Math.abs(stepRaw));
  return { min, max, step };
}

/** Expand a sanitized range into deterministic rounded values. */
export function discreteValues(range: SearchRange): number[] {
  const values: number[] = [];
  const maxLoops = 5000;
  let loops = 0;
  for (let value = range.min; value <= range.max + range.step * 1e-6 && loops < maxLoops; value += range.step) {
    values.push(round(value, 6));
    loops += 1;
  }
  const dedup = Array.from(new Set(values.map((value) => round(value, 6))));
  dedup.sort((a, b) => a - b);
  return dedup.length > 0 ? dedup : [round(range.min, 6)];
}

/** Summarize the core readability metrics used by search ranking. */
export function scopeSummaryFromMetricRows(rows: Array<Pick<MetricRow, "key" | "label" | "before" | "after">>): ScopeSummary {
  const metrics = CORE_METRIC_KEYS.map((key) => {
    const row = rows.find((item) => item.key === key);
    const before = row?.before ?? 0;
    const after = row?.after ?? 0;
    const delta = after - before;
    const improvementPct = relativeImprovementDown(before, after);
    return {
      key,
      label: row?.label ?? key,
      before,
      after,
      delta,
      improvementPct
    };
  });

  const improvements = metrics.map((metric) => metric.improvementPct);
  return {
    metrics,
    maxImprovementPct: Math.max(...improvements),
    avgImprovementPct: improvements.reduce((sum, value) => sum + value, 0) / Math.max(1, improvements.length)
  };
}

/** Reasons for metric regressions beyond the accepted guardrail. */
export function regressionReasons(scopeName: string, scope: ScopeSummary, regressionGuardrailPct: number): string[] {
  return scope.metrics
    .filter((metric) => metric.improvementPct < -regressionGuardrailPct)
    .map(
      (metric) =>
        `${scopeName} ${metric.key} regressed ${(-metric.improvementPct).toFixed(2)}% > ${regressionGuardrailPct.toFixed(2)}%`
    );
}

/** Standard success summary for passing search candidates. */
export function passReasons(roi: ScopeSummary, global: ScopeSummary): string[] {
  return [
    `ROI max improvement ${roi.maxImprovementPct.toFixed(2)}%`,
    `ROI avg improvement ${roi.avgImprovementPct.toFixed(2)}%`,
    `Global avg improvement ${global.avgImprovementPct.toFixed(2)}%`
  ];
}

/** Common candidate ordering: pass first, then ROI/global quality. */
export function compareSearchCandidates(a: SearchCandidateForSort, b: SearchCandidateForSort): number {
  if (a.pass !== b.pass) {
    return a.pass ? -1 : 1;
  }
  if (a.roi.maxImprovementPct !== b.roi.maxImprovementPct) {
    return b.roi.maxImprovementPct - a.roi.maxImprovementPct;
  }
  if (a.roi.avgImprovementPct !== b.roi.avgImprovementPct) {
    return b.roi.avgImprovementPct - a.roi.avgImprovementPct;
  }
  if (a.global.avgImprovementPct !== b.global.avgImprovementPct) {
    return b.global.avgImprovementPct - a.global.avgImprovementPct;
  }
  return a.sortKey.localeCompare(b.sortKey);
}

/** Shared grid-search shell for layout experiments that vary center, strength, and threshold. */
export function runParameterGridSearch<TCandidate extends SearchCandidateForSort>(
  options: ParameterGridSearchOptions<TCandidate>
): ParameterGridSearchResult<TCandidate> {
  const candidates: TCandidate[] = [];

  for (const baselineCenterType of options.centerTypes) {
    for (const baselineUncertaintyWeight of options.baselineUncertaintyWeights) {
      for (const energyThreshold of options.energyThresholds) {
        candidates.push(
          options.buildCandidate({
            baselineCenterType,
            baselineUncertaintyWeight,
            energyThreshold
          })
        );
      }
    }
  }

  candidates.sort(compareSearchCandidates);
  const topN = Math.max(1, Math.round(options.topN));

  return {
    summary: {
      totalCandidates: candidates.length,
      passCount: candidates.filter((item) => item.pass).length,
      failCount: candidates.filter((item) => !item.pass).length
    },
    best: candidates[0] ?? null,
    candidates,
    topCandidates: candidates.slice(0, topN)
  };
}

/** Stable sort key for parameter combinations. */
export function sortKeyFromParams(params: {
  baselineCenterType: SearchCenterType;
  baselineUncertaintyWeight: number;
  energyThreshold: number;
}): string {
  return [
    params.baselineCenterType,
    params.baselineUncertaintyWeight.toFixed(6),
    params.energyThreshold.toFixed(6)
  ].join("|");
}

export function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function relativeImprovementDown(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return 0;
  }
  const denominator = Math.max(1e-9, Math.abs(before));
  return ((before - after) / denominator) * 100;
}
