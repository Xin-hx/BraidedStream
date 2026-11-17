<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { select } from "d3";
import { braidedStream, streamTimeFilter, type ChartOptions } from "braided-stream";
import type { WorkspaceState } from "../composables/useWorkspace";
import { exportSvg } from "../lib/export";

const props = defineProps<{ model: WorkspaceState; options: ChartOptions }>();
const svg = ref<SVGSVGElement>();
const filter = ref<SVGSVGElement>();
const chart = braidedStream().on("hover.app", event => { props.model.hover = event; })
  .on("leave.app", () => { props.model.hover = null; });
const overview = streamTimeFilter().on("rangechange.app", ({ start, end }) => {
  props.model.start = start;
  props.model.end = end;
});
const datum = computed(() => props.model.data && props.model.result
  ? { dataset: props.model.data.dataset, result: props.model.result } : null);
function draw() {
  if (!svg.value || !filter.value) return;
  if (!datum.value) { chart.destroy(select(svg.value)); overview.destroy(select(filter.value)); return; }
  select(svg.value).datum(datum.value).call(chart.options(props.options));
}
function drawOverview() {
  if (!filter.value || !datum.value) return;
  const { layers, colorOverrides, palette, start, end } = props.options;
  select(filter.value).datum(datum.value).call(overview.options({ layers, colorOverrides, palette, start, end }));
}
watch(() => [datum.value, props.options], draw, { flush: "post" });
watch(() => [datum.value, props.options.layers, props.options.colorOverrides, props.options.palette, props.options.start, props.options.end], drawOverview, { flush: "post" });
onMounted(() => { draw(); drawOverview(); });
onBeforeUnmount(() => {
  if (svg.value) chart.destroy(select(svg.value));
  if (filter.value) overview.destroy(select(filter.value));
});
defineExpose({ download: () => { if (svg.value) exportSvg(svg.value); } });
</script>

<template>
  <svg id="chart" ref="svg" role="img" aria-label="Braided streamgraph" />
  <svg id="time-filter" ref="filter" role="group" aria-label="Time range filter" />
</template>
