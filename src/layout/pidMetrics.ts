/**
 * PID ordering metric bundle assembly for comparison panels.
 */
import type { SineStreamHooks } from "../core/baseline";
import { computeBaseline, computeMultiscaleDistributedBaseline } from "../core/baseline";
import { buildCenterOutOrder, normalizeOrderForComparison, rankMap } from "../core/ordering";
import { computePidOrdering } from "../core/ranking";
import { computeStackedBoundaries } from "../core/stack";
import type { InvariantSummary, PidUncertaintySource, PreparedDataset, ROI } from "../core/types";
import { orderLayers } from "../core/validate";
import { computeMetrics, type MetricResult, type MultiscaleDiagnosticsSummary } from "./metrics";
import { stackToBraidLayout } from "./searchUtils";

export interface PidOrderingMetricsInput {
  dataset: PreparedDataset;
  roi: ROI | null;
  sineOrder: string[];
  uncertaintyStrength: number;
  uncertaintySource?: PidUncertaintySource;
  baselineHooks?: SineStreamHooks;
}

export interface PidOrderingMetricsSummary {
  timeCount: number;
  layerCount: number;
  changedCount: number;
  averageAbsShift: number;
  maxAbsShift: number;
  spearmanRho: number;
  kendallTau: number;
  topPidLayerId: string | null;
  topPidDepth: number;
  topPidValidRatio: number;
}

export interface PidOrderingMetricsBundle {
  metrics: MetricResult;
  summary: PidOrderingMetricsSummary;
}

export function computePidOrderingMetrics(input: PidOrderingMetricsInput): PidOrderingMetricsBundle {
  const layerIds = input.dataset.layers.map((layer) => layer.id);
  const sineBaseOrder = normalizeOrderForComparison(input.sineOrder, layerIds, input.dataset.order);
  const pid = computePidOrdering(input.dataset.layers, {
    excludeSelf: true,
    widthPenaltyPower: 1,
    minComparators: 2,
    uncertaintySource: input.uncertaintySource ?? "value"
  });
  const pidDepthOrder = normalizeOrderForComparison(pid.order, layerIds, input.dataset.order);

  // Use the same center-out placement rule for both layouts to isolate ordering effects.
  const pidDisplayOrder = buildCenterOutOrder(pidDepthOrder);

  const pidDisplayLayers = orderLayers(input.dataset.layers, pidDisplayOrder);
  const hooks = input.baselineHooks ?? {};

  const beforeBaseline = computeBaseline(input.dataset.times, pidDisplayLayers, "sineStream", hooks);
  const beforeLayout = computeStackedBoundaries(beforeBaseline, pidDisplayLayers);
  const multiscale = computeMultiscaleDistributedBaseline(
    input.dataset.times,
    pidDisplayLayers,
    Math.max(0, input.uncertaintyStrength),
    hooks,
    0.08
  );
  const afterLayout = stackToBraidLayout(computeStackedBoundaries(multiscale.baseline, pidDisplayLayers));

  const invariant: InvariantSummary = {
    checked: false,
    violations: [],
    maxThicknessError: 0
  };
  const multiscaleSummary: MultiscaleDiagnosticsSummary = {
    method: multiscale.diagnostics.method,
    verified: multiscale.diagnostics.verifiedMultiscale,
    fallbackUsed: multiscale.diagnostics.fallbackUsed,
    effectiveScaleCount: multiscale.diagnostics.effectiveScaleCount,
    threshold: multiscale.diagnostics.energyThreshold,
    scaleBands: multiscale.diagnostics.scaleBands.map((band) => ({ scale: band.scale, ratio: band.ratio }))
  };
  const core = computeMetrics(input.dataset, beforeLayout, afterLayout, input.roi, invariant, pidDisplayLayers, {
    semantic: {
      enableTpidCenterAlignment: true,
      pidUncertaintySource: input.uncertaintySource ?? "value",
      baselineShiftBeforeAbs: multiscale.diagnostics.localShiftAbs,
      baselineShiftAfterAbs: multiscale.diagnostics.distributedShiftAbs,
      uncertaintySaliency: multiscale.diagnostics.uncertaintySaliency
    },
    multiscale: multiscaleSummary,
    includeGlobalRows: true
  });
  const summary = summarizeOrderShift(layerIds, sineBaseOrder, pidDepthOrder, pid, input.dataset.times.length);

  const rows = core.rows.concat([
    metricRow("pidRankShiftMean", "Mean |rank shift|", 0, summary.averageAbsShift, "down"),
    metricRow("pidRankShiftMax", "Max |rank shift|", 0, summary.maxAbsShift, "down"),
    metricRow("pidSpearman", "Rank corr (Spearman rho)", 1, summary.spearmanRho, "up"),
    metricRow("pidKendall", "Rank corr (Kendall tau)", 1, summary.kendallTau, "up")
  ]);

  return {
    metrics: {
      ...core,
      rows,
      scopeText: "ROI (PID baseline metric: Sine -> Multiscale)",
      globalScopeText: "Global (PID baseline metric: Sine -> Multiscale)"
    },
    summary
  };
}

