<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from "vue";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Download, FileSpreadsheet, LoaderCircle, Upload, X } from "@lucide/vue";
import type { PipelineOptions } from "braided-stream/core";
import { createImportTask } from "../lib/import-task";
import { createAnalysisTask, type ImportAcceptance } from "../lib/analysis-task";
import { IMPORT_LIMITS, type ImportedData, type ImportMapping, type ImportPreview, type ImportProgress } from "../lib/import-data";
import type { ReadSettings } from "../lib/read-import";
import { downloadBlob } from "../lib/export";

const props = defineProps<{ options: PipelineOptions; sort: "tpid" | "category" }>();
const emit = defineEmits<{ close: []; import: [acceptance: ImportAcceptance] }>();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const file = shallowRef<File>();
const preview = shallowRef<ImportPreview>();
const converted = shallowRef<ImportedData>();
const mapping = reactive<ImportMapping>({ layout: "long", time: "", groups: [], members: [], representation: "ensemble", support: "points", lower: "", upper: "", values: [], weight: "", timeOrder: "auto", missing: "skip" });
const settings = reactive<ReadSettings>({ encoding: "utf-8", delimiter: "auto" });
const sheet = ref(0), headerRow = ref(1), step = ref(0), busy = ref(false), error = ref(""), dragging = ref(false);
const progress = ref<ImportProgress>({ label: "" });
const readTask = createImportTask(), analysisTask = createAnalysisTask();
let generation = 0;
const layouts = [
  { id: "long", title: "Values in rows" },
  { id: "wide", title: "Layers in columns" },
  { id: "samples", title: "Members in columns" },
] as const;
const columnLabel = (key: string) => preview.value?.columns.find(column => column.key === key)?.label ?? "…";
const groupingRule = computed(() => [columnLabel(mapping.time), ...mapping.groups.map(columnLabel), ...(mapping.layout === "wide" ? ["value column"] : [])].join(" × "));
const memberRule = computed(() => [...(mapping.members.length ? mapping.members.map(columnLabel) : ["row"]), ...(mapping.layout === "samples" ? ["sample column"] : [])].join(" × "));
const numericColumns = computed(() => preview.value?.columns.filter(column => ![mapping.time, ...mapping.groups, ...mapping.members].includes(column.key)) ?? []);
const memberRange = computed(() => {
  const range = converted.value?.summary.memberRange;
  return range ? range[0] === range[1] ? String(range[0]) : `${range[0]}–${range[1]}` : "—";
});
const percent = computed(() => progress.value.fraction === undefined ? undefined : Math.max(0, Math.min(100, Math.round(progress.value.fraction * 100))));
const normalized = computed(() => converted.value ? JSON.stringify(converted.value.dataset, null, 2) : "");
const jsonExcerpt = computed(() => converted.value ? JSON.stringify({
  times: converted.value.dataset.times.slice(0, 3),
  layers: converted.value.dataset.layers.slice(0, 1).map(layer => ({ ...layer, measures: layer.measures.slice(0, 3).map(cell => cell ? { components: cell.components.slice(0, 8) } : null) })),
}, null, 2).slice(0, 3000) : "");

