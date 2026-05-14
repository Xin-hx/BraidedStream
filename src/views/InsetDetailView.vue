<script setup lang="ts">
import * as d3 from "d3";
import { computed, onMounted, ref, watch } from "vue";
import type { SceneBuildResult } from "../app/sceneBuilder";
import type { InsetViewMode, StackLayout } from "../core/types";
import type { AppState } from "../state/appState";
import { createHoverInfoResolver, tooltipText, type HoverInfoResolver } from "../interactions/hover";
import { layerIdAtY, pointerToPlot, timeIndexAtPlotX } from "../interactions/hitTest";
import type { PlotArea } from "../render/chartUtils";
import { ContourBoxplotChart } from "../render/contourBoxplotChart";
import { InsetChart } from "../render/insetChart";

const props = defineProps<{
  scene: SceneBuildResult | null;
  state: AppState;
  forcedViewMode?: InsetViewMode | null;
  forcedUncertaintyGap?: boolean | null;
  enableLayerHoverHighlight?: boolean | null;
}>();

const emit = defineEmits<{
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const insetSvg = ref<SVGSVGElement | null>(null);
const contourBoxplotSvg = ref<SVGSVGElement | null>(null);
let insetChart: InsetChart | null = null;
let contourBoxplotChart: ContourBoxplotChart | null = null;
let lastInsetXScale: d3.ScaleLinear<number, number> | null = null;
let lastInsetYScale: d3.ScaleLinear<number, number> | null = null;
let lastInsetTimes: number[] = [];
let lastInsetStartIndex = 0;
let lastInsetPlotArea: PlotArea | null = null;
let hoverInfo: HoverInfoResolver | null = null;

const showContourBoxplot = computed(() => props.scene?.usesPid === true && props.state.showContourBoxplot === true);

onMounted(() => {
  if (insetSvg.value) {
    insetChart = new InsetChart(insetSvg.value);
  }
  if (contourBoxplotSvg.value) {
    contourBoxplotChart = new ContourBoxplotChart(contourBoxplotSvg.value);
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
    props.state.showContourBoxplot,
    props.state.contourBoxplotYBins,
    props.state.contourBoxplotThreshold,
    props.state.contourBoxplotCentralFraction,
    props.state.contourBoxplotOpacity,
    props.forcedViewMode,
    props.forcedUncertaintyGap,
    props.enableLayerHoverHighlight
  ],
  () => {
    renderChart();
  },
  { deep: true }
);

function renderChart(): void {
  if (!props.scene || !insetChart) {
    hoverInfo = null;
    contourBoxplotChart?.clear();
    return;
  }
  hoverInfo = createHoverInfoResolver(props.scene.dataset.layers);
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
  lastInsetPlotArea = result.plotArea;
  if (!props.enableLayerHoverHighlight) {
    insetChart.setLayerHover(null);
  }
  renderContourBoxplot();
}

function renderContourBoxplot(): void {
  if (!contourBoxplotChart) {
    return;
  }
  if (!props.scene || !showContourBoxplot.value) {
    contourBoxplotChart.clear();
    return;
  }
  contourBoxplotChart.render({
    dataset: props.scene.dataset,
    orderedLayers: props.scene.orderedLayers,
    roi: props.scene.insetRoi,
    uncertaintySource: props.scene.pidUncertaintySource ?? props.state.pidUncertaintySource,
    yBins: props.state.contourBoxplotYBins,
    contourThreshold: props.state.contourBoxplotThreshold,
    centralFraction: props.state.contourBoxplotCentralFraction,
    opacity: props.state.contourBoxplotOpacity
  });
}

function onInsetMove(event: MouseEvent): void {
  if (!props.scene || !insetSvg.value || !lastInsetXScale || !lastInsetPlotArea || !hoverInfo) {
    return;
  }
  if (lastInsetTimes.length === 0) {
    return;
  }
  const pointer = pointerToPlot(insetSvg.value, event, lastInsetPlotArea);
  const localIndex = timeIndexAtPlotX(lastInsetTimes, lastInsetXScale, pointer.x);
  const i = lastInsetStartIndex + localIndex;
  const hoverLayout = currentHoverLayout();
  const focusLayerId =
    lastInsetYScale !== null && pointer.insideY
      ? layerIdAtY(
          i,
          lastInsetYScale.invert(pointer.y),
          props.scene.orderedLayers,
          hoverLayout
        )
      : null;
  if (insetChart && lastInsetXScale) {
    insetChart.setHover(props.scene.dataset.times[i], lastInsetXScale);
    if (props.enableLayerHoverHighlight) {
      insetChart.setLayerHover(focusLayerId);
    }
  }
  emit("hover", {
    x: event.clientX,
    y: event.clientY,
    text: tooltipText(hoverInfo.build(i, props.scene.dataset.times, focusLayerId), ["enhanced"])
  });
}

function onLeave(): void {
  if (insetChart) {
    insetChart.setHover(null, null);
    insetChart.setLayerHover(null);
  }
  emit("hover", null);
}

defineExpose({
  getInsetSvg: () => insetSvg.value
});

function currentHoverLayout(): StackLayout {
  if (!props.scene) {
    return { baseline: [], yBottom: [], yTop: [] };
  }
  const mode = props.forcedViewMode ?? props.state.insetViewMode;
  return mode === "before" ? props.scene.baseLayout : props.scene.braidedLayout;
}
</script>

<template>
  <section>
    <svg id="inset-chart" ref="insetSvg" width="1140" height="300" @mousemove="onInsetMove" @mouseleave="onLeave" />
    <svg
      v-show="showContourBoxplot"
      id="contour-boxplot-chart"
      ref="contourBoxplotSvg"
      width="1140"
      height="190"
    />
  </section>
</template>
