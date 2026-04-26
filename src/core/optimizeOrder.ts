import type { LayerInput, ROI } from "./types";
import { layerUncertaintyAt } from "./validate";

export interface OrderOptimizationConfig {
  /** Scale factor for automatic cluster count selection */
  clusterAutoCutScale: number;
  /** Penalty for cross-cluster boundaries */
  clusterBoundaryPenalty: number;
  /** Sigma for similarity exponential */
  similaritySigma: number;
  /** Maximum local swap improvement passes */
  maxSwapPasses: number;
  /** Weight type for SineStream: "max" | "arithmetic" | "geometric" | "harmonic" | "median" */
  weightType?: "max" | "arithmetic" | "geometric" | "harmonic" | "median";
  /** Whether to use thickness weighting in distance metric */
  useThicknessWeight?: boolean;
  /** Whether to use length weighting in distance metric */
  useLengthWeight?: boolean;
  /** Length weight threshold: layers under (max/threshold) are penalized */
  lengthWeightThreshold?: number;
  /** Whether to include uncertainty similarity term in ordering distance */
  useUncertaintyTerm?: boolean;
  /** Auxiliary uncertainty term weight in ordering distance */
  uncertaintyWeight?: number;
}

export interface OrderOptimizationDiagnostics {
  objectiveBefore: number;
  objectiveAfter: number;
  clusterCount: number;
  trunkCluster: number;
  crossClusterBoundaries: number;
}

export interface OrderOptimizationResult {
  order: string[];
  clusterByLayerId: Map<string, number>;
  boundaryPenalty: number[];
  diagnostics: OrderOptimizationDiagnostics;
}

interface ClusterNode {
  id: number;
  members: number[];
  centroid: number[];
  mass: number;
}

interface MergeStep {
  left: number;
  right: number;
  cost: number;
  mergedId: number;
}

interface LayerMetadata {
  thicknessChanges: number[];
  totalSize: number;
  maxSize: number;
  effectiveLength: number;
}

export function optimizeLayerOrder(
  layers: LayerInput[],
  roi: ROI | null,
  config: OrderOptimizationConfig,
  initialOrder?: string[]
): OrderOptimizationResult {
  if (layers.length <= 1) {
    return {
      order: layers.map((l) => l.id),
      clusterByLayerId: new Map(layers.map((l) => [l.id, 0])),
      boundaryPenalty: [],
      diagnostics: {
        objectiveBefore: 0,
        objectiveAfter: 0,
        clusterCount: 1,
        trunkCluster: 0,
        crossClusterBoundaries: 0
      }
    };
  }

  const [left, right] = roiBounds(layers[0].mean.length, roi);
  
  // Compute SineStream distance metrics
  const metadata = layers.map((layer) => computeLayerMetadata(layer, left, right));
  const masses = layers.map((layer) => sum(layer.mean.slice(left, right + 1)));
  
  // Compute SineStream distance matrix
  const dist = computeSineStreamDistances(
    layers,
    metadata,
    left,
    right,
    config.weightType ?? "max",
    config.useThicknessWeight ?? true,
    config.useLengthWeight ?? true,
    config.lengthWeightThreshold ?? 9,
    config.useUncertaintyTerm === true,
    Math.max(0, config.uncertaintyWeight ?? 0)
  );

  const mergeSteps = wardHierarchical(dist, masses);
  const clusterCount = pickClusterCount(mergeSteps, config.clusterAutoCutScale, layers.length);
  const labels = cutClusters(mergeSteps, layers.length, clusterCount);

  const clusterToMembers = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i += 1) {
    const c = labels[i];
    if (!clusterToMembers.has(c)) {
      clusterToMembers.set(c, []);
    }
    clusterToMembers.get(c)!.push(i);
  }

  const trunkCluster = pickTrunkCluster(clusterToMembers, masses);

  const clusterOrder = Array.from(clusterToMembers.keys()).sort((a, b) => {
    if (a === trunkCluster) {
      return -1;
    }
    if (b === trunkCluster) {
      return 1;
    }
    const da = minDistanceToCluster(clusterToMembers.get(a) ?? [], clusterToMembers.get(trunkCluster) ?? [], dist);
    const db = minDistanceToCluster(clusterToMembers.get(b) ?? [], clusterToMembers.get(trunkCluster) ?? [], dist);
    return da - db;
  });

  const finalOrderIndices: number[] = [];
  for (const clusterId of clusterOrder) {
    const members = clusterToMembers.get(clusterId) ?? [];
    const localOrder = nearestNeighborOrder(members, dist, masses);
    finalOrderIndices.push(...localOrder);
  }

  const fallbackOrder = layers.map((layer) => layer.id);
  const initialIds = initialOrder && initialOrder.length > 0 ? initialOrder : fallbackOrder;
  const idToIndex = new Map<string, number>(layers.map((layer, idx) => [layer.id, idx]));
  const initialIndices = initialIds
    .map((id) => idToIndex.get(id))
    .filter((v): v is number => v !== undefined);

  const sigma = Math.max(1e-6, config.similaritySigma);
  const objectiveBefore = objective(initialIndices, labels, dist, config.clusterBoundaryPenalty, sigma);
  localSwapImprove(finalOrderIndices, labels, dist, config.clusterBoundaryPenalty, sigma, Math.max(1, Math.floor(config.maxSwapPasses)));
  const objectiveAfter = objective(finalOrderIndices, labels, dist, config.clusterBoundaryPenalty, sigma);

  const order = finalOrderIndices.map((idx) => layers[idx].id);
  const clusterByLayerId = new Map<string, number>(finalOrderIndices.map((idx) => [layers[idx].id, labels[idx]]));
  const boundaryPenalty = new Array<number>(Math.max(0, finalOrderIndices.length - 1)).fill(1);
  let crossClusterBoundaries = 0;
  for (let k = 0; k < boundaryPenalty.length; k += 1) {
    const leftIdx = finalOrderIndices[k];
    const rightIdx = finalOrderIndices[k + 1];
    const cross = labels[leftIdx] !== labels[rightIdx];
    if (cross) {
      crossClusterBoundaries += 1;
    }
    boundaryPenalty[k] = cross ? 1 + config.clusterBoundaryPenalty : 1;
  }

  return {
    order,
    clusterByLayerId,
    boundaryPenalty,
    diagnostics: {
      objectiveBefore,
      objectiveAfter,
      clusterCount,
      trunkCluster,
      crossClusterBoundaries
    }
  };
}

