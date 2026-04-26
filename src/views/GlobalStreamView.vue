<script setup lang="ts">
import * as d3 from "d3";
import { onMounted, ref, watch } from "vue";
import type { SceneBuildResult } from "../app/sceneBuilder";
import type { LayerInput, ROI, StackLayout } from "../core/types";
import { buildHoverInfo, tooltipText } from "../interactions/hover";
import { MainChart } from "../render/mainChart";
import { OverviewChart } from "../render/overviewChart";

const props = defineProps<{
  scene: SceneBuildResult | null;
  mainBaselineBranch: "center" | "zero";
}>();

const emit = defineEmits<{
  (e: "update-roi", value: ROI | null): void;
  (e: "update-inset-roi", value: ROI | null): void;
  (e: "update-main-baseline-branch", value: "center" | "zero"): void;
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const mainBaselineButtons: Array<{ key: "center" | "zero"; label: string }> = [
  { key: "center", label: "center" },
  { key: "zero", label: "zero" }
];

const overviewSvg = ref<SVGSVGElement | null>(null);
const mainSvg = ref<SVGSVGElement | null>(null);

let overviewChart: OverviewChart | null = null;
let mainChart: MainChart | null = null;
let lastOverviewXScale: d3.ScaleLinear<number, number> | null = null;
let lastMainXScale: d3.ScaleLinear<number, number> | null = null;
let lastMainYScale: d3.ScaleLinear<number, number> | null = null;

onMounted(() => {
  if (overviewSvg.value) {
    overviewChart = new OverviewChart(overviewSvg.value);
  }
  if (mainSvg.value) {
    mainChart = new MainChart(mainSvg.value);
  }
  renderCharts();
});

watch(
  () => props.scene,
  () => {
    renderCharts();
  },
  { deep: true }
);

function renderCharts(): void {
  if (!props.scene || !overviewChart || !mainChart) {
    return;
  }

  lastOverviewXScale = overviewChart.render({
    dataset: props.scene.dataset,
    roi: props.scene.roi,
    onRoiChange: (roi) => emit("update-roi", roi)
  });

  const mainResult = mainChart.render({
    dataset: props.scene.dataset,
    orderedLayers: props.scene.orderedLayers,
    layout: props.scene.baseLayout,
    roi: props.scene.roi,
    insetRoi: props.scene.insetRoi,
    onInsetRoiChange: (roi) => emit("update-inset-roi", roi)
  });
  lastMainXScale = mainResult.xScale;
  lastMainYScale = mainResult.yScale;
}

function onOverviewMove(event: MouseEvent): void {
  if (!props.scene || !overviewSvg.value || !lastOverviewXScale) {
    return;
  }
  const x = pointerX(overviewSvg.value, event);
  const value = lastOverviewXScale.invert(x);
  const i = nearestByValue(props.scene.dataset.times, value);
  emit("hover", {
    x: event.clientX,
    y: event.clientY,
    text: tooltipText(buildHoverInfo(i, props.scene.dataset.times, props.scene.dataset.layers), ["overview"])
  });
}

function onMainMove(event: MouseEvent): void {
  if (!props.scene || !mainSvg.value || !lastMainXScale) {
    return;
  }
  const x = pointerX(mainSvg.value, event);
  const value = lastMainXScale.invert(x);
  const i = nearestByValue(props.scene.dataset.times, value);
  const y = pointerY(mainSvg.value, event);
  const focusLayerId =
    lastMainYScale !== null
      ? selectLayerIdAtPosition(
          i,
          lastMainYScale.invert(y),
          props.scene.orderedLayers,
          props.scene.baseLayout.yBottom,
          props.scene.baseLayout.yTop
        )
      : null;
  if (lastMainXScale && mainChart) {
    mainChart.setHover(props.scene.dataset.times[i], lastMainXScale);
  }
  emit("hover", {
    x: event.clientX,
    y: event.clientY,
    text: tooltipText(buildHoverInfo(i, props.scene.dataset.times, props.scene.dataset.layers, focusLayerId), ["main"])
  });
}

function onLeave(): void {
  if (mainChart && lastMainXScale) {
    mainChart.setHover(null, lastMainXScale);
  }
  emit("hover", null);
}

defineExpose({
  getOverviewSvg: () => overviewSvg.value,
  getMainSvg: () => mainSvg.value
});

function pointerX(svg: SVGSVGElement, event: MouseEvent): number {
  const rect = svg.getBoundingClientRect();
  return Math.max(0, Math.min(rect.width, event.clientX - rect.left));
}

function pointerY(svg: SVGSVGElement, event: MouseEvent): number {
  const rect = svg.getBoundingClientRect();
  return Math.max(0, Math.min(rect.height, event.clientY - rect.top));
}

function nearestByValue(times: number[], target: number): number {
  if (times.length <= 1) {
    return 0;
  }
  let left = 0;
  let right = times.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (times[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  if (left <= 0) {
    return 0;
  }
  const prev = left - 1;
  return Math.abs(times[left] - target) < Math.abs(times[prev] - target) ? left : prev;
}

function selectLayerIdAtPosition(
  timeIndex: number,
  yValue: number,
  orderedLayers: LayerInput[],
  yBottom: number[][],
  yTop: number[][]
): string | null {
  for (let k = orderedLayers.length - 1; k >= 0; k -= 1) {
    const lo = yBottom[k][timeIndex];
    const hi = yTop[k][timeIndex];
    if (yValue >= lo && yValue <= hi) {
      return orderedLayers[k].id;
    }
  }
  return null;
}
</script>

<template>
  <section class="panel panel--main-stream">
    <div class="main-stream-header">
      <h2>Main Stream</h2>
      <div class="main-branch-switch" aria-label="Main baseline branch">
        <button
          v-for="button in mainBaselineButtons"
          :key="button.key"
          type="button"
          class="main-branch-button"
          :class="{ 'is-active': props.mainBaselineBranch === button.key }"
          @click="emit('update-main-baseline-branch', button.key)"
        >
          {{ button.label }}
        </button>
      </div>
    </div>
    <div class="main-stream-canvas">
      <svg id="main-chart" ref="mainSvg" width="1140" height="360" @mousemove="onMainMove" @mouseleave="onLeave" />
      <div class="main-stream-divider" />
      <div class="subwindow-title">Sub-time window brush area</div>
      <svg
        id="overview-chart"
        ref="overviewSvg"
        width="1140"
        height="118"
        @mousemove="onOverviewMove"
        @mouseleave="onLeave"
      />
    </div>
  </section>
</template>
