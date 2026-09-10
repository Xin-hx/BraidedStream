/** Loader for the hand-editable demo dataset.
 *
 * CSV columns: time,layer,p025,p10,p25,p50,p75,p90,p975
 * One row is one layer at one time point. Keep every time/layer pair present.
 */
import type { Layer } from "./types";

const KEYS = ["p025", "p10", "p25", "p50", "p75", "p90", "p975"] as const;

export function parseEditableCsv(text: string): { layers: Layer[]; times: string[] } {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  const header = rows.shift()?.split(",").map((v) => v.trim());
  if (header?.join(",") !== `time,layer,${KEYS.join(",")}`) {
    throw new Error(`editable CSV header must be time,layer,${KEYS.join(",")}`);
  }

  const cells = new Map<string, Map<string, number[]>>();
  const times: string[] = [];
  const layerIds: string[] = [];
  const layerSet = new Set<string>();
  for (const [lineNo, line] of rows.entries()) {
    const [time, id, ...values] = line.split(",").map((v) => v.trim());
    const numbers = values.map(Number);
    if (!time || !id || values.length !== KEYS.length || numbers.some((v, i) => !Number.isFinite(v) || (i > 0 && v < numbers[i - 1]))) {
      throw new Error(`invalid editable CSV row ${lineNo + 2}`);
    }
    if (!cells.has(time)) { cells.set(time, new Map()); times.push(time); }
    if (!layerSet.has(id)) { layerSet.add(id); layerIds.push(id); }
    if (cells.get(time)!.has(id)) throw new Error(`duplicate layer ${id} at ${time}`);
    cells.get(time)!.set(id, numbers);
  }
  if (!times.length || !layerIds.length) throw new Error("editable CSV has no data rows");

  return {
    times,
    layers: layerIds.map((id) => {
      const q = { p025: [], p10: [], p25: [], p50: [], p75: [], p90: [], p975: [] } as Layer["q"];
      for (const time of times) {
        const values = cells.get(time)!.get(id);
        if (!values) throw new Error(`missing layer ${id} at ${time}`);
        KEYS.forEach((key, i) => q[key].push(values[i]));
      }
      return { id, q };
    }),
  };
}
