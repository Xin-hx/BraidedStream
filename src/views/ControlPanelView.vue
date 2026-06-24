<script setup lang="ts">
import type { AppState } from "../state/appState";
import OptimizingVariantControls from "./OptimizingVariantControls.vue";

interface SpaghettiStateOption {
  id: string;
  label: string;
  total: number;
}

withDefaults(defineProps<{
  state: AppState;
  availableStateOptions: SpaghettiStateOption[];
  defaultSpaghettiStateId: string | null;
  effectiveSpaghettiStateIds: string[];
  showDatasetControls?: boolean;
  showActionControls?: boolean;
  showCompareToggle?: boolean;
}>(), {
  showDatasetControls: true,
  showActionControls: true,
  showCompareToggle: true
});

const emit = defineEmits<{
  (e: "dataset-change"): void;
  (e: "toggle-compare"): void;
  (e: "controls-change"): void;
  (e: "clear-roi"): void;
  (e: "export-svg"): void;
  (e: "export-png"): void;
  (e: "export-json"): void;
  (e: "update:spaghetti-selected-states", value: string[]): void;
}>();

function onControlsChange(): void {
  emit("controls-change");
}

function onSpaghettiSelectionChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const selected = Array.from(target.selectedOptions).map((option) => option.value);
  emit("update:spaghetti-selected-states", selected);
  emit("controls-change");
}
</script>

<template>
  <section class="controls">
    <div v-if="showDatasetControls" class="control-group control-group--global">
      <div class="control-group__title">Global / Dataset</div>
      <div class="control-group__items">
        <label>
          Dataset
          <select v-model="state.datasetKind" @change="emit('dataset-change')">
            <option value="synthetic">synthetic</option>
            <option value="covid">Covid Ensemble</option>
            <option value="sineBank">Sine Bank</option>
            <option value="dataGenerator">Data Generator</option>
          </select>
        </label>
        <label v-if="state.datasetKind === 'dataGenerator'">
          layers cnt
          <input v-model.number="state.generatorLayerCount" type="number" step="1" min="1" @change="emit('dataset-change')" />
        </label>
        <label v-if="state.datasetKind === 'dataGenerator'">
          time cnt
          <input v-model.number="state.generatorTimeCount" type="number" step="1" min="2" @change="emit('dataset-change')" />
        </label>
        <span class="control-inline-note">seed={{ state.fixedSeed }}</span>
        
      </div>
    </div>

    <OptimizingVariantControls
      v-if="state.enhanceTab === 'optimize'"
      :state="state"
      target="current"
      @controls-change="onControlsChange"
    />

    <div v-if="state.enhanceTab === 'braided'" class="control-group control-group--uncertainty">
      <div class="control-group__title">Braiding Controls</div>
      <div class="control-group__items">
        <label>
          Uncertainty Band
          <select v-model="state.covidUncertaintyBand" @change="onControlsChange">
            <option value="95">95% spread (q97.5-q2.5)</option>
            <option value="50">IQR (q75-q25)</option>
          </select>
        </label>

        <label class="checkbox">
          <input v-model="state.enableUncertaintyGap" type="checkbox" @change="onControlsChange" />
          Enable uncertainty gap
        </label>

        <label>
          Gap Mode
          <select v-model="state.gapMode" @change="onControlsChange">
            <option value="uncGap">uncGap</option>
            <option value="fixedGap">fixedGap</option>
            <option value="none">none</option>
          </select>
        </label>

        <label>
          gapAlphaPx
          <input v-model.number="state.gapAlphaPx" type="number" step="0.1" min="0" @change="onControlsChange" />
        </label>

        <label>
          maxExtraHeightPx
          <input v-model.number="state.maxExtraHeightPx" type="number" step="1" min="1" @change="onControlsChange" />
        </label>

        <label>
          spacingBudgetPx
          <input v-model.number="state.optimization.spacingBudgetPx" type="number" step="1" min="1" @change="onControlsChange" />
        </label>

        <label>
          uncertaintyWeight
          <input
            v-model.number="state.optimization.spacingUncertaintyWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>

        <label>
          slopeWeight
          <input
            v-model.number="state.optimization.spacingSlopeWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>

        <label>
          temporalSmoothWeight
          <input
            v-model.number="state.optimization.spacingTemporalWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>

        <label>
          spacingIterations
          <input v-model.number="state.optimization.spacingIterations" type="number" step="1" min="1" @change="onControlsChange" />
        </label>

        <label class="checkbox">
          <input v-model="state.assertEnabled" type="checkbox" @change="onControlsChange" />
          Dev Assertions
        </label>
      </div>
    </div>

    <div v-if="state.enhanceTab === 'spaghetti'" class="control-group">
      <div class="control-group__title">Spaghetti Controls</div>
      <div class="control-group__items">
        <label class="checkbox">
          <input v-model="state.spaghettiAllStates" type="checkbox" @change="onControlsChange" />
          All states
        </label>

        <label v-if="!state.spaghettiAllStates" class="spaghetti-select-label">
          States
          <select
            multiple
            size="10"
            class="spaghetti-select"
            :value="effectiveSpaghettiStateIds"
            @change="onSpaghettiSelectionChange"
          >
            <option v-for="option in availableStateOptions" :key="option.id" :value="option.id">
              {{ option.label }} (total={{ option.total.toFixed(0) }})
            </option>
          </select>
        </label>

        <span class="control-inline-note">
          default state={{ defaultSpaghettiStateId ? defaultSpaghettiStateId.split('|')[0] : "N/A" }}
        </span>
      </div>
    </div>

    <div v-if="showActionControls" class="control-group control-group--actions">
      <div class="control-group__title">ROI / Export</div>
      <div class="control-group__items">
        <button type="button" @click="emit('clear-roi')">Reset Windows</button>
        <button type="button" @click="emit('export-svg')">Export SVG</button>
        <button type="button" @click="emit('export-png')">Export PNG</button>
        <button type="button" @click="emit('export-json')">Export JSON</button>
      </div>
    </div>

    <button
      v-if="showCompareToggle && state.enhanceTab === 'optimize'"
      type="button"
      class="metrics-toggle"
      @click="emit('toggle-compare')"
    >
      {{ state.compareExpanded ? "Close Compare" : "Compare" }}
    </button>
  </section>
</template>
