<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { computeCenteredBaseline, computeWiggleBaseline } from "../../core/baseline/compute";
import { computeSineStreamBaseline } from "../../core/baseline/sineStream";
import { computeMultiscaleDistributedBaseline } from "../../core/baseline/multiscale";
import { computeStackedBoundaries } from "../../core/stack";
import type { BaselineCenterType, LayerInput, StackLayout } from "../../core/types";
import { clamp } from "../../core/utils";
import {
  solveRecursiveScour,
  layoutScourTree,
  DEFAULT_SCOUR_CONFIG,
  type ScourConfig,
  type ScourDebug,
  type ScourLayout
} from "../../core/temp/index";

interface DragTarget {
  layerIndex: number;
  index: number;
}

interface ChartGeometry {
  x: (index: number) => number;
  y: (value: number) => number;
  width: number;
  height: number;
  left: number;
  top: number;
  bottom: number;
  right: number;
}

const timeCount = 9;
const times = Array.from({ length: timeCount }, (_, index) => index);
const layerColors = ["#0f766e", "#c2410c", "#2563eb"];
const thickness = reactive<number[][]>([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 3, 4, 4, 4, 0, 0, 0]
]);

const editorSvg = ref<SVGSVGElement | null>(null);
const dragging = ref<DragTarget | null>(null);
const centerTypeOptions: BaselineCenterType[] = ["median", "mean", "geometric", "harmonic"];
const baselineControls = reactive({
  l1WiggleWeight: 1,
  l1CenterAnchorWeight: 0,
  l2WiggleWeight: 1,
  l2CenterAnchorWeight: 0,
  l2WeightedWiggle: false,
  sineCenterType: "median" as BaselineCenterType,
  multiscaleCenterType: "median" as BaselineCenterType,
  multiscaleWaveStrength: 0.72,
  multiscaleEnergyThreshold: 0.04
});

// ── Recursive Scour parameters ───────────────────────────────────────────────
const scourConfig = reactive<ScourConfig>({ ...DEFAULT_SCOUR_CONFIG });

const editor = {
  width: 300,
  height: 240,
  left: 34,
  right: 14,
  top: 18,
  bottom: 30,
  minThickness: 0,
  maxThickness: 5
};

const chart = {
  width: 270,
  height: 250,
  left: 32,
  right: 8,
  top: 16,
  bottom: 32
};

const derivativeChart = {
  width: 1360,
  height: 170,
  left: 44,
  right: 18,
  top: 20,
  bottom: 36
};

const layers = computed<LayerInput[]>(() =>
  thickness.map((height, index) => ({
    id: `layer-${index + 1}`,
    fill_color: layerColors[index],
    height: height.slice()
  }))
);

// ── compute height matrix [n][T] for scour solver ─────────────────────────────
const scourHeights = computed(() => thickness.map((row) => row.slice()));

const scourResult = computed(() => {
  const config: ScourConfig = { ...scourConfig };
  const { tree, debug } = solveRecursiveScour(scourHeights.value, config);
  return { tree, debug };
});

const scourLayout = computed<ScourLayout>(() => {
  const { tree } = scourResult.value;
  return layoutScourTree(scourHeights.value, tree);
});

// For rendering: convert ScourLayout to a StackLayout-compatible shape.
const scourStackLayout = computed<StackLayout>(() => ({
  baseline: scourLayout.value.centerline,
  yBottom: scourLayout.value.yBottom,
  yTop: scourLayout.value.yTop
}));

// ── existing baselines ────────────────────────────────────────────────────────
const centeredBaseline = computed(() => computeCenteredBaseline(timeCount, layers.value));
const l1Hooks = computed(() => ({
  wiggleWeightL1: Math.max(0, baselineControls.l1WiggleWeight),
  centerAnchorWeight: Math.max(0, baselineControls.l1CenterAnchorWeight)
}));
const l2Hooks = computed(() => ({
  wiggleWeightL2: Math.max(0, baselineControls.l2WiggleWeight),
  centerAnchorWeight: Math.max(0, baselineControls.l2CenterAnchorWeight),
  weightedWiggle: baselineControls.l2WeightedWiggle
}));
const l1Baseline = computed(() =>
  computeWiggleBaseline(timeCount, layers.value, "l1", l1Hooks.value)
);
const l2Baseline = computed(() =>
  computeWiggleBaseline(timeCount, layers.value, "l2", l2Hooks.value)
);
const sineBaseline = computed(() =>
  computeSineStreamBaseline(timeCount, layers.value, { centerType: baselineControls.sineCenterType })
);

