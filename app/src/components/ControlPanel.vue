<script setup lang="ts">
import type { WorkspaceState } from "../composables/useWorkspace";
import { Upload } from "@lucide/vue";
defineProps<{ model: WorkspaceState }>();
defineEmits<{ download: []; import: []; clearImport: [] }>();
const localTcm = __LOCAL_TCM__;
const toggles = [
  ["smoothContours", "smooth", "Smooth contours", false],
  ["showEnvelopeStroke", "envelope-stroke", "Show envelope stroke", false],
  ["showRepresentativeStroke", "representative-stroke", "Show representative layer stroke", false],
  ["showTimeCell", "time-cell", "Show time cell", true],
  ["showBranchStroke", "branch-stroke", "Show branch stroke", true],
  ["showYAxis", "y-axis", "Show y-axis", false],
  ["showDensityGradient", "density-gradient", "Density color gradient", true],
] as const;
</script>

<template>
  <aside id="panel" class="panel" :class="{ collapsed: model.panelCollapsed }">
    <button class="panel-toggle" title="Toggle panel" @click="model.panelCollapsed = !model.panelCollapsed">{{ model.panelCollapsed ? '»' : '«' }}</button>
    <div class="panel-body">
      <div class="brand" aria-label="BraidedStream"><span class="brand-name">BraidedStream</span></div>
      <div class="p-title">Controls</div>
      <label>Dataset
        <select id="ctl-dataset" v-model="model.datasetId">
          <option value="illustration">Illustration ensembles</option>
          <option v-if="localTcm" value="tcm">TCM prescriptions (local only)</option>
          <option value="covid-inc">COVID-inc</option>
          <option v-if="model.customAvailable" value="custom">{{ model.customName }}</option>
        </select>
      </label>
      <button id="btn-import" class="import-entry" type="button" @click="$emit('import')"><Upload :size="15" />Import your data<span>CSV · XLSX · JSON</span></button>
      <div v-if="model.datasetId === 'custom'" class="custom-data-note"><span>This session only</span><button type="button" @click="$emit('clearImport')">Remove data</button></div>
      <label>Vis method
        <select id="ctl-vis-method" v-model="model.visMethod">
          <option value="streamgraph">Streamgraph</option><option value="braided">Braided stream</option>
        </select>
      </label>
      <label>Baseline
        <select id="ctl-baseline" v-model="model.baseline"><option value="wiggle">L2 wiggle</option><option value="sine">Sine (Gaussian L2)</option></select>
      </label>
      <label>KDE bandwidth control
        <input id="ctl-bandwidth-ratio" v-model.number="model.bandwidthRatio" type="range" min="0.1" max="1.5" step="0.05" />
      </label>
      <label v-for="[key, id, label, braidedOnly] in toggles" :key="key" class="chk">
        <input :id="`ctl-${id}`" v-model="model[key]" type="checkbox" :disabled="braidedOnly && model.visMethod !== 'braided'" />{{ label }}
      </label>
      <label class="chk"><input id="ctl-legend" v-model="model.legendVisible" type="checkbox" />Show legend</label>
      <div class="actions">
        <button id="btn-svg" :disabled="!model.result" @click="$emit('download')">SVG</button>
      </div>
    </div>
  </aside>
</template>
