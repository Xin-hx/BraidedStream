/** State-level marginal forecast quantiles. No cross-state quantiles are summed. */
import { inputDataset } from "./dataInput";

const PROBABILITIES = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975];
const EAST_SOUTH_CENTRAL_STATES = new Set(["Alabama", "Kentucky", "Mississippi", "Tennessee"]);
export function parseCovidCsv(text: string) {
  const cells = new Map<string, Map<string, Map<number, number>>>();
  const dates = new Set<string>();
  const states = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("target_end_date")) continue;
    const [date, probabilityText, valueText, state] = line.split(",");
    const probability = Number(probabilityText);
    const value = Number(valueText);

    // --- DATA HERE ---
    if (!date || !EAST_SOUTH_CENTRAL_STATES.has(state) || !PROBABILITIES.includes(probability) || !Number.isFinite(value)) continue;

    dates.add(date); states.add(state);
    let dateCells = cells.get(date);
    if (!dateCells) { dateCells = new Map(); cells.set(date, dateCells); }
    let stateCells = dateCells.get(state);
    if (!stateCells) { stateCells = new Map(); dateCells.set(state, stateCells); }
    stateCells.set(probability, value);
  }
  const times = [...dates].sort();
  return inputDataset({
    times,
    magnitudePolicy: "median",
    layers: [...states].sort().map((id) => ({
      id,
      cells: times.map((time) => {
        const values = cells.get(time)?.get(id);
        return values ? { kind: "quantile" as const, probabilities: PROBABILITIES, quantiles: PROBABILITIES.map((probability) => values.get(probability) ?? Number.NaN) } : null;
      }),
    })),
  });
}
