/** Distribution-derived layer geometry from the definitions in visual_design.tex. */
import type {
  BaseLayout,
  BraidedLayerGeometry,
  BraidedLayout,
  BraidedPointDebug,
  BraidedQuantiles,
  BraidedStreamOptions,
  DistributionAtTime,
  Layer,
  SpaceGeometry,
  WeightedPoint,
} from "../types";

export const DEFAULT_BRAIDED_STREAM_OPTIONS: BraidedStreamOptions = {
  bandwidthRatio: 0.3,
  epsilon: 1e-9,
  debug: false,
};

const QUANTILE_PROBABILITIES = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975];
const KDE_GRID_SIZE = 257;
export const ANALYSIS_INTEGRATION_STEPS = 128;

type Atom = { kind: "atom"; value: number; mass: number };
type UniformSegment = { kind: "uniform"; low: number; high: number; mass: number };
type MeasurePart = Atom | UniformSegment;
type KdeGrid = { x: number[]; density: number[] };
type Interval = { y0: number; y1: number };

export type BranchMode = { location: number; mass: number };
export type DistributionAnalysis = {
  /** Median of the declared, unsmoothed probability measure P. */
  representative: number;
  /** Median of the KDE-smoothed analysis distribution P_hat. */
  kdeMedian: number;
  mean: number;
  /** Exact lower and upper first partial moments of P around representative. */
  deviationLow: number;
  deviationHigh: number;
  dispersion: number;
  balance: number;
  bandwidth: number;
  modes: BranchMode[];
  separations: number[];
};
export type AnalysisDistribution = {
  summary: DistributionAnalysis;
  /** KDE density on the original value scale; zero for a retained point mass. */
  density: (value: number) => number;
  /** Quantile of the KDE-smoothed distribution. */
  quantile: (probability: number) => number;
  /** Survival mask S(x)=P_hat(X>x) on the shared non-negative value domain. */
  survival: (value: number) => number;
  /** Numerical upper bound used for integrals over the smoothed tail. */
  upper: number;
  /** Exact location for the zero-bandwidth case; null for a smoothed density. */
  pointMass: number | null;
};
export type AnalysisTopology = Array<Array<AnalysisDistribution | null>>;
export type BranchTopology = Array<Array<DistributionAnalysis | null>>;

export type DynamicSpaceRequests = {
  actual: number[][];
  balance: number[][];
  gaps: number[][][];
};

/** Return the declared distribution. A missing declared cell stays missing. */
export function distributionAt(layer: Layer, time: number): DistributionAtTime | null {
  if (layer.distribution) return layer.distribution[time] ?? null;
  const values = [
    layer.q.p025[time], layer.q.p10[time], layer.q.p25[time], layer.q.p50[time],
    layer.q.p75[time], layer.q.p90[time], layer.q.p975[time],
  ];
  return values.every(Number.isFinite)
    ? { kind: "quantiles", probabilities: QUANTILE_PROBABILITIES, values }
    : null;
}

/** Exact quantile summary of the declared, unsmoothed probability measure. */
export function getBraidedQuantiles(distribution: DistributionAtTime | null): BraidedQuantiles {
  if (!distribution) return zeroQuantiles();
  const parts = measureParts(distribution);
  return {
    qLow: measureQuantile(parts, 0.025),
    q10: measureQuantile(parts, 0.1),
    q25: measureQuantile(parts, 0.25),
    q50: measureQuantile(parts, 0.5),
    q75: measureQuantile(parts, 0.75),
    q90: measureQuantile(parts, 0.9),
    qHigh: measureQuantile(parts, 0.975),
  };
}

export function resolveLayerQuantiles(layer: Layer, time: number): BraidedQuantiles {
  const values = layer.q;
  return {
    qLow: values.p025[time], q10: values.p10[time], q25: values.p25[time],
    q50: values.p50[time], q75: values.p75[time], q90: values.p90[time],
    qHigh: values.p975[time],
  };
}

/** Analyze one empirical set, quantile function, or weighted quantile mixture. */
export function analyzeDistribution(
  distribution: DistributionAtTime | null,
  bandwidthRatio: number,
): DistributionAnalysis | null {
  return buildAnalysisDistribution(distribution, bandwidthRatio)?.summary ?? null;
}

