<script setup lang="ts">
import * as d3 from "d3";
import { onMounted, ref, watch } from "vue";
import type { SceneBuildResult } from "../app/sceneBuilder";
import type { InsetViewMode, LayerInput, StackLayout } from "../core/types";
import type { AppState } from "../state/appState";
import { buildHoverInfo, tooltipText } from "../interactions/hover";
import { InsetChart } from "../render/insetChart";

const props = defineProps<{
  scene: SceneBuildResult | null;
  state: AppState;
  forcedViewMode?: InsetViewMode | null;
  forcedUncertaintyGap?: boolean | null;
}>();

const emit = defineEmits<{
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const insetSvg = ref<SVGSVGElement | null>(null);
let insetChart: InsetChart | null = null;
let lastInsetXScale: d3.ScaleLinear<number, number> | null = null;
let lastInsetYScale: d3.ScaleLinear<number, number> | null = null;
let lastInsetTimes: number[] = [];
let lastInsetStartIndex = 0;

onMounted(() => {
  if (insetSvg.value) {
    insetChart = new InsetChart(insetSvg.value);
  }
  renderChart();
});

watch(
  () => [
    props.scene,
    props.state.insetViewMode,
    props.state.enableUncertaintyGap,
    props.state.enableJaggedEdge,
    props.state.insetJaggedAmplitude,
    props.state.insetJaggedFrequency,
    props.forcedViewMode,
    props.forcedUncertaintyGap
  ],
  () => {
    renderChart();
  },
  { deep: true }
);

function renderChart(): void {
  if (!props.scene || !insetChart) {
    return;
  }
  const result = insetChart.render({
    dataset: props.scene.dataset,
    orderedLayers: props.scene.orderedLayers,
    before: props.scene.baseLayout,
    after: props.scene.braidedLayout,
    roi: props.scene.insetRoi,
    viewMode: props.forcedViewMode ?? props.state.insetViewMode,
    yZoom: props.state.yZoomInset,
    enableUncertaintyGap: props.forcedUncertaintyGap ?? props.state.enableUncertaintyGap,
    enableJaggedEdge: props.state.enableJaggedEdge,
    jaggedAmplitude: props.state.insetJaggedAmplitude,
    jaggedFrequency: props.state.insetJaggedFrequency,
    fixedSeed: props.state.fixedSeed
  });
  lastInsetXScale = result.xScale;
  lastInsetYScale = result.yScale;
  lastInsetTimes = result.activeTimes;
  lastInsetStartIndex = result.activeStartIndex;
}

function onInsetMove(event: MouseEvent): void {
  if (!props.scene || !insetSvg.value || !lastInsetXScale) {
    return;
  }
  if (lastInsetTimes.length === 0) {
    return;
  }
  const x = pointerX(insetSvg.value, event);
  const timeValue = lastInsetXScale.invert(x);
  const localIndex = nearestByValue(lastInsetTimes, timeValue);
  const i = lastInsetStartIndex + localIndex;
  const y = pointerY(insetSvg.value, event);
  const focusLayerId =
    lastInsetYScale !== null
      ? selectLayerIdAtPosition(
          i,
          lastInsetYScale.invert(y),
          props.scene.orderedLayers,
          props.scene.braidedLayout.yBottom,
          props.scene.braidedLayout.yTop
        )
      : null;
  if (insetChart && lastInsetXScale) {
    insetChart.setHover(props.scene.dataset.times[i], lastInsetXScale);
  }
  emit("hover", {
    x: event.clientX,
    y: event.clientY,
    text: tooltipText(buildHoverInfo(i, props.scene.dataset.times, props.scene.dataset.layers, focusLayerId), ["enhanced"])
  });
}

function onLeave(): void {
  if (insetChart) {
    insetChart.setHover(null, null);
  }
  emit("hover", null);
}

defineExpose({
  getInsetSvg: () => insetSvg.value
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
  <section>
    <svg id="inset-chart" ref="insetSvg" width="1140" height="300" @mousemove="onInsetMove" @mouseleave="onLeave" />
  </section>
</template>
