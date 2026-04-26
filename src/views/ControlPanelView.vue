<script setup lang="ts">
import type { RoiCandidate } from "../layout/roiRecommend";
import type { AppState } from "../state/appState";

interface SpaghettiStateOption {
  id: string;
  label: string;
  total: number;
}

defineProps<{
  state: AppState;
  recommendList: RoiCandidate[];
  selectedRecommendIndex: number;
  availableStateOptions: SpaghettiStateOption[];
  defaultSpaghettiStateId: string | null;
  effectiveSpaghettiStateIds: string[];
}>();

const emit = defineEmits<{
  (e: "dataset-change"): void;
  (e: "toggle-metrics"): void;
  (e: "controls-change"): void;
  (e: "recommend-roi"): void;
  (e: "apply-recommend-roi"): void;
  (e: "recommend-inset-roi"): void;
  (e: "clear-roi"): void;
  (e: "export-svg"): void;
  (e: "export-png"): void;
  (e: "export-json"): void;
  (e: "update:selected-recommend-index", value: number): void;
  (e: "update:spaghetti-selected-states", value: string[]): void;
}>();

function onControlsChange(): void {
  emit("controls-change");
}

function onCandidateChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit("update:selected-recommend-index", Math.max(0, Number(target.value) || 0));
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
    <div class="control-group control-group--global">
      <div class="control-group__title">Global / Dataset</div>
      <div class="control-group__items">
        <label>
          Dataset
          <select v-model="state.datasetKind" @change="emit('dataset-change')">
            <option value="synthetic">synthetic</option>
            <option value="covid">Covid Ensemble</option>
          </select>
        </label>
        <span class="control-inline-note">seed={{ state.fixedSeed }}</span>
        
      </div>
    </div>

    <div
      v-if="state.enhanceTab === 'optimize' || state.enhanceTab === 'optimizeUncertainty' || state.enhanceTab === 'pidOrdering'"
      class="control-group control-group--optimize"
    >
      <div class="control-group__title">Optimizing</div>
      <div class="control-group__items">
        <label>
          Baseline Method
          <select v-model="state.optimizeMethod" @change="onControlsChange">
            <option value="l1">L1</option>
            <option value="l2">L2</option>
            <option value="sineStream">SineStream</option>
          </select>
        </label>

        <template v-if="state.enhanceTab !== 'pidOrdering'">
        <label class="checkbox">
          <input v-model="state.optimizeWithinROI" type="checkbox" @change="onControlsChange" />
          Optimize within ROI
        </label>

        <label>
          clusterAutoCutScale
          <input v-model.number="state.optimization.clusterAutoCutScale" type="number" step="0.05" min="0" @change="onControlsChange" />
        </label>

        <label>
          clusterBoundaryPenalty
          <input
            v-model.number="state.optimization.clusterBoundaryPenalty"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>

        <label>
          orderSimilaritySigma
          <input
            v-model.number="state.optimization.orderSimilaritySigma"
            type="number"
            step="0.05"
            min="0.0001"
            @change="onControlsChange"
          />
        </label>

        <label>
          orderMaxSwapPasses
          <input v-model.number="state.optimization.orderMaxSwapPasses" type="number" step="1" min="1" @change="onControlsChange" />
        </label>

        <label>
          orderUncertaintyWeight
          <input
            v-model.number="state.optimization.orderUncertaintyWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>

        <label>
          baselineUncertaintyWeight
          <input
            v-model.number="state.optimization.baselineUncertaintyWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>
        </template>
      </div>

      <div v-if="state.optimizeMethod === 'l2'" class="control-group__items">
        <label>
          wiggleWeightL2
          <input v-model.number="state.optimization.wiggleWeightL2" type="number" step="0.05" min="0" @change="onControlsChange" />
        </label>
        <label>
          centerAnchorWeight
          <input
            v-model.number="state.optimization.centerAnchorWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>
      </div>

      <div v-if="state.optimizeMethod === 'l1'" class="control-group__items">
        <label>
          wiggleWeightL1
          <input v-model.number="state.optimization.wiggleWeightL1" type="number" step="0.05" min="0" @change="onControlsChange" />
        </label>
        <label>
          centerAnchorWeight
          <input
            v-model.number="state.optimization.centerAnchorWeight"
            type="number"
            step="0.05"
            min="0"
            @change="onControlsChange"
          />
        </label>
        <label>
          irlsIterations
          <input v-model.number="state.optimization.irlsIterations" type="number" step="1" min="1" @change="onControlsChange" />
        </label>
        <label>
          irlsEps
          <input v-model.number="state.optimization.irlsEps" type="number" step="0.0001" min="0.000000001" @change="onControlsChange" />
        </label>
      </div>

      <div v-if="state.optimizeMethod === 'sineStream'" class="control-group__items">
        <label>
          baselineCenterType
          <select v-model="state.optimization.baselineCenterType" @change="onControlsChange">
            <option value="median">median</option>
            <option value="mean">mean</option>
            <option value="geometric">geometric</option>
            <option value="harmonic">harmonic</option>
          </select>
        </label>
        <template v-if="state.enhanceTab !== 'pidOrdering'">
        <label>
          orderWeightType
          <select v-model="state.optimization.orderWeightType" @change="onControlsChange">
            <option value="max">max</option>
            <option value="arithmetic">arithmetic</option>
            <option value="geometric">geometric</option>
            <option value="harmonic">harmonic</option>
            <option value="median">median</option>
          </select>
        </label>
        <label class="checkbox">
          <input v-model="state.optimization.orderUseThicknessWeight" type="checkbox" @change="onControlsChange" />
          thicknessWeight
        </label>
        <label class="checkbox">
          <input v-model="state.optimization.orderUseLengthWeight" type="checkbox" @change="onControlsChange" />
          lengthWeight
        </label>
        <label>
          lengthThreshold
          <input
            v-model.number="state.optimization.orderLengthWeightThreshold"
            type="number"
            step="1"
            min="1"
            @change="onControlsChange"
          />
        </label>
        </template>
      </div>
    </div>

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

    <div class="control-group control-group--actions">
      <div class="control-group__title">ROI / Export</div>
      <div class="control-group__items">
        <label>
          Recommend ROI
          <select v-model="state.recommendStrategy">
            <option value="highest uncertainty">highest uncertainty</option>
            <option value="highest mean slope">highest mean slope</option>
            <option value="highest wiggle">highest wiggle</option>
            <option value="largest local change">largest local change</option>
          </select>
        </label>

        <button type="button" @click="emit('recommend-roi')">Recommend ROI</button>
        <select :value="selectedRecommendIndex" title="Recommended ROI candidates" @change="onCandidateChange">
          <option
            v-for="(candidate, idx) in recommendList"
            :key="candidate.label + idx"
            :value="idx"
          >
            {{ candidate.label }} score={{ candidate.score.toFixed(2) }}
          </option>
        </select>
        <button type="button" @click="emit('apply-recommend-roi')">Apply Suggested ROI</button>
        <button type="button" @click="emit('recommend-inset-roi')">Recommend Inset ROI</button>
        <button type="button" @click="emit('clear-roi')">Clear ROI</button>
        <button type="button" @click="emit('export-svg')">Export SVG</button>
        <button type="button" @click="emit('export-png')">Export PNG</button>
        <button type="button" @click="emit('export-json')">Export JSON</button>
      </div>
    </div>

    <button type="button" class="metrics-toggle" @click="emit('toggle-metrics')">
          {{ state.metricsExpanded ? "Close Metrics" : "Show Metrics" }}
    </button>
  </section>
</template>
