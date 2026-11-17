<script setup lang="ts">
import { useWorkspace } from "./composables/useWorkspace";
import ControlPanel from "./components/ControlPanel.vue";
import ChartHost from "./components/ChartHost.vue";
import LayerLegend from "./components/LayerLegend.vue";
import ChartTooltip from "./components/ChartTooltip.vue";
import { ref } from "vue";

const { model, colors, chartOptions, save } = useWorkspace();
const chart = ref<InstanceType<typeof ChartHost>>();
</script>

<template>
  <div class="layout">
    <ControlPanel :model="model" @download="chart?.download()" />
    <main class="content">
      <ChartHost ref="chart" :model="model" :options="chartOptions" />
      <ChartTooltip :model="model" />
      <div id="costs" class="costs" role="status">
        <template v-if="model.error">{{ model.error }}</template>
        <template v-else-if="model.loading">Loading data…</template>
        <template v-else><b>recompute</b> in {{ model.perfMs.toFixed(1) }} ms</template>
      </div>
    </main>
    <LayerLegend :model="model" :colors="colors" @save="save" />
  </div>
</template>