/** Build the one analysis distribution consumed by both TPID and braiding. */
export function buildAnalysisDistribution(
  distribution: DistributionAtTime | null,
  bandwidthRatio: number,
): AnalysisDistribution | null {
  if (!distribution) return null;
  if (!Number.isFinite(bandwidthRatio) || bandwidthRatio <= 0) {
    throw new Error("bandwidthRatio beta must be finite and positive");
  }
  const parts = measureParts(distribution);
  if (!parts.length) return null;
  const representative = measureQuantile(parts, 0.5);
  const { deviationLow, deviationHigh } = partialMoments(parts, representative);
  const dispersion = deviationLow + deviationHigh;
  const balance = dispersion > 0
    ? (deviationHigh - deviationLow) / dispersion
    : 0;
  const { mean, variance, maximum } = moments(parts);
  if (variance === 0) {
    const summary = {
      representative,
      kdeMedian: mean,
      mean,
      deviationLow,
      deviationHigh,
      dispersion,
      balance,
      bandwidth: 0,
      modes: [{ location: mean, mass: 1 }],
      separations: [],
    };
    return {
      summary,
      density: () => 0,
      quantile: () => mean,
      survival: (value) => value >= 0 && value < mean ? 1 : 0,
      upper: mean,
      pointMass: mean,
    };
  }

  const bandwidth = bandwidthRatio * Math.sqrt(variance);
  const density = (x: number) => reflectedDensity(parts, bandwidth, x);
  const cdf = (x: number) => reflectedCdf(parts, bandwidth, x);
  let upper = maximum + 8 * bandwidth;
  while (cdf(upper) < 1 - 1e-10) upper *= 2;
  const kdeMedian = bisectCdf(cdf, upper, 0.5);
  const smoothedMean = parts.reduce((sum, part) => sum + part.mass * (
    part.kind === "atom"
      ? foldedNormalMean(part.value, bandwidth)
      : simpson(
          (z) => foldedNormalMean(z, bandwidth),
          part.low,
          part.high,
          ANALYSIS_INTEGRATION_STEPS,
        ) / (part.high - part.low)
  ), 0);
  const grid = kdeGrid(density, upper);
  const peakIndices = findPeaks(grid);
  const valleyIndices = peakIndices.slice(0, -1).map((peak, index) =>
    indexOfMinimum(grid.density, peak, peakIndices[index + 1])
  );
  const boundaries = valleyIndices.map((index) => grid.x[index]);
  const modes = peakIndices.map((index, modeIndex) => {
    const lowCdf = modeIndex === 0 ? 0 : cdf(boundaries[modeIndex - 1]);
    const highCdf = modeIndex === peakIndices.length - 1 ? 1 : cdf(boundaries[modeIndex]);
    return { location: grid.x[index], mass: Math.max(0, highCdf - lowCdf) };
  });
  normalizeModeMasses(modes);
  const separations = peakIndices.slice(0, -1).map((left, index) =>
    lowDensitySeparation(grid, left, peakIndices[index + 1])
  );
  const summary = {
    representative,
    kdeMedian,
    mean: smoothedMean,
    deviationLow,
    deviationHigh,
    dispersion,
    balance: clamp(balance, -1, 1),
    bandwidth,
    modes,
    separations,
  };
  return {
    summary,
    density,
    quantile: (probability) => bisectCdf(cdf, upper, clamp(probability, 0, 1)),
    survival: (value) => value < 0 ? 0 : clamp(1 - cdf(value), 0, 1),
    upper,
    pointMass: null,
  };
}

