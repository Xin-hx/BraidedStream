import type { LayerInput } from "../core/types";

export interface HoverInfo {
  timeIndex: number;
  timeValue: number;
  total: number;
  layerValues: Array<{ id: string; mean: number; unc: number }>;
}

export function buildHoverInfo(timeIndex: number, times: number[], layers: LayerInput[]): HoverInfo {
  const clamped = Math.max(0, Math.min(times.length - 1, timeIndex));
  const layerValues = layers.map((layer) => ({
    id: layer.id,
    mean: layer.mean[clamped],
    unc: layer.unc?.[clamped] ?? 0
  }));
  return {
    timeIndex: clamped,
    timeValue: times[clamped],
    total: layerValues.reduce((acc, item) => acc + item.mean, 0),
    layerValues
  };
}

export function tooltipText(info: HoverInfo, extra: string[]): string {
  const header = `t=${info.timeValue} total=${info.total.toFixed(2)}`;
  const top = info.layerValues.slice(0, 4).map((item) => `${item.id}: ${item.mean.toFixed(2)} (u ${item.unc.toFixed(2)})`);
  return [header, ...top, ...extra].join("\n");
}