function roiBounds(length: number, roi: ROI | null): [number, number] {
  if (!roi) {
    return [0, Math.max(0, length - 1)];
  }
  return [
    Math.max(0, Math.min(length - 1, roi.t0Index)),
    Math.max(0, Math.min(length - 1, roi.t1Index))
  ];
}

/**
 * Compute layer metadata needed for SineStream distance metric
 */
function computeLayerMetadata(layer: LayerInput, left: number, right: number): LayerMetadata {
  const thicknessChanges: number[] = [];
  
  // Use mean values for thickness change calculation
  for (let t = left; t < right; t += 1) {
    const change = Math.abs(layer.mean[t + 1] - layer.mean[t]);
    thicknessChanges.push(change);
  }

  // Compute statistics
  const layerValues = layer.mean.slice(left, right + 1);
  const totalSize = sum(layerValues);
  const maxSize = Math.max(...layerValues);
  
  // Effective length: count how many points exceed max/9 threshold
  const threshold = maxSize / 9;
  const effectiveLength = layerValues.filter((v) => v > threshold).length;

  return {
    thicknessChanges,
    totalSize,
    maxSize,
    effectiveLength
  };
}

/**
 * Compute SineStream-based distance matrix between all layers
 * 
 * Distance formula incorporates:
 * 1. Angle similarity: |ΔA + ΔB| / (|ΔA| + |ΔB|)
 * 2. Size weighting: Combined layer thickness (max/arithmetic/geometric/etc)
 * 3. Length weighting: Penalty for thin/short-lived layers
 */
function computeSineStreamDistances(
  layers: LayerInput[],
  metadata: LayerMetadata[],
  left: number,
  right: number,
  weightType: string,
  useThicknessWeight: boolean,
  useLengthWeight: boolean,
  lengthThreshold: number,
  useUncertaintyTerm: boolean,
  uncertaintyWeight: number
): number[][] {
  const n = layers.length;
  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const uncertaintyScale = useUncertaintyTerm ? globalUncertaintyScale(layers, left, right) : 1;

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = computeSineStreamDistance(
        layers[i],
        layers[j],
        metadata[i],
        metadata[j],
        left,
        right,
        weightType,
        useThicknessWeight,
        useLengthWeight,
        lengthThreshold,
        useUncertaintyTerm,
        uncertaintyWeight,
        uncertaintyScale
      );
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }

  return dist;
}

