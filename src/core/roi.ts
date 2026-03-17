import type { ROI } from "./types";

export function normalizeROI(roi: ROI | null, tLength: number): ROI | null {
  if (!roi || tLength <= 0) {
    return null;
  }
  const minIndex = 0;
  const maxIndex = tLength - 1;
  const raw0 = clamp(Math.round(roi.t0Index), minIndex, maxIndex);
  const raw1 = clamp(Math.round(roi.t1Index), minIndex, maxIndex);
  return raw0 <= raw1
    ? { t0Index: raw0, t1Index: raw1 }
    : { t0Index: raw1, t1Index: raw0 };
}

export function isOutsideROI(t: number, roi: ROI | null): boolean {
  return !roi || t < roi.t0Index || t > roi.t1Index;
}

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}