/** Expected overlap E[min(X,Y)] for independent draws from two analysis distributions. */
export function analysisOverlap(a: AnalysisDistribution, b: AnalysisDistribution): number {
  if (a.pointMass !== null && b.pointMass !== null) {
    return Math.min(a.pointMass, b.pointMass);
  }
  if (a.pointMass !== null) {
    return a.pointMass > 0
      ? simpson(b.survival, 0, Math.min(a.pointMass, b.upper), ANALYSIS_INTEGRATION_STEPS)
      : 0;
  }
  if (b.pointMass !== null) {
    return b.pointMass > 0
      ? simpson(a.survival, 0, Math.min(b.pointMass, a.upper), ANALYSIS_INTEGRATION_STEPS)
      : 0;
  }
  // The product vanishes with the shorter tail; a larger peer must not coarsen this grid.
  const upper = Math.min(a.upper, b.upper);
  return upper > 0
    ? simpson((value) => a.survival(value) * b.survival(value), 0, upper, ANALYSIS_INTEGRATION_STEPS)
    : 0;
}

export function computeAnalysisTopology(
  layers: Layer[],
  bandwidthRatio: number,
): AnalysisTopology {
  return layers.map((layer) =>
    layer.q.p50.map((_, time) =>
      buildAnalysisDistribution(distributionAt(layer, time), bandwidthRatio)
    )
  );
}

export function branchTopologyFromAnalysis(analysis: AnalysisTopology): BranchTopology {
  return analysis.map((layer) => layer.map((cell) => cell?.summary ?? null));
}

/** Sample true KDE density at equal-probability bins; one scale is shared across time per layer. */
export function densityProfilesFromAnalysis(
  analysis: AnalysisTopology,
  bins: number,
): Array<Array<number[] | null>> {
  if (!Number.isInteger(bins) || bins < 2) {
    throw new Error("density profile bins must be an integer >= 2");
  }
  return analysis.map((layer) => {
    const raw = layer.map((cell) => {
      if (!cell) return null;
      if (cell.pointMass !== null) return new Array<number>(bins).fill(Number.NaN);
      return Array.from({ length: bins }, (_, bin) => {
        const probability = (bin + 0.5) / bins;
        return cell.density(cell.quantile(probability));
      });
    });
    const maximum = Math.max(0, ...raw.flatMap((profile) =>
      profile?.filter(Number.isFinite) ?? []
    ));
    return raw.map((profile) => profile?.map((value) =>
      Number.isNaN(value) ? 1 : maximum > 0 ? clamp(value / maximum, 0, 1) : 0
    ) ?? null);
  });
}

export function computeBranchTopology(
  orderedLayers: Layer[],
  bandwidthRatio: number,
): BranchTopology {
  return branchTopologyFromAnalysis(computeAnalysisTopology(orderedLayers, bandwidthRatio));
}

/** Allocate D=U once across A_-, d_1,...,d_(K-1), A_+. */
export function requestDynamicSpaces(topology: BranchTopology): DynamicSpaceRequests {
  const actual: number[][] = [];
  const balance: number[][] = [];
  const gaps: number[][][] = [];
  for (let i = 0; i < topology.length; i += 1) {
    actual[i] = [];
    balance[i] = [];
    gaps[i] = [];
    for (let t = 0; t < topology[i].length; t += 1) {
      const point = topology[i][t];
      if (!point) {
        actual[i][t] = 0;
        balance[i][t] = 0;
        gaps[i][t] = [0, 0];
        continue;
      }
      const weights = [point.deviationLow, ...point.separations, point.deviationHigh];
      const total = weights.reduce((sum, value) => sum + value, 0);
      actual[i][t] = point.dispersion;
      balance[i][t] = point.balance;
      gaps[i][t] = total > 0
        ? weights.map((value) => point.dispersion * value / total)
        : weights.map(() => 0);
    }
  }
  return { actual, balance, gaps };
}

export function computeActiveMask(space: number[][]): boolean[][] {
  return space.map((row) => row.map((value) => value > 0));
}

type Placement = { branches: Array<Interval & { center: number }>; gaps: Interval[] };

function placeBranches(modes: BranchMode[], height: number, gaps: number[]): Placement {
  let assigned = 0;
  let cursor = gaps[0] ?? 0;
  const branches = modes.map((mode, index) => {
    const branchHeight = index + 1 === modes.length ? height - assigned : mode.mass * height;
    const y0 = cursor;
    const y1 = y0 + branchHeight;
    assigned += branchHeight;
    cursor = y1 + (gaps[index + 1] ?? 0);
    return { y0, y1, center: (y0 + y1) / 2 };
  });
  return {
    branches,
    gaps: gaps.map((gap, index) => {
      const y0 = index === 0 ? 0 : branches[index - 1].y1;
      return { y0, y1: y0 + gap };
    }),
  };
}

