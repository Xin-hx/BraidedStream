/**
 * ROI helpers for keeping user-selected time windows inside valid bounds.
 */
import type { ROI } from "./types";
import { clamp } from "./utils";

/** Normalize ROI endpoints and clamp them to the available time range. */
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

/** True when a time index is outside the active ROI, or when no ROI exists. */
export function isOutsideROI(t: number, roi: ROI | null): boolean {
  return !roi || t < roi.t0Index || t > roi.t1Index;
}

/** Clamp a child ROI so it stays inside a parent ROI. */
export function clampRoiToParent(roi: ROI | null, parent: ROI | null): ROI | null {
  if (!roi || !parent) {
    return null;
  }
  const left = clamp(roi.t0Index, parent.t0Index, parent.t1Index);
  const right = clamp(roi.t1Index, parent.t0Index, parent.t1Index);
  return left <= right
    ? { t0Index: left, t1Index: right }
    : { t0Index: right, t1Index: left };
}

/** Return inclusive ROI bounds as safe array indices. */
export function roiBounds(length: number, roi: ROI | null): [number, number] {
  if (length <= 0) {
    return [0, 0];
  }
  if (!roi) {
    return [0, length - 1];
  }
  const left = clamp(Math.round(roi.t0Index), 0, length - 1);
  const right = clamp(Math.round(roi.t1Index), 0, length - 1);
  return left <= right ? [left, right] : [right, left];
}
