<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { defaultWindow } from "../app/sceneBuilder";
import { createSyntheticBundle, loadCovidBundle, type DatasetBundle } from "../core/datasets";
import { normalizeROI } from "../core/roi";
import type { DatasetKind, PreparedDataset, ROI } from "../core/types";
import { orderLayers } from "../core/validate";
import { preprocessDataset } from "../data/transforms";
import {
  buildFixedOrder,
  runMultiscaleSearch,
  type MultiscaleCandidateResult,
  type MultiscaleSearchResult,
  type MultiscaleSearchSpace
} from "../layout/multiscaleSearch";
import { createInitialState } from "../state/appState";

interface LabState {
  datasetKind: DatasetKind;
  roiT0: number;
  roiT1: number;
  strengthMin: number;
  strengthMax: number;
  strengthStep: number;
  thresholdMin: number;
  thresholdMax: number;
  thresholdStep: number;
  passThresholdPct: number;
  regressionGuardrailPct: number;
  topN: number;
  centerMedian: boolean;
  centerMean: boolean;
  centerGeometric: boolean;
  centerHarmonic: boolean;
}

const defaults = createInitialState();
const datasetCache = new Map<DatasetKind, DatasetBundle>();

datasetCache.set("synthetic", createSyntheticBundle());

const state = reactive<LabState>({
  datasetKind: "covid",
  roiT0: 0,
  roiT1: 0,
  strengthMin: 0.15,
  strengthMax: 1.2,
  strengthStep: 0.05,
  thresholdMin: 0.04,
  thresholdMax: 0.2,
  thresholdStep: 0.02,
  passThresholdPct: 5,
  regressionGuardrailPct: 3,
  topN: 20,
  centerMedian: true,
  centerMean: true,
  centerGeometric: true,
  centerHarmonic: true
});

const datasetBundle = ref<DatasetBundle | null>(null);
const preparedDataset = ref<PreparedDataset | null>(null);
const fixedOrder = ref<string[]>([]);
const searchResult = ref<MultiscaleSearchResult | null>(null);
const loadingDataset = ref(false);
const runningSearch = ref(false);
const errorText = ref<string | null>(null);
const runTimestamp = ref<string>("");

const selectedCenterTypes = computed(() => {
  const list: Array<"median" | "mean" | "geometric" | "harmonic"> = [];
  if (state.centerMedian) {
    list.push("median");
  }
  if (state.centerMean) {
    list.push("mean");
  }
  if (state.centerGeometric) {
    list.push("geometric");
  }
  if (state.centerHarmonic) {
    list.push("harmonic");
  }
  return list.length > 0 ? list : ["median"];
});

const currentRoi = computed<ROI | null>(() => {
  const dataset = preparedDataset.value;
  if (!dataset) {
    return null;
  }
  return normalizeROI({ t0Index: state.roiT0, t1Index: state.roiT1 }, dataset.times.length);
});

const roiSpanText = computed(() => {
  const roi = currentRoi.value;
  if (!roi) {
    return "N/A";
  }
  return `${roi.t0Index} - ${roi.t1Index} (span=${roi.t1Index - roi.t0Index + 1})`;
});

const candidateCount = computed(() => {
  const centers = selectedCenterTypes.value.length;
  return countValues(state.strengthMin, state.strengthMax, state.strengthStep) *
    countValues(state.thresholdMin, state.thresholdMax, state.thresholdStep) *
    centers;
});

const fixedOrderPreview = computed(() => {
  if (fixedOrder.value.length === 0) {
    return "N/A";
  }
  const preview = fixedOrder.value.slice(0, 8).map((id) => id.split("|")[0]);
  const suffix = fixedOrder.value.length > 8 ? ` ... (+${fixedOrder.value.length - 8})` : "";
  return preview.join(", ") + suffix;
});

const bestCandidate = computed(() => searchResult.value?.best ?? null);

onMounted(async () => {
  await activateDataset(state.datasetKind);
});

async function onDatasetChange(): Promise<void> {
  await activateDataset(state.datasetKind);
  searchResult.value = null;
  runTimestamp.value = "";
}

