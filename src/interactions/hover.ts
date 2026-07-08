import type { LayerInput } from "../core/types";

export interface HoverInfo {
  timeIndex: number;
  timeValue: number;
  timeLabel: string;
  total: number;
  focusLayerId: string | null;
  layerValues: Array<{ id: string; label: string; value: number; unc: number }>;
}

interface HoverLayerEntry {
  layer: LayerInput;
  label: string;
}

export interface HoverInfoResolver {
  build: (timeIndex: number, times: number[], focusLayerId?: string | null) => HoverInfo;
}

export function createHoverInfoResolver(layers: LayerInput[]): HoverInfoResolver {
  const entries = layers.map((layer) => ({ layer, label: layer.id.split("|")[0] ?? layer.id }));
  const byId = new Map(entries.map((entry) => [entry.layer.id, entry]));
  return {
    build: (timeIndex, times, focusLayerId) => buildHoverInfoFromEntries(timeIndex, times, entries, byId, focusLayerId)
  };
}

export function buildHoverInfo(timeIndex: number, times: number[], layers: LayerInput[], focusLayerId?: string | null): HoverInfo {
  const resolver = createHoverInfoResolver(layers);
  return resolver.build(timeIndex, times, focusLayerId);
}

function buildHoverInfoFromEntries(
  timeIndex: number,
  times: number[],
  entries: HoverLayerEntry[],
  byId: Map<string, HoverLayerEntry>,
  focusLayerId?: string | null
): HoverInfo {
  const clamped = Math.max(0, Math.min(times.length - 1, timeIndex));
  let total = 0;
  for (const entry of entries) {
    total += entry.layer.height[clamped] ?? 0;
  }
  const layerValues = focusLayerId
    ? layerValueAt(byId.get(focusLayerId), clamped)
    : topLayerValuesAt(entries, clamped, 4);
  return {
    timeIndex: clamped,
    timeValue: times[clamped],
    timeLabel: formatTimeValue(times[clamped]),
    total,
    focusLayerId: focusLayerId ?? null,
    layerValues
  };
}

export function tooltipText(info: HoverInfo, extra: string[]): string {
  const header = info.focusLayerId
    ? `t=${info.timeLabel} total=${info.total.toFixed(2)} | focused substream`
    : `t=${info.timeLabel} total=${info.total.toFixed(2)}`;
  const top = info.layerValues
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, info.focusLayerId ? 1 : 4)
    .map((item) => `${item.label}: ${item.value.toFixed(2)} (u ${item.unc.toFixed(2)})`);
  if (top.length === 0 && info.focusLayerId) {
    top.push("no substream at cursor");
  }
  return [header, ...top, ...extra].join("\n");
}

function topLayerValuesAt(
  entries: HoverLayerEntry[],
  timeIndex: number,
  limit: number
): HoverInfo["layerValues"] {
  const top: HoverInfo["layerValues"] = [];
  for (const entry of entries) {
    const item = layerValue(entry, timeIndex);
    let insertAt = top.length;
    while (insertAt > 0 && item.value > top[insertAt - 1].value) {
      insertAt -= 1;
    }
    if (insertAt < limit) {
      top.splice(insertAt, 0, item);
      if (top.length > limit) {
        top.pop();
      }
    }
  }
  return top;
}

function layerValueAt(
  entry: HoverLayerEntry | undefined,
  timeIndex: number
): HoverInfo["layerValues"] {
  return entry ? [layerValue(entry, timeIndex)] : [];
}

function layerValue(entry: HoverLayerEntry, timeIndex: number): { id: string; label: string; value: number; unc: number } {
  return {
    id: entry.layer.id,
    label: entry.label,
    value: entry.layer.height[timeIndex] ?? 0,
    unc: entry.layer.unc?.[timeIndex] ?? 0
  };
}

function formatTimeValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return new Date(value).toISOString().slice(0, 10);
}