export function buildLayerSlotGeometry(
  orderedLayers: Layer[],
  quantiles: BraidedQuantiles[][],
  topology: BranchTopology,
  slotBase: BaseLayout,
  requested: DynamicSpaceRequests,
  options: BraidedStreamOptions,
): BraidedLayout {
  const tLen = slotBase.baseline.length;
  const layers: BraidedLayerGeometry[] = [];

  for (let i = 0; i < orderedLayers.length; i += 1) {
    const maxBranches = Math.max(1, ...topology[i].map((point) => point?.modes.length ?? 0));
    const branches = Array.from({ length: maxBranches }, (_, branchIndex) => ({
      layerId: orderedLayers[i].id,
      branchIndex,
      mass: 0,
      masses: new Array<number>(tLen).fill(0),
      y0: new Array<number>(tLen),
      y1: new Array<number>(tLen),
    }));
    const spaces = Array.from({ length: maxBranches + 1 }, (_, index): SpaceGeometry => ({
      ownerLayerId: orderedLayers[i].id,
      kind: index === 0 ? "lower" : index === maxBranches ? "upper" : "internal",
      gapIndex: index === maxBranches ? maxBranches : index - 1,
      y0: new Array<number>(tLen),
      y1: new Array<number>(tLen),
    }));
    const branchCount = new Array<number>(tLen);
    const missing = new Array<boolean>(tLen);
    const visualEnvelopeY0 = new Array<number>(tLen);
    const visualEnvelopeY1 = new Array<number>(tLen);
    const debug = options.debug ? new Array<BraidedPointDebug>(tLen) : undefined;

    for (let t = 0; t < tLen; t += 1) {
      const point = topology[i][t];
      const low = slotBase.yBottom[i][t];
      const high = slotBase.yTop[i][t];
      const H = orderedLayers[i].magnitude?.[t] ?? 0;
      const modes = point?.modes ?? [{ location: 0, mass: 1 }];
      const localGaps = point ? requested.gaps[i][t] : [0, 0];
      const placement = placeBranches(modes, H, localGaps);
      const count = point?.modes.length ?? 0;
      branchCount[t] = count;
      missing[t] = !point;
      visualEnvelopeY0[t] = low;
      visualEnvelopeY1[t] = high;

      const absolute = placement.branches.slice(0, count).map((branch, index) => {
        const interval = { y0: low + branch.y0, y1: low + branch.y1 };
        branches[index].masses[t] = point!.modes[index].mass;
        branches[index].y0[t] = interval.y0;
        branches[index].y1[t] = interval.y1;
        return interval;
      });
      const coloredEnd = absolute.at(-1)?.y1 ?? low;
      for (let index = count; index < maxBranches; index += 1) {
        branches[index].y0[t] = coloredEnd;
        branches[index].y1[t] = coloredEnd;
      }

      const lower = placement.gaps[0] ?? { y0: 0, y1: 0 };
      spaces[0].y0[t] = low + lower.y0;
      spaces[0].y1[t] = low + lower.y1;
      for (let index = 1; index < maxBranches; index += 1) {
        const gap = index < count
          ? placement.gaps[index]
          : { y0: coloredEnd - low, y1: coloredEnd - low };
        spaces[index].y0[t] = low + gap.y0;
        spaces[index].y1[t] = low + gap.y1;
      }
      const upper = placement.gaps[count] ?? { y0: coloredEnd - low, y1: coloredEnd - low };
      spaces[maxBranches].y0[t] = low + upper.y0;
      spaces[maxBranches].y1[t] = low + upper.y1;

      if (debug) {
        debug[t] = {
          ...quantiles[i][t],
          H,
          kdeMedian: point?.kdeMedian ?? Number.NaN,
          mean: point?.mean ?? Number.NaN,
          deviationLow: point?.deviationLow ?? 0,
          deviationHigh: point?.deviationHigh ?? 0,
          dispersion: point?.dispersion ?? 0,
          bandwidth: point?.bandwidth ?? 0,
          bandwidthRatio: options.bandwidthRatio,
          active: Boolean(point && point.dispersion > 0),
          missing: !point,
          branchCount: count,
          modeLocations: point?.modes.map((mode) => mode.location) ?? [],
          branchMasses: point?.modes.map((mode) => mode.mass) ?? [],
          separations: point?.separations ?? [],
          gaps: localGaps,
          branchCenters: absolute.map((interval) => (interval.y0 + interval.y1) / 2),
          envelopeLow: low,
          envelopeHigh: high,
          balance: point?.balance ?? 0,
          actualSpace: point?.dispersion ?? 0,
          branchIntervals: absolute,
          visibleBranchCount: count,
        };
      }
    }
    for (const branch of branches) {
      branch.mass = branch.masses.reduce((sum, mass) => sum + mass, 0) / tLen;
    }
    layers.push({
      layerId: orderedLayers[i].id,
      branchCount,
      missing,
      active: activeFromTopology(topology[i]),
      branches,
      spaces,
      visualEnvelopeY0,
      visualEnvelopeY1,
      slotY0: slotBase.yBottom[i],
      slotY1: slotBase.yTop[i],
      actualSpace: requested.actual[i],
      balance: requested.balance[i],
      debug,
    });
  }

  const yBottomStar = layers.map((layer) => layer.branches[0].y0.slice());
  const yTopStar = layers.map((layer) => layer.slotY0.map((low, t) => {
    const count = layer.branchCount[t];
    return count ? layer.branches[count - 1].y1[t] : low;
  }));
  return {
    layers,
    yBottomStar,
    yTopStar,
    actualSpace: requested.actual,
    totalHeight: slotBase.yTop.at(-1)!.map((top, t) => top - slotBase.yBottom[0][t]),
    envelopeLow: layers.map((layer) => layer.slotY0),
    envelopeHigh: layers.map((layer) => layer.slotY1),
  };
}

