import type { BaselineMode, BraidLayout, GapMode, LayerInput, ROI, RoiSupportWindow, SmoothKernel, StackLayout } from "./types";
import { normalizeROI } from "./roi";
import { boundaryUncertaintyAt } from "./validate";

export interface BraidArgs {
  base: StackLayout;
  orderedLayers: LayerInput[];
  roi: ROI | null;
  baselineMode: BaselineMode;
  gapMode: GapMode;
  gapAlphaPx: number;
  maxExtraHeightPx: number;
  smoothKernel: SmoothKernel;
  yScale: (v: number) => number;
}

export function computeBraidLayout(args: BraidArgs): BraidLayout {
  const { base, orderedLayers, roi, baselineMode, gapMode, gapAlphaPx, maxExtraHeightPx, smoothKernel, yScale } = args;
  const tLength = base.baseline.length;
  const gapCount = Math.max(0, orderedLayers.length - 1);
  const normalizedROI = normalizeROI(roi, tLength);

  const omegaResult = computeOmega(tLength, normalizedROI, smoothKernel);
  const omega = omegaResult.omega;
  const roiSupport = omegaResult.roiSupport;

  const gapsPx = Array.from({ length: gapCount }, () => new Array<number>(tLength).fill(0));
  const sumGapPx = new Array<number>(tLength).fill(0);

  if (gapMode !== "none" && roiSupport) {
    for (let t = 0; t < tLength; t += 1) {
      let totalGapPx = 0;
      for (let k = 0; k < gapCount; k += 1) {
        let rawGapPx = 0;
        if (gapMode === "fixedGap") {
          rawGapPx = omega[t] * gapAlphaPx;
        } else if (gapMode === "uncGap") {
          const u = boundaryUncertaintyAt(orderedLayers[k], orderedLayers[k + 1], t);
          rawGapPx = omega[t] * gapAlphaPx * u;
        }
        gapsPx[k][t] = Math.max(0, rawGapPx);
        totalGapPx += gapsPx[k][t];
      }
      if (totalGapPx > maxExtraHeightPx && totalGapPx > 0) {
        const s = maxExtraHeightPx / totalGapPx;
        for (let k = 0; k < gapCount; k += 1) {
          gapsPx[k][t] *= s;
        }
        totalGapPx = maxExtraHeightPx;
      }
      sumGapPx[t] = totalGapPx;
    }
  }

  const pxPerValue = estimatePixelsPerValue(yScale);
  const gapsValue = gapsPx.map((row) => row.map((v) => v / pxPerValue));
  const yBottom = base.yBottom.map((row) => row.slice());
  const yTop = base.yTop.map((row) => row.slice());

  for (let t = 0; t < tLength; t += 1) {
    const totalExtraValue = sumGapPx[t] / pxPerValue;
    const centerShift = baselineMode === "center" ? -0.5 * totalExtraValue : 0;
    let extra = 0;
    for (let k = 0; k < orderedLayers.length; k += 1) {
      yBottom[k][t] = base.yBottom[k][t] + centerShift + extra;
      yTop[k][t] = yBottom[k][t] + orderedLayers[k].mean[t];
      if (k < gapCount) {
        extra += gapsValue[k][t];
      }
    }
  }

  return {
    baseline: base.baseline.slice(),
    yBottom,
    yTop,
    omega,
    gapsPx,
    gapsValue,
    sumGapPx,
    roiSupport
  };
}

export function computeOmega(
  tLength: number,
  roi: ROI | null,
  smoothKernel: SmoothKernel
): { omega: number[]; roiSupport: RoiSupportWindow | null } {
  const omega = new Array<number>(tLength).fill(0);
  if (!roi) {
    return { omega, roiSupport: null };
  }
  const span = roi.t1Index - roi.t0Index + 1;
  if (span <= 0) {
    return { omega, roiSupport: null };
  }
  const tau = Math.max(5, Math.floor(0.25 * (roi.t1Index - roi.t0Index)));
  const supportStart = clamp(Math.floor(roi.t0Index - tau), 0, tLength - 1);
  const supportEnd = clamp(Math.ceil(roi.t1Index + tau), 0, tLength - 1);

  for (let t = supportStart; t <= supportEnd; t += 1) {
    omega[t] = raisedCosineWindow(t, roi.t0Index, roi.t1Index, tau, smoothKernel);
  }
  return {
    omega,
    roiSupport: {
      tau,
      coreStart: roi.t0Index,
      coreEnd: roi.t1Index,
      supportStart,
      supportEnd
    }
  };
}

function estimatePixelsPerValue(yScale: (v: number) => number): number {
  const p0 = yScale(0);
  const p1 = yScale(1);
  const slope = Math.abs(p1 - p0);
  if (!Number.isFinite(slope) || slope <= 1e-12) {
    throw new Error("yScale must be linear with non-zero slope");
  }
  return slope;
}

function raisedCosineWindow(t: number, t0: number, t1: number, tau: number, smoothKernel: SmoothKernel): number {
  if (t < t0 - tau || t > t1 + tau) {
    return 0;
  }
  if (t >= t0 && t <= t1) {
    return 1;
  }
  if (tau <= 0) {
    return t >= t0 && t <= t1 ? 1 : 0;
  }
  if (t < t0) {
    const u = clamp01((t - (t0 - tau)) / tau);
    if (smoothKernel === "cubic") {
      return 0.5 - 0.5 * Math.cos(Math.PI * u);
    }
  }
  const u = clamp01(((t1 + tau) - t) / tau);
  if (smoothKernel === "cubic") {
    return 0.5 - 0.5 * Math.cos(Math.PI * u);
  }
  return 0;
}

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
