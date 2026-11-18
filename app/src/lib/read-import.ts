import Papa from "papaparse";
import { checkTable, jsonSource, IMPORT_LIMITS, type ImportSource, type ProgressCallback, type Cell } from "./import-data";

export interface ReadSettings { encoding: "utf-8" | "utf-16le" | "gb18030"; delimiter: "auto" | "," | ";" | "\t" }
export async function parseImport(bytes: ArrayBuffer, extension: string, settings: ReadSettings, progress: ProgressCallback = () => undefined): Promise<ImportSource> {
  if (bytes.byteLength > IMPORT_LIMITS.bytes) throw new Error("Choose a file smaller than 25 MB.");
  if (extension === "xlsx") {
    progress({ label: "Opening Excel workbook" });
    const { default: readWorkbook } = await import("read-excel-file/universal");
    const sheets = await readWorkbook(bytes, { trim: false });
    const usable = sheets.filter(sheet => sheet.data.length > 1);
    if (!usable.length) throw new Error("The workbook needs a header row and at least one data row.");
    return { kind: "table", sheets: usable.map(sheet => ({ name: sheet.sheet, rows: sheet.data as Cell[][] })) };
  }
  let text: string;
  try { text = new TextDecoder(settings.encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error("Text could not be decoded. Try UTF-16 or GB18030 in the encoding selector, or export as UTF-8."); }
  if (!text.trim()) throw new Error("The file is empty.");
  if (extension === "json") {
    progress({ label: "Reading JSON records" });
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("Invalid JSON. Check quotes, commas and brackets, or start with the JSON template."); }
    return jsonSource(value);
  }
  if (extension !== "csv") throw new Error("Choose a .csv, .xlsx or .json file. Save legacy .xls files as .xlsx first.");
  const rows: Cell[][] = [];
  let cellCount = 0;
  let failure: Error | undefined;
  const config = {
    delimiter: settings.delimiter === "auto" ? "" : settings.delimiter,
    skipEmptyLines: false, chunkSize: 256 * 1024,
    chunk(result: Papa.ParseResult<string[]>, parser: Papa.Parser) {
      const error = result.errors.find(error => error.code !== "UndetectableDelimiter");
      if (error) { failure = new Error(`CSV ${error.row === undefined ? "" : `row ${rows.length + error.row + 1}: `}${error.message}`); parser.abort(); return; }
      for (const row of result.data) {
        cellCount += row.length;
        if (row.length > IMPORT_LIMITS.columns || cellCount > IMPORT_LIMITS.cells) { failure = new Error("CSV exceeds the 512-column / 500,000-cell browser limit. Import a smaller range."); parser.abort(); return; }
        rows.push(row);
      }
      if (rows.length > IMPORT_LIMITS.rows + 1) { failure = new Error("CSV exceeds 100,000 data rows. Import a smaller range."); parser.abort(); return; }
      progress({ label: "Parsing CSV rows", fraction: result.meta.cursor / text.length });
    },
  };
  Papa.parse<string[]>(text, config);
  if (failure) throw failure;
  checkTable(rows);
  return { kind: "table", sheets: [{ name: "CSV data", rows }] };
}