async function activateDataset(kind: DatasetKind): Promise<void> {
  loadingDataset.value = true;
  errorText.value = null;

  let resolvedKind = kind;
  let bundle: DatasetBundle;

  try {
    bundle = await ensureDataset(kind);
  } catch {
    resolvedKind = "synthetic";
    state.datasetKind = "synthetic";
    bundle = await ensureDataset("synthetic");
  }

  datasetBundle.value = bundle;
  const preprocessed = preprocessDataset(bundle.dataset);
  preparedDataset.value = preprocessed.dataset;

  state.datasetKind = resolvedKind;
  fixedOrder.value = buildFixedOrder(preprocessed.dataset, defaults.optimization, defaults.fixedSeed);
  applyDefaultRoi(preprocessed.dataset);
  loadingDataset.value = false;
}

async function ensureDataset(kind: DatasetKind): Promise<DatasetBundle> {
  if (datasetCache.has(kind)) {
    return datasetCache.get(kind)!;
  }
  const bundle = kind === "covid" ? await loadCovidBundle() : createSyntheticBundle();
  datasetCache.set(kind, bundle);
  return bundle;
}

function applyDefaultRoi(dataset: PreparedDataset): void {
  const roi = defaultWindow(dataset.times.length);
  state.roiT0 = roi.t0Index;
  state.roiT1 = roi.t1Index;
}

function onResetRoi(): void {
  if (!preparedDataset.value) {
    return;
  }
  applyDefaultRoi(preparedDataset.value);
}

function buildSearchSpace(): MultiscaleSearchSpace {
  return {
    baselineUncertaintyWeight: {
      min: state.strengthMin,
      max: state.strengthMax,
      step: state.strengthStep
    },
    energyThreshold: {
      min: state.thresholdMin,
      max: state.thresholdMax,
      step: state.thresholdStep
    },
    centerTypes: selectedCenterTypes.value,
    passThresholdPct: state.passThresholdPct,
    regressionGuardrailPct: state.regressionGuardrailPct,
    topN: state.topN
  };
}

async function onRunSearch(): Promise<void> {
  const dataset = preparedDataset.value;
  if (!dataset) {
    return;
  }

  const normalizedRoi = currentRoi.value ?? defaultWindow(dataset.times.length);
  state.roiT0 = normalizedRoi.t0Index;
  state.roiT1 = normalizedRoi.t1Index;

  runningSearch.value = true;
  errorText.value = null;

  try {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const orderedLayers = orderLayers(dataset.layers, fixedOrder.value);
    const result = runMultiscaleSearch({
      dataset,
      roi: normalizedRoi,
      orderedLayers,
      searchSpace: buildSearchSpace(),
      baseHooks: {
        wiggleWeightL1: defaults.optimization.wiggleWeightL1,
        wiggleWeightL2: defaults.optimization.wiggleWeightL2,
        centerAnchorWeight: defaults.optimization.centerAnchorWeight,
        irlsIterations: defaults.optimization.irlsIterations,
        irlsEps: defaults.optimization.irlsEps
      }
    });
    searchResult.value = result;
    runTimestamp.value = new Date().toISOString();
  } catch (error) {
    searchResult.value = null;
    errorText.value = String(error);
  } finally {
    runningSearch.value = false;
  }
}

function metricPct(candidate: MultiscaleCandidateResult, scope: "roi" | "global", key: "meanSlope" | "wiggle" | "illusion"): string {
  const metric = candidate[scope].metrics.find((item) => item.key === key);
  if (!metric || !Number.isFinite(metric.improvementPct)) {
    return "N/A";
  }
  return `${metric.improvementPct >= 0 ? "+" : ""}${metric.improvementPct.toFixed(2)}%`;
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toFixed(4);
}

function fmtPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtTimestamp(value: string): string {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}

function countValues(minValue: number, maxValue: number, stepValue: number): number {
  const min = Math.min(minValue, maxValue);
  const max = Math.max(minValue, maxValue);
  const step = Math.max(1e-6, Math.abs(stepValue));
  let count = 0;
  for (let value = min; value <= max + step * 1e-6; value += step) {
    count += 1;
    if (count >= 5000) {
      break;
    }
  }
  return Math.max(1, count);
}
</script>

