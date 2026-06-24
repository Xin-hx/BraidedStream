<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { computeCenteredBaseline, computeWiggleBaseline } from "../core/baseline/compute";
import { computeSineStreamBaseline } from "../core/baseline/sineStream";
import { computeMultiscaleDistributedBaseline } from "../core/baseline/multiscale";
import { computeStackedBoundaries } from "../core/stack";
import type { BaselineCenterType, LayerInput, StackLayout } from "../core/types";
import { clamp } from "../core/utils";

interface DragTarget {
  layer: "x" | "y";
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
const thickness = reactive({
  x: [24, 24, 24, 24, 24, 150, 24, 24, 24],
  y: [24, 24, 24, 150, 24, 24, 24, 24, 24]
});

const editorSvg = ref<SVGSVGElement | null>(null);
const dragging = ref<DragTarget | null>(null);
const centerTypeOptions: BaselineCenterType[] = ["median", "mean", "geometric", "harmonic"];
const baselineControls = reactive({
  l2WiggleWeight: 1,
  l2CenterAnchorWeight: 0,
  sineCenterType: "median" as BaselineCenterType,
  multiscaleCenterType: "median" as BaselineCenterType,
  multiscaleWaveStrength: 0.72,
  multiscaleEnergyThreshold: 0.04
});

const editor = {
  width: 760,
  height: 270,
  left: 48,
  right: 28,
  top: 24,
  bottom: 42,
  minThickness: 8,
  maxThickness: 170
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
  width: 1120,
  height: 170,
  left: 44,
  right: 18,
  top: 20,
  bottom: 36
};

const layers = computed<LayerInput[]>(() => [
  {
    id: "x-bottom",
    fill_color: "#0f766e",
    height: thickness.x.slice()
  },
  {
    id: "y-top",
    fill_color: "#c2410c",
    height: thickness.y.slice()
  }
]);

const centeredBaseline = computed(() => computeCenteredBaseline(timeCount, layers.value));
const l2Hooks = computed(() => ({
  wiggleWeightL2: Math.max(0, baselineControls.l2WiggleWeight),
  centerAnchorWeight: Math.max(0, baselineControls.l2CenterAnchorWeight)
}));
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
const l2Layout = computed(() => computeStackedBoundaries(l2Baseline.value, layers.value));
const sineLayout = computed(() => computeStackedBoundaries(sineBaseline.value, layers.value));
const multiscaleLayout = computed(() => computeStackedBoundaries(multiscaleResult.value.baseline, layers.value));

const centeredCenterline = computed(() => centerlineFromLayout(centeredLayout.value));
const l2Centerline = computed(() => centerlineFromLayout(l2Layout.value));
const sineCenterline = computed(() => centerlineFromLayout(sineLayout.value));
const multiscaleCenterline = computed(() => centerlineFromLayout(multiscaleLayout.value));
const centeredDerivative = computed(() => derivative(centeredCenterline.value));
const l2Derivative = computed(() => derivative(l2Centerline.value));
const sineDerivative = computed(() => derivative(sineCenterline.value));
const multiscaleDerivative = computed(() => derivative(multiscaleCenterline.value));

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
    ...l2Layout.value.yBottom.flat(),
    ...l2Layout.value.yTop.flat(),
    ...sineLayout.value.yBottom.flat(),
    ...sineLayout.value.yTop.flat(),
    ...multiscaleLayout.value.yBottom.flat(),
    ...multiscaleLayout.value.yTop.flat(),
    ...centeredCenterline.value,
    ...l2Centerline.value,
    ...sineCenterline.value,
    ...multiscaleCenterline.value
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
const l2Paths = computed(() => layerPaths(l2Layout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value)));
const sinePaths = computed(() => layerPaths(sineLayout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value)));
const multiscalePaths = computed(() =>
  layerPaths(multiscaleLayout.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
);

const centeredCenterPath = computed(() =>
  linePath(centeredCenterline.value, streamGeometry(chart.width, chart.height, sharedYExtent.value))
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

const xThicknessPath = computed(() => linePath(thickness.x, editorGeometry.value));
const yThicknessPath = computed(() => linePath(thickness.y, editorGeometry.value));

const derivativeExtent = computed(() => {
  const maxValue = Math.max(
    1,
    ...centeredDerivative.value.map(Math.abs),
    ...l2Derivative.value.map(Math.abs),
    ...sineDerivative.value.map(Math.abs),
    ...multiscaleDerivative.value.map(Math.abs)
  );
  return { min: -maxValue * 1.15, max: maxValue * 1.15 };
});

const centeredDerivativePath = computed(() => derivativeLinePath(centeredDerivative.value));
const l2DerivativePath = computed(() => derivativeLinePath(l2Derivative.value));
const sineDerivativePath = computed(() => derivativeLinePath(sineDerivative.value));
const multiscaleDerivativePath = computed(() => derivativeLinePath(multiscaleDerivative.value));

const comparisons = computed(() => [
  {
    key: "centered",
    title: "Centered Baseline",
    note: "b(t) = -H(t)/2",
    paths: centeredPaths.value,
    centerPath: centeredCenterPath.value
  },
  {
    key: "l2",
    title: "L2 Norm Baseline",
    note: "least-squares wiggle baseline",
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
  }
]);

const baselineMetrics = computed(() => [
  metricRow("Centered", centeredDerivative.value, "#64748b"),
  metricRow("L2 norm", l2Derivative.value, "#2563eb"),
  metricRow("SineStream", sineDerivative.value, "#7c3aed"),
  metricRow("Multiscale", multiscaleDerivative.value, "#059669")
]);

const derivativeLines = computed(() => [
  { label: "Centered", path: centeredDerivativePath.value, color: "#64748b" },
  { label: "L2 norm", path: l2DerivativePath.value, color: "#2563eb" },
  { label: "SineStream", path: sineDerivativePath.value, color: "#7c3aed" },
  { label: "Multiscale", path: multiscaleDerivativePath.value, color: "#059669" }
]);

const multiscaleNotes = computed(() => ({
  selectedScales: multiscaleResult.value.diagnostics.selectedScales.join(", "),
  verified: multiscaleResult.value.diagnostics.verifiedMultiscale
}));

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

function onPointerDown(layer: "x" | "y", index: number, event: PointerEvent): void {
  dragging.value = { layer, index };
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
  thickness[target.layer][target.index] = Math.round(nextValue);
}

function resetCase(kind: "burst" | "exchange" | "smooth"): void {
  const next =
    kind === "exchange"
      ? {
          x: [42, 42, 42, 42, 174, 42, 42, 42, 42],
          y: [132, 132, 132, 132, 8, 132, 132, 132, 132]
        }
      : kind === "smooth"
        ? {
            x: [42, 48, 56, 66, 78, 88, 96, 102, 106],
            y: [72, 70, 69, 67, 66, 64, 63, 61, 60]
          }
        : {
            x: [24, 24, 24, 24, 24, 150, 24, 24, 24],
            y: [24, 24, 24, 150, 24, 24, 24, 24, 24]
          };
  thickness.x.splice(0, thickness.x.length, ...next.x);
  thickness.y.splice(0, thickness.y.length, ...next.y);
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
      <h1>Two-layer SineStream Centerline Demo</h1>
      <div class="two-layer-actions" aria-label="Preset cases">
        <button type="button" @click="resetCase('burst')">Burst</button>
        <button type="button" @click="resetCase('exchange')">Exchange</button>
        <button type="button" @click="resetCase('smooth')">Smooth</button>
      </div>
    </header>

    <section class="two-layer-workspace" aria-label="Interactive thickness editor">
      <div class="two-layer-editor">
        <div class="two-layer-section-title">
          <h2>Layer Thickness</h2>
          <div class="two-layer-legend">
            <span><i class="swatch swatch-x"></i>x bottom layer</span>
            <span><i class="swatch swatch-y"></i>y top layer</span>
          </div>
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
          <path :d="xThicknessPath" fill="none" stroke="#0f766e" stroke-width="4" stroke-linecap="round" />
          <path :d="yThicknessPath" fill="none" stroke="#c2410c" stroke-width="4" stroke-linecap="round" />
          <g v-for="(value, index) in thickness.x" :key="`x-${index}`">
            <circle
              class="drag-handle drag-handle-x"
              :cx="editorGeometry.x(index)"
              :cy="editorGeometry.y(value)"
              r="9"
              tabindex="0"
              @pointerdown="onPointerDown('x', index, $event)"
            />
          </g>
          <g v-for="(value, index) in thickness.y" :key="`y-${index}`">
            <circle
              class="drag-handle drag-handle-y"
              :cx="editorGeometry.x(index)"
              :cy="editorGeometry.y(value)"
              r="9"
              tabindex="0"
              @pointerdown="onPointerDown('y', index, $event)"
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

    <section class="two-layer-compare" aria-label="SineStream and multiscale comparison">
      <div v-for="item in comparisons" :key="item.key" class="two-layer-chart">
        <h2>{{ item.title }}</h2>
        <div class="baseline-controls" :aria-label="`${item.title} parameters`">
          <span v-if="item.key === 'centered'" class="baseline-controls__static">b(t) = -H(t)/2</span>

          <template v-else-if="item.key === 'l2'">
            <label>
              wiggle L2
              <input v-model.number="baselineControls.l2WiggleWeight" type="number" min="0" step="0.05" />
            </label>
            <label>
              center anchor
              <input v-model.number="baselineControls.l2CenterAnchorWeight" type="number" min="0" step="0.05" />
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

          <template v-else>
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
          <path :d="item.paths[0]" fill="#0f766e" opacity="0.78" />
          <path :d="item.paths[1]" fill="#c2410c" opacity="0.78" />
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
          <line :x1="52 + index * 128" :x2="82 + index * 128" y1="22" y2="22" :stroke="item.color" stroke-width="3" />
          <text :x="88 + index * 128" y="26" :fill="item.color" font-size="12">{{ item.label }}</text>
        </g>
      </svg>
    </section>
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

.two-layer-workspace {
  display: block;
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

.metric-line {
  display: inline-block;
  width: 18px;
  height: 3px;
  border-radius: 999px;
  vertical-align: middle;
}

.two-layer-compare {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.two-layer-derivative {
  padding: 10px;
}

@media (max-width: 1100px) {
  .two-layer-compare {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .two-layer-compare {
    grid-template-columns: 1fr;
  }

  .two-layer-metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .baseline-controls label,
  .two-layer-metric-strip {
    grid-template-columns: 1fr;
  }
}
</style>
