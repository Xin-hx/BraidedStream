import * as d3 from "d3";

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

const US_STATE_KEYS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC"
];

const FIXED_STATE_COLOR = buildFixedStateColorMap();

export function layerColor(index: number, layerId?: string): string {
  const stateKey = extractStateKey(layerId);
  if (stateKey) {
    return stateColor(stateKey);
  }
  if (layerId && layerId.trim() !== "") {
    return stateColor(layerId.trim());
  }
  return CATEGORICAL[index % CATEGORICAL.length];
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

function extractStateKey(layerId?: string): string | null {
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
  const fixed = FIXED_STATE_COLOR.get(stateKey);
  if (fixed) {
    return fixed;
  }
  const hue = stableHue(stateKey);
  return `hsl(${hue}, 62%, 46%)`;
}

function buildFixedStateColorMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < US_STATE_KEYS.length; i += 1) {
    const hue = Math.round((i * 137.508 + 18) % 360);
    const saturation = i % 2 === 0 ? 64 : 60;
    const lightness = i % 3 === 0 ? 43 : i % 3 === 1 ? 47 : 40;
    out.set(US_STATE_KEYS[i], `hsl(${hue}, ${saturation}%, ${lightness}%)`);
  }
  return out;
}

function stableHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
