<script setup lang="ts">
import { computed } from "vue";
import { optimizingBaselineModeLabel, orderingScoringLabel } from "../../optimizingConfig";
import type { AppState } from "../../state/appState";
import type {
  BaselineCenterType,
  OptimizingBaselineMode,
  OptimizingStage,
  OrderingScoringMode,
  OrderWeightType,
  PidUncertaintySource
} from "../../core/types";

const props = defineProps<{
  state: AppState;
  target: "current" | "compare";
}>();

const emit = defineEmits<{
  (e: "controls-change"): void;
}>();

const isCompare = computed(() => props.target === "compare");

const optimizingStage = computed<OptimizingStage>({
  get: () => (isCompare.value ? props.state.compare.optimizingStage : props.state.optimizingStage),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.optimizingStage = value;
    } else {
      props.state.optimizingStage = value;
    }
  }
});

const orderingScoringMode = computed<OrderingScoringMode>({
  get: () => (isCompare.value ? props.state.compare.orderingScoringMode : props.state.orderingScoringMode),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.orderingScoringMode = value;
    } else {
      props.state.orderingScoringMode = value;
    }
  }
});

const baselineMode = computed<OptimizingBaselineMode>({
  get: () => (isCompare.value ? props.state.compare.baselineMode : props.state.optimizingBaselineMode),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.baselineMode = value;
    } else {
      props.state.optimizingBaselineMode = value;
    }
  }
});

const pidUncertaintySource = computed<PidUncertaintySource>({
  get: () => (isCompare.value ? props.state.compare.pidUncertaintySource : props.state.pidUncertaintySource),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.pidUncertaintySource = value;
    } else {
      props.state.pidUncertaintySource = value;
    }
  }
});

const pidTimeAlpha = computed<number>({
  get: () => (isCompare.value ? props.state.compare.pidTimeAlpha : props.state.pidTimeAlpha),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.pidTimeAlpha = value;
    } else {
      props.state.pidTimeAlpha = value;
    }
  }
});

const baselineCenterType = computed<BaselineCenterType>({
  get: () =>
    isCompare.value ? props.state.compare.baselineCenterType : props.state.optimization.baselineCenterType ?? "median",
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.baselineCenterType = value;
    } else {
      props.state.optimization.baselineCenterType = value;
    }
  }
});

const baselineUncertaintyWeight = computed<number>({
  get: () =>
    isCompare.value
      ? props.state.compare.baselineUncertaintyWeight
      : props.state.optimization.baselineUncertaintyWeight ?? 0.45,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.baselineUncertaintyWeight = value;
    } else {
      props.state.optimization.baselineUncertaintyWeight = value;
    }
  }
});

const multiscaleEnergyThreshold = computed<number>({
  get: () =>
    isCompare.value
      ? props.state.compare.multiscaleEnergyThreshold
      : props.state.optimization.multiscaleEnergyThreshold ?? 0.08,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.multiscaleEnergyThreshold = value;
    } else {
      props.state.optimization.multiscaleEnergyThreshold = value;
    }
  }
});

const wiggleWeightL1 = computed<number>({
  get: () => (isCompare.value ? props.state.compare.wiggleWeightL1 : props.state.optimization.wiggleWeightL1),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.wiggleWeightL1 = value;
    } else {
      props.state.optimization.wiggleWeightL1 = value;
    }
  }
});

const wiggleWeightL2 = computed<number>({
  get: () => (isCompare.value ? props.state.compare.wiggleWeightL2 : props.state.optimization.wiggleWeightL2),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.wiggleWeightL2 = value;
    } else {
      props.state.optimization.wiggleWeightL2 = value;
    }
  }
});

const centerAnchorWeight = computed<number>({
  get: () => (isCompare.value ? props.state.compare.centerAnchorWeight : props.state.optimization.centerAnchorWeight),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.centerAnchorWeight = value;
    } else {
      props.state.optimization.centerAnchorWeight = value;
    }
  }
});

const irlsIterations = computed<number>({
  get: () => (isCompare.value ? props.state.compare.irlsIterations : props.state.optimization.irlsIterations),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.irlsIterations = value;
    } else {
      props.state.optimization.irlsIterations = value;
    }
  }
});