/**
 * Compute SineStream distance between two layers
 */
function computeSineStreamDistance(
  layerA: LayerInput,
  layerB: LayerInput,
  metaA: LayerMetadata,
  metaB: LayerMetadata,
  left: number,
  right: number,
  weightType: string,
  useThicknessWeight: boolean,
  useLengthWeight: boolean,
  lengthThreshold: number,
  useUncertaintyTerm: boolean,
  uncertaintyWeight: number,
  uncertaintyScale: number
): number {
  // 1. ANGLE-BASED SIMILARITY
  // Measure how aligned the thickness changes are
  let angleSimilarity = 0;
  let validPoints = 0;

  for (let t = 0; t < metaA.thicknessChanges.length; t += 1) {
    const dA = metaA.thicknessChanges[t];
    const dB = metaB.thicknessChanges[t];
    const sumAbs = Math.abs(dA) + Math.abs(dB);

    if (sumAbs < 1e-10) {
      continue;
    }

    // Core SineStream formula: |ΔA + ΔB| / (|ΔA| + |ΔB|)
    const numerator = Math.abs(dA + dB);
    angleSimilarity += numerator / sumAbs;
    validPoints += 1;
  }

  if (validPoints > 0) {
    angleSimilarity /= validPoints;
  }

  // 2. SIZE-BASED WEIGHTING
  let sizeWeight = computeSizeWeight(layerA, layerB, left, right, weightType);

  // 3. LENGTH WEIGHTING
  // Penalize if either layer is thin/short-lived
  let lengthWeight = 1;
  if (useLengthWeight) {
    const lengthA = metaA.effectiveLength > 0 ? metaA.effectiveLength : 1;
    const lengthB = metaB.effectiveLength > 0 ? metaB.effectiveLength : 1;
    const timeSeriesLength = metaA.thicknessChanges.length + 1;
    
    const penaltyA = timeSeriesLength / lengthA;
    const penaltyB = timeSeriesLength / lengthB;
    lengthWeight = Math.max(penaltyA, penaltyB);
  }

  // Combine components
  let distance = angleSimilarity;
  
  if (useThicknessWeight) {
    distance *= sizeWeight;
  }
  
  if (useLengthWeight) {
    distance *= lengthWeight;
  }

  if (useUncertaintyTerm && uncertaintyWeight > 0) {
    const uncertaintyDiff = uncertaintyDifference(layerA, layerB, left, right, uncertaintyScale);
    distance += uncertaintyWeight * uncertaintyDiff;
  }

  return distance;
}

/**
 * Compute size weight based on combined layer sizes
 */
function computeSizeWeight(layerA: LayerInput, layerB: LayerInput, left: number, right: number, weightType: string): number {
  const safeLeft = Math.max(0, Math.min(left, layerA.mean.length - 1));
  const safeRight = Math.max(0, Math.min(right, layerA.mean.length - 1));
  const n = Math.max(1, safeRight - safeLeft + 1);
  
  switch (weightType.toLowerCase()) {
    case "arithmetic": {
      let sum = 0;
      let count = 0;
      for (let t = safeLeft; t <= safeRight; t += 1) {
        const combined = layerA.mean[t] + layerB.mean[t];
        if (combined > 0) {
          sum += combined;
          count += 1;
        }
      }
      return count > 0 ? sum / count : 1;
    }
    case "geometric": {
      let product = 1;
      let count = 0;
      for (let t = safeLeft; t <= safeRight; t += 1) {
        const combined = layerA.mean[t] + layerB.mean[t];
        if (combined > 1e-10) {
          product *= Math.pow(combined, 1 / n);
          count += 1;
        }
      }
      return count > 0 ? product : 1;
    }
    case "harmonic": {
      let recipSum = 0;
      let count = 0;
      for (let t = safeLeft; t <= safeRight; t += 1) {
        const combined = layerA.mean[t] + layerB.mean[t];
        if (combined > 1e-10) {
          recipSum += 1 / combined;
          count += 1;
        }
      }
      return count > 0 ? count / recipSum : 1;
    }
    case "median": {
      const sizes: number[] = [];
      for (let t = safeLeft; t <= safeRight; t += 1) {
        const combined = layerA.mean[t] + layerB.mean[t];
        if (combined > 0) sizes.push(combined);
      }
      if (sizes.length === 0) return 1;
      sizes.sort((a, b) => a - b);
      if (sizes.length % 2 !== 0) {
        return sizes[Math.floor(sizes.length / 2)];
      }
      return (sizes[sizes.length / 2] + sizes[sizes.length / 2 - 1]) / 2;
    }
    case "max":
    default: {
      let maxSize = 0;
      for (let t = safeLeft; t <= safeRight; t += 1) {
        maxSize = Math.max(maxSize, layerA.mean[t] + layerB.mean[t]);
      }
      return maxSize;
    }
  }
}

