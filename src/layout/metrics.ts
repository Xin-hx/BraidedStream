import * as d3 from "d3";
import type { BraidLayout, InvariantSummary, PreparedDataset, ROI, StackLayout } from "../core/types";

export interface MetricRow {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  better: "up" | "down";
}

export interface MetricResult {
  rows: MetricRow[];
  invariant: InvariantSummary;
  scopeText: string;
}

export function computeMetrics(
  dataset: PreparedDataset,
  beforeLayout: StackLayout,
  afterLayout: BraidLayout,
  roi: ROI | null,
  useGlobal: boolean,
  invariant: InvariantSummary
): MetricResult {
  const idx = computeIndices(dataset.times.length, roi, useGlobal);
  const centersBefore = centers(beforeLayout);
  const centersAfter = centers(afterLayout);

  const rows: MetricRow[] = [
    row("meanSlope", "Mean slope in ROI", meanSlope(centersBefore, idx), meanSlope(centersAfter, idx), "down"),
    row("maxSlope", "Max slope in ROI", maxSlope(centersBefore, idx), maxSlope(centersAfter, idx), "down"),
    row("wiggle", "Wiggle energy", wiggleEnergy(centersBefore, idx), wiggleEnergy(centersAfter, idx), "down"),
    row("illusion", "Sine-illusion proxy", curvatureEnergy(centersBefore, idx), curvatureEnergy(centersAfter, idx), "down"),
    row("sepMean", "Mean layer separation", meanSeparation(beforeLayout, idx), meanSeparation(afterLayout, idx), "up"),
    row("sepMin", "Min layer separation", minSeparation(beforeLayout, idx), minSeparation(afterLayout, idx), "up"),
    row("extraSpace", "Extra space used", 0, mean(afterLayout.sumGapPx, idx), "down"),
    row("compact", "Compactness loss", compactness(beforeLayout, idx), compactness(afterLayout, idx), "down"),
    row("boundary", "ROI boundary distortion", 0, roiBoundaryDistortion(beforeLayout, afterLayout, idx), "down"),
    row("thickness", "Thickness invariance error", 0, thicknessError(dataset, afterLayout, idx), "down"),
    row("order", "Order stability", 1, orderStability(afterLayout, idx), "up")
  ];

  return {
    rows,
    invariant,
    scopeText: useGlobal ? "Global" : "ROI"
  };
}

function row(key: string, label: string, before: number, after: number, better: "up" | "down"): MetricRow {
  return { key, label, before, after, delta: after - before, better };
}

function computeIndices(length: number, roi: ROI | null, globalMode: boolean): number[] {
  if (globalMode || !roi) {
    return d3.range(0, length);
  }
  const left = Math.max(0, roi.t0Index);
  const right = Math.min(length - 1, roi.t1Index);
  return d3.range(left, right + 1);
}

function centers(layout: StackLayout): number[][] {
  return layout.yBottom.map((row, k) => row.map((v, t) => 0.5 * (v + layout.yTop[k][t])));
}

function meanSlope(series: number[][], idx: number[]): number {
  const values: number[] = [];
  for (const row of series) {
    for (let i = 1; i < idx.length; i += 1) {
      const t0 = idx[i - 1];
      const t1 = idx[i];
      values.push(Math.abs(row[t1] - row[t0]));
    }
  }
  return mean(values);
}

function maxSlope(series: number[][], idx: number[]): number {
  let m = 0;
  for (const row of series) {
    for (let i = 1; i < idx.length; i += 1) {
      const t0 = idx[i - 1];
      const t1 = idx[i];
      m = Math.max(m, Math.abs(row[t1] - row[t0]));
    }
  }
  return m;
}

function wiggleEnergy(series: number[][], idx: number[]): number {
  let acc = 0;
  for (const row of series) {
    for (let i = 2; i < idx.length; i += 1) {
      const a = row[idx[i - 2]];
      const b = row[idx[i - 1]];
      const c = row[idx[i]];
      const secondDiff = c - 2 * b + a;
      acc += secondDiff * secondDiff;
    }
  }
  return acc / Math.max(1, series.length);
}

function curvatureEnergy(series: number[][], idx: number[]): number {
  const values: number[] = [];
  for (const row of series) {
    for (let i = 2; i < idx.length; i += 1) {
      const a = row[idx[i - 2]];
      const b = row[idx[i - 1]];
      const c = row[idx[i]];
      values.push(Math.abs(c - 2 * b + a));
    }
  }
  return mean(values);
}

function meanSeparation(layout: StackLayout, idx: number[]): number {
  if (layout.yBottom.length < 2) {
    return 0;
  }
  const values: number[] = [];
  for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
    for (const t of idx) {
      values.push(Math.max(0, layout.yBottom[k + 1][t] - layout.yTop[k][t]));
    }
  }
  return mean(values);
}

function minSeparation(layout: StackLayout, idx: number[]): number {
  if (layout.yBottom.length < 2) {
    return 0;
  }
  let minV = Number.POSITIVE_INFINITY;
  for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
    for (const t of idx) {
      minV = Math.min(minV, layout.yBottom[k + 1][t] - layout.yTop[k][t]);
    }
  }
  return Number.isFinite(minV) ? minV : 0;
}

function compactness(layout: StackLayout, idx: number[]): number {
  const heights = idx.map((t) => layout.yTop[layout.yTop.length - 1][t] - layout.yBottom[0][t]);
  return mean(heights);
}

function roiBoundaryDistortion(before: StackLayout, after: StackLayout, idx: number[]): number {
  if (idx.length < 2) {
    return 0;
  }
  const endpoints = [idx[0], idx[idx.length - 1]];
  const values: number[] = [];
  for (const t of endpoints) {
    for (let k = 0; k < before.yBottom.length; k += 1) {
      values.push(Math.abs(after.yBottom[k][t] - before.yBottom[k][t]));
    }
  }
  return mean(values);
}

function thicknessError(dataset: PreparedDataset, after: StackLayout, idx: number[]): number {
  let maxErr = 0;
  for (let k = 0; k < dataset.layers.length; k += 1) {
    for (const t of idx) {
      const thickness = after.yTop[k][t] - after.yBottom[k][t];
      maxErr = Math.max(maxErr, Math.abs(thickness - dataset.layers[k].mean[t]));
    }
  }
  return maxErr;
}

function orderStability(layout: StackLayout, idx: number[]): number {
  if (layout.yBottom.length < 2) {
    return 1;
  }
  let overlaps = 0;
  let total = 0;
  for (let k = 0; k < layout.yBottom.length - 1; k += 1) {
    for (const t of idx) {
      total += 1;
      if (layout.yBottom[k + 1][t] < layout.yTop[k][t]) {
        overlaps += 1;
      }
    }
  }
  return 1 - overlaps / Math.max(1, total);
}

function mean(values: number[], idx?: number[]): number {
  if (idx) {
    const picked = idx.map((i) => values[i]).filter((v) => Number.isFinite(v));
    return picked.length === 0 ? 0 : d3.mean(picked) ?? 0;
  }
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length === 0 ? 0 : d3.mean(finite) ?? 0;
}