const irlsEps = computed<number>({
  get: () => (isCompare.value ? props.state.compare.irlsEps : props.state.optimization.irlsEps),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.irlsEps = value;
    } else {
      props.state.optimization.irlsEps = value;
    }
  }
});

const sineOrderWeightType = computed<OrderWeightType>({
  get: () => (isCompare.value ? props.state.compare.sineOrderWeightType : props.state.optimization.orderWeightType ?? "max"),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.sineOrderWeightType = value;
    } else {
      props.state.optimization.orderWeightType = value;
    }
  }
});

const sineOrderUseThicknessWeight = computed<boolean>({
  get: () =>
    isCompare.value ? props.state.compare.sineOrderUseThicknessWeight : props.state.optimization.orderUseThicknessWeight !== false,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.sineOrderUseThicknessWeight = value;
    } else {
      props.state.optimization.orderUseThicknessWeight = value;
    }
  }
});

const sineOrderUseLengthWeight = computed<boolean>({
  get: () =>
    isCompare.value ? props.state.compare.sineOrderUseLengthWeight : props.state.optimization.orderUseLengthWeight !== false,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.sineOrderUseLengthWeight = value;
    } else {
      props.state.optimization.orderUseLengthWeight = value;
    }
  }
});

const sineOrderLengthWeightThreshold = computed<number>({
  get: () =>
    isCompare.value ? props.state.compare.sineOrderLengthWeightThreshold : props.state.optimization.orderLengthWeightThreshold ?? 9,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.sineOrderLengthWeightThreshold = value;
    } else {
      props.state.optimization.orderLengthWeightThreshold = value;
    }
  }
});

const clusterAutoCutScale = computed<number>({
  get: () => (isCompare.value ? props.state.compare.clusterAutoCutScale : props.state.optimization.clusterAutoCutScale),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.clusterAutoCutScale = value;
    } else {
      props.state.optimization.clusterAutoCutScale = value;
    }
  }
});

const clusterBoundaryPenalty = computed<number>({
  get: () => (isCompare.value ? props.state.compare.clusterBoundaryPenalty : props.state.optimization.clusterBoundaryPenalty),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.clusterBoundaryPenalty = value;
    } else {
      props.state.optimization.clusterBoundaryPenalty = value;
    }
  }
});

const orderSimilaritySigma = computed<number>({
  get: () => (isCompare.value ? props.state.compare.orderSimilaritySigma : props.state.optimization.orderSimilaritySigma),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.orderSimilaritySigma = value;
    } else {
      props.state.optimization.orderSimilaritySigma = value;
    }
  }
});

const orderMaxSwapPasses = computed<number>({
  get: () => (isCompare.value ? props.state.compare.orderMaxSwapPasses : props.state.optimization.orderMaxSwapPasses),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.orderMaxSwapPasses = value;
    } else {
      props.state.optimization.orderMaxSwapPasses = value;
    }
  }
});

const scourLambdaTurn = computed<number>({
  get: () => (isCompare.value ? props.state.compare.scourLambdaTurn : props.state.optimization.scourLambdaTurn ?? 0.2),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourLambdaTurn = value;
    } else {
      props.state.optimization.scourLambdaTurn = value;
    }
  }
});

const scourRhoSplit = computed<number>({
  get: () => (isCompare.value ? props.state.compare.scourRhoSplit : props.state.optimization.scourRhoSplit ?? 0.05),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourRhoSplit = value;
    } else {
      props.state.optimization.scourRhoSplit = value;
    }
  }
});

const scourEtaHeight = computed<number>({
  get: () => (isCompare.value ? props.state.compare.scourEtaHeight : props.state.optimization.scourEtaHeight ?? 0.01),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourEtaHeight = value;
    } else {
      props.state.optimization.scourEtaHeight = value;
    }
  }
});

const scourBetaBalance = computed<number>({
  get: () => (isCompare.value ? props.state.compare.scourBetaBalance : props.state.optimization.scourBetaBalance ?? 0.1),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourBetaBalance = value;
    } else {
      props.state.optimization.scourBetaBalance = value;
    }
  }
});

const scourMaxDepth = computed<number>({
  get: () => (isCompare.value ? props.state.compare.scourMaxDepth : props.state.optimization.scourMaxDepth ?? 4),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourMaxDepth = value;
    } else {
      props.state.optimization.scourMaxDepth = value;
    }
  }
});

