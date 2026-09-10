/** Quantile envelopes with KDE-supported, mass-conserving branches. */
import type {
  BaseLayout,
  BraidedLayerGeometry,
  BraidedLayout,
  BraidedPointDebug,
  BraidedQuantiles,
  BraidedStreamOptions,
  CollisionRelaxationStats,
  DistributionAtTime,
  Layer,
  SpaceGeometry,
  WeightedPoint,
} from "../types";

export const DEFAULT_BRAIDED_STREAM_OPTIONS: BraidedStreamOptions = {
  representativeQuantile: 0.5,
  envelopeQuantile: 0.9,
  uncertaintyFocusPercent: 10,
  epsilon: 1e-9,
  debug: false,
};

export const MIN_BRANCH_MASS = 0.1;
export const MIN_VALLEY_DEPTH = 0.2;
const KDE_GRID_SIZE = 128;

type KdeGrid = { x: number[]; density: number[] };
type ModeBasin = { peakIndex: number; mass: number };
export type BranchMode = { location: number; mass: number };
export type BranchTopologyPoint = {
  modes: BranchMode[];
  rawBranchCount: 1 | 2 | 3;
  branchCount: 1 | 2 | 3;
};
export type BranchTopology = BranchTopologyPoint[][];

/** Sorted weighted samples; missing observations are not real zero values. */
function normalizeSamples(distribution: Extract<DistributionAtTime, { kind: "samples" }>): WeightedPoint[] {
  return normalizeWeightedValues(distribution.values, distribution.weights);
}

function normalizeWeightedValues(values: number[], weights?: number[]): WeightedPoint[] {
  if (weights && weights.length !== values.length) {
    throw new Error("sample weights length mismatch");
  }
  const points = values.map((value, i) => ({
    value, weight: weights?.[i] ?? 1,
  })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.weight) && point.weight > 0)
    .sort((a, b) => a.value - b.value);
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  return points.map((point) => ({ value: point.value, weight: point.weight / total }));
}

export function distributionAt(layer: Layer, time: number): DistributionAtTime {
  // Missing cells use the already validated/interpolated quantiles.
  return layer.distribution?.[time] ?? {
    kind: "quantiles",
    probabilities: [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975],
    values: [layer.q.p025[time], layer.q.p10[time], layer.q.p25[time], layer.q.p50[time], layer.q.p75[time], layer.q.p90[time], layer.q.p975[time]],
  };
}

/** Selected representative Q^rho plus a configurable upper-quantile contour Q^eta. */
export function getBraidedQuantiles(
  distribution: DistributionAtTime | null,
  envelopeQuantile = 0.9,
  representativeQuantile = 0.5,
): BraidedQuantiles {
  assertQuantileSelection(representativeQuantile, envelopeQuantile);
  if (!distribution) return { qLow: 0, q25: 0, q50: 0, q75: 0, qRepresentative: 0, qEnvelope: 0, qHigh: 0 };
  if (distribution.kind === "samples") {
    const points = normalizeSamples(distribution);
    return {
      qLow: weightedQuantile(points, 0.025),
      q25: weightedQuantile(points, 0.25),
      q50: weightedQuantile(points, 0.5),
      q75: weightedQuantile(points, 0.75),
      qRepresentative: weightedQuantile(points, representativeQuantile),
      qEnvelope: weightedQuantile(points, envelopeQuantile),
      qHigh: weightedQuantile(points, 0.975),
    };
  }
  if (!distribution.probabilities.length || distribution.probabilities.length !== distribution.values.length) {
    throw new Error("invalid quantile distribution");
  }
  const knots = distribution.probabilities.map((probability, i) => ({
    probability, value: distribution.values[i],
  })).sort((a, b) => a.probability - b.probability);
  for (let i = 0; i < knots.length; i += 1) {
    const knot = knots[i];
    if (!Number.isFinite(knot.probability) || knot.probability < 0 || knot.probability > 1 ||
        !Number.isFinite(knot.value) ||
        (i > 0 && (knot.probability <= knots[i - 1].probability || knot.value < knots[i - 1].value))) {
      throw new Error("quantile probabilities must be unique and values finite and monotone");
    }
  }
  // Do not invent tails beyond the supplied probability range.
  const probabilityTolerance = 1e-12;
  if (knots[0].probability > 0.025 + probabilityTolerance ||
      knots.at(-1)!.probability < 0.975 - probabilityTolerance) {
    throw new Error("quantile data does not cover Q2.5 and Q97.5");
  }
  const at = (probability: number): number => {
    if (probability <= knots[0].probability) return knots[0].value;
    if (probability >= knots.at(-1)!.probability) return knots.at(-1)!.value;
    const upper = knots.findIndex((knot) => knot.probability >= probability);
    const a = knots[upper - 1];
    const b = knots[upper];
    return a.value + (probability - a.probability) / (b.probability - a.probability) * (b.value - a.value);
  };
  return {
    qLow: at(0.025), q25: at(0.25), q50: at(0.5), q75: at(0.75),
    qRepresentative: at(representativeQuantile),
    qEnvelope: at(envelopeQuantile), qHigh: at(0.975),
  };
}