async function task<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  const ticket = ++generation;
  busy.value = true; error.value = ""; progress.value = { label };
  try { const result = await run(); return ticket === generation ? result : undefined; }
  catch (reason) { if (ticket === generation && !(reason instanceof Error && reason.name === "AbortError")) error.value = reason instanceof Error ? reason.message : String(reason); return undefined; }
  finally { if (ticket === generation) busy.value = false; }
}
async function chooseFile(selected?: File) {
  if (!selected) return;
  readTask.cancel(); analysisTask.cancel();
  preview.value = undefined; converted.value = undefined; step.value = 0;
  if (!/\.(csv|xlsx|json)$/i.test(selected.name)) { error.value = "Choose CSV, XLSX or JSON. Save legacy XLS files as XLSX first."; return; }
  if (selected.size > IMPORT_LIMITS.bytes) { error.value = "This file exceeds 25 MB. Choose a smaller file or export fewer rows."; return; }
  if (!selected.size) { error.value = "This file is empty."; return; }
  file.value = selected;
  const result = await task("Reading file locally", () => readTask.run({ type: "read", file: selected, settings: { ...settings } }, value => { progress.value = value; }));
  if (result?.type === "preview") {
    preview.value = result.preview; sheet.value = result.preview.sheet; headerRow.value = result.preview.headerRow;
    Object.assign(mapping, result.preview.mapping); step.value = 1;
  }
}
async function refreshPreview() {
  if (!preview.value) return;
  converted.value = undefined;
  const result = await task("Preparing preview", () => readTask.run({ type: "preview", sheet: sheet.value, headerRow: headerRow.value }));
  if (result?.type === "preview") { preview.value = result.preview; Object.assign(mapping, result.preview.mapping); }
}
async function validate() {
  if (preview.value?.kind === "table" && (sheet.value !== preview.value.sheet || headerRow.value !== preview.value.headerRow)) {
    error.value = "Fix the worksheet/header row and refresh the preview before continuing."; return;
  }
  const result = await task("Validating distributions", () => readTask.run({ type: "convert", mapping: { ...mapping, groups: [...mapping.groups], members: [...mapping.members], values: [...mapping.values] } }, value => { progress.value = value; }));
  if (result?.type === "converted") { converted.value = result.data; step.value = 2; }
}
async function visualize() {
  if (!converted.value || !file.value) return;
  const data = converted.value;
  const options = { ...props.options, layoutOrder: props.sort === "category" ? data.dataset.layers.map(layer => layer.id).sort((a, b) => a.localeCompare(b)) : undefined };
  const analysis = await task("Calculating layout on this device", () => analysisTask.run({ dataset: data.dataset, options }));
  if (analysis) { emit("import", { name: file.value.name, data, analysis }); close(); }
}
function close() { generation++; readTask.cancel(); analysisTask.cancel(); dialog.value?.close?.(); emit("close"); }
function drop(event: DragEvent) { dragging.value = false; if (!busy.value) void chooseFile(event.dataTransfer?.files[0]); }
function changeLayout() { mapping.values = mapping.layout === "long" ? mapping.values.slice(0, 1) : mapping.values; if (mapping.layout !== "long") mapping.weight = ""; }
function claim(keys: string[], role: "time" | "groups" | "members") {
  const taken = new Set(keys.filter(Boolean));
  if (role !== "groups") mapping.groups = mapping.groups.filter(key => !taken.has(key));
  if (role !== "members") mapping.members = mapping.members.filter(key => !taken.has(key));
  mapping.values = mapping.values.filter(key => !taken.has(key));
  if (taken.has(mapping.weight)) mapping.weight = "";
  if (taken.has(mapping.lower)) mapping.lower = "";
  if (taken.has(mapping.upper)) mapping.upper = "";
}
function changeRepresentation() {
  mapping.layout = "long"; mapping.values = mapping.values.slice(0, 1);
  if (mapping.representation === "distribution") {
    mapping.members = [];
    mapping.support = mapping.lower && mapping.upper ? "intervals" : "points";
    mapping.weight ||= preview.value?.columns.find(col => /^(weight|mass|probability|frequency|count|权重|概率|频数)$/i.test(col.label))?.key ?? "";
  } else mapping.support = "points";
}
function downloadNormalized() { downloadBlob(new Blob([normalized.value], { type: "application/json" }), "braided-stream-input.json"); }
function template(kind: "long" | "wide" | "json") {
  const text = kind === "long" ? "time,category,value,weight\n2024-01-01,A,10,1\n2024-01-01,A,14,1\n2024-01-02,A,12,1\n2024-01-01,B,8,1\n2024-01-02,B,11,1\n"
    : kind === "wide" ? "time,A,B\n2024-01-01,10,8\n2024-01-02,12,11\n"
    : JSON.stringify({ times: ["2024-01-01", "2024-01-02"], layers: [{ id: "A", measures: [{ components: [{ kind: "atom", value: 10, mass: 0.5 }, { kind: "atom", value: 14, mass: 0.5 }] }, { components: [{ kind: "atom", value: 12, mass: 1 }] }] }] }, null, 2);
  downloadBlob(new Blob([text], { type: kind === "json" ? "application/json" : "text/csv;charset=utf-8" }), `braided-stream-${kind}.${kind === "json" ? "json" : "csv"}`);
}
onMounted(() => { if (dialog.value?.showModal) dialog.value.showModal(); else dialog.value?.setAttribute("open", ""); });
onBeforeUnmount(() => { generation++; readTask.cancel(); analysisTask.cancel(); });
</script>

