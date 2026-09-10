import type { CanonicalLayer, DistributionCell, DistributionalTemporalDataset, QuantileMatrix } from "./types";

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
      const distribution: number[][] = [];
      const sampleSize: Array<number | null> = [];
      let sourceKind: CanonicalLayer["sourceKind"] = "quantile";
      for (const cell of layer.cells) {
        if (!cell) {
          for (const key of KEYS) q[key].push(Number.NaN);
          magnitude.push(Number.NaN);
          distribution.push([]);
          sampleSize.push(null);
          continue;
        }
        sourceKind = cell.kind;
        const values = PROBABILITIES.map((p) => quantileAt(cell, p));
        KEYS.forEach((key, index) => q[key].push(values[index]));
        if (cell.kind === "empirical") {
          magnitude.push(weightedMean(cell));
          distribution.push(cell.observations.map((observation) => observation.value));
          sampleSize.push(cell.observations.length);
        } else {
          magnitude.push(dataset.magnitudePolicy === "point" && cell.pointValue !== undefined ? cell.pointValue : quantileAt(cell, 0.5));
          distribution.push(cell.quantiles.slice());
          sampleSize.push(null);
        }
      }
      return { id: layer.id, magnitude, distribution, q, sampleSize, sourceKind };
    }),
  };
}

function quantileAt(cell: DistributionCell, probability: number): number {
  if (cell.kind === "empirical") return weightedQuantile(cell.observations, probability);
  if (cell.probabilities.length !== cell.quantiles.length || !cell.probabilities.length) throw new Error("invalid quantile cell");
  for (let i = 1; i < cell.probabilities.length; i += 1) {
    if (cell.probabilities[i] < cell.probabilities[i - 1] || cell.quantiles[i] < cell.quantiles[i - 1]) throw new Error("non-monotone quantile cell");
  }
  if (probability <= cell.probabilities[0]) return cell.quantiles[0];
  for (let i = 1; i < cell.probabilities.length; i += 1) {
    if (probability <= cell.probabilities[i]) {
      const a = (probability - cell.probabilities[i - 1]) / (cell.probabilities[i] - cell.probabilities[i - 1]);
      return cell.quantiles[i - 1] + a * (cell.quantiles[i] - cell.quantiles[i - 1]);
    }
  }
  return cell.quantiles.at(-1)!;
}

function weightedMean(cell: Extract<DistributionCell, { kind: "empirical" }>): number {
  const total = cell.observations.reduce((sum, observation) => sum + (observation.weight ?? 1), 0);
  return total ? cell.observations.reduce((sum, observation) => sum + observation.value * (observation.weight ?? 1), 0) / total : 0;
}

function weightedQuantile(observations: Extract<DistributionCell, { kind: "empirical" }>["observations"], probability: number): number {
  if (!observations.length) return 0;
  const values = [...observations].sort((a, b) => a.value - b.value);
  const total = values.reduce((sum, observation) => sum + (observation.weight ?? 1), 0);
  let cumulative = 0;
  for (const observation of values) {
    cumulative += observation.weight ?? 1;
    if (cumulative / total >= probability) return observation.value;
  }
  return values.at(-1)!.value;
}