function activeFromTopology(points: Array<DistributionAnalysis | null>): boolean[] {
  return points.map((point) => Boolean(point && point.dispersion > 0));
}

function measureParts(distribution: DistributionAtTime): MeasurePart[] {
  if (distribution.kind === "samples") {
    return normalizedSamples(distribution.values, distribution.weights).map((point) => ({
      kind: "atom", value: point.value, mass: point.weight,
    }));
  }
  if (distribution.kind === "quantiles") {
    return quantileParts(distribution.probabilities, distribution.values, 1);
  }
  const members = distribution.members.filter((member) => Number.isFinite(member.weight) && member.weight > 0);
  const total = members.reduce((sum, member) => sum + member.weight, 0);
  if (!total) return [];
  return members.flatMap((member) =>
    quantileParts(member.probabilities, member.values, member.weight / total)
  );
}

function normalizedSamples(values: number[], weights?: number[]): WeightedPoint[] {
  if (weights && weights.length !== values.length) throw new Error("sample weights length mismatch");
  const points: WeightedPoint[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const weight = weights?.[index] ?? 1;
    if (!Number.isFinite(value)) continue;
    if (value < 0) throw new Error("distribution values must be non-negative");
    if (!Number.isFinite(weight) || weight <= 0) throw new Error("sample weights must be finite and positive");
    points.push({ value, weight });
  }
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  return total ? points.map((point) => ({ ...point, weight: point.weight / total })) : [];
}

function quantileParts(probabilities: number[], values: number[], totalMass: number): MeasurePart[] {
  const knots = validatedKnots(probabilities, values);
  const parts: MeasurePart[] = [];
  addAtom(parts, knots[0].value, totalMass * knots[0].probability);
  for (let index = 0; index + 1 < knots.length; index += 1) {
    const left = knots[index];
    const right = knots[index + 1];
    const mass = totalMass * (right.probability - left.probability);
    if (right.value === left.value) addAtom(parts, left.value, mass);
    else parts.push({ kind: "uniform", low: left.value, high: right.value, mass });
  }
  addAtom(parts, knots.at(-1)!.value, totalMass * (1 - knots.at(-1)!.probability));
  return parts;
}