<template>
  <dialog ref="dialog" class="import-dialog" aria-labelledby="import-title" @cancel.prevent="close">
    <header class="import-header">
      <h1 id="import-title">Import data</h1>
      <button class="import-icon" type="button" aria-label="Close import" @click="close"><X :size="19" /></button>
    </header>
    <ol class="import-steps" aria-label="Import steps">
      <li v-for="(label, index) in ['Choose file', 'Map columns', 'Review & import']" :key="label" :class="{ current: step === index, complete: step > index }" :aria-current="step === index ? 'step' : undefined"><span><Check v-if="step > index" :size="13" /><template v-else>{{ index + 1 }}</template></span>{{ label }}</li>
    </ol>
    <div class="import-body" :aria-busy="busy">
      <div v-if="error" class="import-error" role="alert"><span>{{ error }}</span></div>
      <section v-if="step === 0" class="import-section">
        <div class="import-drop" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="drop">
          <div class="import-file-icon"><Upload :size="24" /></div><h2>Drop a file here</h2><p>CSV · XLSX · JSON · Up to 25 MB</p>
          <button class="import-primary" type="button" :disabled="busy" @click="input?.click()"><FileSpreadsheet :size="16" />Choose file</button>
          <input ref="input" class="import-file-input" type="file" accept=".csv,.xlsx,.json" aria-label="Choose a data file" :disabled="busy" @change="chooseFile(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />
          <small>Processed locally · Not uploaded</small>
        </div>
        <div class="import-read-settings">
          <label>Text encoding<select v-model="settings.encoding" :disabled="busy"><option value="utf-8">UTF-8 (recommended)</option><option value="utf-16le">UTF-16 LE</option><option value="gb18030">GB18030 / Chinese CSV</option></select></label>
          <label>CSV separator<select v-model="settings.delimiter" :disabled="busy"><option value="auto">Detect automatically</option><option value=",">Comma</option><option value=";">Semicolon</option><option :value="'\t'">Tab</option></select></label>
        </div>
        <div class="import-templates"><h3>Templates</h3><div><button type="button" @click="template('long')"><Download :size="14" />Sample rows CSV</button><button type="button" @click="template('wide')"><Download :size="14" />Series columns CSV</button><button type="button" @click="template('json')"><Download :size="14" />Unified JSON</button></div></div>
      </section>
      <section v-else-if="step === 1 && preview" class="import-section">
        <div class="import-file-summary"><FileSpreadsheet :size="18" /><strong>{{ file?.name }}</strong><span>{{ preview.rowCount.toLocaleString() }} {{ preview.kind === 'table' ? 'data rows' : 'time points' }}</span></div>
        <template v-if="preview.kind === 'table'">
          <div class="import-read-settings"><label>Worksheet<select v-model.number="sheet" :disabled="busy || preview.sheets.length === 1" @change="headerRow = 1; refreshPreview()"><option v-for="(name, index) in preview.sheets" :key="index" :value="index">{{ name }}</option></select></label><label>Header row<input v-model.number="headerRow" type="number" min="1" :disabled="busy" @change="refreshPreview" /></label></div>
          <div class="import-table-wrap"><table class="import-table"><thead><tr><th>Row</th><th v-for="col in preview.columns" :key="col.key">{{ col.label }}</th></tr></thead><tbody><tr v-for="row in preview.rows" :key="row.number"><th>{{ row.number }}</th><td v-for="(cell, index) in row.cells" :key="index" :title="cell">{{ cell || '—' }}</td></tr></tbody></table></div>
          <div class="import-read-settings">
            <label>Data type<select id="import-representation" v-model="mapping.representation" :disabled="busy" @change="changeRepresentation"><option value="ensemble">Ensemble samples</option><option value="distribution">Weighted distribution</option></select></label>
            <label>Time column<select id="import-time" v-model="mapping.time" :disabled="busy" @change="claim([mapping.time], 'time')"><option value="">Choose…</option><option v-for="col in preview.columns" :key="col.key" :value="col.key">{{ col.label }}</option></select></label>
          </div>
          <fieldset v-if="mapping.representation === 'ensemble'" class="import-layouts" :disabled="busy"><legend>Table layout</legend><label v-for="layout in layouts" :key="layout.id" :class="{ selected: mapping.layout === layout.id }"><input v-model="mapping.layout" type="radio" name="import-layout" :value="layout.id" @change="changeLayout" /><span>{{ layout.title }}</span></label></fieldset>
          <fieldset class="import-values import-groups" :disabled="busy"><legend>Distribution groups</legend><label v-for="col in preview.columns.filter(col => col.key !== mapping.time)" :key="col.key"><input v-model="mapping.groups" type="checkbox" :value="col.key" @change="claim(mapping.groups, 'groups')" />{{ col.label }}</label><small v-if="!mapping.groups.length">No fields selected: one layer{{ mapping.layout === 'wide' ? ' per value column' : '' }}.</small></fieldset>
          <fieldset v-if="mapping.representation === 'ensemble'" class="import-values import-members" :disabled="busy"><legend>Member ID fields <span class="import-optional">optional</span></legend><label v-for="col in preview.columns.filter(col => ![mapping.time, ...mapping.groups].includes(col.key))" :key="col.key"><input v-model="mapping.members" type="checkbox" :value="col.key" @change="claim(mapping.members, 'members')" />{{ col.label }}</label><small v-if="!mapping.members.length">Each row{{ mapping.layout === 'samples' ? ' × sample column' : '' }} is an independent member.</small></fieldset>
          <div class="import-mapping">
            <label v-if="mapping.representation === 'distribution'">Support<select id="import-support" v-model="mapping.support" :disabled="busy"><option value="points">Points</option><option value="intervals">Intervals / histogram bins</option></select></label>
            <template v-if="mapping.representation === 'distribution' && mapping.support === 'intervals'">
              <label>Lower bound<select id="import-lower" v-model="mapping.lower" :disabled="busy"><option value="">Choose…</option><option v-for="col in numericColumns.filter(col => ![mapping.upper, mapping.weight].includes(col.key))" :key="col.key" :value="col.key">{{ col.label }}</option></select></label>
              <label>Upper bound<select id="import-upper" v-model="mapping.upper" :disabled="busy"><option value="">Choose…</option><option v-for="col in numericColumns.filter(col => ![mapping.lower, mapping.weight].includes(col.key))" :key="col.key" :value="col.key">{{ col.label }}</option></select></label>
            </template>
            <label v-else-if="mapping.layout === 'long'">Value<select id="import-value" :value="mapping.values[0] ?? ''" :disabled="busy" @change="mapping.values = [($event.target as HTMLSelectElement).value]"><option value="">Choose…</option><option v-for="col in numericColumns.filter(col => col.key !== mapping.weight)" :key="col.key" :value="col.key">{{ col.label }}</option></select></label>
            <label v-if="mapping.layout === 'long'">{{ mapping.representation === 'distribution' ? 'Mass / frequency' : 'Weight (optional)' }}<select id="import-weight" v-model="mapping.weight" :disabled="busy"><option value="">{{ mapping.representation === 'distribution' ? 'Choose…' : 'Equal weights' }}</option><option v-for="col in numericColumns.filter(col => !(mapping.representation === 'distribution' && mapping.support === 'intervals' ? [mapping.lower, mapping.upper] : mapping.values).includes(col.key))" :key="col.key" :value="col.key">{{ col.label }}</option></select></label>
          </div>
          <fieldset v-if="mapping.layout !== 'long'" class="import-values" :disabled="busy"><legend>{{ mapping.layout === 'wide' ? 'Layer value columns' : 'Member value columns' }}</legend><label v-for="col in numericColumns" :key="col.key"><input v-model="mapping.values" type="checkbox" :value="col.key" />{{ col.label }}</label></fieldset>
          <dl class="import-definition"><div><dt>One distribution</dt><dd>{{ groupingRule }}</dd></div><div><dt>{{ mapping.representation === 'ensemble' ? 'One member' : 'Support' }}</dt><dd>{{ mapping.representation === 'ensemble' ? memberRule : mapping.support === 'intervals' ? `${columnLabel(mapping.lower)} → ${columnLabel(mapping.upper)}` : columnLabel(mapping.values[0] ?? '') }}</dd></div></dl>
        </template>
        <div v-else class="import-unified"><CheckCircle2 :size="24" /><h2>Unified JSON detected</h2></div>
        <div class="import-read-settings"><label>Time order<select v-model="mapping.timeOrder" :disabled="busy"><option value="auto">Sort numeric / ISO dates automatically</option><option value="file">Keep file order</option></select></label><label v-if="preview.kind === 'table'">Blank values<select v-model="mapping.missing" :disabled="busy"><option value="skip">Treat blanks as missing</option><option value="error">Stop and report blank cells</option></select></label></div>
      </section>
      <section v-else-if="step === 2 && converted" class="import-section">
        <div class="import-file-summary"><CheckCircle2 :size="18" /><strong>{{ file?.name }}</strong><span>{{ converted.definition.kind === 'ensemble' ? 'Ensemble' : converted.definition.kind === 'unified' ? 'Unified JSON' : 'Distribution' }}</span></div>
        <div class="import-stats"><div><strong>{{ converted.summary.layers }}</strong><span>Layers</span></div><div><strong>{{ converted.summary.times }}</strong><span>Time points</span></div><div><strong>{{ converted.summary.distributions.toLocaleString() }}</strong><span>Distributions</span></div><div v-if="converted.summary.memberRange"><strong>{{ memberRange }}</strong><span>Members / distribution</span></div></div>
        <p class="import-range">{{ converted.summary.firstTime }} <ArrowRight :size="14" /> {{ converted.summary.lastTime }}</p>
        <dl class="import-definition"><div><dt>Grouped by</dt><dd>{{ converted.definition.grouping.join(' × ') }}</dd></div><div><dt>{{ converted.definition.kind === 'ensemble' ? 'Members' : 'Distribution' }}</dt><dd>{{ converted.definition.kind === 'ensemble' ? converted.definition.members.join(' × ') : converted.definition.kind === 'unified' ? 'Defined in JSON' : `Weighted ${converted.definition.support}` }}</dd></div></dl>
        <ul v-if="converted.notes.length" class="import-notes"><li v-for="note in converted.notes" :key="note">{{ note }}</li></ul>
        <details class="import-json"><summary>Data preview</summary><pre>{{ jsonExcerpt }}</pre></details>
        <button class="import-text-button" type="button" @click="downloadNormalized"><Download :size="14" />Export JSON</button>
      </section>
    </div>
    <div v-if="busy" class="import-progress" role="status" aria-live="polite"><div><LoaderCircle :size="16" class="import-spinning" /><span>{{ progress.label }}</span><strong v-if="percent !== undefined">{{ percent }}%</strong></div><progress v-if="percent !== undefined" :value="percent" max="100" :aria-label="progress.label" /></div>
    <footer class="import-footer"><button class="import-secondary" type="button" @click="close">{{ busy ? 'Cancel import' : 'Cancel' }}</button><div><button v-if="step > 0" class="import-secondary" type="button" :disabled="busy" @click="step--; error = ''"><ArrowLeft :size="15" />Back</button><button v-if="step === 1" class="import-primary" type="button" :disabled="busy" @click="validate">Validate & review<ArrowRight :size="15" /></button><button v-if="step === 2" class="import-primary" type="button" :disabled="busy" @click="visualize">Import & visualize<ArrowRight :size="15" /></button></div></footer>
  </dialog>
