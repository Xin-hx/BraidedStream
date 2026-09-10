import type { CanonicalLayer, DistributionAtTime, DistributionCell, DistributionalTemporalDataset, QuantileMatrix } from "../types";

const PROBABILITIES = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975] as const;
const KEYS: (keyof QuantileMatrix)[] = ["p025", "p10", "p25", "p50", "p75", "p90", "p975"];

export function inputDataset(dataset: DistributionalTemporalDataset): {
  times: string[];
  layers: CanonicalLayer[];
} {
  return {
    times: dataset.times,
    layers: dataset.layers.map((layer) => {
      if (layer.cells.length !== dataset.times.length) throw new Error(`layer ${layer.id}: cell count mismatch`);
      const q = { p025: [], p10: [], p25: [], p50: [], p75: [], p90: [], p975: [] } as QuantileMatrix;
      const magnitude: number[] = [];
      const distribution: Array<DistributionAtTime | null> = [];
      const sampleSize: Array<number | null> = [];
      let sourceKind: CanonicalLayer["sourceKind"] = "quantile";
      for (const cell of layer.cells) {
        if (!cell) {
          for (const key of KEYS) q[key].push(Number.NaN);
          magnitude.push(Number.NaN);
          distribution.push(null);
          sampleSize.push(null);
          continue;
        }
        sourceKind = cell.kind;
        const noObservedMembers = cell.kind === "empirical" && !cell.observations.some((observation) => Number.isFinite(observation.value));
        const values = noObservedMembers
          ? PROBABILITIES.map(() => Number.NaN)
          : PROBABILITIES.map((p) => quantileAt(cell, p));
        KEYS.forEach((key, index) => q[key].push(values[index]));
        if (cell.kind === "empirical") {
          magnitude.push(noObservedMembers
            ? Number.NaN
            : dataset.magnitudePolicy === "empirical-mean"
              ? weightedMean(cell)
              : weightedQuantile(cell.observations, 0.5));
          distribution.push(noObservedMembers ? null : {
            kind: "samples",
            values: cell.observations.map((observation) => observation.value),
            weights: cell.observations.map((observation) => observation.weight ?? 1),
          });
          sampleSize.push(cell.observations.filter((observation) => Number.isFinite(observation.value)).length);
        } else {
          const sorted = sortedQuantiles(cell);
          magnitude.push(dataset.magnitudePolicy === "point" && cell.pointValue !== undefined ? cell.pointValue : quantileAt(cell, 0.5));
          distribution.push({ kind: "quantiles", probabilities: sorted.map((pair) => pair.probability), values: sorted.map((pair) => pair.value) });
          sampleSize.push(null);
        }
      }
      return {
        id: layer.id,
        magnitude,
        distribution,
        q,
        sampleSize,
        sourceKind,
        ...(layer.uncertainty ? { uncertainty: layer.uncertainty.slice() } : {}),
      };
    }),
  };
}

function quantileAt(cell: DistributionCell, probability: number): number {
  if (cell.kind === "empirical") return weightedQuantile(cell.observations, probability);
  const pairs = sortedQuantiles(cell);
  if (probability <= pairs[0].probability) return pairs[0].value;
  for (let i = 1; i < pairs.length; i += 1) {
    if (probability <= pairs[i].probability) {
      const a = (probability - pairs[i - 1].probability) / (pairs[i].probability - pairs[i - 1].probability);
      return pairs[i - 1].value + a * (pairs[i].value - pairs[i - 1].value);
    }
  }
  return pairs.at(-1)!.value;
}

function sortedQuantiles(cell: Extract<DistributionCell, { kind: "quantile" }>) {
  if (cell.probabilities.length !== cell.quantiles.length || !cell.probabilities.length) throw new Error("invalid quantile cell");
  const pairs = cell.probabilities.map((probability, i) => ({ probability, value: cell.quantiles[i] })).sort((a, b) => a.probability - b.probability);
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (!Number.isFinite(pair.probability) || pair.probability <= 0 || pair.probability >= 1 || !Number.isFinite(pair.value) || pair.value < 0) throw new Error("invalid quantile cell");
    if (i > 0 && (pair.probability <= pairs[i - 1].probability || pair.value < pairs[i - 1].value)) throw new Error("non-monotone quantile cell");
  }
  return pairs;
}

function weightedMean(cell: Extract<DistributionCell, { kind: "empirical" }>): number {
  const observations = cell.observations.filter((observation) => Number.isFinite(observation.value) && Number.isFinite(observation.weight ?? 1) && (observation.weight ?? 1) > 0);
  const total = observations.reduce((sum, observation) => sum + (observation.weight ?? 1), 0);
  return total ? observations.reduce((sum, observation) => sum + observation.value * (observation.weight ?? 1), 0) / total : Number.NaN;
}

function weightedQuantile(observations: Extract<DistributionCell, { kind: "empirical" }>["observations"], probability: number): number {
  const values = observations.filter((observation) => Number.isFinite(observation.value) && Number.isFinite(observation.weight ?? 1) && (observation.weight ?? 1) > 0).sort((a, b) => a.value - b.value);
  if (!values.length) return Number.NaN;
  const total = values.reduce((sum, observation) => sum + (observation.weight ?? 1), 0);
  let cumulative = 0;
  for (const observation of values) {
    cumulative += observation.weight ?? 1;
    if (cumulative / total >= probability) return observation.value;
  }
  return values.at(-1)!.value;
}