const scourMinGroupSize = computed<number>({
  get: () => (isCompare.value ? props.state.compare.scourMinGroupSize : props.state.optimization.scourMinGroupSize ?? 1),
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourMinGroupSize = value;
    } else {
      props.state.optimization.scourMinGroupSize = value;
    }
  }
});

const scourMovingInterfaceLambda = computed<number>({
  get: () =>
    isCompare.value
      ? props.state.compare.scourMovingInterfaceLambda
      : props.state.optimization.scourMovingInterfaceLambda ?? 0.2,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourMovingInterfaceLambda = value;
    } else {
      props.state.optimization.scourMovingInterfaceLambda = value;
    }
  }
});

const scourMovingInterfaceAnchorWeight = computed<number>({
  get: () =>
    isCompare.value
      ? props.state.compare.scourMovingInterfaceAnchorWeight
      : props.state.optimization.scourMovingInterfaceAnchorWeight ?? 0,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourMovingInterfaceAnchorWeight = value;
    } else {
      props.state.optimization.scourMovingInterfaceAnchorWeight = value;
    }
  }
});

const scourMovingInterfaceWeight = computed<number>({
  get: () =>
    isCompare.value
      ? props.state.compare.scourMovingInterfaceWeight
      : props.state.optimization.scourMovingInterfaceWeight ?? 0.25,
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourMovingInterfaceWeight = value;
    } else {
      props.state.optimization.scourMovingInterfaceWeight = value;
    }
  }
});

const scourMovingInterfaceMode = computed<"symmetric" | "optimized" | "fixed">({
  get: () =>
    isCompare.value
      ? props.state.compare.scourMovingInterfaceMode
      : props.state.optimization.scourMovingInterfaceMode ?? "optimized",
  set: (value) => {
    if (isCompare.value) {
      props.state.compare.scourMovingInterfaceMode = value;
    } else {
      props.state.optimization.scourMovingInterfaceMode = value;
    }
  }
});

const isCustomStage = computed(() => optimizingStage.value === "custom");
const effectiveOrderingMode = computed<OrderingScoringMode>(() => {
  if (optimizingStage.value === "byronWattenberg") {
    return "insideOut";
  }
  if (optimizingStage.value === "bartolomeoHu") {
    return "twoOpt";
  }
  if (optimizingStage.value === "buZhang") {
    return "sineStream";
  }
  if (optimizingStage.value === "ours") {
    return "input";
  }
  return orderingScoringMode.value;
});
const effectiveBaselineMode = computed<OptimizingBaselineMode>(() => {
  if (optimizingStage.value === "byronWattenberg") {
    return "l2";
  }
  if (optimizingStage.value === "bartolomeoHu") {
    return "l1";
  }
  if (optimizingStage.value === "buZhang") {
    return "sineStream";
  }
  if (optimizingStage.value === "ours") {
    return "scour";
  }
  return baselineMode.value;
});
const showPidControls = computed(() =>
  ["intervalInclusion", "pidMean", "pidTimeWeighted"].includes(effectiveOrderingMode.value)
);
const showPidAlpha = computed(() => effectiveOrderingMode.value === "pidTimeWeighted");
const showSineOrderingControls = computed(() => effectiveOrderingMode.value === "sineStream");
const showBaselineCenter = computed(() => ["sineStream", "multiscale"].includes(effectiveBaselineMode.value));
const showMultiscaleControls = computed(() => effectiveBaselineMode.value === "multiscale");
const showScourControls = computed(() => effectiveBaselineMode.value === "scour");
const showL1Controls = computed(() => effectiveBaselineMode.value === "l1");
const showL2Controls = computed(() => effectiveBaselineMode.value === "l2");
const effectiveOrderingLabel = computed(() =>
  optimizingStage.value === "ours" ? "Joint order + baseline" : orderingScoringLabel(effectiveOrderingMode.value)
);
const effectiveBaselineLabel = computed(() =>
  optimizingStage.value === "ours"
    ? "Common-interface joint optimization"
    : optimizingBaselineModeLabel(effectiveBaselineMode.value)
);

function onControlsChange(): void {
  emit("controls-change");
}
</script>

