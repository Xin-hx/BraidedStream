<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { colorForLayer, LAYER_PALETTES, M, W } from "braided-stream";
import type { WorkspaceState } from "../composables/useWorkspace";
const props = defineProps<{ model: WorkspaceState; colors: Record<string, string> }>();
const emit = defineEmits<{ save: [] }>();
const compactWidth = ref("48px");
const ids = computed(() => {
  const { result, legendMinimized, sort } = props.model;
  return !result ? [] : legendMinimized ? [...result.layoutOrder].reverse() : sort === "tpid" ? result.pid.ranking : result.layoutOrder;
});
function color(id: string) { return colorForLayer(props.model.data?.layers ?? [], id, props.colors, props.model.appearance.palette); }
function reset(id: string) { delete props.model.appearance.colors[`${props.model.datasetId}:${id}`]; emit("save"); }
function updateCompactWidth() {
  const chart = document.getElementById("chart") as unknown as SVGSVGElement | null;
  const matrix = chart?.getScreenCTM?.();
  if (!chart || !matrix) return;
  const point = chart.createSVGPoint();
  point.x = W - M.right;
  const right = point.matrixTransform(matrix).x;
  compactWidth.value = `${Math.max(20, document.documentElement.clientWidth - right)}px`;
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  const chart = document.getElementById("chart");
  if (chart && typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(updateCompactWidth); observer.observe(chart); }
});
watch(() => props.model.legendMinimized, updateCompactWidth, { flush: "post" });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <aside id="legend" class="legend" :class="{ 'is-minimized': model.legendMinimized }" :hidden="!model.legendVisible" :style="{ '--legend-compact-width': compactWidth }" aria-label="Layer legend">
    <button class="legend-restore" :hidden="!model.legendMinimized" aria-label="Restore legend" @click="model.legendMinimized = false">«</button>
    <div class="legend-header">
      <strong>Legend</strong>
      <button aria-label="Minimize legend" @click="model.legendMinimized = true">−</button>
      <button aria-label="Hide legend" @click="model.legendVisible = false">×</button>
    </div>
    <div class="legend-tools">
      <label>Order<select id="ctl-legend-sort" v-model="model.sort"><option value="tpid">TPID</option><option value="category">Category (A–Z)</option></select></label>
      <label>Palette<select id="ctl-legend-palette" v-model="model.appearance.palette" @change="$emit('save')"><option v-for="(_, id) in LAYER_PALETTES" :key="id" :value="id">{{ id }}</option></select></label>
    </div>
    <div class="legend-note">{{ model.visMethod === 'braided' && model.showDensityGradient && !model.collapseBranches ? 'Branch color intensity represents KDE density.' : '' }}</div>
    <div class="legend-grid">
      <div v-for="id in ids" :key="id" class="legend-item" :class="{ 'is-selected': model.selectedLayer === id }" :style="{ '--layer-color': color(id) }">
        <input class="legend-color" type="color" :value="color(id)" :aria-label="`Color for ${id}`" @input="model.appearance.colors[`${model.datasetId}:${id}`] = ($event.target as HTMLInputElement).value" @change="$emit('save')" />
        <div class="legend-label">
          <button class="legend-select" :title="id" :aria-label="`Focus layer ${id}`" :aria-pressed="model.selectedLayer === id" @click="model.selectedLayer = model.selectedLayer === id ? null : id"><span class="legend-name">{{ id }}</span></button>
          <span class="legend-meta">{{ model.result?.pid.defined ? `TPID #${model.result.pid.ranking.indexOf(id) + 1} · ${model.result.pid.depth[id].toFixed(6)}` : 'TPID undefined' }}</span>
        </div>
        <button class="legend-reset" :hidden="!Object.hasOwn(colors, id)" :aria-label="`Reset ${id} to the selected palette`" @click="reset(id)">↺</button>
      </div>
    </div>
    <div class="legend-status" aria-live="polite">{{ model.status }}</div>
  </aside>
</template>