</template>

<style scoped>
.import-dialog { width: min(820px, calc(100vw - 32px)); max-height: min(900px, calc(100dvh - 48px)); margin: auto; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--background); color: var(--ink); box-shadow: 0 24px 80px var(--shadow-color); }
.import-dialog[open] { display: flex; flex-direction: column; }
.import-dialog::backdrop { background: var(--overlay-color); backdrop-filter: blur(3px); }
.import-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 24px 28px 20px; }
.import-header h1 { margin: 6px 0; font-size: var(--font-display); line-height: 1.25; font-weight: var(--font-weight-emphasis); letter-spacing: -.035em; }
.import-dialog button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-height: 36px; padding: 8px 13px; border: 1px solid transparent; border-radius: 8px; font-size: var(--font-small); font-weight: var(--font-weight-regular); cursor: pointer; }
.import-dialog button:disabled { opacity: .45; cursor: wait; }
.import-dialog button.import-icon { width: 32px; height: 32px; min-height: 32px; padding: 0; background: transparent; color: var(--muted); }
.import-dialog button.import-icon:hover { background: var(--surface-subtle); color: var(--ink); }
.import-dialog button.import-primary { background: var(--accent); color: var(--white); }
.import-dialog button.import-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 85%, var(--ink)); }
.import-dialog button.import-secondary { background: var(--background); border-color: var(--line); color: var(--muted); }
.import-dialog button.import-secondary:hover:not(:disabled) { background: var(--surface-subtle); border-color: var(--line); }
.import-dialog :is(button, input, select, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.import-steps { display: flex; justify-content: space-between; gap: 12px; margin: 0; padding: 14px 28px; list-style: none; background: var(--surface-subtle); border-block: 1px solid var(--line); }
.import-steps li { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: var(--font-small); }
.import-steps li > span { display: grid; place-items: center; flex: 0 0 auto; width: 23px; height: 23px; border: 1px solid var(--line); border-radius: 50%; font-size: var(--font-small); }
.import-steps li.current { color: var(--accent); font-weight: var(--font-weight-emphasis); }
.import-steps li.current > span { background: var(--accent); color: var(--white); border-color: var(--accent); }
.import-steps li.complete > span { background: var(--accent-soft); border-color: var(--accent-soft); color: var(--accent); }
.import-body { overflow: auto; min-height: 0; padding: 20px 28px 24px; }
.import-section { display: grid; gap: 18px; }
.import-error { display: grid; gap: 4px; margin-bottom: 16px; padding: 12px 14px; background: var(--danger-soft); border: 1px solid var(--danger-line); border-radius: 9px; color: var(--danger); font-size: var(--font-small); overflow-wrap: anywhere; }
.import-drop { display: flex; flex-direction: column; align-items: center; padding: 30px 20px; text-align: center; border: 1.5px dashed var(--line); border-radius: 12px; background: var(--surface-subtle); }
.import-drop.dragging { border-color: var(--muted); background: var(--surface-subtle); }
.import-file-icon { display: grid; place-items: center; width: 50px; height: 50px; margin-bottom: 14px; border: 1px solid var(--line); border-radius: 13px; background: var(--background); color: var(--muted); }
.import-section h2 { margin: 0; font-size: var(--font-large); font-weight: var(--font-weight-emphasis); }
.import-drop p { margin: 7px 0 18px; color: var(--muted); font-size: var(--font-small); }
.import-drop small { margin-top: 12px; font-size: var(--font-small); color: var(--muted); }
.import-file-input { display: none; }
.import-read-settings, .import-mapping { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.import-section label { display: flex; flex-direction: column; min-width: 0; gap: 6px; font-size: var(--font-small); color: var(--muted); }
.import-section :is(select, input[type=number]) { width: 100%; min-width: 0; height: 36px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--background); color: var(--ink); font-size: var(--font-small); }
.import-optional { display: inline; color: var(--muted); font-size: var(--font-small); }
.import-templates { padding-top: 4px; }
.import-templates h3 { margin: 0; font-size: var(--font-small); font-weight: var(--font-weight-emphasis); }
.import-templates > div { display: flex; flex-wrap: wrap; gap: 8px; }
.import-templates button, .import-dialog button.import-text-button { background: var(--surface-subtle); border-color: var(--line); color: var(--muted); }
.import-templates button:hover, .import-dialog button.import-text-button:hover { background: var(--surface-subtle); color: var(--ink); }
.import-file-summary { display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--muted); font-size: var(--font-small); }
.import-file-summary strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-regular); }
.import-file-summary > span { color: var(--muted); }
.import-table-wrap { max-height: 230px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
.import-table { width: 100%; border-collapse: collapse; font-size: var(--font-small); white-space: nowrap; text-align: left; }
.import-table th { position: sticky; top: 0; background: var(--surface-subtle); font-weight: var(--font-weight-regular); color: var(--muted); }
.import-table :is(th, td) { max-width: 220px; padding: 7px 10px; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--surface-subtle); }
.import-table tr:last-child td { border-bottom: 0; }
.import-layouts, .import-values { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
.import-section legend { margin-bottom: 9px; font-size: var(--font-small); font-weight: var(--font-weight-emphasis); color: var(--ink); }
.import-layouts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.import-layouts label { flex-direction: row; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
.import-layouts label.selected { background: var(--accent-soft); border-color: var(--accent); }
.import-layouts input { margin: 3px 0 0; accent-color: var(--accent); }
.import-values { display: flex; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
.import-values small { flex-basis: 100%; color: var(--muted); font-size: var(--font-small); }
.import-values input { accent-color: var(--accent); }
.import-values label { flex-direction: row; align-items: center; gap: 5px; padding: 3px 5px; }
.import-values legend { padding-inline: 4px; }
.import-unified { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-subtle); }
.import-unified > svg { flex: 0 0 auto; color: var(--accent); }
.import-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr)); border: 1px solid var(--line); border-radius: 10px; }
.import-stats > div { display: flex; flex-direction: column; gap: 5px; padding: 15px; border-right: 1px solid var(--line); }
.import-stats > div:last-child { border: 0; }
.import-stats strong { font-size: var(--font-display); font-weight: var(--font-weight-emphasis); font-variant-numeric: tabular-nums; }
.import-stats span { color: var(--muted); font-size: var(--font-small); }
.import-range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: var(--font-small); color: var(--muted); }
.import-notes { margin: 0; padding-left: 18px; color: var(--muted); font-size: var(--font-small); line-height: 1.7; }
.import-json { font-size: var(--font-small); color: var(--muted); }
.import-json summary { cursor: pointer; }
.import-definition { display: grid; gap: 7px; margin: 0; padding: 12px 14px; background: var(--surface-subtle); border: 1px solid var(--line); border-radius: 8px; font-size: var(--font-small); }
.import-definition > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; }
.import-definition dt { color: var(--muted); }
.import-definition dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.import-json pre { max-height: 200px; overflow: auto; padding: 12px; border-radius: 8px; background: var(--surface-subtle); font: var(--font-weight-regular) var(--font-small)/1.6 ui-monospace, monospace; }
.import-progress { flex: 0 0 auto; padding: 12px 28px; border-top: 1px solid var(--line); background: var(--surface-subtle); font-size: var(--font-small); color: var(--muted); }
.import-progress > div { display: flex; align-items: center; gap: 8px; }
.import-progress strong { margin-left: auto; font-variant-numeric: tabular-nums; }
.import-progress progress { width: 100%; height: 6px; margin-top: 8px; accent-color: var(--accent); }
.import-spinning { animation: import-spin 1s linear infinite; }
@keyframes import-spin { to { transform: rotate(360deg); } }
.import-footer { display: flex; flex: 0 0 auto; justify-content: space-between; gap: 12px; padding: 16px 28px; border-top: 1px solid var(--line); }
.import-footer > div { display: flex; gap: 8px; }
@media (max-width: 560px) {
  .import-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: 12px; }
  .import-header, .import-body, .import-footer { padding: 16px; }
  .import-steps { padding: 12px 16px; gap: 6px; }
  .import-steps li { gap: 5px; font-size: var(--font-small); }
  .import-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .import-stats > div { border-bottom: 1px solid var(--line); }
  .import-read-settings, .import-mapping, .import-layouts { grid-template-columns: minmax(0, 1fr); }
  .import-definition > div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .import-progress { padding-inline: 16px; }
}
@media (prefers-reduced-motion: reduce) { .import-spinning { animation: none; } }
</style>
