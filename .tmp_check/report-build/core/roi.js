import { clamp } from "./utils";
/** Normalize ROI endpoints and clamp them to the available time range. */
export function normalizeROI(roi, tLength) {
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
export function isOutsideROI(t, roi) {
    return !roi || t < roi.t0Index || t > roi.t1Index;
}
/** Clamp a child ROI so it stays inside a parent ROI. */
export function clampRoiToParent(roi, parent) {
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
export function roiBounds(length, roi) {
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
/** Build an ROI from ISO date strings by snapping each endpoint to the nearest sample. */
export function roiFromIsoDateRange(times, startIso, endIso) {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || times.length === 0) {
        return null;
    }
    return normalizeROI({
        t0Index: nearestTimeIndex(times, start),
        t1Index: nearestTimeIndex(times, end)
    }, times.length);
}
function nearestTimeIndex(times, target) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i += 1) {
        const distance = Math.abs(times[i] - target);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }
    return bestIndex;
}
