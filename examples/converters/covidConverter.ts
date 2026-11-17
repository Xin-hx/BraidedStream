import { validateInput, type InputDataset, type MeasureComponent } from "braided-stream/core";

const KEYS = ["q025", "q10", "q25", "q50", "q75", "q90", "q975"] as const;
const PROBABILITIES = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975] as const;

export const DEFAULT_COVID_STATES = ["Alabama", "Kentucky", "Mississippi", "Tennessee"] as const;
export type CovidStateSelection = "all" | readonly string[];
export interface CovidConverterOptions { readonly states?: CovidStateSelection }
export interface CovidDisplayMetadata {
  readonly modelNames: Readonly<Record<string, readonly (readonly string[])[]>>;
  readonly sampleSize: Readonly<Record<string, readonly number[]>>;
  readonly officialReferenceQuantiles: Readonly<Record<string, readonly (readonly number[])[]>>;
  readonly availableWeightCoverage: Readonly<Record<string, readonly number[]>>;
}

type Member = Record<(typeof KEYS)[number], number> & { model: string; weight: number };
type Cell = {
  forecast_date: string;
  target_end_date: string;
  ensemble: Record<(typeof KEYS)[number], number>;
  available_weight_sum: number;
  members: Member[];
};
type CovidCase = {
  meta: { target: string; time_field: string; ensemble: string; member_weight: string };
  states: Array<{ state: string; location: string; series: Cell[] }>;
};

export function convertCovidJson(text: string, options: CovidConverterOptions = {}): InputDataset {
  return convertCovidCase(text, options).dataset;
}

export function convertCovidCase(
  text: string,
  options: CovidConverterOptions = {},
): { dataset: InputDataset; metadata: CovidDisplayMetadata } {
  let data: CovidCase;
  try { data = JSON.parse(text) as CovidCase; } catch { throw new Error("COVID input must be valid JSON"); }
  if (data?.meta?.target !== "1 wk ahead inc case" ||
      data.meta.time_field !== "target_end_date" ||
      data.meta.ensemble !== "COVIDhub-trained_ensemble") {
    throw new Error("COVID case must use the trained 1-week incident-case target and target_end_date");
  }
  if (!Array.isArray(data.states)) throw new Error("COVID states must be an array");
  const selection = options.states ?? DEFAULT_COVID_STATES;
  const wanted = selection === "all" ? null : new Set(selection);
  const states = data.states.filter((state) => !wanted || wanted.has(state.state));
  if (!states.length) throw new Error("COVID state selection is empty");
  if (wanted && states.length !== wanted.size) throw new Error("COVID state selection contains an unavailable state");
  if (new Set(states.map((state) => state.state)).size !== states.length) throw new Error("COVID state names must be unique");
  if (states.some((state) => new Set(state.series.map((cell) => cell.target_end_date)).size !== state.series.length)) {
    throw new Error("COVID state series contains duplicate target dates");
  }

  const times = [...new Set(states.flatMap((state) => state.series.map((cell) => cell.target_end_date)))].sort();
  if (!times.length || times.some((time) => typeof time !== "string" || !Number.isFinite(Date.parse(time)))) {
    throw new Error("COVID target dates must be valid");
  }
  const dataset = validateInput({
    times,
    layers: states.map((state) => {
      const byTime = new Map(state.series.map((cell) => [cell.target_end_date, cell]));
      return {
        id: state.state,
        measures: times.map((time) => {
          const cell = byTime.get(time);
          if (!cell) throw new Error(`${state.state}: missing ${time}`);
          validateCell(cell, state.state, time);
          const totalWeight = cell.members.reduce((sum, member) => sum + member.weight, 0);
          return {
            components: cell.members.flatMap((member) =>
              reconstructMember(member, member.weight / totalWeight)
            ),
          };
        }),
      };
    }),
  });
  const modelNames: Record<string, string[][]> = {};
  const officialReferenceQuantiles: Record<string, number[][]> = {};
  const availableWeightCoverage: Record<string, number[]> = {};
  for (const state of states) {
    const byTime = new Map(state.series.map((cell) => [cell.target_end_date, cell]));
    modelNames[state.state] = times.map((time) => byTime.get(time)!.members.map((member) => member.model));
    officialReferenceQuantiles[state.state] = times.map((time) => KEYS.map((key) => byTime.get(time)!.ensemble[key]));
    availableWeightCoverage[state.state] = times.map((time) => byTime.get(time)!.available_weight_sum);
  }
  return {
    dataset,
    metadata: {
      modelNames,
      sampleSize: Object.fromEntries(Object.entries(modelNames).map(([id, names]) => [id, names.map((cell) => cell.length)])),
      officialReferenceQuantiles,
      availableWeightCoverage,
    },
  };
}

function validateCell(cell: Cell, state: string, time: string): void {
  if (!Number.isFinite(Date.parse(cell.forecast_date)) || !Number.isFinite(Date.parse(cell.target_end_date))) {
    throw new Error(`${state} ${time}: invalid forecast date`);
  }
  validateQuantiles(cell.ensemble, `${state} ${time}: invalid official reference quantiles`);
  if (!Number.isFinite(cell.available_weight_sum) || cell.available_weight_sum <= 0) {
    throw new Error(`${state} ${time}: invalid available weight coverage`);
  }
  if (!Array.isArray(cell.members) || !cell.members.length) throw new Error(`${state} ${time}: no members`);
  for (const member of cell.members) {
    if (!member.model || !Number.isFinite(member.weight) || member.weight <= 0) {
      throw new Error(`${state} ${time}: member weight must be finite and positive`);
    }
    validateQuantiles(member, `${state} ${time}: invalid member quantiles`);
  }
}

function validateQuantiles(values: Record<(typeof KEYS)[number], number>, message: string): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (const key of KEYS) {
    const value = values[key];
    if (!Number.isFinite(value) || value < 0 || value < previous) throw new Error(message);
    previous = value;
  }
}

function reconstructMember(member: Member, weight: number): MeasureComponent[] {
  const values = KEYS.map((key) => member[key]);
  const components: MeasureComponent[] = [
    { kind: "atom", value: values[0], mass: weight * PROBABILITIES[0] },
  ];
  for (let index = 1; index < PROBABILITIES.length; index += 1) {
    const mass = weight * (PROBABILITIES[index] - PROBABILITIES[index - 1]);
    components.push(values[index] === values[index - 1]
      ? { kind: "atom", value: values[index], mass }
      : { kind: "uniform", low: values[index - 1], high: values[index], mass });
  }
  components.push({
    kind: "atom",
    value: values.at(-1)!,
    mass: weight * (1 - PROBABILITIES.at(-1)!),
  });
  return components;
}