const multiscaleResult = computed(() =>
  computeMultiscaleDistributedBaseline(
    times,
    layers.value,
    Math.max(0, baselineControls.multiscaleWaveStrength),
    { centerType: baselineControls.multiscaleCenterType },
    clamp(baselineControls.multiscaleEnergyThreshold, 0, 1)
  )
);

const centeredLayout = computed(() => computeStackedBoundaries(centeredBaseline.value, layers.value));
const l1Layout = computed(() => computeStackedBoundaries(l1Baseline.value, layers.value));
const l2Layout = computed(() => computeStackedBoundaries(l2Baseline.value, layers.value));
const sineLayout = computed(() => computeStackedBoundaries(sineBaseline.value, layers.value));
const multiscaleLayout = computed(() => computeStackedBoundaries(multiscaleResult.value.baseline, layers.value));

const centeredCenterline = computed(() => centerlineFromLayout(centeredLayout.value));
const l1Centerline = computed(() => centerlineFromLayout(l1Layout.value));
const l2Centerline = computed(() => centerlineFromLayout(l2Layout.value));
const sineCenterline = computed(() => centerlineFromLayout(sineLayout.value));
const multiscaleCenterline = computed(() => centerlineFromLayout(multiscaleLayout.value));
const scourCenterline = computed(() => centerlineFromScourLayout(scourLayout.value));

const centeredDerivative = computed(() => derivative(centeredCenterline.value));
const l1Derivative = computed(() => derivative(l1Centerline.value));
const l2Derivative = computed(() => derivative(l2Centerline.value));
const sineDerivative = computed(() => derivative(sineCenterline.value));
const multiscaleDerivative = computed(() => derivative(multiscaleCenterline.value));
const scourDerivative = computed(() => derivative(scourCenterline.value));

const focusStep = computed(() => {
  const values = sineDerivative.value;
  let index = 1;
  let best = 0;
  for (let i = 0; i < values.length; i += 1) {
    const magnitude = Math.abs(values[i]);
    if (magnitude > best) {
      best = magnitude;
      index = i + 1;
    }
  }
  return index;
});

const sharedYExtent = computed(() => {
  const values = [
    ...centeredLayout.value.yBottom.flat(),
    ...centeredLayout.value.yTop.flat(),
    ...l1Layout.value.yBottom.flat(),
    ...l1Layout.value.yTop.flat(),
    ...l2Layout.value.yBottom.flat(),
    ...l2Layout.value.yTop.flat(),
    ...sineLayout.value.yBottom.flat(),
    ...sineLayout.value.yTop.flat(),
    ...multiscaleLayout.value.yBottom.flat(),
    ...multiscaleLayout.value.yTop.flat(),
    ...scourStackLayout.value.yBottom.flat(),
    ...scourStackLayout.value.yTop.flat(),
    ...centeredCenterline.value,
    ...l1Centerline.value,
    ...l2Centerline.value,
    ...sineCenterline.value,
    ...multiscaleCenterline.value,
    ...scourCenterline.value
  ];
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
    minValue = -100;
    maxValue = 100;
  }
  const pad = Math.max(12, (maxValue - minValue) * 0.08);
  return { min: minValue - pad, max: maxValue + pad };
});

