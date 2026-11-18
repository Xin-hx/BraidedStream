import { validateInput, type InputDataset, type MeasureComponent } from "braided-stream/core";

export const IMPORT_LIMITS = { bytes: 25 * 1024 * 1024, rows: 100_000, columns: 512, cells: 500_000, timeCells: 50_000 };
export type Cell = string | number | boolean | Date | null;
export type ImportSource = { kind: "table"; sheets: { name: string; rows: Cell[][] }[] } | { kind: "unified"; dataset: InputDataset };
export interface ImportMapping {
  layout: "long" | "wide" | "samples";
  time: string;
  groups: string[];
  members: string[];
  representation: "ensemble" | "distribution";
  support: "points" | "intervals";
  lower: string;
  upper: string;
  values: string[];
  weight: string;
  timeOrder: "auto" | "file";
  missing: "skip" | "error";
}
export interface ImportPreview {
  kind: ImportSource["kind"];
  sheets: string[];
  sheet: number;
  headerRow: number;
  columns: { key: string; label: string }[];
  rows: { number: number; cells: string[] }[];
  rowCount: number;
  mapping: ImportMapping;
}
export interface ImportedData {
  dataset: InputDataset;
  sampleSize: Readonly<Record<string, readonly number[]>>;
  summary: { layers: number; times: number; observations: number | null; missingCells: number; firstTime: string; lastTime: string; distributions: number; memberRange: [number, number] | null };
  definition: { grouping: string[]; members: string[]; kind: "ensemble" | "distribution" | "unified"; support: "points" | "intervals" };
  notes: string[];
}
export interface ImportProgress { label: string; fraction?: number }
export type ProgressCallback = (progress: ImportProgress) => void;

export function cellText(value: Cell | undefined): string {
  if (value instanceof Date) {
    const text = value.toISOString();
    return text.endsWith("T00:00:00.000Z") ? text.slice(0, 10) : text;
  }
  return value === null || value === undefined ? "" : String(value).trim();
}
const empty = (value: Cell | undefined) => value === null || value === undefined || (typeof value === "string" && !value.trim());
const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function numberValue(value: Cell | undefined, location: string): number {
  const text = cellText(value);
  if ((typeof value !== "number" && (typeof value !== "string" || !decimal.test(text))) || !Number.isFinite(Number(text)) || Number(text) < 0) {
    throw new Error(`${location}: enter a finite, non-negative number, e.g. 1234.5 (no currency or thousands separators).`);
  }
  return Number(text);
}

export function checkTable(rows: Cell[][]): void {
  if (!rows.length) throw new Error("The selected sheet is empty.");
  if (rows.length > IMPORT_LIMITS.rows + 1) throw new Error("Too many rows for this browser import. Keep at most 100,000 data rows.");
  let cells = 0;
  for (const row of rows) {
    if (row.length > IMPORT_LIMITS.columns) throw new Error("Too many columns. Keep at most 512 columns.");
    cells += row.length;
  }
  if (cells > IMPORT_LIMITS.cells) throw new Error("This sheet exceeds 500,000 cells. Import a smaller sheet or range.");
}

export function jsonSource(value: unknown): ImportSource {
  if (value && typeof value === "object" && !Array.isArray(value) && "times" in value && "layers" in value) {
    const dataset = value as InputDataset;
    if (Array.isArray(dataset.times) && Array.isArray(dataset.layers) && dataset.times.length * dataset.layers.length > IMPORT_LIMITS.timeCells) {
      throw new Error("The dataset exceeds 50,000 layer × time cells. Import a smaller range.");
    }
    return { kind: "unified", dataset: validateInput(dataset) };
  }
  const records = Array.isArray(value) ? value : value && typeof value === "object" && "rows" in value ? value.rows : undefined;
  if (!Array.isArray(records) || !records.length) throw new Error('JSON must contain a non-empty array of flat records, { "rows": [...] }, or an InputDataset with times and layers.');
  if (records.length > IMPORT_LIMITS.rows) throw new Error("JSON exceeds 100,000 records.");
  const columns = new Set<string>();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`JSON record ${index + 1} must be an object.`);
    for (const [key, cell] of Object.entries(record)) {
      if (cell !== null && !["string", "number", "boolean"].includes(typeof cell)) throw new Error(`JSON record ${index + 1}, ${key}: nested values need to be flattened first. You can also use the unified JSON template.`);
      columns.add(key);
    }
  }
  const keys = [...columns];
  if (keys.length > IMPORT_LIMITS.columns || keys.length * records.length > IMPORT_LIMITS.cells) throw new Error("JSON exceeds the browser's column/cell limit. Import a smaller range.");
  const rows: Cell[][] = [keys, ...records.map(record => keys.map(key => Object.hasOwn(record, key) ? record[key] as Cell : null))];
  checkTable(rows);
  return { kind: "table", sheets: [{ name: "JSON records", rows }] };
}