<template>
  <div class="control-group control-group--stage">
    <div class="control-group__title">{{ isCompare ? "Compare Preset" : "Preset" }}</div>
    <div class="control-group__items">
      <label>
        Preset
        <select v-model="optimizingStage" @change="onControlsChange">
          <option value="byronWattenberg">Byron &amp; Wattenberg</option>
          <option value="bartolomeoHu">Bartolomeo &amp; Hu</option>
          <option value="buZhang">Bu &amp; Zhang</option>
          <option value="ours">Ours</option>
          <option value="custom">Customer</option>
        </select>
      </label>

      <div class="effective-summary" aria-label="Effective optimization modes">
        <div class="effective-summary__row">
          <span class="effective-summary__label">Ordering:</span>
          <span class="effective-summary__value">{{ effectiveOrderingLabel }}</span>
        </div>
        <div class="effective-summary__row">
          <span class="effective-summary__label">Baseline:</span>
          <span class="effective-summary__value">{{ effectiveBaselineLabel }}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="control-group control-group--ordering">
    <div class="control-group__title">{{ isCompare ? "Compare Ordering" : "Ordering" }}</div>
    <div class="control-group__items">
      <label v-if="isCustomStage">
        Scoring
        <select v-model="orderingScoringMode" @change="onControlsChange">
          <option value="input">Original order</option>
          <option value="insideOut">Inside-out (late onset)</option>
          <option value="twoOpt">2-opt</option>
          <option value="sineStream">Hierarchy clustering</option>
          <option value="intervalInclusion">One-way inclusion</option>
          <option value="pidMean">PID</option>
          <option value="pidTimeWeighted">PID + time trend</option>
        </select>
      </label>

      <label v-if="showPidControls && state.datasetKind === 'covid'">
        PID Source
        <select v-model="pidUncertaintySource" @change="onControlsChange">
          <option value="value">value</option>
          <option value="poportion">poportion</option>
        </select>
      </label>

      <label v-if="showPidAlpha">
        alpha
        <input v-model.number="pidTimeAlpha" type="range" min="0" max="1" step="0.01" @input="onControlsChange" />
        <span class="control-inline-note">{{ pidTimeAlpha.toFixed(2) }}</span>
      </label>

      <label v-if="showPidControls" class="checkbox">
        <input v-model="state.showContourBoxplot" type="checkbox" @change="onControlsChange" />
        contour boxplot
      </label>

      <label v-if="showPidControls && state.showContourBoxplot">
        boxplot top
        <input
          v-model.number="state.contourBoxplotCentralFraction"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          @input="onControlsChange"
        />
        <span class="control-inline-note">{{ Math.round(state.contourBoxplotCentralFraction * 100) }}%</span>
      </label>

      <label v-if="showPidControls && state.showContourBoxplot">
        mask threshold
        <input
          v-model.number="state.contourBoxplotThreshold"
          type="range"
          min="0.05"
          max="0.95"
          step="0.05"
          @input="onControlsChange"
        />
        <span class="control-inline-note">{{ state.contourBoxplotThreshold.toFixed(2) }}</span>
      </label>

      <label v-if="showPidControls && state.showContourBoxplot">
        yBins
        <input v-model.number="state.contourBoxplotYBins" type="number" step="10" min="24" max="420" @change="onControlsChange" />
      </label>

      <label v-if="showPidControls && state.showContourBoxplot">
        boxplot opacity
        <input
          v-model.number="state.contourBoxplotOpacity"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          @input="onControlsChange"
        />
        <span class="control-inline-note">{{ state.contourBoxplotOpacity.toFixed(2) }}</span>
      </label>

      <label v-if="showSineOrderingControls">
        orderWeightType
        <select v-model="sineOrderWeightType" @change="onControlsChange">
          <option value="max">max</option>
          <option value="arithmetic">arithmetic</option>
          <option value="geometric">geometric</option>
          <option value="harmonic">harmonic</option>
          <option value="median">median</option>
        </select>
      </label>

      <label v-if="showSineOrderingControls" class="checkbox">
        <input v-model="sineOrderUseThicknessWeight" type="checkbox" @change="onControlsChange" />
        thickness weight
      </label>

      <label v-if="showSineOrderingControls" class="checkbox">
        <input v-model="sineOrderUseLengthWeight" type="checkbox" @change="onControlsChange" />
        length weight
      </label>

      <label v-if="showSineOrderingControls">
        lengthThreshold
        <input v-model.number="sineOrderLengthWeightThreshold" type="number" step="1" min="1" @change="onControlsChange" />
      </label>

      <label v-if="showSineOrderingControls">
        clusterAutoCutScale
        <input v-model.number="clusterAutoCutScale" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showSineOrderingControls">
        clusterBoundaryPenalty
        <input v-model.number="clusterBoundaryPenalty" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showSineOrderingControls">
        orderSimilaritySigma
        <input v-model.number="orderSimilaritySigma" type="number" step="0.05" min="0.0001" @change="onControlsChange" />
      </label>

      <label v-if="showSineOrderingControls">
        maxSwapPasses
        <input v-model.number="orderMaxSwapPasses" type="number" step="1" min="1" @change="onControlsChange" />
      </label>
    </div>
  </div>

  <div class="control-group control-group--optimize">
    <div class="control-group__title">{{ isCompare ? "Compare Baseline" : "Baseline" }}</div>
    <div class="control-group__items">
      <label v-if="isCustomStage">
        Baseline Method
        <select v-model="baselineMode" @change="onControlsChange">
          <option value="zero">Zero</option>
          <option value="center">Centered</option>
          <option value="l1">Weighted wiggle (L1 norm)</option>
          <option value="l2">Weighted wiggle (L2 norm)</option>
          <option value="sineStream">Gaussian weighted wiggle</option>
          <option value="multiscale">Multiscale</option>
          <option value="scour">Common-interface joint optimization</option>
        </select>
      </label>

      <label v-if="showMultiscaleControls">
        waveStrength
        <input v-model.number="baselineUncertaintyWeight" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showMultiscaleControls">
        energyThreshold
        <input v-model.number="multiscaleEnergyThreshold" type="number" step="0.01" min="0" max="1" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        lambdaTurn
        <input v-model.number="scourLambdaTurn" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        rhoSplit
        <input v-model.number="scourRhoSplit" type="number" step="0.01" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        etaHeight
        <input v-model.number="scourEtaHeight" type="number" step="0.001" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        betaBalance
        <input v-model.number="scourBetaBalance" type="number" step="0.02" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        maxDepth
        <input v-model.number="scourMaxDepth" type="number" step="1" min="1" max="8" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        minGroupSize
        <input v-model.number="scourMinGroupSize" type="number" step="1" min="1" max="12" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        interfaceMode
        <select v-model="scourMovingInterfaceMode" @change="onControlsChange">
          <option value="optimized">optimized</option>
          <option value="symmetric">symmetric</option>
          <option value="fixed">fixed</option>
        </select>
      </label>

      <label v-if="showScourControls">
        interfaceLambda
        <input v-model.number="scourMovingInterfaceLambda" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        interfaceAnchor
        <input v-model.number="scourMovingInterfaceAnchorWeight" type="number" step="1" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showScourControls">
        interfaceWeight
        <input v-model.number="scourMovingInterfaceWeight" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>

      <label v-if="showBaselineCenter">
        baselineCenterType
        <select v-model="baselineCenterType" @change="onControlsChange">
          <option value="median">median</option>
          <option value="mean">mean</option>
          <option value="geometric">geometric</option>
          <option value="harmonic">harmonic</option>
        </select>
      </label>

      <label v-if="showL1Controls">
        wiggleWeightL1
        <input v-model.number="wiggleWeightL1" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>
      <label v-if="showL2Controls">
        wiggleWeightL2
        <input v-model.number="wiggleWeightL2" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>
      <label v-if="showL1Controls || showL2Controls">
        centerAnchorWeight
        <input v-model.number="centerAnchorWeight" type="number" step="0.05" min="0" @change="onControlsChange" />
      </label>
      <label v-if="showL1Controls">
        irlsIterations
        <input v-model.number="irlsIterations" type="number" step="1" min="1" @change="onControlsChange" />
      </label>
      <label v-if="showL1Controls">
        irlsEps
        <input v-model.number="irlsEps" type="number" step="0.0001" min="0.000000001" @change="onControlsChange" />
      </label>
    </div>
  </div>
</template>
