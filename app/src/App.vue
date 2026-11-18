<script setup lang="ts">
import { useWorkspace } from "./composables/useWorkspace";
import ControlPanel from "./components/ControlPanel.vue";
import ChartHost from "./components/ChartHost.vue";
import LayerLegend from "./components/LayerLegend.vue";
import ChartTooltip from "./components/ChartTooltip.vue";
import { defineAsyncComponent, ref } from "vue";

const { model, colors, chartOptions, analysisOptions, save, acceptImport, clearImport } = useWorkspace();
const chart = ref<InstanceType<typeof ChartHost>>();
const importOpen = ref(false);
const ImportDataDialog = defineAsyncComponent(() => import("./components/ImportDataDialog.vue"));
</script>

<template>
  <div class="layout">
    <ControlPanel :model="model" @download="chart?.download()" @import="importOpen = true" @clear-import="clearImport" />
    <main class="content">
      <ChartHost ref="chart" :model="model" :options="chartOptions">
        <LayerLegend :model="model" :colors="colors" @save="save" />
      </ChartHost>
      <ChartTooltip :model="model" />
      <div id="costs" class="costs" role="status">
        <template v-if="model.error">{{ model.error }}</template>
        <template v-else-if="model.loading">Loading data…</template>
        <template v-else-if="model.computing"><span class="analysis-spinner" aria-hidden="true" />Calculating layout on this device…</template>
        <template v-else><b>recompute</b> in {{ model.perfMs.toFixed(1) }} ms</template>
      </div>
    </main>
    <ImportDataDialog v-if="importOpen" :options="analysisOptions" :sort="model.sort" @import="acceptImport" @close="importOpen = false" />
  </div>
</template>