<template>
  <div class="multiscale-lab-page">
    <header class="multiscale-lab-page__header">
      <h1>Multiscale Parameter Lab</h1>
      <p>
        Grid-search `baselineUncertaintyWeight` / `energyThreshold` / `baselineCenterType`,
        ranking by ROI first and guarding global regressions.
      </p>
    </header>

    <section class="panel multiscale-lab-panel">
      <h2>Dataset & ROI</h2>
      <div class="multiscale-lab-grid multiscale-lab-grid--4">
        <label>
          Dataset
          <select v-model="state.datasetKind" :disabled="loadingDataset || runningSearch" @change="onDatasetChange">
            <option value="synthetic">synthetic</option>
            <option value="covid">Covid Ensemble</option>
          </select>
        </label>
        <label>
          ROI start index
          <input v-model.number="state.roiT0" type="number" step="1" min="0" :disabled="loadingDataset || runningSearch" />
        </label>
        <label>
          ROI end index
          <input v-model.number="state.roiT1" type="number" step="1" min="0" :disabled="loadingDataset || runningSearch" />
        </label>
        <button type="button" :disabled="loadingDataset || runningSearch" @click="onResetRoi">Reset ROI</button>
      </div>
      <div class="multiscale-lab-notes">
        <span>ROI: {{ roiSpanText }}</span>
        <span>layers: {{ preparedDataset?.layers.length ?? 0 }}</span>
        <span>time points: {{ preparedDataset?.times.length ?? 0 }}</span>
        <span>fixed order preview: {{ fixedOrderPreview }}</span>
      </div>
    </section>

    <section class="panel multiscale-lab-panel">
      <h2>Search Space</h2>
      <div class="multiscale-lab-grid multiscale-lab-grid--6">
        <label>
          weight min
          <input v-model.number="state.strengthMin" type="number" step="0.01" min="0" :disabled="runningSearch" />
        </label>
        <label>
          weight max
          <input v-model.number="state.strengthMax" type="number" step="0.01" min="0" :disabled="runningSearch" />
        </label>
        <label>
          weight step
          <input v-model.number="state.strengthStep" type="number" step="0.01" min="0.001" :disabled="runningSearch" />
        </label>
        <label>
          threshold min
          <input v-model.number="state.thresholdMin" type="number" step="0.01" min="0" max="1" :disabled="runningSearch" />
        </label>
        <label>
          threshold max
          <input v-model.number="state.thresholdMax" type="number" step="0.01" min="0" max="1" :disabled="runningSearch" />
        </label>
        <label>
          threshold step
          <input v-model.number="state.thresholdStep" type="number" step="0.01" min="0.001" max="1" :disabled="runningSearch" />
        </label>
      </div>

      <div class="multiscale-lab-grid multiscale-lab-grid--3">
        <label>
          pass threshold %
          <input v-model.number="state.passThresholdPct" type="number" step="0.1" min="0" :disabled="runningSearch" />
        </label>
        <label>
          regression guardrail %
          <input v-model.number="state.regressionGuardrailPct" type="number" step="0.1" min="0" :disabled="runningSearch" />
        </label>
        <label>
          top N rows
          <input v-model.number="state.topN" type="number" step="1" min="1" :disabled="runningSearch" />
        </label>
      </div>

      <div class="multiscale-lab-checkbox-row">
        <label class="checkbox">
          <input v-model="state.centerMedian" type="checkbox" :disabled="runningSearch" />
          centerType=median
        </label>
        <label class="checkbox">
          <input v-model="state.centerMean" type="checkbox" :disabled="runningSearch" />
          centerType=mean
        </label>
        <label class="checkbox">
          <input v-model="state.centerGeometric" type="checkbox" :disabled="runningSearch" />
          centerType=geometric
        </label>
        <label class="checkbox">
          <input v-model="state.centerHarmonic" type="checkbox" :disabled="runningSearch" />
          centerType=harmonic
        </label>
      </div>

      <div class="multiscale-lab-actions">
        <button type="button" :disabled="loadingDataset || runningSearch || !preparedDataset" @click="onRunSearch">
          {{ runningSearch ? "Running..." : "Run Grid Search" }}
        </button>
        <span>candidate count={{ candidateCount }}</span>
        <span>last run={{ fmtTimestamp(runTimestamp) }}</span>
      </div>

      <div v-if="errorText" class="multiscale-lab-error">{{ errorText }}</div>
    </section>

    <section v-if="searchResult" class="panel multiscale-lab-panel">
      <h2>Summary</h2>
      <div class="multiscale-lab-notes">
        <span>total={{ searchResult.summary.totalCandidates }}</span>
        <span>pass={{ searchResult.summary.passCount }}</span>
        <span>fail={{ searchResult.summary.failCount }}</span>
      </div>

      <div v-if="bestCandidate" class="multiscale-lab-best">
        <div>
          <strong>Best Params</strong>
          <div>
            centerType={{ bestCandidate.params.baselineCenterType }},
            weight={{ bestCandidate.params.baselineUncertaintyWeight.toFixed(3) }},
            threshold={{ bestCandidate.params.energyThreshold.toFixed(3) }}
          </div>
          <div>
            status={{ bestCandidate.pass ? "PASS" : "FAIL" }},
            fallback={{ bestCandidate.diagnostics.fallbackUsed ? "yes" : "no" }},
            verified={{ bestCandidate.diagnostics.verified ? "yes" : "no" }}
          </div>
        </div>
        <div>
          <strong>Decision Reasons</strong>
          <div class="multiscale-lab-reasons">
            {{ bestCandidate.reasons.join(" | ") }}
          </div>
        </div>
      </div>
    </section>

    <section v-if="searchResult?.topCandidates.length" class="panel multiscale-lab-panel">
      <h2>Top Candidates</h2>
      <table class="multiscale-lab-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Status</th>
            <th>Params</th>
            <th>ROI mean/wiggle/illusion</th>
            <th>Global mean/wiggle/illusion</th>
            <th>Fallback</th>
            <th>Verified</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(candidate, index) in searchResult.topCandidates" :key="candidate.sortKey">
            <td>{{ index + 1 }}</td>
            <td :class="candidate.pass ? 'lab-status-pass' : 'lab-status-fail'">{{ candidate.pass ? "PASS" : "FAIL" }}</td>
            <td>
              c={{ candidate.params.baselineCenterType }},
              w={{ candidate.params.baselineUncertaintyWeight.toFixed(2) }},
              t={{ candidate.params.energyThreshold.toFixed(2) }}
            </td>
            <td>
              {{ metricPct(candidate, "roi", "meanSlope") }} /
              {{ metricPct(candidate, "roi", "wiggle") }} /
              {{ metricPct(candidate, "roi", "illusion") }}
            </td>
            <td>
              {{ metricPct(candidate, "global", "meanSlope") }} /
              {{ metricPct(candidate, "global", "wiggle") }} /
              {{ metricPct(candidate, "global", "illusion") }}
            </td>
            <td>{{ candidate.diagnostics.fallbackUsed ? "yes" : "no" }}</td>
            <td>{{ candidate.diagnostics.verified ? "yes" : "no" }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="bestCandidate" class="panel multiscale-lab-panel">
      <h2>Best Candidate Detail</h2>
      <div class="multiscale-lab-detail-grid">
        <div>
          <h3>ROI Metrics (Sine -&gt; Multiscale)</h3>
          <table class="multiscale-lab-table multiscale-lab-table--compact">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Before</th>
                <th>After</th>
                <th>Delta</th>
                <th>Improve %</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in bestCandidate.roi.metrics" :key="`roi-${metric.key}`">
                <td>{{ metric.label }}</td>
                <td>{{ fmtNumber(metric.before) }}</td>
                <td>{{ fmtNumber(metric.after) }}</td>
                <td>{{ fmtNumber(metric.delta) }}</td>
                <td>{{ fmtPercent(metric.improvementPct) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h3>Global Metrics (Sine -&gt; Multiscale)</h3>
          <table class="multiscale-lab-table multiscale-lab-table--compact">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Before</th>
                <th>After</th>
                <th>Delta</th>
                <th>Improve %</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in bestCandidate.global.metrics" :key="`global-${metric.key}`">
                <td>{{ metric.label }}</td>
                <td>{{ fmtNumber(metric.before) }}</td>
                <td>{{ fmtNumber(metric.after) }}</td>
                <td>{{ fmtNumber(metric.delta) }}</td>
                <td>{{ fmtPercent(metric.improvementPct) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>