function globalUncertaintyScale(layers: LayerInput[], left: number, right: number): number {
  let maxMeanUnc = 0;
  for (const layer of layers) {
    const meanUnc = meanLayerUncertainty(layer, left, right);
    if (meanUnc > maxMeanUnc) {
      maxMeanUnc = meanUnc;
    }
  }
  return Math.max(1e-9, maxMeanUnc);
}

function meanLayerUncertainty(layer: LayerInput, left: number, right: number): number {
  const safeLeft = Math.max(0, Math.min(left, layer.mean.length - 1));
  const safeRight = Math.max(0, Math.min(right, layer.mean.length - 1));
  let acc = 0;
  let count = 0;
  for (let t = safeLeft; t <= safeRight; t += 1) {
    acc += layerUncertaintyAt(layer, t);
    count += 1;
  }
  return count > 0 ? acc / count : 0;
}

function uncertaintyDifference(layerA: LayerInput, layerB: LayerInput, left: number, right: number, scale: number): number {
  const safeLeft = Math.max(0, Math.min(left, layerA.mean.length - 1));
  const safeRight = Math.max(0, Math.min(right, layerA.mean.length - 1));
  let acc = 0;
  let count = 0;
  for (let t = safeLeft; t <= safeRight; t += 1) {
    const ua = layerUncertaintyAt(layerA, t);
    const ub = layerUncertaintyAt(layerB, t);
    acc += Math.abs(ua - ub);
    count += 1;
  }
  const meanDiff = count > 0 ? acc / count : 0;
  return meanDiff / Math.max(1e-9, scale);
}

