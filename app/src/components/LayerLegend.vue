<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, ChevronUp, Layers3, RotateCcw, X } from "@lucide/vue";
import { colorForLayer } from "braided-stream";
import type { WorkspaceState } from "../composables/useWorkspace";

const props = defineProps<{ model: WorkspaceState; colors: Record<string, string> }>();
const emit = defineEmits<{ save: [] }>();
const palettes = { reference: "Reference", tableau10: "Tableau 10", set2: "Set 2", paired: "Paired" };
const ids = computed(() => {
  const { result, sort } = props.model;
  return !result ? [] : sort === "tpid" ? result.pid.ranking : result.layoutOrder;
});
function color(id: string) { return colorForLayer(props.model.data?.layers ?? [], id, props.colors, props.model.appearance.palette); }
function reset(id: string) { delete props.model.appearance.colors[`${props.model.datasetId}:${id}`]; emit("save"); }
</script>

<template>
  <aside v-show="model.legendVisible" id="legend" class="legend" :class="{ 'is-minimized': model.legendMinimized }" aria-label="Layer legend">
    <header class="legend-header">
      <div class="legend-title"><Layers3 :size="16" aria-hidden="true" /><h2>Legend</h2><span class="legend-count">{{ ids.length }}</span></div>
      <div class="legend-actions">
        <button class="legend-icon-button" type="button" :aria-label="model.legendMinimized ? 'Restore legend' : 'Minimize legend'" :title="model.legendMinimized ? 'Expand legend' : 'Collapse legend'" :aria-expanded="!model.legendMinimized" aria-controls="legend-details" @click="model.legendMinimized = !model.legendMinimized">
          <ChevronDown v-if="model.legendMinimized" :size="16" aria-hidden="true" /><ChevronUp v-else :size="16" aria-hidden="true" />
        </button>
        <button class="legend-icon-button" type="button" aria-label="Hide legend" title="Hide legend" @click="model.legendVisible = false"><X :size="16" aria-hidden="true" /></button>
      </div>
    </header>

    <div v-show="!model.legendMinimized" id="legend-details" class="legend-details">
      <div class="legend-tools">
        <label for="ctl-legend-sort">Order
          <span class="legend-field"><select id="ctl-legend-sort" v-model="model.sort"><option value="tpid">TPID ranking</option><option value="category">Category A–Z</option></select><ChevronDown :size="14" aria-hidden="true" /></span>
        </label>
        <label for="ctl-legend-palette">Palette
          <span class="legend-field"><select id="ctl-legend-palette" v-model="model.appearance.palette" @change="$emit('save')"><option v-for="(label, id) in palettes" :key="id" :value="id">{{ label }}</option></select><ChevronDown :size="14" aria-hidden="true" /></span>
        </label>
      </div>
    </div>

    <div class="legend-list" aria-label="Layers">
      <div v-for="id in ids" :key="id" class="legend-item" :class="{ 'is-selected': model.selectedLayer === id }" :style="{ '--layer-color': color(id) }">
        <div class="legend-swatch">
          <span v-if="model.legendMinimized" class="legend-dot" aria-hidden="true" />
          <input v-else class="legend-color" type="color" :value="color(id)" :aria-label="`Color for ${id}`" :title="`Change color for ${id}`" @input="model.appearance.colors[`${model.datasetId}:${id}`] = ($event.target as HTMLInputElement).value" @change="$emit('save')" />
        </div>
        <button class="legend-select" type="button" :title="id" :aria-label="`Focus layer ${id}`" :aria-pressed="model.selectedLayer === id" @click="model.selectedLayer = model.selectedLayer === id ? null : id">
          <span class="legend-name">{{ id }}</span>
          <span v-if="!model.legendMinimized" class="legend-meta">
            <template v-if="model.result?.pid.defined"><span>TPID #{{ model.result.pid.ranking.indexOf(id) + 1 }}</span><span class="legend-depth">{{ model.result.pid.depth[id].toFixed(6) }}</span></template>
            <template v-else>TPID undefined</template>
          </span>
        </button>
        <button v-if="!model.legendMinimized && Object.hasOwn(colors, id)" class="legend-icon-button legend-reset" type="button" :aria-label="`Reset ${id} to the selected palette`" :title="`Reset ${id} color`" @click="reset(id)"><RotateCcw :size="14" aria-hidden="true" /></button>
      </div>
      <p v-if="!ids.length" class="legend-empty">{{ model.loading ? 'Loading layers…' : 'No layers to display' }}</p>
    </div>

    <footer v-if="!model.legendMinimized" class="legend-footer">
      <span v-if="model.status" class="legend-status" role="status">{{ model.status }}</span>
      <span v-else>Click a layer to focus · Click again to clear</span>
    </footer>
  </aside>