/**
 * Single downstream entry for representative and envelope values.
 * Hybrid layers keep official ensemble quantiles for geometry; member Q50s
 * remain exclusively the KDE source.
 */
export function resolveLayerQuantiles(
  layer: Layer,
  time: number,
  envelopeQuantile = 0.9,
  representativeQuantile = 0.5,
): BraidedQuantiles {
  if (layer.sourceKind !== "hybrid") {
    return getBraidedQuantiles(distributionAt(layer, time), envelopeQuantile, representativeQuantile);
  }
  return getBraidedQuantiles({
    kind: "quantiles",
    probabilities: [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975],
    values: [
      layer.q.p025[time], layer.q.p10[time], layer.q.p25[time],
      layer.q.p50[time], layer.q.p75[time], layer.q.p90[time], layer.q.p975[time],
    ],
  }, envelopeQuantile, representativeQuantile);
}

function assertQuantileSelection(representativeQuantile: number, envelopeQuantile: number): void {
  if (!Number.isFinite(envelopeQuantile) || envelopeQuantile <= 0.5 || envelopeQuantile > 0.975) {
    throw new Error("envelopeQuantile must be in (0.5, 0.975]");
  }
  if (!Number.isFinite(representativeQuantile) || representativeQuantile < 0.025 || representativeQuantile >= envelopeQuantile) {
    throw new Error("representativeQuantile must be in [0.025, envelopeQuantile)");
  }
}

function weightedQuantile(points: WeightedPoint[], probability: number): number {
  if (!points.length) return 0;
  let cumulative = 0;
  for (const point of points) {
    cumulative += point.weight;
    if (cumulative + Number.EPSILON >= probability) return point.value;
  }
  return points.at(-1)!.value;
}

export type EnvelopeSpaceRequests = {
  /** Permanent Q^eta - Q^rho envelope capacity. */
  capacity: number[][];
  /** Exposure-controlled portion of capacity used as internal branch gaps. */
  total: number[][];
};

/** Layout uses data units; the renderer applies the same linear y scale to everything. */
export function requestQuantileEnvelope(
  quantiles: BraidedQuantiles[][],
  exposure: number[][],
  topology: BranchTopology,
): EnvelopeSpaceRequests {
  const capacity = quantiles.map((row) => row.map((q) =>
    Math.max(0, q.qEnvelope - q.qRepresentative)
  ));
  const total = quantiles.map((row, i) => row.map((q, t) =>
    topology[i][t].branchCount > 1
      ? exposure[i][t] * Math.max(0, q.qEnvelope - q.qRepresentative)
      : 0
  ));
  return { capacity, total };
}

