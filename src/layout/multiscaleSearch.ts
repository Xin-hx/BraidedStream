import { computeBaseline, computeMultiscaleDistributedBaseline, type SineStreamHooks } from "../core/baseline";
import { optimizeLayerOrder } from "../core/optimizeOrder";
import { computeStackedBoundaries } from "../core/stack";
import type {
  BraidLayout,
  InvariantSummary,
  LayerInput,
  LayoutOptimizationConfig,
  PreparedDataset,
  ROI,
  StackLayout
} from "../core/types";
import { orderLayers } from "../core/validate";
import { computeMetrics } from "./metrics";

const CORE_KEYS = ["meanSlope", "wiggle", "illusion"] as const;

type CoreMetricKey = (typeof CORE_KEYS)[number];

type CenterType = "median" | "mean" | "geometric" | "harmonic";

export interface MultiscaleSearchRange {
  min: number;
  max: number;
  step: number;
}

export interface MultiscaleSearchSpace {
  baselineUncertaintyWeight: MultiscaleSearchRange;
  energyThreshold: MultiscaleSearchRange;
  centerTypes: CenterType[];
  passThresholdPct: number;
  regressionGuardrailPct: number;
  topN: number;
}

export interface MultiscaleCandidateParams {
  baselineUncertaintyWeight: number;
  energyThreshold: number;
  baselineCenterType: CenterType;
}

export interface MultiscaleCoreMetricDelta {
  key: CoreMetricKey;
  label: string;
  before: number;
  after: number;
  delta: number;
  improvementPct: number;
}

export interface MultiscaleScopeSummary {
  metrics: MultiscaleCoreMetricDelta[];
  maxImprovementPct: number;
  avgImprovementPct: number;
}

export interface MultiscaleCandidateResult {
  params: MultiscaleCandidateParams;
  pass: boolean;
  reasons: string[];
  roi: MultiscaleScopeSummary;
  global: MultiscaleScopeSummary;
  diagnostics: {
    fallbackUsed: boolean;
    fallbackReason: string | null;
    verified: boolean;
    effectiveScaleCount: number;
    threshold: number;
  };
  sortKey: string;
}

export interface MultiscaleSearchSummary {
  totalCandidates: number;
  passCount: number;
  failCount: number;
}

export interface MultiscaleSearchResult {
  searchSpace: MultiscaleSearchSpace;
  summary: MultiscaleSearchSummary;
  best: MultiscaleCandidateResult | null;
  candidates: MultiscaleCandidateResult[];
  topCandidates: MultiscaleCandidateResult[];
}

export interface MultiscaleSearchInput {
  dataset: PreparedDataset;
  roi: ROI | null;
  orderedLayers: LayerInput[];
  searchSpace: MultiscaleSearchSpace;
  baseHooks?: Omit<SineStreamHooks, "centerType">;
}

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

  const candidates: MultiscaleCandidateResult[] = [];
  const invariant: InvariantSummary = {
    checked: false,
    violations: [],
    maxThicknessError: 0
  };

  for (const centerType of searchSpace.centerTypes) {
    const hooks: SineStreamHooks = {
      ...(input.baseHooks ?? {}),
      centerType
    };
    const beforeBaseline = computeBaseline(input.dataset.times, input.orderedLayers, "sineStream", hooks);
    const beforeLayout = computeStackedBoundaries(beforeBaseline, input.orderedLayers);

    for (const baselineUncertaintyWeight of strengths) {
      for (const energyThreshold of thresholds) {
        const params: MultiscaleCandidateParams = {
          baselineCenterType: centerType,
          baselineUncertaintyWeight,
          energyThreshold
        };

        const multiscale = computeMultiscaleDistributedBaseline(
          input.dataset.times,
          input.orderedLayers,
          baselineUncertaintyWeight,
          hooks,
          energyThreshold
        );
        const afterLayout = stackToBraidLayout(computeStackedBoundaries(multiscale.baseline, input.orderedLayers));

        const metrics = computeMetrics(input.dataset, beforeLayout, afterLayout, input.roi, invariant, input.orderedLayers, {
          includeGlobalRows: true
        });
        const roi = scopeSummaryFromMetricRows(metrics.rows);
        const global = scopeSummaryFromMetricRows(metrics.globalRows ?? metrics.rows);

        const reasons = evaluateCandidate(
          roi,
          global,
          searchSpace.passThresholdPct,
          searchSpace.regressionGuardrailPct,
          multiscale.diagnostics.fallbackUsed,
          multiscale.diagnostics.fallbackReason
        );

        candidates.push({
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
        });
      }
    }
  }

  candidates.sort(compareCandidates);
  const topN = Math.max(1, Math.round(searchSpace.topN));

  const summary: MultiscaleSearchSummary = {
    totalCandidates: candidates.length,
    passCount: candidates.filter((item) => item.pass).length,
    failCount: candidates.filter((item) => !item.pass).length
  };

  return {
    searchSpace,
    summary,
    best: candidates[0] ?? null,
    candidates,
    topCandidates: candidates.slice(0, topN)
  };
}

