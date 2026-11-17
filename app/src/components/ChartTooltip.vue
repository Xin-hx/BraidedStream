<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceState } from "../composables/useWorkspace";
import { tooltipRows } from "../lib/tooltip";
const props = defineProps<{ model: WorkspaceState }>();
const detail = computed(() => {
  const { hover, data, result, datasetId } = props.model;
  if (!hover || !data || !result) return null;
  const { timeIndex: t, layerId, spaceKind, sourceEvent } = hover;
  return {
    title: `${data.dataset.times[t]}${layerId ? ` · ${layerId}` : ''}`,
    rows: layerId ? tooltipRows(result, t, layerId, datasetId, data.sampleSize[layerId]?.[t], spaceKind) : [],
    left: `${Math.max(8, Math.min(sourceEvent.clientX + 14, window.innerWidth - 320))}px`,
    top: `${Math.max(8, Math.min(sourceEvent.clientY + 14, window.innerHeight - 250))}px`,
  };
});
</script>

<template>
  <div id="tooltip" class="tooltip" :class="{ hidden: !detail }" :style="detail ? { left: detail.left, top: detail.top } : {}">
    <template v-if="detail">
      <div class="tt-title">{{ detail.title }}</div>
      <div v-if="!detail.rows.length">no layer under cursor (corridor gap)</div>
      <div v-for="[key, value] in detail.rows" :key="key" class="tt-row"><span class="k">{{ key }}</span><span class="v">{{ value }}</span></div>
    </template>
  </div>
</template>