/** Silverman's robust bandwidth in log1p(value) space, shared by one category. */
export function estimateCategoryBandwidth(layer: Layer): number | null {
  const bandwidths = (layer.distribution ?? []).flatMap((cell) => {
    if (cell?.kind !== "samples") return [];
    const points = toKdeScale(normalizeSamples(cell)).points;
    if (points.length < 2) return [];
    const mean = points.reduce((sum, point) => sum + point.value * point.weight, 0);
    const squaredWeightSum = points.reduce((sum, point) => sum + point.weight ** 2, 0);
    const variance = points.reduce((sum, point) =>
      sum + point.weight * (point.value - mean) ** 2, 0
    ) / Math.max(1 - squaredWeightSum, Number.EPSILON);
    const std = Math.sqrt(variance);
    const sigma = Math.min(
      std,
      (weightedQuantile(points, 0.75) - weightedQuantile(points, 0.25)) / 1.34,
    );
    const effectiveSampleSize = 1 / squaredWeightSum;
    const bandwidth = 0.9 * sigma * effectiveSampleSize ** (-0.2);
    return Number.isFinite(bandwidth) && bandwidth > 0 ? [bandwidth] : [];
  }).sort((a, b) => a - b);
  return bandwidths.length ? sampleQuantile(bandwidths, 0.5) : null;
}

/** Gaussian KDE on a fixed grid spanning the supplied coordinate space. */
export function estimateKDE(
  samples: number[],
  bandwidth: number,
  gridSize = KDE_GRID_SIZE,
  weights?: number[],
): KdeGrid {
  const points = normalizeWeightedValues(samples, weights);
  if (!points.length || !Number.isFinite(bandwidth) || bandwidth <= 0) return { x: [], density: [] };
  const low = points[0].value;
  const high = points.at(-1)!.value;
  const count = Math.max(3, Math.floor(gridSize));
  const x = Array.from({ length: count }, (_, i) => low + (high - low) * i / (count - 1));
  const normalizer = bandwidth * Math.sqrt(2 * Math.PI);
  const density = x.map((position) => points.reduce((sum, point) => {
    const z = (position - point.value) / bandwidth;
    return sum + point.weight * Math.exp(-0.5 * z * z);
  }, 0) / normalizer);
  return { x, density };
}

/** Extract KDE maxima, valley-defined basins, and weighted empirical basin masses. */
export function extractModesAndBasins(samples: number[], bandwidth: number | null, weights?: number[]): BranchMode[] {
  const rawPoints = normalizeWeightedValues(samples, weights);
  if (!rawPoints.length) return [{ location: 0, mass: 1 }];
  const { points, fromKdeScale } = toKdeScale(rawPoints);
  if (!bandwidth || points[0].value === points.at(-1)!.value) {
    return [{ location: weightedQuantile(rawPoints, 0.5), mass: 1 }];
  }
  const grid = estimateKDE(
    points.map((point) => point.value),
    bandwidth,
    KDE_GRID_SIZE,
    points.map((point) => point.weight),
  );
  let peaks = grid.x.flatMap((_, i) => {
    const left = i === 0 ? -Infinity : grid.density[i - 1];
    const right = i === grid.x.length - 1 ? -Infinity : grid.density[i + 1];
    return grid.density[i] >= left && grid.density[i] > right ? [i] : [];
  });
  if (!peaks.length) peaks = [indexOfMaximum(grid.density)];
  const valleys = peaks.slice(0, -1).map((peak, i) => indexOfMinimum(grid.density, peak, peaks[i + 1]));
  const masses = new Array<number>(peaks.length).fill(0);
  for (const point of points) {
    const basin = valleys.findIndex((valley) => point.value <= grid.x[valley]);
    masses[basin < 0 ? peaks.length - 1 : basin] += point.weight;
  }
  const basins = peaks.map((peakIndex, i) => ({ peakIndex, mass: masses[i] }));
  return mergeInsignificantModes(basins, grid).map((basin) => ({
    location: fromKdeScale(grid.x[basin.peakIndex]), mass: basin.mass,
  }));
}