function summarizeOrderShift(
  layerIds: string[],
  sineBaseOrder: string[],
  pidDepthOrder: string[],
  pid: ReturnType<typeof computePidOrdering>,
  timeCount: number
): PidOrderingMetricsSummary {
  const sineRank = rankMap(sineBaseOrder);
  const pidRank = rankMap(pidDepthOrder);

  let changedCount = 0;
  let sumAbsShift = 0;
  let maxAbsShift = 0;
  for (const id of layerIds) {
    const left = sineRank.get(id) ?? 0;
    const right = pidRank.get(id) ?? 0;
    const shift = Math.abs(right - left);
    if (shift > 0) {
      changedCount += 1;
    }
    sumAbsShift += shift;
    maxAbsShift = Math.max(maxAbsShift, shift);
  }

  const topPid = pid.scores[0] ?? null;
  return {
    timeCount,
    layerCount: layerIds.length,
    changedCount,
    averageAbsShift: layerIds.length > 0 ? sumAbsShift / layerIds.length : 0,
    maxAbsShift,
    spearmanRho: spearmanRho(layerIds, sineRank, pidRank),
    kendallTau: kendallTau(layerIds, sineRank, pidRank),
    topPidLayerId: topPid?.id ?? null,
    topPidDepth: topPid?.depth ?? 0,
    topPidValidRatio: topPid ? topPid.validTimeCount / Math.max(1, timeCount) : 0
  };
}

function spearmanRho(layerIds: string[], leftRank: Map<string, number>, rightRank: Map<string, number>): number {
  const n = layerIds.length;
  if (n <= 1) {
    return 1;
  }
  let sumD2 = 0;
  for (const id of layerIds) {
    const d = (leftRank.get(id) ?? 0) - (rightRank.get(id) ?? 0);
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function kendallTau(layerIds: string[], leftRank: Map<string, number>, rightRank: Map<string, number>): number {
  const n = layerIds.length;
  if (n <= 1) {
    return 1;
  }
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const li = leftRank.get(layerIds[i]) ?? 0;
      const lj = leftRank.get(layerIds[j]) ?? 0;
      const ri = rightRank.get(layerIds[i]) ?? 0;
      const rj = rightRank.get(layerIds[j]) ?? 0;
      const sign = (li - lj) * (ri - rj);
      if (sign > 0) {
        concordant += 1;
      } else if (sign < 0) {
        discordant += 1;
      }
    }
  }
  const denom = concordant + discordant;
  if (denom <= 0) {
    return 1;
  }
  return (concordant - discordant) / denom;
}

function metricRow(
  key: string,
  label: string,
  before: number,
  after: number,
  better: "up" | "down"
): MetricResult["rows"][number] {
  return {
    key,
    label,
    before,
    after,
    delta: after - before,
    better
  };
}
