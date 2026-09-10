/** COVID adapter: full member quantile functions form one weighted predictive mixture. */
import type { CanonicalLayer } from "../types";

type CovidCase = {
  meta: {
    target: string;
    time_field: string;
    ensemble: string;
    member_weight: string;
  };
  states: Array<{
    state: string;
    location: string;
    series: Array<{
      forecast_date: string;
      target_end_date: string;
      ensemble: Record<"q025" | "q10" | "q25" | "q50" | "q75" | "q90" | "q975", number>;
      actual: number | null;
      available_weight_sum: number;
      members: Array<{
        model: string;
        official_weight: number;
        weight: number;
        q025: number;
        q10: number;
        q25: number;
        q50: number;
        q75: number;
        q90: number;
        q975: number;
      }>;
    }>;
  }>;
};

export const DEFAULT_COVID_STATES = [
  "Alabama", "Kentucky", "Mississippi", "Tennessee",
] as const;
export type CovidStateSelection = "all" | readonly string[];

/** Official ensemble quantiles are retained only as a reference; geometry uses the member mixture. */
export function parseCovidCaseJson(
  text: string,
  stateSelection: CovidStateSelection = DEFAULT_COVID_STATES,
): { times: string[]; layers: CanonicalLayer[] } {
  const data = JSON.parse(text) as CovidCase;
  if (data.meta.target !== "1 wk ahead inc case" || data.meta.ensemble !== "COVIDhub-trained_ensemble") {
    throw new Error("COVID case must use the official trained 1-week incident-case ensemble");
  }
  const wanted = stateSelection === "all" ? null : new Set(stateSelection);
  const states = data.states.filter((state) => !wanted || wanted.has(state.state));
  if (!states.length) throw new Error("COVID state selection is empty");
  const times = [...new Set(states.flatMap((state) => state.series.map((cell) => cell.target_end_date)))].sort();
  const keys = ["q025", "q10", "q25", "q50", "q75", "q90", "q975"] as const;
  const layers = states.map((source): CanonicalLayer => {
    const byTime = new Map(source.series.map((cell) => [cell.target_end_date, cell]));
    const q = {
      p025: [] as number[], p10: [] as number[], p25: [] as number[], p50: [] as number[],
      p75: [] as number[], p90: [] as number[], p975: [] as number[],
    };
    const qKeys = ["p025", "p10", "p25", "p50", "p75", "p90", "p975"] as const;
    const distribution = times.map((time) => {
      const cell = byTime.get(time);
      if (!cell) throw new Error(`${source.state}: missing ${time}`);
      const submitted = keys.map((key) => cell.ensemble[key]);
      if (submitted.some((value, i) => !Number.isFinite(value) || (i > 0 && value < submitted[i - 1]))) {
        throw new Error(`${source.state} ${time}: invalid trained quantiles`);
      }
      qKeys.forEach((key, i) => q[key].push(submitted[i]));
      const weightSum = cell.members.reduce((sum, member) => sum + member.weight, 0);
      if (cell.members.some((member) => {
        const values = keys.map((key) => member[key]);
        return !Number.isFinite(member.weight) || member.weight <= 0 ||
          values.some((value, index) => !Number.isFinite(value) || value < 0 ||
            (index > 0 && value < values[index - 1]));
      })
          || Math.abs(weightSum - 1) > 1e-6) {
        throw new Error(`${source.state} ${time}: invalid active trained weights`);
      }
      return {
        kind: "quantile-mixture" as const,
        members: cell.members.map((member) => ({
          probabilities: [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975],
          values: [member.q025, member.q10, member.q25, member.q50, member.q75, member.q90, member.q975],
          weight: member.weight,
        })),
      };
    });
    return {
      id: source.state,
      q,
      magnitude: q.p50.slice(),
      distribution,
      sampleSize: source.series.map((cell) => cell.members.length),
      sourceKind: "quantile-mixture",
    };
  });
  return { times, layers };
}