function toKdeScale(points: WeightedPoint[]): {
  points: WeightedPoint[];
  fromKdeScale: (value: number) => number;
} {
  // The forecast/dosage domains are non-negative. Preserve raw coordinates for signed generic inputs.
  return points.every((point) => point.value >= 0)
    ? { points: points.map((point) => ({ ...point, value: Math.log1p(point.value) })), fromKdeScale: Math.expm1 }
    : { points, fromKdeScale: (value) => value };
}

/** Apply only the requested mass, valley-depth, and three-mode merges. */
function mergeInsignificantModes(initial: ModeBasin[], grid: KdeGrid): ModeBasin[] {
  const basins = initial.slice();
  while (basins.length > 1) {
    const small = basins.reduce((best, basin, i) => basin.mass < basins[best].mass ? i : best, 0);
    if (basins[small].mass >= MIN_BRANCH_MASS) break;
    mergePair(basins, nearestNeighbor(basins, small, grid), grid);
  }
  while (basins.length > 1) {
    let shallowest = -1;
    let shallowestDepth = Infinity;
    for (let i = 0; i + 1 < basins.length; i += 1) {
      const a = basins[i].peakIndex;
      const b = basins[i + 1].peakIndex;
      const valley = grid.density[indexOfMinimum(grid.density, a, b)];
      const depth = 1 - valley / Math.min(grid.density[a], grid.density[b]);
      if (depth < shallowestDepth) { shallowestDepth = depth; shallowest = i; }
    }
    if (shallowestDepth >= MIN_VALLEY_DEPTH) break;
    mergePair(basins, shallowest, grid);
  }
  while (basins.length > 3) {
    const smallest = basins.reduce((best, basin, i) => basin.mass < basins[best].mass ? i : best, 0);
    mergePair(basins, nearestNeighbor(basins, smallest, grid), grid);
  }
  const total = basins.reduce((sum, basin) => sum + basin.mass, 0);
  return basins.map((basin) => ({ ...basin, mass: basin.mass / total }));
}

/** Keep only constant multi-mode runs lasting at least three time points. */
export function applyTemporalPersistence(raw: Array<1 | 2 | 3>): Array<1 | 2 | 3> {
  const result = new Array<1 | 2 | 3>(raw.length).fill(1);
  for (let start = 0; start < raw.length;) {
    let end = start + 1;
    while (end < raw.length && raw[end] === raw[start]) end += 1;
    if (raw[start] > 1 && end - start >= 3) result.fill(raw[start], start, end);
    start = end;
  }
  return result;
}

/** Distribution shape determines branch topology before uncertainty is applied. */
export function computeBranchTopology(
  orderedLayers: Layer[],
  quantiles: BraidedQuantiles[][],
): BranchTopology {
  return orderedLayers.map((layer, i) => {
    const bandwidth = estimateCategoryBandwidth(layer);
    const rawModes = quantiles[i].map((q, t) => {
      const cell = layer.distribution?.[t];
      return cell?.kind === "samples"
        ? extractModesAndBasins(cell.values, bandwidth, cell.weights)
        : [{ location: q.qRepresentative, mass: 1 }];
    });
    const rawCounts = rawModes.map((modes) => modes.length as 1 | 2 | 3);
    const persistentCounts = applyTemporalPersistence(rawCounts);
    return rawModes.map((modes, t) => ({
      modes: persistentCounts[t] > 1
        ? modes
        : [{
            location: modes.length === 1 ? modes[0].location : quantiles[i][t].qRepresentative,
            mass: 1,
          }],
      rawBranchCount: rawCounts[t],
      branchCount: persistentCounts[t],
    }));
  });
}

export function computeActiveMask(deformation: number[][]): boolean[][] {
  return deformation.map((row) => row.map((value) => value > 0));
}