function validatedKnots(probabilities: number[], values: number[]) {
  if (!probabilities.length || probabilities.length !== values.length) {
    throw new Error("invalid quantile distribution");
  }
  const knots = probabilities.map((probability, index) => ({ probability, value: values[index] }))
    .sort((a, b) => a.probability - b.probability);
  for (let index = 0; index < knots.length; index += 1) {
    const knot = knots[index];
    const previous = knots[index - 1];
    if (!Number.isFinite(knot.probability) || knot.probability <= 0 || knot.probability >= 1 ||
        !Number.isFinite(knot.value) || knot.value < 0 ||
        (index > 0 && (knot.probability <= previous.probability || knot.value < previous.value))) {
      throw new Error("quantile probabilities must be strictly ordered in (0,1) and values non-negative and monotone");
    }
  }
  return knots;
}

function addAtom(parts: MeasurePart[], value: number, mass: number): void {
  if (mass > 0) parts.push({ kind: "atom", value, mass });
}

function moments(parts: MeasurePart[]): { mean: number; variance: number; maximum: number } {
  let mean = 0;
  let maximum = 0;
  for (const part of parts) {
    const partMean = part.kind === "atom" ? part.value : (part.low + part.high) / 2;
    mean += part.mass * partMean;
    maximum = Math.max(maximum, part.kind === "atom" ? part.value : part.high);
  }
  const variance = parts.reduce((sum, part) => {
    const partMean = part.kind === "atom" ? part.value : (part.low + part.high) / 2;
    const within = part.kind === "atom" ? 0 : (part.high - part.low) ** 2 / 12;
    return sum + part.mass * ((partMean - mean) ** 2 + within);
  }, 0);
  return { mean, variance, maximum };
}

/** Exact first partial moments of the original atom/uniform measure around r. */
function partialMoments(
  parts: MeasurePart[],
  representative: number,
): { deviationLow: number; deviationHigh: number } {
  let deviationLow = 0;
  let deviationHigh = 0;
  for (const part of parts) {
    if (part.kind === "atom") {
      deviationLow += part.mass * Math.max(representative - part.value, 0);
      deviationHigh += part.mass * Math.max(part.value - representative, 0);
      continue;
    }
    const split = Math.max(part.low, Math.min(representative, part.high));
    const density = part.mass / (part.high - part.low);
    deviationLow += density * (
      representative * (split - part.low) - (split ** 2 - part.low ** 2) / 2
    );
    deviationHigh += density * (
      (part.high ** 2 - split ** 2) / 2 - representative * (part.high - split)
    );
  }
  return {
    deviationLow: Math.max(0, deviationLow),
    deviationHigh: Math.max(0, deviationHigh),
  };
}

function reflectedDensity(parts: MeasurePart[], bandwidth: number, x: number): number {
  if (x < 0) return 0;
  return parts.reduce((sum, part) => {
    if (part.kind === "atom") {
      return sum + part.mass * (
        normalPdf((x - part.value) / bandwidth) + normalPdf((x + part.value) / bandwidth)
      ) / bandwidth;
    }
    const direct = normalCdf((x - part.low) / bandwidth) - normalCdf((x - part.high) / bandwidth);
    const reflected = normalCdf((x + part.high) / bandwidth) - normalCdf((x + part.low) / bandwidth);
    return sum + part.mass * (direct + reflected) / (part.high - part.low);
  }, 0);
}

function reflectedCdf(parts: MeasurePart[], bandwidth: number, x: number): number {
  if (x <= 0) return 0;
  const value = parts.reduce((sum, part) => {
    if (part.kind === "atom") {
      return sum + part.mass * (
        normalCdf((x - part.value) / bandwidth) + normalCdf((x + part.value) / bandwidth) - 1
      );
    }
    const direct = bandwidth * (
      normalCdfIntegral((x - part.low) / bandwidth) -
      normalCdfIntegral((x - part.high) / bandwidth)
    );
    const reflected = bandwidth * (
      normalCdfIntegral((x + part.high) / bandwidth) -
      normalCdfIntegral((x + part.low) / bandwidth)
    );
    return sum + part.mass * (direct + reflected - (part.high - part.low)) /
      (part.high - part.low);
  }, 0);
  return clamp(value, 0, 1);
}