export function makePreview(source: ImportSource, sheet = 0, headerRow = 1): ImportPreview {
  const mapping: ImportMapping = { layout: "long", time: "", groups: [], members: [], representation: "ensemble", support: "points", lower: "", upper: "", values: [], weight: "", timeOrder: "auto", missing: "skip" };
  if (source.kind === "unified") return { kind: "unified", sheets: [], sheet: 0, headerRow: 1, columns: [], rows: [], rowCount: source.dataset.times.length, mapping };
  const selected = source.sheets[sheet];
  if (!selected) throw new Error("Choose an available worksheet.");
  checkTable(selected.rows);
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow >= selected.rows.length) throw new Error("Header row must be followed by at least one data row.");
  const width = selected.rows.slice(headerRow - 1).reduce((max, row) => Math.max(max, row.length), 0);
  const headers = selected.rows[headerRow - 1];
  const columns = Array.from({ length: width }, (_, index) => ({ key: String(index), label: cellText(headers[index]) || `Column ${index + 1}` }));
  const find = (aliases: string[]) => columns.find(col => aliases.includes(col.label.toLowerCase().replace(/[\s_-]/g, "")))?.key ?? "";
  mapping.time = find(["time", "date", "timestamp", "year", "时间", "日期", "年份"]);
  const layer = find(["category", "layer", "group", "series", "state", "region", "类别", "分类", "图层", "组别", "地区"]);
  mapping.groups = layer ? [layer] : [];
  mapping.weight = find(["weight", "mass", "probability", "权重", "概率"]);
  const value = find(["value", "amount", "dose", "measurement", "值", "数值", "样本", "剂量"]);
  const numeric = columns.filter(col => ![mapping.time, ...mapping.groups, mapping.weight].includes(col.key) && selected.rows.slice(headerRow, headerRow + 50).some(row => !empty(row[Number(col.key)])) && selected.rows.slice(headerRow, headerRow + 50).every(row => empty(row[Number(col.key)]) || (typeof row[Number(col.key)] === "number" || decimal.test(cellText(row[Number(col.key)]))))).map(col => col.key);
  mapping.values = value ? [value] : numeric;
  mapping.layout = value ? "long" : layer ? "samples" : "wide";
  mapping.lower = find(["low", "lower", "binlow", "binstart", "下界", "下限"]);
  mapping.upper = find(["high", "upper", "binhigh", "binend", "上界", "上限"]);
  if (mapping.layout !== "long") mapping.weight = "";
  return {
    kind: "table", sheets: source.sheets.map(s => s.name), sheet, headerRow, columns,
    rows: selected.rows.slice(headerRow, headerRow + 8).map((cells, offset) => ({ number: headerRow + offset + 1, cells: columns.map((_, i) => cellText(cells[i]).slice(0, 160)) })),
    rowCount: selected.rows.slice(headerRow).filter(row => row.some(value => !empty(value))).length, mapping,
  };
}

function coordinate(label: string): number {
  if (decimal.test(label)) return Number(label);
  if (/^day \d+$/.test(label)) return Number(label.slice(4));
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(label) ? Date.parse(label) : NaN;
}
function orderDataset(dataset: InputDataset, order: ImportMapping["timeOrder"]): InputDataset {
  const coordinates = dataset.times.map(coordinate);
  if (!coordinates.every(Number.isFinite)) return dataset;
  const indices = dataset.times.map((_, index) => index);
  if (order === "auto") indices.sort((a, b) => coordinates[a] - coordinates[b]);
  // Calendar/day labels have an explicit numeric axis in the renderer.
  if (dataset.times.every(time => /^day \d+$|^\d{4}-\d{2}-\d{2}$/.test(time)) && indices.some((index, i) => i > 0 && coordinates[index] <= coordinates[indices[i - 1]])) {
    throw new Error("Date/day labels must increase without duplicate coordinates. Choose automatic time ordering and use consistent labels.");
  }
  return { times: indices.map(index => dataset.times[index]), layers: dataset.layers.map(layer => ({ id: layer.id, measures: indices.map(index => layer.measures[index]) })) };
}