export function buildLayerSlotGeometry(
  orderedLayers: Layer[],
  quantiles: BraidedQuantiles[][],
  topology: BranchTopology,
  slotBase: BaseLayout,
  uncertainty: number[][],
  uncertaintyRanks: number[][],
  exposure: number[][],
  active: boolean[][],
  requested: EnvelopeSpaceRequests,
  options: BraidedStreamOptions,
  coloredBase: BaseLayout
): BraidedLayout {
  const n = orderedLayers.length;
  const tLen = slotBase.baseline.length;
  const layerGeometry: BraidedLayerGeometry[] = [];
  for (let i = 0; i < n; i += 1) {
    const branches = Array.from({ length: 3 }, (_, branchIndex) => ({
      layerId: orderedLayers[i].id, branchIndex, mass: 0, masses: new Array<number>(tLen),
      y0: new Array<number>(tLen), y1: new Array<number>(tLen),
    }));
    const spaces: SpaceGeometry[] = Array.from({ length: 2 }, (_, gapIndex) => ({
      ownerLayerId: orderedLayers[i].id, kind: "internal", gapIndex,
      y0: new Array<number>(tLen), y1: new Array<number>(tLen),
    }));
    const branchCount = new Array<1 | 2 | 3>(tLen);
    const activePoints = new Array<boolean>(tLen);
    const visualEnvelopeY0 = new Array<number>(tLen);
    const visualEnvelopeY1 = new Array<number>(tLen);
    const debug = options.debug ? new Array<BraidedPointDebug>(tLen) : undefined;
    for (let t = 0; t < tLen; t += 1) {
      const q = quantiles[i][t];
      const topologyPoint = topology[i][t];
      const H = q.qRepresentative;
      const HEnvelope = q.qEnvelope;
      const u = uncertainty[i][t];
      const rank = uncertaintyRanks[i][t];
      const lambda = exposure[i][t];
      const isActive = active[i][t];
      activePoints[t] = isActive;
      const envelopeLow = slotBase.yBottom[i][t];
      const envelopeHigh = slotBase.yTop[i][t];
      const retained = topologyPoint.modes;
      branchCount[t] = topologyPoint.branchCount;
      const placement = placeBranchesByModeDistance(
        retained,
        H,
        requested.total[i][t],
      );
      const localIntervals = placement;
      const intervals = localIntervals.map((local, b) => {
        const interval = { y0: envelopeLow + local.y0, y1: envelopeLow + local.y1 };
        const height = local.y1 - local.y0;
        branches[b].masses[t] = H > 0 ? height / H : retained[b].mass;
        branches[b].y0[t] = interval.y0;
        branches[b].y1[t] = interval.y1;
        return interval;
      });
      for (let b = retained.length; b < branches.length; b += 1) {
        branches[b].masses[t] = 0;
        branches[b].y0[t] = intervals.at(-1)!.y1;
        branches[b].y1[t] = intervals.at(-1)!.y1;
      }
      const gaps = [
        retained.length > 1 ? { y0: intervals[0].y1, y1: intervals[1].y0 } : { y0: intervals[0].y1, y1: intervals[0].y1 },
        retained.length > 2 ? { y0: intervals[1].y1, y1: intervals[2].y0 } : { y0: intervals.at(-1)!.y1, y1: intervals.at(-1)!.y1 },
      ];
      spaces.forEach((space, index) => {
        space.y0[t] = gaps[index].y0;
        space.y1[t] = gaps[index].y1;
      });
      visualEnvelopeY0[t] = envelopeLow;
      visualEnvelopeY1[t] = envelopeHigh;
      if (debug) {
        debug[t] = {
          ...q, H, HEnvelope, uncertainty: u, uncertaintyRank: rank, exposure: lambda, active: isActive,
          rawBranchCount: topologyPoint.rawBranchCount, persistentBranchCount: topologyPoint.branchCount,
          modeLocations: retained.map((mode) => mode.location),
          branchMasses: retained.map((mode) => mode.mass),
          branchCenters: localIntervals.map((interval) => interval.center),
          envelopeLow, envelopeHigh, branchIntervals: intervals.map((interval) => ({ ...interval })),
          visibleBranchCount: (isActive ? retained.length : 1) as 1 | 2 | 3,
        };
      }
    }
    for (const branch of branches) branch.mass = branch.masses.reduce((sum, mass) => sum + mass, 0) / tLen;
    layerGeometry.push({
      layerId: orderedLayers[i].id, branchCount, active: activePoints, branches, spaces, visualEnvelopeY0, visualEnvelopeY1,
      slotY0: slotBase.yBottom[i], slotY1: slotBase.yTop[i],
      uncertainty: uncertainty[i], uncertaintyRank: uncertaintyRanks[i], exposure: exposure[i],
      requestedSpace: requested.total[i], allocatedSpace: requested.total[i],
      debug,
    });
  }

  const yBottomStar = layerGeometry.map((layer) => layer.slotY0.slice());
  const yTopStar = yBottomStar.map((row, i) => row.map((value, t) => value + quantiles[i][t].qRepresentative));
  return {
    layers: layerGeometry, yBottomStar, yTopStar,
    s: yBottomStar.map((row, i) => row.map((value, t) => value - coloredBase.yBottom[i][t])),
    o: Array.from({ length: n }, () => new Array<number>(tLen).fill(0)),
    aAlloc: requested.total,
    seam: Array.from({ length: Math.max(0, n - 1) }, () => new Array<number>(tLen).fill(0)),
    rho: new Array<number>(tLen).fill(1),
    totalHeight: slotBase.yTop[n - 1].map((top, t) => top - slotBase.yBottom[0][t]),
    components: Array.from({ length: tLen }, () => []),
    envelopeLow: layerGeometry.map((layer) => layer.slotY0),
    envelopeHigh: layerGeometry.map((layer) => layer.slotY1),
    collisionRelaxation: { beforeCount: 0, afterCount: 0, maxOverlapBefore: 0, maxOverlapAfter: 0, passes: 0 },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function sampleQuantile(sorted: number[], probability: number): number {
  if (!sorted.length) return 0;
  const index = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
}

function indexOfMaximum(values: number[]): number {
  return values.reduce((best, value, i) => value > values[best] ? i : best, 0);
}

function indexOfMinimum(values: number[], start: number, end: number): number {
  let best = start;
  for (let i = start + 1; i <= end; i += 1) if (values[i] < values[best]) best = i;
  return best;
}

function nearestNeighbor(basins: ModeBasin[], index: number, grid: KdeGrid): number {
  if (index === 0) return 0;
  if (index === basins.length - 1) return index - 1;
  const location = grid.x[basins[index].peakIndex];
  const leftDistance = location - grid.x[basins[index - 1].peakIndex];
  const rightDistance = grid.x[basins[index + 1].peakIndex] - location;
  return leftDistance <= rightDistance ? index - 1 : index;
}

function mergePair(basins: ModeBasin[], left: number, grid: KdeGrid): void {
  const a = basins[left];
  const b = basins[left + 1];
  basins.splice(left, 2, {
    peakIndex: grid.density[a.peakIndex] >= grid.density[b.peakIndex] ? a.peakIndex : b.peakIndex,
    mass: a.mass + b.mass,
  });
}

export function placeBranchesByModeDistance(
  modes: BranchMode[],
  representativeHeight: number,
  deformation: number,
): Array<{ y0: number; y1: number; center: number }> {
  let usedHeight = 0;
  const heights = modes.map((mode, i) => {
    const height = i === modes.length - 1 ? representativeHeight - usedHeight : mode.mass * representativeHeight;
    usedHeight += height;
    return height;
  });
  const distances = modes.slice(0, -1).map((mode, i) =>
    Math.max(0, modes[i + 1].location - mode.location)
  );
  const distanceTotal = distances.reduce((sum, distance) => sum + distance, 0);
  const gaps = distances.map((distance) => deformation * (
    distanceTotal > 0 ? distance / distanceTotal : 1 / distances.length
  ));
  let cursor = 0;
  const intervals = modes.map((_, i) => {
    const y0 = cursor;
    const y1 = i === modes.length - 1 ? representativeHeight + deformation : y0 + heights[i];
    cursor = y1 + (gaps[i] ?? 0);
    return { y0, y1, center: (y0 + y1) / 2 };
  });
  return intervals;
}

/**
 * Final geometry-only correction. Stored stack order is bottom-to-top, so a
 * collision is upper(i) > lower(i+1); both whole layer polygons move equally
 * in opposite directions without changing their thickness or topology.
 */
export function relaxLayerCollisions(
  layout: BraidedLayout,
  epsilon: number,
  requestedPasses = 5
): CollisionRelaxationStats {
  const before = collisionSummary(layout, epsilon);
  let passes = 0;
  const hardLimit = Math.max(requestedPasses, layout.layers.length * 32);
  while (passes < hardLimit) {
    let changed = false;
    for (let t = 0; t < layout.totalHeight.length; t += 1) {
      for (let i = 0; i + 1 < layout.layers.length; i += 1) {
        const penetration = layerUpper(layout.layers[i], t) - layerLower(layout.layers[i + 1], t);
        if (penetration <= epsilon) continue;
        const offset = penetration + epsilon;
        shiftLayerAt(layout, i, t, -offset / 2);
        shiftLayerAt(layout, i + 1, t, offset / 2);
        changed = true;
      }
    }
    passes += 1;
    if (!changed || (passes >= requestedPasses && collisionSummary(layout, epsilon).maxOverlap <= epsilon)) break;
  }
  for (let t = 0; t < layout.totalHeight.length; t += 1) {
    layout.totalHeight[t] = Math.max(...layout.layers.map((layer) => layer.slotY1[t]))
      - Math.min(...layout.layers.map((layer) => layer.slotY0[t]));
  }
  const after = collisionSummary(layout, epsilon);
  const stats = {
    beforeCount: before.count,
    afterCount: after.count,
    maxOverlapBefore: before.maxOverlap,
    maxOverlapAfter: after.maxOverlap,
    passes,
  };
  layout.collisionRelaxation = stats;
  return stats;
}

function collisionSummary(layout: BraidedLayout, epsilon: number): { count: number; maxOverlap: number } {
  let count = 0;
  let maxOverlap = 0;
  for (let t = 0; t < layout.totalHeight.length; t += 1) {
    for (let i = 0; i + 1 < layout.layers.length; i += 1) {
      const penetration = layerUpper(layout.layers[i], t) - layerLower(layout.layers[i + 1], t);
      if (penetration > epsilon) count += 1;
      if (penetration > maxOverlap) maxOverlap = penetration;
    }
  }
  return { count, maxOverlap };
}

function layerLower(layer: BraidedLayerGeometry, t: number): number {
  return layer.slotY0[t];
}

function layerUpper(layer: BraidedLayerGeometry, t: number): number {
  return layer.slotY1[t];
}

function shiftLayerAt(layout: BraidedLayout, index: number, t: number, offset: number): void {
  const layer = layout.layers[index];
  layer.slotY0[t] += offset;
  layer.slotY1[t] += offset;
  layer.visualEnvelopeY0[t] += offset;
  layer.visualEnvelopeY1[t] += offset;
  for (const branch of layer.branches) {
    branch.y0[t] += offset;
    branch.y1[t] += offset;
  }
  for (const space of layer.spaces) {
    space.y0[t] += offset;
    space.y1[t] += offset;
  }
  const debug = layer.debug?.[t];
  if (debug) {
    debug.envelopeLow += offset;
    debug.envelopeHigh += offset;
    for (const interval of debug.branchIntervals) {
      interval.y0 += offset;
      interval.y1 += offset;
    }
  }
  layout.yBottomStar[index][t] += offset;
  layout.yTopStar[index][t] += offset;
  layout.s[index][t] += offset;
}
