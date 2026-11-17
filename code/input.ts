export type MeasureComponent =
  | { readonly kind: "atom"; readonly value: number; readonly mass: number }
  | {
      readonly kind: "uniform";
      readonly low: number;
      readonly high: number;
      readonly mass: number;
    };

export interface ProbabilityMeasure {
  readonly components: readonly MeasureComponent[];
}

export interface InputLayer {
  readonly id: string;
  readonly measures: readonly (ProbabilityMeasure | null)[];
}

export interface InputDataset {
  readonly times: readonly string[];
  readonly layers: readonly InputLayer[];
}

const NORMALIZATION_TOLERANCE = 1e-10;

/** Validate the public trust boundary and return a normalized, independent copy. */
export function validateInput(dataset: InputDataset): InputDataset {
  if (!dataset || !Array.isArray(dataset.times) || dataset.times.length === 0) {
    throw new Error("input time axis must be non-empty");
  }
  if (dataset.times.some((time) => typeof time !== "string") ||
      new Set(dataset.times).size !== dataset.times.length) {
    throw new Error("input time labels must be unique strings");
  }
  if (!Array.isArray(dataset.layers) || dataset.layers.length === 0) {
    throw new Error("input must contain at least one layer");
  }
  const ids = dataset.layers.map((layer) => layer?.id);
  if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("layer id must be a non-empty string");
  }
  if (new Set(ids).size !== ids.length) throw new Error("layer ids must be unique");

  let validCells = 0;
  const layers = dataset.layers.map((layer: InputLayer) => {
    if (!Array.isArray(layer.measures) || layer.measures.length !== dataset.times.length) {
      throw new Error(`layer ${layer.id}: measures length must equal times length`);
    }
    return {
      id: layer.id,
      measures: layer.measures.map((measure: ProbabilityMeasure | null, timeIndex: number) => {
        if (measure === null) return null;
        validCells += 1;
        return normalizeMeasure(measure, layer.id, timeIndex);
      }),
    };
  });
  if (validCells === 0) throw new Error("input dataset must contain at least one valid cell");
  return { times: [...dataset.times], layers };
}

function normalizeMeasure(measure: ProbabilityMeasure, layerId: string, timeIndex: number): ProbabilityMeasure {
  if (!measure || !Array.isArray(measure.components) || measure.components.length === 0) {
    throw new Error(`layer ${layerId} time ${timeIndex}: measure components must be non-empty`);
  }
  const components = measure.components.map((component): MeasureComponent => {
    if (!component || !Number.isFinite(component.mass) || component.mass < 0) {
      throw new Error(`layer ${layerId} time ${timeIndex}: component mass must be finite and non-negative`);
    }
    if (component.kind === "atom") {
      if (!Number.isFinite(component.value)) {
        throw new Error(`layer ${layerId} time ${timeIndex}: atom value must be finite`);
      }
      if (component.value < 0) throw new Error(`layer ${layerId} time ${timeIndex}: atom value must be non-negative`);
      return { kind: "atom", value: component.value, mass: component.mass };
    }
    if (component.kind !== "uniform" || !Number.isFinite(component.low) ||
        !Number.isFinite(component.high) || component.low < 0 || component.low >= component.high) {
      throw new Error(`layer ${layerId} time ${timeIndex}: invalid uniform interval`);
    }
    return { kind: "uniform", low: component.low, high: component.high, mass: component.mass };
  }).filter((component) => component.mass > 0);
  const total = compensatedSum(components.map((component) => component.mass));
  if (!(total > 0)) throw new Error(`layer ${layerId} time ${timeIndex}: measure needs positive mass`);
  if (Math.abs(total - 1) > NORMALIZATION_TOLERANCE) {
    throw new Error(`layer ${layerId} time ${timeIndex}: total mass must equal 1`);
  }
  return { components: canonicalize(components, total) };
}

function compensatedSum(values: readonly number[]): number {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value)
      ? sum - next + value
      : value - next + sum;
    sum = next;
  }
  return sum + correction;
}

function canonicalize(components: MeasureComponent[], total: number): MeasureComponent[] {
  const atoms = new Map<number, number>();
  const uniforms: Extract<MeasureComponent, { kind: "uniform" }>[] = [];
  for (const component of components) {
    const normalized = component.mass / total;
    if (component.kind === "atom") atoms.set(component.value, (atoms.get(component.value) ?? 0) + normalized);
    else uniforms.push({ ...component, mass: normalized });
  }
  uniforms.sort((a, b) => a.low - b.low || a.high - b.high || a.mass - b.mass);
  const merged: typeof uniforms = [];
  for (const component of uniforms) {
    const previous = merged.at(-1);
    const density = component.mass / (component.high - component.low);
    const previousDensity = previous ? previous.mass / (previous.high - previous.low) : Number.NaN;
    const densityScale = Math.max(Math.abs(density), Math.abs(previousDensity));
    if (previous && previous.high === component.low &&
        Math.abs(density - previousDensity) <= 16 * Number.EPSILON * densityScale) {
      merged[merged.length - 1] = {
        kind: "uniform",
        low: previous.low,
        high: component.high,
        mass: previous.mass + component.mass,
      };
    } else merged.push(component);
  }
  return [
    ...[...atoms].sort(([a], [b]) => a - b).map(([value, mass]) => ({ kind: "atom" as const, value, mass })),
    ...merged,
  ];
}
