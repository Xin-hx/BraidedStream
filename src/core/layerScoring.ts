import type { PidTimeOrderMode } from "./types";
import { clamp, sum } from "./utils";

export interface PidOrderingCompositeScore {
  layerId: string;
  C: number;
  R: number;
  score: number;
}

export interface ComputePidOrderingScoresInput {
  layerIds: string[];
  D_cross: ReadonlyMap<string, number[]>;
  temporalSelfInclusion?: ReadonlyMap<string, number[]>;
  mode: PidTimeOrderMode;
  alpha?: number;
}

/** Compute adjacent-time temporal self-inclusion (TSI) for each layer. */
export function computeTemporalSelfInclusion(
  depthSeriesByLayerId: ReadonlyMap<string, number[]>
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [layerId, series] of depthSeriesByLayerId.entries()) {
    const tsi: number[] = [];
    for (let t = 1; t < series.length; t += 1) {
      const prev = series[t - 1];
      const next = series[t];
      if (!Number.isFinite(prev) || !Number.isFinite(next)) {
        tsi.push(Number.NaN);
        continue;
      }
      tsi.push(clamp(1 - Math.abs(next - prev), 0, 1));
    }
    out.set(layerId, tsi);
  }
  return out;
}

/** Build layer-wise ordering scores for PID time ordering modes. */
export function computePidOrderingScores(input: ComputePidOrderingScoresInput): PidOrderingCompositeScore[] {
  const alpha = clamp(input.alpha ?? 0.8, 0, 1);
  const out: PidOrderingCompositeScore[] = [];

  for (const layerId of input.layerIds) {
    const dSeries = input.D_cross.get(layerId) ?? [];
    const cValues = dSeries.filter((value) => Number.isFinite(value));
    const C = cValues.length > 0 ? sum(cValues) / cValues.length : 0;

    const tsiSeries = input.temporalSelfInclusion?.get(layerId) ?? [];
    const rValues = tsiSeries.filter((value) => Number.isFinite(value));
    const R = rValues.length > 0 ? sum(rValues) / rValues.length : 0;

    const score = input.mode === "layer_pid_time_weighted" ? alpha * C + (1 - alpha) * R : C;
    out.push({ layerId, C, R, score });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.C !== a.C) {
      return b.C - a.C;
    }
    if (b.R !== a.R) {
      return b.R - a.R;
    }
    return a.layerId.localeCompare(b.layerId);
  });

  return out;
}

