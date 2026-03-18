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

export function layerColor(index: number): string {
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
