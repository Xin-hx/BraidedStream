/**
 * Grid search for multiscale baseline parameters under a fixed layer order.
 *
 * Includes shared search utilities (was searchUtils.ts).
 */
import { computeBaseline } from "../core/baseline/compute";
import { computeMultiscaleDistributedBaseline } from "../core/baseline/multiscale";
import type { BaselineParameters } from "../core/baseline/types";
import { optimizeLayerOrder } from "../core/ordering/sineStream";
import { computeStackedBoundaries } from "../core/stack";
import { clamp, round } from "../core/utils";
import { emptyInvariantSummary } from "../core/validate";
import type { LayerInput, LayoutOptimizationConfig, PreparedDataset, ROI } from "../core/types";
import { computeMetrics, type MetricRow } from "./metrics";

// ---- Search types ----

const CORE_METRIC_KEYS = ["meanSlope", "wiggle", "illusion"] as const;
type CoreMetricKey = (typeof CORE_METRIC_KEYS)[number];

export type SearchCenterType = "median" | "mean" | "geometric" | "harmonic";

export interface SearchRange {
  min: number;
  max: number;
  step: number;
}

interface CoreMetricDelta {
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

interface SearchCandidateForSort {
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

interface ParameterGridSearchOptions<TCandidate extends SearchCandidateForSort> {
  centerTypes: SearchCenterType[];
  baselineUncertaintyWeights: number[];
  energyThresholds: number[];
  topN: number;
  buildCandidate: (params: SearchCandidateParams) => TCandidate;
}

interface ParameterGridSearchResult<TCandidate extends SearchCandidateForSort> {
  summary: SearchSummary;
  best: TCandidate | null;
  candidates: TCandidate[];
  topCandidates: TCandidate[];
}

// ---- Multiscale search types ----

export interface MultiscaleSearchSpace {
  baselineUncertaintyWeight: SearchRange;
  energyThreshold: SearchRange;
  centerTypes: SearchCenterType[];
  passThresholdPct: number;
  regressionGuardrailPct: number;
  topN: number;
}

export interface MultiscaleCandidateResult {
  params: SearchCandidateParams;
  pass: boolean;
  reasons: string[];
  roi: ScopeSummary;
  global: ScopeSummary;
  diagnostics: SearchCandidateDiagnostics;
  sortKey: string;
}

export interface MultiscaleSearchResult {
  searchSpace: MultiscaleSearchSpace;
  summary: SearchSummary;
  best: MultiscaleCandidateResult | null;
  candidates: MultiscaleCandidateResult[];
  topCandidates: MultiscaleCandidateResult[];
}

export interface MultiscaleSearchInput {
  dataset: PreparedDataset;
  roi: ROI | null;
  orderedLayers: LayerInput[];
  searchSpace: MultiscaleSearchSpace;
  baseHooks?: Omit<BaselineParameters, "centerType">;
}

// ---- Public API ----

export function buildFixedOrder(
  dataset: PreparedDataset,
  optimization: LayoutOptimizationConfig,
  shuffleSeed?: number
): string[] {
  const optimized = optimizeLayerOrder(
    dataset.layers,
    null,
    {
      clusterAutoCutScale: optimization.clusterAutoCutScale,
      clusterBoundaryPenalty: optimization.clusterBoundaryPenalty,
      similaritySigma: optimization.orderSimilaritySigma,
      maxSwapPasses: optimization.orderMaxSwapPasses,
      weightType: optimization.orderWeightType ?? "max",
      useThicknessWeight: optimization.orderUseThicknessWeight !== false,
      useLengthWeight: optimization.orderUseLengthWeight !== false,
      lengthWeightThreshold: optimization.orderLengthWeightThreshold ?? 9,
      shuffleSeed: Number.isFinite(shuffleSeed) ? shuffleSeed : optimization.shuffleSeed,
      useUncertaintyTerm: false,
      uncertaintyWeight: 0
    },
    dataset.order
  );
  return optimized.order.slice();
}

export function runMultiscaleSearch(input: MultiscaleSearchInput): MultiscaleSearchResult {
  const searchSpace = sanitizeSearchSpace(input.searchSpace);
  const strengths = discreteValues(searchSpace.baselineUncertaintyWeight);
  const thresholds = discreteValues(searchSpace.energyThreshold);

  const invariant = emptyInvariantSummary();
  const result = runParameterGridSearch<MultiscaleCandidateResult>({
    centerTypes: searchSpace.centerTypes,
    baselineUncertaintyWeights: strengths,
    energyThresholds: thresholds,
    topN: searchSpace.topN,
    buildCandidate: (params) => {
      const hooks: BaselineParameters = {
        ...(input.baseHooks ?? {}),
        centerType: params.baselineCenterType
      };
      const beforeBaseline = computeBaseline(input.dataset.times, input.orderedLayers, "sineStream", hooks);
      const beforeLayout = computeStackedBoundaries(beforeBaseline, input.orderedLayers);
      const multiscale = computeMultiscaleDistributedBaseline(
        input.dataset.times,
        input.orderedLayers,
        params.baselineUncertaintyWeight,
        hooks,
        params.energyThreshold
      );
      const afterLayout = computeStackedBoundaries(multiscale.baseline, input.orderedLayers);
      const metrics = computeMetrics(input.dataset, beforeLayout, afterLayout, input.roi, invariant, input.orderedLayers, {
        includeGlobalRows: true
      });
      const roi = scopeSummaryFromMetricRows(metrics.rows);
      const global = scopeSummaryFromMetricRows(metrics.globalRows ?? metrics.rows);
      const reasons = evaluateCandidate(
        roi, global,
        searchSpace.passThresholdPct,
        searchSpace.regressionGuardrailPct,
        multiscale.diagnostics.fallbackUsed,
        multiscale.diagnostics.fallbackReason
      );

      return {
        params,
        pass: reasons.length === 0,
        reasons: reasons.length === 0 ? passReasons(roi, global) : reasons,
        roi,
        global,
        diagnostics: {
          fallbackUsed: multiscale.diagnostics.fallbackUsed,
          fallbackReason: multiscale.diagnostics.fallbackReason,
          verified: multiscale.diagnostics.verifiedMultiscale,
          effectiveScaleCount: multiscale.diagnostics.effectiveScaleCount,
          threshold: multiscale.diagnostics.energyThreshold
        },
        sortKey: sortKeyFromParams(params)
      };
    }
  });

  return { searchSpace, ...result };
}

// ---- Search space sanitization ----

function sanitizeSearchSpace(space: MultiscaleSearchSpace): MultiscaleSearchSpace {
  return {
    baselineUncertaintyWeight: sanitizeRange(space.baselineUncertaintyWeight, { min: 0.15, max: 1.2, step: 0.05 }),
    energyThreshold: sanitizeRange(space.energyThreshold, { min: 0.04, max: 0.2, step: 0.02 }, 0, 1),
    centerTypes: sanitizeCenterTypes(space.centerTypes),
    passThresholdPct: finiteNumber(space.passThresholdPct, 5),
    regressionGuardrailPct: Math.max(0, finiteNumber(space.regressionGuardrailPct, 3)),
    topN: Math.max(1, Math.round(finiteNumber(space.topN, 20)))
  };
}

function evaluateCandidate(
  roi: ScopeSummary,
  global: ScopeSummary,
  passThresholdPct: number,
  regressionGuardrailPct: number,
  fallbackUsed: boolean,
  fallbackReason: string | null
): string[] {
  const reasons: string[] = [];

  if (fallbackUsed) {
    reasons.push(`fallback used${fallbackReason ? `: ${fallbackReason}` : ""}`);
    return reasons;
  }

  if (roi.maxImprovementPct < passThresholdPct) {
    reasons.push(`ROI max improvement ${roi.maxImprovementPct.toFixed(2)}% < ${passThresholdPct.toFixed(2)}%`);
  }

  reasons.push(...regressionReasons("ROI", roi, regressionGuardrailPct));
  reasons.push(...regressionReasons("Global", global, regressionGuardrailPct));

  return reasons;
}

// ---- Shared search utilities (was searchUtils.ts) ----

function sanitizeCenterTypes(values: SearchCenterType[]): SearchCenterType[] {
  const valid = new Set<SearchCenterType>(["median", "mean", "geometric", "harmonic"]);
  const centerTypes = Array.from(new Set(values)).filter((v): v is SearchCenterType => valid.has(v));
  return centerTypes.length > 0 ? centerTypes : ["median"];
}

function sanitizeRange(
  range: SearchRange,
  fallback: SearchRange,
  hardMin = Number.NEGATIVE_INFINITY,
  hardMax = Number.POSITIVE_INFINITY
): SearchRange {
  const minRaw = finiteNumber(range.min, fallback.min);
  const maxRaw = finiteNumber(range.max, fallback.max);
  const stepRaw = finiteNumber(range.step, fallback.step);
  return {
    min: clamp(Math.min(minRaw, maxRaw), hardMin, hardMax),
    max: clamp(Math.max(minRaw, maxRaw), hardMin, hardMax),
    step: Math.max(1e-6, Math.abs(stepRaw))
  };
}

function discreteValues(range: SearchRange): number[] {
  const values: number[] = [];
  const maxLoops = 5000;
  let loops = 0;
  for (let value = range.min; value <= range.max + range.step * 1e-6 && loops < maxLoops; value += range.step) {
    values.push(round(value, 6));
    loops += 1;
  }
  const dedup = Array.from(new Set(values.map((v) => round(v, 6))));
  dedup.sort((a, b) => a - b);
  return dedup.length > 0 ? dedup : [round(range.min, 6)];
}

function scopeSummaryFromMetricRows(rows: Array<Pick<MetricRow, "key" | "label" | "before" | "after">>): ScopeSummary {
  const metrics = CORE_METRIC_KEYS.map((key) => {
    const row = rows.find((item) => item.key === key);
    const before = row?.before ?? 0;
    const after = row?.after ?? 0;
    return {
      key,
      label: row?.label ?? key,
      before,
      after,
      delta: after - before,
      improvementPct: relativeImprovementDown(before, after)
    };
  });

  const improvements = metrics.map((m) => m.improvementPct);
  return {
    metrics,
    maxImprovementPct: Math.max(...improvements),
    avgImprovementPct: improvements.reduce((sum, v) => sum + v, 0) / Math.max(1, improvements.length)
  };
}

function regressionReasons(scopeName: string, scope: ScopeSummary, guardrailPct: number): string[] {
  return scope.metrics
    .filter((m) => m.improvementPct < -guardrailPct)
    .map((m) => `${scopeName} ${m.key} regressed ${(-m.improvementPct).toFixed(2)}% > ${guardrailPct.toFixed(2)}%`);
}

function passReasons(roi: ScopeSummary, global: ScopeSummary): string[] {
  return [
    `ROI max improvement ${roi.maxImprovementPct.toFixed(2)}%`,
    `ROI avg improvement ${roi.avgImprovementPct.toFixed(2)}%`,
    `Global avg improvement ${global.avgImprovementPct.toFixed(2)}%`
  ];
}

function compareSearchCandidates(a: SearchCandidateForSort, b: SearchCandidateForSort): number {
  if (a.pass !== b.pass) return a.pass ? -1 : 1;
  if (a.roi.maxImprovementPct !== b.roi.maxImprovementPct) return b.roi.maxImprovementPct - a.roi.maxImprovementPct;
  if (a.roi.avgImprovementPct !== b.roi.avgImprovementPct) return b.roi.avgImprovementPct - a.roi.avgImprovementPct;
  if (a.global.avgImprovementPct !== b.global.avgImprovementPct) return b.global.avgImprovementPct - a.global.avgImprovementPct;
  return a.sortKey.localeCompare(b.sortKey);
}

function runParameterGridSearch<TCandidate extends SearchCandidateForSort>(
  options: ParameterGridSearchOptions<TCandidate>
): ParameterGridSearchResult<TCandidate> {
  const candidates: TCandidate[] = [];

  for (const baselineCenterType of options.centerTypes) {
    for (const baselineUncertaintyWeight of options.baselineUncertaintyWeights) {
      for (const energyThreshold of options.energyThresholds) {
        candidates.push(
          options.buildCandidate({ baselineCenterType, baselineUncertaintyWeight, energyThreshold })
        );
      }
    }
  }

  candidates.sort(compareSearchCandidates);
  const topN = Math.max(1, Math.round(options.topN));

  return {
    summary: {
      totalCandidates: candidates.length,
      passCount: candidates.filter((c) => c.pass).length,
      failCount: candidates.filter((c) => !c.pass).length
    },
    best: candidates[0] ?? null,
    candidates,
    topCandidates: candidates.slice(0, topN)
  };
}

function sortKeyFromParams(params: {
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

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function relativeImprovementDown(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  return ((before - after) / Math.max(1e-9, Math.abs(before))) * 100;
}
