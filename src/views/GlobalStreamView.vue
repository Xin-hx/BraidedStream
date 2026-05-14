<script setup lang="ts">
import * as d3 from "d3";
import { computed, onMounted, ref, watch } from "vue";
import type { SceneBuildResult } from "../app/sceneBuilder";
import type { ROI } from "../core/types";
import { createHoverInfoResolver, tooltipText, type HoverInfoResolver } from "../interactions/hover";
import { layerIdAtY, pointerToPlot, timeIndexAtPlotX } from "../interactions/hitTest";
import type { PlotArea } from "../render/chartUtils";
import { MainChart } from "../render/mainChart";
import { OverviewChart } from "../render/overviewChart";
import { stateLegendEntriesForLayers } from "../styles/palette";

const props = defineProps<{
  scene: SceneBuildResult | null;
}>();

const emit = defineEmits<{
  (e: "update-roi", value: ROI | null): void;
  (e: "update-inset-roi", value: ROI | null): void;
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const overviewSvg = ref<SVGSVGElement | null>(null);
const mainSvg = ref<SVGSVGElement | null>(null);

let overviewChart: OverviewChart | null = null;
let mainChart: MainChart | null = null;
let lastOverviewXScale: d3.ScaleLinear<number, number> | null = null;
let lastOverviewPlotArea: PlotArea | null = null;
let lastMainXScale: d3.ScaleLinear<number, number> | null = null;
let lastMainYScale: d3.ScaleLinear<number, number> | null = null;
let lastMainPlotArea: PlotArea | null = null;
let hoverInfo: HoverInfoResolver | null = null;

const legendEntries = computed(() => {
  return props.scene ? stateLegendEntriesForLayers(props.scene.orderedLayers) : [];
});

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
    hoverInfo = null;
    return;
  }

  hoverInfo = createHoverInfoResolver(props.scene.dataset.layers);
  const overviewResult = overviewChart.render({
    dataset: props.scene.dataset,
    roi: props.scene.roi,
    onRoiChange: (roi) => emit("update-roi", roi)
  });
  lastOverviewXScale = overviewResult.xScale;
  lastOverviewPlotArea = overviewResult.plotArea;

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
  lastMainPlotArea = mainResult.plotArea;
}

function onOverviewMove(event: MouseEvent): void {
  if (!props.scene || !overviewSvg.value || !lastOverviewXScale || !lastOverviewPlotArea || !hoverInfo) {
    return;
  }
  const pointer = pointerToPlot(overviewSvg.value, event, lastOverviewPlotArea);
  const i = timeIndexAtPlotX(props.scene.dataset.times, lastOverviewXScale, pointer.x);
  emit("hover", {
    x: event.clientX,
    y: event.clientY,
    text: tooltipText(hoverInfo.build(i, props.scene.dataset.times), ["overview"])
  });
}

function onMainMove(event: MouseEvent): void {
  if (!props.scene || !mainSvg.value || !lastMainXScale || !lastMainPlotArea || !hoverInfo) {
    return;
  }
  const pointer = pointerToPlot(mainSvg.value, event, lastMainPlotArea);
  const i = timeIndexAtPlotX(props.scene.dataset.times, lastMainXScale, pointer.x);
  const focusLayerId =
    lastMainYScale !== null && pointer.insideY
      ? layerIdAtY(
          i,
          lastMainYScale.invert(pointer.y),
          props.scene.orderedLayers,
          props.scene.baseLayout
        )
      : null;
  if (lastMainXScale && mainChart) {
    mainChart.setHover(props.scene.dataset.times[i], lastMainXScale);
  }
  emit("hover", {
    x: event.clientX,
    y: event.clientY,
    text: tooltipText(hoverInfo.build(i, props.scene.dataset.times, focusLayerId), ["main"])
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
</script>

<template>
  <section class="panel panel--main-stream">
    <div class="main-stream-header">
      <h2>Main Stream</h2>
    </div>
    <div v-if="legendEntries.length > 0" class="main-stream-legend" aria-label="State color legend">
      <span v-for="entry in legendEntries" :key="entry.key" class="main-stream-legend__item">
        <span class="main-stream-legend__swatch" :style="{ backgroundColor: entry.color }" />
        <span class="main-stream-legend__label">{{ entry.label }}</span>
      </span>
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
