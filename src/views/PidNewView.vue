<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { SineStreamHooks } from "../core/baseline";
import { buildPidNewScene } from "../core/pid";
import type { PreparedDataset, ROI } from "../core/types";
import {
  getPidNewHoverPayload,
  renderPidNewChart,
  renderPidNewEmpty,
  type PidNewChartState
} from "../render/pidNewChart";
import type { AppState } from "../state/appState";

const props = defineProps<{
  dataset: PreparedDataset | null;
  roi: ROI | null;
  state: AppState;
}>();

const emit = defineEmits<{
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);
let currentRender: PidNewChartState | null = null;

onMounted(() => {
  renderChart();
});

watch(
  () => [
    props.dataset,
    props.roi,
    props.state.pidBaselineMode,
    props.state.pidUncertaintySource,
    props.state.optimization.baselineUncertaintyWeight,
    props.state.optimization.wiggleWeightL1,
    props.state.optimization.wiggleWeightL2,
    props.state.optimization.centerAnchorWeight,
    props.state.optimization.irlsIterations,
    props.state.optimization.irlsEps,
    props.state.optimization.baselineCenterType
  ],
  () => {
    renderChart();
  },
  { deep: true }
);

function renderChart(): void {
  if (!svgRef.value) {
    return;
  }
  emit("hover", null);
  currentRender = null;

  const dataset = props.dataset;
  if (!dataset) {
    renderPidNewEmpty(svgRef.value);
    return;
  }

  const scene = buildPidNewScene({
    dataset,
    roi: props.roi,
    baselineMode: props.state.pidBaselineMode,
    baselineHooks: baselineHooksFromState(props.state),
    uncertaintyStrength: props.state.optimization.baselineUncertaintyWeight ?? 0.45,
    uncertaintySource: props.state.pidUncertaintySource
  });

  if (!scene) {
    renderPidNewEmpty(svgRef.value);
    return;
  }

  currentRender = renderPidNewChart(svgRef.value, scene, props.state.pidBaselineMode);
}

function onMouseMove(event: MouseEvent): void {
  if (!svgRef.value || !currentRender) {
    emit("hover", null);
    return;
  }
  emit("hover", getPidNewHoverPayload(svgRef.value, event, currentRender));
}

function onMouseLeave(): void {
  emit("hover", null);
}

function baselineHooksFromState(state: AppState): SineStreamHooks {
  return {
    centerType: state.optimization.baselineCenterType ?? "median",
    wiggleWeightL1: state.optimization.wiggleWeightL1,
    wiggleWeightL2: state.optimization.wiggleWeightL2,
    centerAnchorWeight: state.optimization.centerAnchorWeight,
    irlsIterations: state.optimization.irlsIterations,
    irlsEps: state.optimization.irlsEps
  };
}

defineExpose({
  getPidNewSvg: () => svgRef.value
});
</script>

<template>
  <section>
    <svg
      ref="svgRef"
      id="pid-new-chart"
      preserveAspectRatio="xMidYMid meet"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    />
  </section>
</template>