function foldedNormalMean(value: number, bandwidth: number): number {
  const z = value / bandwidth;
  return bandwidth * Math.sqrt(2 / Math.PI) * Math.exp(-0.5 * z * z) +
    value * (2 * normalCdf(z) - 1);
}

function kdeGrid(density: (x: number) => number, upper: number): KdeGrid {
  const x = Array.from({ length: KDE_GRID_SIZE }, (_, index) => upper * index / (KDE_GRID_SIZE - 1));
  return { x, density: x.map(density) };
}

function findPeaks(grid: KdeGrid): number[] {
  const peaks: number[] = [];
  if (grid.density[0] > 0 && grid.density[0] >= grid.density[1]) peaks.push(0);
  for (let index = 1; index + 1 < grid.x.length; index += 1) {
    if (grid.density[index] <= grid.density[index - 1]) continue;
    let end = index;
    while (end + 1 < grid.x.length && grid.density[end + 1] === grid.density[index]) end += 1;
    if (end + 1 < grid.x.length && grid.density[end] > grid.density[end + 1]) {
      peaks.push(Math.floor((index + end) / 2));
    }
    index = end;
  }
  return peaks.length ? peaks : [indexOfMaximum(grid.density)];
}

function lowDensitySeparation(grid: KdeGrid, left: number, right: number): number {
  const level = Math.min(grid.density[left], grid.density[right]);
  if (!(level > 0) || right <= left) return 0;
  let integral = 0;
  let previous = Math.max(0, 1 - grid.density[left] / level);
  for (let index = left + 1; index <= right; index += 1) {
    const current = Math.max(0, 1 - grid.density[index] / level);
    integral += (current + previous) * (grid.x[index] - grid.x[index - 1]) / 2;
    previous = current;
  }
  return integral;
}

function normalizeModeMasses(modes: BranchMode[]): void {
  const total = modes.reduce((sum, mode) => sum + mode.mass, 0);
  if (total > 0) for (const mode of modes) mode.mass /= total;
}

function measureQuantile(parts: MeasurePart[], probability: number): number {
  if (!parts.length) return Number.NaN;
  const upper = Math.max(...parts.map((part) => part.kind === "atom" ? part.value : part.high));
  const cdf = (value: number) => parts.reduce((sum, part) => {
    if (part.kind === "atom") return sum + (part.value <= value ? part.mass : 0);
    if (value <= part.low) return sum;
    if (value >= part.high) return sum + part.mass;
    return sum + part.mass * (value - part.low) / (part.high - part.low);
  }, 0);
  return bisectCdf(cdf, upper, probability);
}

function bisectCdf(cdf: (x: number) => number, upper: number, probability: number): number {
  let low = 0;
  let high = upper;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (cdf(midpoint) < probability) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function simpson(fn: (value: number) => number, low: number, high: number, steps: number): number {
  if (high <= low) return 0;
  const evenSteps = steps % 2 ? steps + 1 : steps;
  const width = (high - low) / evenSteps;
  let sum = fn(low) + fn(high);
  for (let index = 1; index < evenSteps; index += 1) {
    sum += (index % 2 ? 4 : 2) * fn(low + index * width);
  }
  return sum * width / 3;
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function normalCdfIntegral(value: number): number {
  return value * normalCdf(value) + normalPdf(value);
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
    0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function indexOfMaximum(values: number[]): number {
  return values.reduce((best, value, index) => value > values[best] ? index : best, 0);
}

function indexOfMinimum(values: number[], start: number, end: number): number {
  let best = start;
  for (let index = start + 1; index <= end; index += 1) {
    if (values[index] < values[best]) best = index;
  }
  let last = best;
  while (last + 1 <= end && values[last + 1] === values[best]) last += 1;
  return Math.floor((best + last) / 2);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function zeroQuantiles(): BraidedQuantiles {
  return { qLow: 0, q10: 0, q25: 0, q50: 0, q75: 0, q90: 0, qHigh: 0 };
}