function sanitizeSearchSpace(space: MultiscaleSearchSpace): MultiscaleSearchSpace {
  const centerTypes = Array.from(new Set(space.centerTypes)).filter((v): v is CenterType =>
    v === "median" || v === "mean" || v === "geometric" || v === "harmonic"
  );

  return {
    baselineUncertaintyWeight: sanitizeRange(space.baselineUncertaintyWeight, { min: 0.15, max: 1.2, step: 0.05 }),
    energyThreshold: sanitizeRange(space.energyThreshold, { min: 0.04, max: 0.2, step: 0.02 }, 0, 1),
    centerTypes: centerTypes.length > 0 ? centerTypes : ["median"],
    passThresholdPct: finiteNumber(space.passThresholdPct, 5),
    regressionGuardrailPct: Math.max(0, finiteNumber(space.regressionGuardrailPct, 3)),
    topN: Math.max(1, Math.round(finiteNumber(space.topN, 20)))
  };
}

function sanitizeRange(
  range: MultiscaleSearchRange,
  fallback: MultiscaleSearchRange,
  hardMin = Number.NEGATIVE_INFINITY,
  hardMax = Number.POSITIVE_INFINITY
): MultiscaleSearchRange {
  const minRaw = finiteNumber(range.min, fallback.min);
  const maxRaw = finiteNumber(range.max, fallback.max);
  const stepRaw = finiteNumber(range.step, fallback.step);
  const min = clamp(Math.min(minRaw, maxRaw), hardMin, hardMax);
  const max = clamp(Math.max(minRaw, maxRaw), hardMin, hardMax);
  const step = Math.max(1e-6, Math.abs(stepRaw));
  return { min, max, step };
}

function discreteValues(range: MultiscaleSearchRange): number[] {
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

function scopeSummaryFromMetricRows(rows: Array<{ key: string; label: string; before: number; after: number; delta: number }>): MultiscaleScopeSummary {
  const metrics = CORE_KEYS.map((key) => {
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

  const improvements = metrics.map((item) => item.improvementPct);
  return {
    metrics,
    maxImprovementPct: Math.max(...improvements),
    avgImprovementPct: improvements.reduce((sum, value) => sum + value, 0) / Math.max(1, improvements.length)
  };
}

function evaluateCandidate(
  roi: MultiscaleScopeSummary,
  global: MultiscaleScopeSummary,
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

  const roiRegression = roi.metrics.filter((metric) => metric.improvementPct < -regressionGuardrailPct);
  for (const metric of roiRegression) {
    reasons.push(`ROI ${metric.key} regressed ${(-metric.improvementPct).toFixed(2)}% > ${regressionGuardrailPct.toFixed(2)}%`);
  }

  const globalRegression = global.metrics.filter((metric) => metric.improvementPct < -regressionGuardrailPct);
  for (const metric of globalRegression) {
    reasons.push(`Global ${metric.key} regressed ${(-metric.improvementPct).toFixed(2)}% > ${regressionGuardrailPct.toFixed(2)}%`);
  }

  return reasons;
}

function passReasons(roi: MultiscaleScopeSummary, global: MultiscaleScopeSummary): string[] {
  return [
    `ROI max improvement ${roi.maxImprovementPct.toFixed(2)}%`,
    `ROI avg improvement ${roi.avgImprovementPct.toFixed(2)}%`,
    `Global avg improvement ${global.avgImprovementPct.toFixed(2)}%`
  ];
}

function compareCandidates(a: MultiscaleCandidateResult, b: MultiscaleCandidateResult): number {
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

function sortKeyFromParams(params: MultiscaleCandidateParams): string {
  return [
    params.baselineCenterType,
    params.baselineUncertaintyWeight.toFixed(6),
    params.energyThreshold.toFixed(6)
  ].join("|");
}

function relativeImprovementDown(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return 0;
  }
  const denominator = Math.max(1e-9, Math.abs(before));
  return ((before - after) / denominator) * 100;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function stackToBraidLayout(layout: StackLayout): BraidLayout {
  const tLength = layout.baseline.length;
  const gapCount = Math.max(0, layout.yBottom.length - 1);
  return {
    baseline: layout.baseline.slice(),
    yBottom: layout.yBottom.map((row) => row.slice()),
    yTop: layout.yTop.map((row) => row.slice()),
    omega: new Array<number>(tLength).fill(0),
    gapsPx: Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0)),
    gapsValue: Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0)),
    sumGapPx: new Array<number>(tLength).fill(0),
    roiSupport: null
  };
}