function finish(dataset: InputDataset, samples: Map<string, Map<string, number>>, observations: number | null, notes: string[], order: ImportMapping["timeOrder"], definition: ImportedData["definition"]): ImportedData {
  if (dataset.times.length * dataset.layers.length > IMPORT_LIMITS.timeCells) throw new Error("The dataset exceeds 50,000 layer × time cells. Import a smaller range.");
  const ordered = orderDataset(validateInput(dataset), order);
  const counts = [...samples.values()].flatMap(cells => [...cells.values()]).filter(count => count > 0);
  return {
    dataset: ordered,
    sampleSize: Object.fromEntries([...samples].map(([id, cells]) => [id, ordered.times.map(time => cells.get(time) ?? 0)])),
    summary: {
      layers: ordered.layers.length, times: ordered.times.length, observations,
      missingCells: ordered.layers.reduce((sum, layer) => sum + layer.measures.filter(cell => cell === null).length, 0),
      firstTime: ordered.times[0], lastTime: ordered.times.at(-1)!,
      distributions: ordered.layers.reduce((sum, layer) => sum + layer.measures.filter(cell => cell !== null).length, 0),
      memberRange: counts.length ? [Math.min(...counts), Math.max(...counts)] : null,
    }, notes, definition,
  };
}

export function convertSource(source: ImportSource, preview: ImportPreview, mapping: ImportMapping, progress: ProgressCallback = () => undefined): ImportedData {
  if (source.kind === "unified") return finish(source.dataset, new Map(), null, [], mapping.timeOrder, { kind: "unified", grouping: ["time", "layer"], members: [], support: "points" });
  const sheet = source.sheets[preview.sheet];
  if (!sheet) throw new Error("Choose an available worksheet.");
  const distribution = mapping.representation === "distribution";
  const intervals = distribution && mapping.support === "intervals";
  if (distribution && mapping.layout !== "long") throw new Error("Weighted distributions use one support point or interval per row.");
  const validKeys = new Set(preview.columns.map(col => col.key));
  const supports = intervals ? [mapping.lower, mapping.upper] : mapping.values;
  const selected = [mapping.time, ...mapping.groups, ...mapping.members, ...supports, ...(mapping.weight ? [mapping.weight] : [])];
  if (!supports.length || selected.some(key => !validKeys.has(key))) throw new Error("Choose the time and value columns, and check the grouping/member fields.");
  if (distribution && !mapping.weight) throw new Error("Choose a probability, frequency or weight column for the distribution.");
  if (distribution && mapping.members.length) throw new Error("Member identifiers apply to ensembles, not weighted distributions.");
  if (new Set(selected).size !== selected.length) throw new Error("Each selected column must have one role. Time, groups, members, values and weights must be different.");
  if (mapping.layout === "long" && !intervals && mapping.values.length !== 1) throw new Error("Select one value column for row-based data.");
  if (mapping.layout !== "long" && mapping.weight) throw new Error("Row weights are available only with one value per row.");
  const valueColumns = supports.map(key => preview.columns[Number(key)]);
  if (mapping.layout === "wide" && new Set(valueColumns.map(col => col.label)).size !== valueColumns.length) throw new Error("Value columns used as layers must have unique names. Rename duplicate headers first.");
  type CellData = { components: MeasureComponent[]; members: Set<string> };
  const groups = new Map<string, Map<string, CellData>>();
  const times = new Set<string>();
  let blanks = 0, observations = 0, zeroWeights = 0;
  const keyText = (row: Cell[], keys: string[], index: number, role: string) => keys.map(key => {
    const value = cellText(row[Number(key)]);
    if (!value) throw new Error(`Row ${index + 1}: ${role} field ${preview.columns[Number(key)].label} is missing.`);
    return value;
  });
  for (let index = preview.headerRow; index < sheet.rows.length; index++) {
    const row = sheet.rows[index];
    if (row.every(empty)) continue;
    if (row.slice(sheet.rows[preview.headerRow - 1].length).some(value => !empty(value))) throw new Error(`Row ${index + 1}: more fields than the selected header. Check the separator or header row.`);
    const time = cellText(row[Number(mapping.time)]);
    if (!time) throw new Error(`Row ${index + 1}: time is missing.`);
    times.add(time);
    const groupValues = keyText(row, mapping.groups, index, "group/category");
    const columns = intervals ? valueColumns.slice(0, 1) : valueColumns;
    for (const column of columns) {
      const parts = mapping.layout === "wide" ? [...groupValues, column.label] : groupValues;
      // JSON tuples keep composite group identities distinct even when values contain separators.
      const id = parts.length === 0 ? "All data" : parts.length === 1 ? parts[0] : JSON.stringify(parts);
      let cells = groups.get(id);
      if (!cells) { cells = new Map(); groups.set(id, cells); }
      if (empty(row[Number(column.key)]) || (intervals && empty(row[Number(mapping.upper)]))) {
        if (mapping.missing === "error") throw new Error(`Row ${index + 1}, ${column.label}: value is blank.`);
        blanks++; continue;
      }
      const weight = mapping.weight ? numberValue(row[Number(mapping.weight)], `Row ${index + 1}, weight`) : 1;
      const value = numberValue(row[Number(column.key)], `Row ${index + 1}, ${column.label}`);
      let component: MeasureComponent;
      if (intervals) {
        const high = numberValue(row[Number(mapping.upper)], `Row ${index + 1}, upper bound`);
        if (high <= value) throw new Error(`Row ${index + 1}: upper bound must exceed lower bound.`);
        component = { kind: "uniform", low: value, high, mass: weight };
      } else component = { kind: "atom", value, mass: weight };
      if (!weight) { zeroWeights++; continue; }
      let cell = cells.get(time);
      if (!cell) { cell = { components: [], members: new Set() }; cells.set(time, cell); }
      if (mapping.members.length) {
        const member = keyText(row, mapping.members, index, "member");
        if (mapping.layout === "samples") member.push(column.key);
        const identity = JSON.stringify(member);
        if (cell.members.has(identity)) throw new Error(`Row ${index + 1}: duplicate member in the same distribution. Add member fields, or clear member IDs to count rows independently.`);
        cell.members.add(identity);
      }
      cell.components.push(component); observations++;
    }
    if (index % 1000 === 0) progress({ label: "Building distributions", fraction: index / sheet.rows.length });
  }
  if (!observations) throw new Error("No usable observations remain. Check values, blanks and zero weights.");
  if (times.size * groups.size > IMPORT_LIMITS.timeCells) throw new Error("The dataset exceeds 50,000 layer × time cells. Import a smaller range.");
  const sampleSize = new Map<string, Map<string, number>>();
  const dataset: InputDataset = { times: [...times], layers: [...groups].map(([id, cells]) => {
    if (!distribution) sampleSize.set(id, new Map([...cells].map(([time, cell]) => [time, cell.components.length])));
    return { id, measures: [...times].map(time => {
      const cell = cells.get(time);
      if (!cell) return null;
      const total = cell.components.reduce((sum, component) => sum + component.mass, 0);
      if (!Number.isFinite(total)) throw new Error(`Layer ${id}, time ${time}: weights are too large. Scale weights down.`);
      return { components: cell.components.map(component => ({ ...component, mass: component.mass / total })) };
    }) };
  }) };
  const notes: string[] = [];
  if (blanks) notes.push(`${blanks.toLocaleString()} blank values omitted.`);
  if (zeroWeights) notes.push(`${zeroWeights.toLocaleString()} zero-weight values omitted.`);
  progress({ label: "Validating input" });
  const labels = (keys: string[]) => keys.map(key => preview.columns[Number(key)].label);
  return finish(dataset, sampleSize, distribution ? null : observations, notes, mapping.timeOrder, {
    kind: mapping.representation, grouping: [preview.columns[Number(mapping.time)].label, ...labels(mapping.groups), ...(mapping.layout === "wide" ? ["value column"] : [])],
    members: distribution ? [] : mapping.members.length ? [...labels(mapping.members), ...(mapping.layout === "samples" ? ["sample column"] : [])] : [mapping.layout === "samples" ? "row + sample column" : "row"],
    support: intervals ? "intervals" : "points",
  });
}
