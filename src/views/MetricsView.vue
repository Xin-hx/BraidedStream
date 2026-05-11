<script setup lang="ts">
import { computed } from "vue";
import type { MetricResult } from "../layout/metrics";

const props = defineProps<{
  title: string;
  metrics: MetricResult | null;
  notes: string[];
  spaghettiSummary?: {
    selectedCount: number;
    totalCount: number;
    allSelected: boolean;
    defaultStateLabel: string;
  } | null;
}>();

const invariantText = computed(() => {
  if (!props.metrics) {
    return "N/A";
  }
  const invariant = props.metrics.invariant;
  if (!invariant.checked) {
    return "SKIPPED";
  }
  return invariant.violations.length === 0 ? "PASS" : `FAIL (${invariant.violations.length})`;
});

const multiscaleBandCount = computed(() => props.metrics?.multiscale?.scaleBands.length ?? 0);
const hasGlobalRows = computed(
  () => !!props.metrics?.globalRows && Array.isArray(props.metrics.globalRows) && props.metrics.globalRows.length > 0
);
const scopeText = computed(() => {
  if (!props.metrics) {
    return "N/A";
  }
  if (!hasGlobalRows.value) {
    return props.metrics.scopeText;
  }
  const globalScope = props.metrics.globalScopeText ?? "Global";
  return `${props.metrics.scopeText} + ${globalScope}`;
});

function trendTag(delta: number, better: "up" | "down"): "same" | "improved" | "worse" {
  if (delta === 0) {
    return "same";
  }
  if (better === "down") {
    return delta < 0 ? "improved" : "worse";
  }
  return delta > 0 ? "improved" : "worse";
}

function fmt(v: number, sign = false): string {
  if (!Number.isFinite(v)) {
    return "-";
  }
  if (Math.abs(v) >= 1000) {
    return sign ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1);
  }
  const s = v.toFixed(3);
  return sign ? `${v >= 0 ? "+" : ""}${s}` : s;
}

function pct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value * 100));
}
</script>

<template>
  <section class="panel">
    <div id="metrics">
      <div class="metrics-header">
        <strong>{{ title }}</strong>
        <span>Scope: {{ scopeText }}</span>
        <span>Invariant: {{ invariantText }}</span>
      </div>

      <div v-if="metrics && hasGlobalRows" class="metrics-scope-title">ROI</div>
      <table v-if="metrics">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Compare</th>
            <th>Current</th>
            <th>Delta</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in metrics.rows"
            :key="row.key"
            :class="`metric-${trendTag(row.delta, row.better)}`"
          >
            <td>{{ row.label }}</td>
            <td>{{ fmt(row.before) }}</td>
            <td>{{ fmt(row.after) }}</td>
            <td>{{ fmt(row.delta, true) }}</td>
            <td>{{ trendTag(row.delta, row.better) }}</td>
          </tr>
        </tbody>
      </table>

      <template v-if="metrics && hasGlobalRows">
        <div class="metrics-scope-title">{{ metrics?.globalScopeText ?? "Global" }}</div>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Compare</th>
              <th>Current</th>
              <th>Delta</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in metrics.globalRows"
              :key="`global-${row.key}`"
              :class="`metric-${trendTag(row.delta, row.better)}`"
            >
              <td>{{ row.label }}</td>
              <td>{{ fmt(row.before) }}</td>
              <td>{{ fmt(row.after) }}</td>
              <td>{{ fmt(row.delta, true) }}</td>
              <td>{{ trendTag(row.delta, row.better) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <div v-if="metrics?.multiscale" class="multiscale-summary">
        <div class="multiscale-summary__header">
          <strong>Multiscale Diagnostics</strong>
          <span>method={{ metrics.multiscale.method }}</span>
          <span>verified={{ metrics.multiscale.verified ? "yes" : "no" }}</span>
          <span>fallback={{ metrics.multiscale.fallbackUsed ? "yes" : "no" }}</span>
          <span>effective scales={{ metrics.multiscale.effectiveScaleCount }}</span>
          <span>threshold={{ metrics.multiscale.threshold.toFixed(2) }}</span>
          <span>bands={{ multiscaleBandCount }}</span>
        </div>
        <div class="multiscale-bars">
          <div
            v-for="band in metrics.multiscale.scaleBands"
            :key="`scale-${band.scale}`"
            class="multiscale-bars__row"
          >
            <span class="multiscale-bars__label">scale {{ band.scale }}</span>
            <div class="multiscale-bars__track">
              <div class="multiscale-bars__fill" :style="{ width: `${pct(band.ratio)}%` }" />
            </div>
            <span class="multiscale-bars__value">{{ (band.ratio * 100).toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <div v-else-if="spaghettiSummary" class="metrics-empty">
        <div>metrics rows: N/A (spaghetti view)</div>
        <div>selected states: {{ spaghettiSummary.selectedCount }}/{{ spaghettiSummary.totalCount }}</div>
        <div>all states selected: {{ spaghettiSummary.allSelected ? "yes" : "no" }}</div>
        <div>default state: {{ spaghettiSummary.defaultStateLabel }}</div>
      </div>

      <div class="metrics-notes">{{ notes.length ? notes.join(" | ") : "No preprocessing notes" }}</div>
    </div>
  </section>
</template>