const centeredPaths = computed(() =>
  layerPaths(centeredLayout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const l1Paths = computed(() => layerPaths(l1Layout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value)));
const l2Paths = computed(() => layerPaths(l2Layout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value)));
const sinePaths = computed(() => layerPaths(sineLayout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value)));
const multiscalePaths = computed(() =>
  layerPaths(multiscaleLayout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const scourPaths = computed(() =>
  layerPaths(scourStackLayout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);

const centeredCenterPath = computed(() =>
  linePath(centeredCenterline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const l1CenterPath = computed(() =>
  linePath(l1Centerline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const l2CenterPath = computed(() =>
  linePath(l2Centerline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const sineCenterPath = computed(() =>
  linePath(sineCenterline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const multiscaleCenterPath = computed(() =>
  linePath(multiscaleCenterline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);
const scourCenterPath = computed(() =>
  linePath(scourCenterline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);

const editorGeometry = computed(() => {
  const innerWidth = editor.width - editor.left - editor.right;
  const innerHeight = editor.height - editor.top - editor.bottom;
  return {
    x: (index: number) => editor.left + (index / Math.max(1, timeCount - 1)) * innerWidth,
    y: (value: number) =>
      editor.top +
      (1 - (clamp(value, editor.minThickness, editor.maxThickness) - editor.minThickness) /
        (editor.maxThickness - editor.minThickness)) *
        innerHeight,
    width: innerWidth,
    height: innerHeight,
    left: editor.left,
    top: editor.top,
    bottom: editor.height - editor.bottom,
    right: editor.width - editor.right
  };
});

const thicknessPaths = computed(() => thickness.map((row) => linePath(row, editorGeometry.value)));

const derivativeExtent = computed(() => {
  const maxValue = Math.max(
    1,
    ...centeredDerivative.value.map(Math.abs),
    ...l1Derivative.value.map(Math.abs),
    ...l2Derivative.value.map(Math.abs),
    ...sineDerivative.value.map(Math.abs),
    ...multiscaleDerivative.value.map(Math.abs),
    ...scourDerivative.value.map(Math.abs)
  );
  return { min: -maxValue * 1.15, max: maxValue * 1.15 };
});

const centeredDerivativePath = computed(() => derivativeLinePath(centeredDerivative.value));
const l1DerivativePath = computed(() => derivativeLinePath(l1Derivative.value));
const l2DerivativePath = computed(() => derivativeLinePath(l2Derivative.value));
const sineDerivativePath = computed(() => derivativeLinePath(sineDerivative.value));
const multiscaleDerivativePath = computed(() => derivativeLinePath(multiscaleDerivative.value));
const scourDerivativePath = computed(() => derivativeLinePath(scourDerivative.value));

const comparisons = computed(() => [
  {
    key: "centered",
    title: "Centered Baseline",
    note: "b(t) = -H(t)/2",
    paths: centeredPaths.value,
    centerPath: centeredCenterPath.value
  },
  {
    key: "l1",
    title: "L1 Norm Baseline",
    note: "least-absolute wiggle baseline",
    paths: l1Paths.value,
    centerPath: l1CenterPath.value
  },
  {
    key: "l2",
    title: "L2 Norm Baseline",
    note: baselineControls.l2WeightedWiggle ? "height-weighted centerline wiggle" : "unweighted edge wiggle",
    paths: l2Paths.value,
    centerPath: l2CenterPath.value
  },
  {
    key: "sine",
    title: "SineStream Baseline",
    note: "Gaussian-weighted layer-center smoothing",
    paths: sinePaths.value,
    centerPath: sineCenterPath.value
  },
  {
    key: "multiscale",
    title: "Multiscale Baseline",
    note: "SineStream anchor plus multiscale redistribution",
    paths: multiscalePaths.value,
    centerPath: multiscaleCenterPath.value
  },
  {
    key: "scour",
    title: "Recursive Scour",
    note: scourNote.value,
    paths: scourPaths.value,
    centerPath: scourCenterPath.value
  }
]);

const scourNote = computed(() => {
  const d = scourResult.value.debug;
  if (d.treeType === "split") {
    return `split: cost=${d.totalCost.toFixed(1)} < chain=${d.chainCost?.toFixed(1) ?? "N/A"}`;
  }
  return `chain: cost=${d.totalCost.toFixed(1)}`;
});

const scourDebugText = computed(() => {
  const d = scourResult.value.debug;
  return [
    `type: ${d.treeType}`,
    `cost: ${d.totalCost.toFixed(2)}`,
    `chainCost: ${d.chainCost?.toFixed(2) ?? "N/A"}`,
    d.splitCost !== null ? `splitCost: ${d.splitCost.toFixed(2)}` : "",
    d.splitPenalty !== null ? `splitPenalty: ${d.splitPenalty.toFixed(4)}` : "",
    d.selectedSplit ?? "",
    `depth: ${d.recursionDepth}`,
    "",
    d.treeStructure
  ]
    .filter((line) => line !== "")
    .join("\n");
});

const baselineMetrics = computed(() => [
  metricRow("Centered", centeredDerivative.value, "#64748b"),
  metricRow("L1 norm", l1Derivative.value, "#0891b2"),
  metricRow("L2 norm", l2Derivative.value, "#2563eb"),
  metricRow("SineStream", sineDerivative.value, "#7c3aed"),
  metricRow("Multiscale", multiscaleDerivative.value, "#059669"),
  metricRow("Scour", scourDerivative.value, "#d97706")
]);

const derivativeLines = computed(() => [
  { label: "Centered", path: centeredDerivativePath.value, color: "#64748b" },
  { label: "L1 norm", path: l1DerivativePath.value, color: "#0891b2" },
  { label: "L2 norm", path: l2DerivativePath.value, color: "#2563eb" },
  { label: "SineStream", path: sineDerivativePath.value, color: "#7c3aed" },
  { label: "Multiscale", path: multiscaleDerivativePath.value, color: "#059669" },
  { label: "Scour", path: scourDerivativePath.value, color: "#d97706" }
]);

const multiscaleNotes = computed(() => ({
  selectedScales: multiscaleResult.value.diagnostics.selectedScales.join(", "),
  verified: multiscaleResult.value.diagnostics.verifiedMultiscale
}));

function exportComparisonSvg(): void {
  const panelWidth = chart.width;
  const panelHeight = chart.height;
  const titleHeight = 26;
  const noteHeight = 20;
  const gap = 16;
  const padding = 18;
  const columns = 3;
  const panelOuterHeight = titleHeight + panelHeight + noteHeight;
  const rows = Math.ceil(comparisons.value.length / columns);
  const width = padding * 2 + columns * panelWidth + (columns - 1) * gap;
  const height = padding * 2 + rows * panelOuterHeight + (rows - 1) * gap;
  const geometry = streamGeometry(chart.width, chart.height, sharedYExtent.value);
  const zeroY = geometry.y(0);
  const focusX = geometry.x(focusStep.value);
  const panels = comparisons.value.map((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + col * (panelWidth + gap);
    const y = padding + row * (panelOuterHeight + gap);
    return `
      <g transform="translate(${x},${y})">
        <text x="0" y="17" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#0f172a">${escapeXml(item.title)}</text>
        <g transform="translate(0,${titleHeight})">
          <rect width="${panelWidth}" height="${panelHeight}" fill="#ffffff" stroke="#cbd5e1"/>
          <line x1="${chart.left}" x2="${chart.width - chart.right}" y1="${zeroY}" y2="${zeroY}" stroke="#cbd5e1"/>
          ${item.paths
            .map((path, layerIndex) => `<path d="${escapeXml(path)}" fill="${layerColors[layerIndex] ?? "#64748b"}" opacity="0.78"/>`)
            .join("\n")}
          <path d="${escapeXml(item.centerPath)}" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>
          <line x1="${focusX}" x2="${focusX}" y1="${chart.top}" y2="${chart.height - chart.bottom}" stroke="#334155" stroke-dasharray="5 5"/>
        </g>
        <text x="4" y="${titleHeight + panelHeight + 15}" font-family="Arial, sans-serif" font-size="11" fill="#475569">${escapeXml(item.note)}</text>
      </g>`;
  });
  downloadText("demo-comparison.svg", `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${panels.join("\n")}
</svg>
`);
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function streamGeometry(width: number, height: number, extent: { min: number; max: number }): ChartGeometry {
  const innerWidth = width - chart.left - chart.right;
  const innerHeight = height - chart.top - chart.bottom;
  return {
    x: (index: number) => chart.left + (index / Math.max(1, timeCount - 1)) * innerWidth,
    y: (value: number) => chart.top + (1 - (value - extent.min) / Math.max(1e-9, extent.max - extent.min)) * innerHeight,
    width: innerWidth,
    height: innerHeight,
    left: chart.left,
    top: chart.top,
    bottom: height - chart.bottom,
    right: width - chart.right
  };
}

function layerPaths(layout: StackLayout, geometry: ChartGeometry): string[] {
  return layout.yBottom.map((bottom, index) => areaPath(bottom, layout.yTop[index], geometry));
}

function areaPath(bottom: number[], top: number[], geometry: ChartGeometry): string {
  const upper: string[] = [];
  const lower: string[] = [];
  for (let i = 0; i < top.length; i += 1) {
    upper.push(`${i === 0 ? "M" : "L"}${fmt(geometry.x(i))},${fmt(geometry.y(top[i]))}`);
  }
  for (let i = bottom.length - 1; i >= 0; i -= 1) {
    lower.push(`L${fmt(geometry.x(i))},${fmt(geometry.y(bottom[i]))}`);
  }
  return `${upper.join(" ")} ${lower.join(" ")} Z`;
}

function linePath(values: number[], geometry: Pick<ChartGeometry, "x" | "y">): string {
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"}${fmt(geometry.x(index))},${fmt(geometry.y(value))}`)
    .join(" ");
}

function derivativeLinePath(values: number[]): string {
  const width = derivativeChart.width;
  const height = derivativeChart.height;
  const innerWidth = width - derivativeChart.left - derivativeChart.right;
  const innerHeight = height - derivativeChart.top - derivativeChart.bottom;
  const extent = derivativeExtent.value;
  const x = (index: number) => derivativeChart.left + ((index + 1) / Math.max(1, timeCount - 1)) * innerWidth;
  const y = (value: number) =>
    derivativeChart.top + (1 - (value - extent.min) / Math.max(1e-9, extent.max - extent.min)) * innerHeight;
  return values.map((value, index) => `${index === 0 ? "M" : "L"}${fmt(x(index))},${fmt(y(value))}`).join(" ");
}

function derivativeZeroY(): number {
  const extent = derivativeExtent.value;
  const innerHeight = derivativeChart.height - derivativeChart.top - derivativeChart.bottom;
  return (
    derivativeChart.top +
    (1 - (0 - extent.min) / Math.max(1e-9, extent.max - extent.min)) * innerHeight
  );
}

function centerlineFromLayout(layout: StackLayout): number[] {
  if (layout.yTop.length === 0) {
    return layout.baseline.slice();
  }
  const last = layout.yTop.length - 1;
  return layout.baseline.map((value, index) => 0.5 * (value + layout.yTop[last][index]));
}

/** The scour interface line — a flat horizontal line after the global shift. */
function centerlineFromScourLayout(layout: ScourLayout): number[] {
  return layout.centerline.slice();
}

function derivative(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] - values[i - 1]);
  }
  return out;
}

function maxAbs(values: number[]): number {
  return values.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0);
}

function concentration(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const magnitudes = values.map(Math.abs);
  const mean = magnitudes.reduce((acc, value) => acc + value, 0) / values.length;
  return mean <= 1e-9 ? 0 : Math.max(...magnitudes) / mean;
}

function improvementPct(before: number, after: number): number {
  if (!Number.isFinite(before) || Math.abs(before) <= 1e-9) {
    return 0;
  }
  return ((before - after) / Math.abs(before)) * 100;
}

function metricRow(label: string, values: number[], color: string): { label: string; peak: number; concentration: number; color: string } {
  return {
    label,
    peak: maxAbs(values),
    concentration: concentration(values),
    color
  };
}

function addLayer(): void {
  if (thickness.length < 3) {
    thickness.push(new Array<number>(timeCount).fill(0));
  }
}

function onPointerDown(layerIndex: number, index: number, event: PointerEvent): void {
  dragging.value = { layerIndex, index };
  (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
  updateDragValue(event);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) {
    return;
  }
  updateDragValue(event);
}

function onPointerUp(): void {
  dragging.value = null;
}

function updateDragValue(event: PointerEvent): void {
  const svg = editorSvg.value;
  const target = dragging.value;
  if (!svg || !target) {
    return;
  }
  const rect = svg.getBoundingClientRect();
  const viewY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * editor.height;
  const ratio = 1 - (viewY - editor.top) / Math.max(1, editor.height - editor.top - editor.bottom);
  const nextValue = editor.minThickness + clamp(ratio, 0, 1) * (editor.maxThickness - editor.minThickness);
  thickness[target.layerIndex][target.index] = Math.round(clamp(nextValue, editor.minThickness, editor.maxThickness));
}

function resetCase(kind: "burst" | "exchange" | "smooth"): void {
  const next =
    kind === "exchange"
      ? [
          [1, 1, 1, 1, 5, 1, 1, 1, 1],
          [4, 4, 4, 4, 0, 4, 4, 4, 4],
          [0, 1, 2, 3, 4, 3, 2, 1, 0]
        ]
      : kind === "smooth"
        ? [
            [1, 1, 2, 2, 2, 3, 3, 3, 3],
            [2, 2, 2, 2, 2, 2, 2, 2, 2],
            [3, 3, 3, 2, 2, 2, 1, 1, 1]
          ]
        : [
            [0, 0, 0, 0, 0, 5, 0, 0, 0],
            [0, 0, 3, 4, 4, 4, 0, 0, 0],
            [0, 0, 0, 2, 5, 2, 0, 0, 0]
          ];
  for (let i = 0; i < thickness.length; i += 1) {
    thickness[i].splice(0, thickness[i].length, ...(next[i] ?? new Array<number>(timeCount).fill(0)));
  }
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0";
}

function fmtShort(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}
</script>

<template>
  <div class="two-layer-page">
    <header class="two-layer-header">
      <h1>Demo</h1>
      
    </header>

    <div class="demo-body">
    <aside class="two-layer-workspace" aria-label="Interactive thickness editor">
      <div class="two-layer-editor">
        <div class="two-layer-section-title">
          <h2>Layer Thickness</h2>
          <button type="button" :disabled="thickness.length >= 3" @click="addLayer">+ Layer</button>
        </div>
          <div class="two-layer-legend">
            <span v-for="(_layer, index) in thickness" :key="`legend-${index}`">
              <i class="swatch" :style="{ backgroundColor: layerColors[index] }"></i>layer {{ index + 1 }}
            </span>
          </div>
          
        <svg
          ref="editorSvg"
          class="two-layer-editor-svg"
          :viewBox="`0 0 ${editor.width} ${editor.height}`"
          role="img"
          aria-label="Drag layer thickness points"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <rect
            :x="editorGeometry.left"
            :y="editorGeometry.top"
            :width="editorGeometry.width"
            :height="editorGeometry.height"
            rx="6"
            fill="#f8fafc"
            stroke="#cbd5e1"
          />
          <line
            v-for="index in timeCount"
            :key="`grid-${index}`"
            :x1="editorGeometry.x(index - 1)"
            :x2="editorGeometry.x(index - 1)"
            :y1="editorGeometry.top"
            :y2="editorGeometry.bottom"
            stroke="#e2e8f0"
          />
          <path
            v-for="(path, layerIndex) in thicknessPaths"
            :key="`path-${layerIndex}`"
            :d="path"
            fill="none"
            :stroke="layerColors[layerIndex]"
            stroke-width="4"
            stroke-linecap="round"
          />
          <g v-for="(row, layerIndex) in thickness" :key="`layer-${layerIndex}`">
            <circle
              v-for="(value, index) in row"
              :key="`point-${layerIndex}-${index}`"
              class="drag-handle"
              :fill="layerColors[layerIndex]"
              :cx="editorGeometry.x(index)"
              :cy="editorGeometry.y(value)"
              r="7"
              tabindex="0"
              @pointerdown="onPointerDown(layerIndex, index, $event)"
            />
          </g>
          <text
            v-for="index in timeCount"
            :key="`tick-${index}`"
            :x="editorGeometry.x(index - 1)"
            :y="editor.height - 16"
            text-anchor="middle"
            font-size="12"
            fill="#475569"
          >
            t{{ index - 1 }}
          </text>
        </svg>
        <div class="two-layer-actions" aria-label="Preset cases">
        <button type="button" @click="resetCase('burst')">Burst</button>
        <button type="button" @click="resetCase('exchange')">Exchange</button>
        <button type="button" @click="resetCase('smooth')">Smooth</button>
      </div>
      </div>
    </aside>
    <main class="demo-main">

    <!-- Scour parameters -->
    <section class="two-layer-metric-strip scour-params" aria-label="Scour parameters">
      <div class="metric-pill">
        <span>λ turn</span>
        <strong><input v-model.number="scourConfig.lambdaTurn" type="number" min="0" max="2" step="0.05" /></strong>
      </div>
      <div class="metric-pill">
        <span>ρ split</span>
        <strong><input v-model.number="scourConfig.rhoSplit" type="number" min="0" max="1" step="0.01" /></strong>
      </div>
      <div class="metric-pill">
        <span>η height</span>
        <strong><input v-model.number="scourConfig.etaHeight" type="number" min="0" max="0.1" step="0.001" /></strong>
      </div>
      <div class="metric-pill">
        <span>β balance</span>
        <strong><input v-model.number="scourConfig.betaBalance" type="number" min="0" max="2" step="0.02" /></strong>
      </div>
      <div class="metric-pill">
        <span>max depth</span>
        <strong><input v-model.number="scourConfig.maxDepth" type="number" min="1" max="6" step="1" /></strong>
      </div>
      <div class="metric-pill">
        <span>interface mode</span>
        <strong>
          <select v-model="scourConfig.movingInterfaceMode">
            <option value="optimized">optimized</option>
            <option value="symmetric">symmetric</option>
            <option value="fixed">fixed</option>
          </select>
        </strong>
      </div>
      <div class="metric-pill">
        <span>interface anchor</span>
        <strong><input v-model.number="scourConfig.movingInterfaceAnchorWeight" type="number" min="0" step="1" /></strong>
      </div>
      <div class="metric-pill">
        <span>interface λ</span>
        <strong><input v-model.number="scourConfig.movingInterfaceLambda" type="number" min="0" step="0.05" /></strong>
      </div>
      <div class="metric-pill">
        <span>interface weight</span>
        <strong><input v-model.number="scourConfig.movingInterfaceWeight" type="number" min="0" step="0.05" /></strong>
      </div>
      <div class="metric-pill">
        <span>search</span>
        <strong>
          <select v-model="scourConfig.searchMode">
            <option value="greedy">greedy</option>
            <option value="exact">exact</option>
          </select>
        </strong>
      </div>
    </section>

    <section class="two-layer-metric-strip" aria-label="Baseline metrics">
      <div v-for="item in baselineMetrics" :key="item.label" class="metric-pill">
        <span><i class="metric-line" :style="{ backgroundColor: item.color }"></i>{{ item.label }}</span>
        <strong>|dc|max={{ fmtShort(item.peak) }}, conc={{ fmtShort(item.concentration) }}</strong>
      </div>
      <div class="metric-pill">
        <span>Multiscale scales</span>
        <strong>{{ multiscaleNotes.selectedScales || "none" }}</strong>
      </div>
      <div class="metric-pill">
        <span>Verified</span>
        <strong>{{ multiscaleNotes.verified ? "yes" : "no" }}</strong>
      </div>
    </section>

    <section class="two-layer-compare-section" aria-label="Baseline and scour comparison">
      <div class="two-layer-section-title">
        <h2>Baseline Comparison</h2>
        <button type="button" @click="exportComparisonSvg">Export SVG</button>
      </div>
      <div class="two-layer-compare">
        <div v-for="item in comparisons" :key="item.key" class="two-layer-chart">
        <h2>{{ item.title }}</h2>
        <div class="baseline-controls" :aria-label="`${item.title} parameters`">
          <span v-if="item.key === 'centered'" class="baseline-controls__static">b(t) = -H(t)/2</span>

          <template v-else-if="item.key === 'l1'">
            <label>
              wiggle L1
              <input v-model.number="baselineControls.l1WiggleWeight" type="number" min="0" step="0.05" />
            </label>
            <label>
              center anchor
              <input v-model.number="baselineControls.l1CenterAnchorWeight" type="number" min="0" step="0.05" />
            </label>
          </template>

          <template v-else-if="item.key === 'l2'">
            <label>
              wiggle L2
              <input v-model.number="baselineControls.l2WiggleWeight" type="number" min="0" step="0.05" />
            </label>
            <label>
              center anchor
              <input v-model.number="baselineControls.l2CenterAnchorWeight" type="number" min="0" step="0.05" />
            </label>
            <label>
              weighted
              <input v-model="baselineControls.l2WeightedWiggle" type="checkbox" />
            </label>
          </template>

          <template v-else-if="item.key === 'sine'">
            <label>
              center type
              <select v-model="baselineControls.sineCenterType">
                <option v-for="option in centerTypeOptions" :key="`sine-${option}`" :value="option">
                  {{ option }}
                </option>
              </select>
            </label>
          </template>

          <template v-else-if="item.key === 'multiscale'">
            <label>
              center type
              <select v-model="baselineControls.multiscaleCenterType">
                <option v-for="option in centerTypeOptions" :key="`multi-${option}`" :value="option">
                  {{ option }}
                </option>
              </select>
            </label>
            <label>
              wave
              <input v-model.number="baselineControls.multiscaleWaveStrength" type="number" min="0" step="0.05" />
            </label>
            <label>
              threshold
              <input
                v-model.number="baselineControls.multiscaleEnergyThreshold"
                type="number"
                min="0"
                max="1"
                step="0.01"
              />
            </label>
          </template>

          <template v-else-if="item.key === 'scour'">
            <div class="scour-debug" aria-label="Scour debug output">
              <pre>{{ scourDebugText }}</pre>
            </div>
          </template>
        </div>
        <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${item.title} layout`">
          <rect width="100%" height="100%" rx="8" fill="#ffffff" />
          <line
            :x1="chart.left"
            :x2="chart.width - chart.right"
            :y1="streamGeometry(chart.width, chart.height, sharedYExtent).y(0)"
            :y2="streamGeometry(chart.width, chart.height, sharedYExtent).y(0)"
            stroke="#cbd5e1"
          />
          <path
            v-for="(path, layerIndex) in item.paths"
            :key="`area-${item.key}-${layerIndex}`"
            :d="path"
            :fill="layerColors[layerIndex]"
            opacity="0.78"
          />
          <path :d="item.centerPath" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round" />
          <line
            :x1="streamGeometry(chart.width, chart.height, sharedYExtent).x(focusStep)"
            :x2="streamGeometry(chart.width, chart.height, sharedYExtent).x(focusStep)"
            :y1="chart.top"
            :y2="chart.height - chart.bottom"
            stroke="#334155"
            stroke-dasharray="5 5"
          />
          <text
            :x="streamGeometry(chart.width, chart.height, sharedYExtent).x(focusStep) + 5"
            y="26"
            fill="#334155"
            font-size="9"
          >
            max|dc|
          </text>
          <text x="36" :y="chart.height - 10" fill="#475569" font-size="11">{{ item.note }}</text>
        </svg>
      </div>
      </div>
    </section>

    <section class="two-layer-derivative" aria-label="Centerline derivative comparison">
      <h2>Centerline Step Motion</h2>
      <svg
        :viewBox="`0 0 ${derivativeChart.width} ${derivativeChart.height}`"
        role="img"
        aria-label="Centerline derivative chart"
      >
        <rect width="100%" height="100%" rx="8" fill="#ffffff" />
        <line
          :x1="derivativeChart.left"
          :x2="derivativeChart.width - derivativeChart.right"
          :y1="derivativeZeroY()"
          :y2="derivativeZeroY()"
          stroke="#94a3b8"
        />
        <path
          v-for="item in derivativeLines"
          :key="item.label"
          :d="item.path"
          fill="none"
          :stroke="item.color"
          stroke-width="3"
          stroke-linecap="round"
        />
        <g v-for="index in timeCount - 1" :key="`dt-${index}`">
          <text
            :x="derivativeChart.left + (index / Math.max(1, timeCount - 1)) * (derivativeChart.width - derivativeChart.left - derivativeChart.right)"
            :y="derivativeChart.height - 12"
            text-anchor="middle"
            font-size="11"
            fill="#475569"
          >
            d{{ index }}
          </text>
        </g>
        <g v-for="(item, index) in derivativeLines" :key="`legend-${item.label}`">
          <line :x1="52 + index * 120" :x2="82 + index * 120" y1="22" y2="22" :stroke="item.color" stroke-width="3" />
          <text :x="88 + index * 120" y="26" :fill="item.color" font-size="12">{{ item.label }}</text>
        </g>
      </svg>
    </section>
    </main>
    </div>
  </div>
</template>

<style scoped>
.two-layer-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.two-layer-header,
.two-layer-workspace,
.two-layer-metric-strip,
.two-layer-compare-section,
.two-layer-compare,
.two-layer-derivative {
  width: 100%;
}

.two-layer-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.two-layer-header h1 {
  margin: 0;
}

.two-layer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.demo-body {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.demo-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.two-layer-workspace {
  display: block;
  position: sticky;
  top: 10px;
}

.two-layer-editor,
.two-layer-chart,
.two-layer-derivative,
.two-layer-metric-strip {
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 8px;
  background: #ffffff;
}

.two-layer-editor {
  padding: 10px;
}

.two-layer-section-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
}

.two-layer-section-title button {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
}

.two-layer-section-title button:disabled {
  cursor: default;
  opacity: 0.45;
}

.two-layer-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  color: #334155;
  font-size: 0.86rem;
}

.two-layer-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.swatch-x {
  background: #0f766e;
}

.swatch-y {
  background: #c2410c;
}

.two-layer-editor-svg,
.two-layer-chart svg,
.two-layer-derivative svg {
  display: block;
  width: 100%;
  height: auto;
}

.drag-handle {
  cursor: ns-resize;
  stroke: #ffffff;
  stroke-width: 2.5;
}

.drag-handle-x {
  fill: #0f766e;
}

.drag-handle-y {
  fill: #c2410c;
}

.drag-handle:hover,
.drag-handle:focus {
  stroke: #0f172a;
  outline: none;
}

.two-layer-metric-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  padding: 8px 10px;
}

.metric-pill {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 7px 8px;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font-size: 0.82rem;
}

.metric-pill span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  min-width: 0;
}

.metric-pill strong {
  min-width: 0;
  color: #0f172a;
  overflow-wrap: anywhere;
  font-size: 0.84rem;
}

/* Scour parameter inputs */
.metric-pill input,
.metric-pill select {
  width: 100%;
  padding: 2px 4px;
  font: inherit;
  font-size: 0.82rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
}

.metric-line {
  display: inline-block;
  width: 18px;
  height: 3px;
  border-radius: 999px;
  vertical-align: middle;
}

.two-layer-compare {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.two-layer-chart {
  min-width: 0;
  padding: 10px;
}

.baseline-controls {
  min-height: 78px;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px 8px;
  margin-bottom: 8px;
  padding: 7px;
  border-radius: 6px;
  background: #f8fafc;
}

.baseline-controls label {
  display: grid;
  grid-template-columns: minmax(74px, max-content) minmax(72px, 1fr);
  gap: 6px;
  align-items: center;
  min-width: 0;
  flex: 1 1 130px;
  color: #334155;
  font-size: 0.78rem;
}

.baseline-controls input,
.baseline-controls select {
  width: 100%;
  min-width: 0;
  font: inherit;
}

.baseline-controls__static {
  align-self: start;
  color: #334155;
  font-size: 0.82rem;
  font-weight: 700;
}

/* Scour debug panel */
.scour-debug pre {
  margin: 0;
  padding: 6px 8px;
  font-size: 0.68rem;
  line-height: 1.35;
  color: #334155;
  background: #f1f5f9;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 110px;
  overflow-y: auto;
}

.two-layer-derivative {
  padding: 10px;
}

@media (max-width: 1300px) {
  .two-layer-compare {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .demo-body {
    grid-template-columns: 1fr;
  }

  .two-layer-workspace {
    position: static;
  }

  .two-layer-compare {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .two-layer-metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .two-layer-compare {
    grid-template-columns: 1fr;
  }
  .baseline-controls label,
  .two-layer-metric-strip {
    grid-template-columns: 1fr;
  }
}
</style>