</template>

<style scoped>
.legend {
  position: absolute;
  inset: 16px 16px auto auto;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: min(304px, calc(100% - 32px));
  max-height: calc(100% - 32px);
  min-width: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
  color: var(--ink);
  background: var(--background);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 12px 32px -12px var(--shadow-color);
  font-size: var(--font-small);
  line-height: 1.5;
  transition: width 160ms ease;
}
.legend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 8px;
  padding: 12px 12px 10px 16px;
}
.legend-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.legend-title > svg { flex: 0 0 auto; color: var(--muted); }
.legend-title h2 { margin: 0; font-size: var(--font-small); font-weight: var(--font-weight-emphasis); letter-spacing: -.015em; }
.legend-count { padding: 1px 6px; border-radius: 5px; background: var(--surface-subtle); color: var(--muted); font-size: var(--font-small); font-variant-numeric: tabular-nums; }
.legend-actions { display: flex; align-items: center; gap: 2px; }
.legend-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.legend-icon-button:hover { background: var(--surface-subtle); color: var(--ink); }
.legend-icon-button:active { background: var(--line); }
.legend :is(button, select, input):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.legend-details { flex: 0 0 auto; padding: 0 16px 12px; border-bottom: 1px solid var(--surface-subtle); }
.legend-tools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.legend-tools label { display: grid; gap: 5px; min-width: 0; font-size: var(--font-small); font-weight: var(--font-weight-regular); color: var(--muted); }
.legend-field { position: relative; display: flex; min-width: 0; }
.legend-field select { appearance: none; width: 100%; min-width: 0; height: 32px; padding: 0 28px 0 10px; overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-subtle); color: var(--ink); font-size: var(--font-small); cursor: pointer; }
.legend-field select:hover { border-color: var(--line); }
.legend-field > svg { position: absolute; right: 9px; top: 9px; pointer-events: none; color: var(--muted); }
.legend-note { margin: 10px 0 0; font-size: var(--font-small); color: var(--muted); }
.legend-list { flex: 0 1 auto; min-height: 32px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line) transparent; padding: 8px; }
.legend-item { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; column-gap: 6px; min-width: 0; padding: 3px 5px; border: 1px solid transparent; border-radius: 8px; }
.legend-item + .legend-item { margin-top: 2px; }
.legend-item:hover { background: var(--surface-subtle); }
.legend-item.is-selected { border-color: var(--accent); background: var(--accent-soft); }
.legend-swatch { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; }
.legend-color { appearance: none; display: block; width: 24px; height: 24px; min-width: 0; padding: 0; overflow: hidden; border: 0; border-radius: 5px; background: transparent; cursor: pointer; }
.legend-color::-webkit-color-swatch-wrapper { padding: 0; }
.legend-color::-webkit-color-swatch { border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); border-radius: 5px; }
.legend-color::-moz-color-swatch { border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); border-radius: 5px; }
.legend-select { display: flex; flex-direction: column; justify-content: center; gap: 1px; width: 100%; min-width: 0; min-height: 44px; padding: 4px 0; border: 0; border-radius: 4px; background: transparent; color: var(--ink); text-align: left; }
.legend-select:hover, .legend-select:active { background: transparent; color: var(--ink); }
.legend-item.is-selected .legend-name { font-weight: var(--font-weight-emphasis); color: var(--ink); }
.legend-name { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-small); font-weight: var(--font-weight-regular); }
.legend-meta { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; color: var(--muted); font-size: var(--font-small); font-variant-numeric: tabular-nums; }
.legend-depth { color: var(--muted); }
.legend-reset { width: 24px; height: 24px; }
.legend-footer { flex: 0 0 auto; padding: 10px 16px; border-top: 1px solid var(--surface-subtle); color: var(--muted); font-size: var(--font-small); overflow-wrap: anywhere; }
.legend-status { color: var(--muted); }
.legend-empty { margin: 6px 8px; color: var(--muted); }
.legend.is-minimized { width: min(216px, calc(100% - 32px)); }
.legend.is-minimized .legend-header { padding-bottom: 6px; }
.legend.is-minimized .legend-list { padding-top: 0; }
.legend.is-minimized .legend-select { min-height: 30px; padding-block: 3px; }
.legend-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--layer-color); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent); }
@container (max-width: 400px) {
  .legend { inset: 12px 12px auto auto; width: min(280px, calc(100% - 24px)); max-height: calc(100% - 24px); }
  .legend.is-minimized { width: min(200px, calc(100% - 24px)); }
}
@container (max-width: 260px) {
  .legend-header { flex-wrap: wrap; }
  .legend-tools { grid-template-columns: minmax(0, 1fr); }
  .legend-title { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .legend { transition: none; } }
</style>