function pairwiseDistance(vectors: number[][]): number[][] {
  const n = vectors.length;
  const dist = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = l2(vectors[i], vectors[j]);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

function wardHierarchical(dist: number[][], masses: number[]): MergeStep[] {
  const nodes = new Map<number, ClusterNode>();
  for (let i = 0; i < dist.length; i += 1) {
    nodes.set(i, { id: i, members: [i], centroid: [], mass: Math.max(1e-9, masses[i]) });
  }

  const merges: MergeStep[] = [];
  let nextId = dist.length;

  while (nodes.size > 1) {
    const ids = Array.from(nodes.keys());
    let bestI = ids[0];
    let bestJ = ids[1];
    let bestCost = Number.POSITIVE_INFINITY;

    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        const i = ids[a];
        const j = ids[b];
        const ni = nodes.get(i)!;
        const nj = nodes.get(j)!;
        // Use existing precomputed distance scaled by mass product
        let delta: number;
        if (i < dist.length && j < dist.length) {
          delta = (ni.mass * nj.mass) / (ni.mass + nj.mass) * dist[i][j];
        } else {
          delta = (ni.mass * nj.mass) / (ni.mass + nj.mass);
        }
        if (delta < bestCost) {
          bestCost = delta;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const left = nodes.get(bestI)!;
    const right = nodes.get(bestJ)!;
    const merged = mergeNodes(left, right, nextId);
    nodes.delete(bestI);
    nodes.delete(bestJ);
    nodes.set(nextId, merged);
    merges.push({ left: bestI, right: bestJ, cost: bestCost, mergedId: nextId });
    nextId += 1;
  }

  return merges;
}

function pickClusterCount(merges: MergeStep[], scale: number, maxLeaf: number): number {
  if (merges.length <= 1) {
    return 1;
  }
  let maxJump = Number.NEGATIVE_INFINITY;
  let idx = merges.length - 1;
  for (let i = 1; i < merges.length; i += 1) {
    const jump = merges[i].cost - merges[i - 1].cost;
    if (jump > maxJump) {
      maxJump = jump;
      idx = i;
    }
  }
  const raw = maxLeaf - idx;
  const adjusted = Math.round(raw * Math.max(0.2, scale));
  return Math.max(1, Math.min(maxLeaf, adjusted));
}

function cutClusters(merges: MergeStep[], nLeaf: number, k: number): number[] {
  const active = new Set<number>();
  for (let i = 0; i < nLeaf; i += 1) {
    active.add(i);
  }

  for (const m of merges) {
    if (active.size <= k) {
      break;
    }
    active.delete(m.left);
    active.delete(m.right);
    active.add(m.mergedId);
  }

  const children = new Map<number, [number, number]>();
  for (const m of merges) {
    children.set(m.mergedId, [m.left, m.right]);
  }

  const labels = new Array<number>(nLeaf).fill(0);
  let label = 0;
  for (const root of active) {
    fillLeaves(root, label, labels, children, nLeaf);
    label += 1;
  }
  return labels;
}

function fillLeaves(
  nodeId: number,
  label: number,
  labels: number[],
  children: Map<number, [number, number]>,
  nLeaf: number
): void {
  if (nodeId < nLeaf) {
    labels[nodeId] = label;
    return;
  }
  const ch = children.get(nodeId);
  if (!ch) {
    return;
  }
  fillLeaves(ch[0], label, labels, children, nLeaf);
  fillLeaves(ch[1], label, labels, children, nLeaf);
}

function pickTrunkCluster(clusterToMembers: Map<number, number[]>, masses: number[]): number {
  let bestCluster = 0;
  let bestMass = Number.NEGATIVE_INFINITY;
  for (const [clusterId, members] of clusterToMembers.entries()) {
    const total = members.reduce((acc, idx) => acc + masses[idx], 0);
    if (total > bestMass) {
      bestMass = total;
      bestCluster = clusterId;
    }
  }
  return bestCluster;
}

function minDistanceToCluster(a: number[], b: number[], dist: number[][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const i of a) {
    for (const j of b) {
      best = Math.min(best, dist[i][j]);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function nearestNeighborOrder(members: number[], dist: number[][], masses: number[]): number[] {
  if (members.length <= 1) {
    return members.slice();
  }
  const remaining = new Set(members);
  let start = members[0];
  let bestMass = Number.NEGATIVE_INFINITY;
  for (const idx of members) {
    if (masses[idx] > bestMass) {
      bestMass = masses[idx];
      start = idx;
    }
  }
  remaining.delete(start);
  const order = [start];

  while (remaining.size > 0) {
    const last = order[order.length - 1];
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const cand of remaining) {
      if (dist[last][cand] < bestDist) {
        bestDist = dist[last][cand];
        best = cand;
      }
    }
    if (best < 0) {
      break;
    }
    remaining.delete(best);
    order.push(best);
  }
  return order;
}

function localSwapImprove(
  order: number[],
  labels: number[],
  dist: number[][],
  penalty: number,
  sigma: number,
  maxPasses: number
): void {
  let improved = true;
  let loops = 0;
  while (improved && loops < maxPasses) {
    improved = false;
    loops += 1;
    for (let i = 0; i < order.length - 1; i += 1) {
      const before = objective(order, labels, dist, penalty, sigma);
      const tmp = order[i];
      order[i] = order[i + 1];
      order[i + 1] = tmp;
      const after = objective(order, labels, dist, penalty, sigma);
      if (after + 1e-9 < before) {
        improved = true;
      } else {
        const back = order[i];
        order[i] = order[i + 1];
        order[i + 1] = back;
      }
    }
  }
}

function objective(order: number[], labels: number[], dist: number[][], penalty: number, sigma: number): number {
  if (order.length <= 1) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < order.length - 1; i += 1) {
    const a = order[i];
    const b = order[i + 1];
    const sim = Math.exp(-dist[a][b] / sigma);
    total += 1 - sim;
    if (labels[a] !== labels[b]) {
      total += penalty;
    }
  }
  return total;
}

function mergeNodes(left: ClusterNode, right: ClusterNode, id: number): ClusterNode {
  const mass = left.mass + right.mass;
  const centroid = left.centroid.map((v, i) => (v * left.mass + right.centroid[i] * right.mass) / Math.max(1e-9, mass));
  return {
    id,
    members: left.members.concat(right.members),
    centroid,
    mass
  };
}

function l2(a: number[], b: number[]): number {
  return Math.sqrt(sqrL2(a, b));
}

function sqrL2(a: number[], b: number[]): number {
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    acc += d * d;
  }
  return acc;
}

function sum(values: number[]): number {
  let acc = 0;
  for (const v of values) {
    acc += v;
  }
  return acc;
}
