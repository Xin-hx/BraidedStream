import * as d3 from "d3";
import { FIXED_STATE_COLORS, FIXED_STATE_LABELS } from "./stateColorMap.js";

const CATEGORICAL = [
  "#0f766e",
  "#1d4ed8",
  "#b45309",
  "#be123c",
  "#047857",
  "#7c3aed",
  "#b91c1c",
  "#0e7490",
  "#475569",
  "#4d7c0f",
  "#9333ea",
  "#c2410c"
];

export interface StateLegendEntry {
  key: string;
  label: string;
  color: string;
}

export function layerColor(index: number, layer?: string | { id: string; fill_color?: string }): string {
  const sourceColor = typeof layer === "object" ? normalizeColor(layer.fill_color) : null;
  if (sourceColor) {
    return sourceColor;
  }
  const layerId = typeof layer === "object" ? layer.id : layer;
  const stateKey = stateKeyFromLayerId(layerId);
  if (stateKey) {
    return stateColor(stateKey);
  }
  if (layerId && layerId.trim() !== "") {
    return stateColor(layerId.trim());
  }
  return CATEGORICAL[index % CATEGORICAL.length];
}

function normalizeColor(value?: string): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed !== "" ? trimmed : null;
}

export function stateLegendEntriesForLayers(layers: Array<{ id: string }>): StateLegendEntry[] {
  const seen = new Set<string>();
  const entries: StateLegendEntry[] = [];
  for (const layer of layers) {
    const key = stateKeyFromLayerId(layer.id);
    if (!key || seen.has(key) || !FIXED_STATE_COLORS[key]) {
      continue;
    }
    seen.add(key);
    entries.push({
      key,
      label: FIXED_STATE_LABELS[key] ?? key,
      color: FIXED_STATE_COLORS[key]
    });
  }
  return entries;
}

export function uncertaintyColor(value01: number): string {
  return d3.interpolateGreys(clamp01(value01 * 0.85 + 0.1));
}

export function diffColor(value01: number): string {
  return d3.interpolateYlOrBr(clamp01(value01));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function stateKeyFromLayerId(layerId?: string): string | null {
  if (!layerId) {
    return null;
  }
  const token = layerId.split("|")[0]?.trim();
  if (!token) {
    return null;
  }
  return token.toUpperCase();
}

function stateColor(stateKey: string): string {
  const fixed = FIXED_STATE_COLORS[stateKey];
  if (fixed) {
    return fixed;
  }
  const hue = stableHue(stateKey);
  return `hsl(${hue}, 62%, 46%)`;
}

function stableHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
