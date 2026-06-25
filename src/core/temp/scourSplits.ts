/**
 * Candidate split generation for the recursive scour solver.
 *
 * Exact mode enumerates all non-empty proper binary partitions for small groups
 * while removing A|B and B|A symmetry. Greedy mode keeps a deterministic bounded
 * candidate set built from useful ordering heuristics.
 */

import type { ScourConfig } from "./scourTypes";
import { layerVariationScore } from "./scourEnergy";

/** A candidate binary partition of a layer set. */
export interface CandidateSplit {
  /** Non-empty proper subset A. */
  left: number[];
  /** Complement subset B. */
  right: number[];
}

/**
 * Generate candidate binary splits for a group of layer indices.
 *
 * Exact mode for n <= 12 returns 2^(n - 1) - 1 unique partitions.
 * Greedy mode returns a compact deterministic set.
 */
export function generateCandidateSplits(
  heights: number[][],
  group: number[],
  config: ScourConfig
): CandidateSplit[] {
  const sortedGroup = normalizeGroup(group);

  if (sortedGroup.length <= 1) {
    return [];
  }

  if (config.searchMode === "exact" && sortedGroup.length <= 12) {
    return generateExactSplits(sortedGroup);
  }

  return generateGreedySplits(heights, sortedGroup, config);
}

function normalizeGroup(group: number[]): number[] {
  return [...new Set(group)].sort((a, b) => a - b);
}

function canonicalSplitKey(left: number[], right: number[]): string {
  const a = normalizeGroup(left).join(",");
  const b = normalizeGroup(right).join(",");
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pushUnique(
  results: CandidateSplit[],
  seen: Set<string>,
  left: number[],
  right: number[]
): void {
  const normalizedLeft = normalizeGroup(left);
  const normalizedRight = normalizeGroup(right);

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return;
  }

  const key = canonicalSplitKey(normalizedLeft, normalizedRight);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  results.push({ left: normalizedLeft, right: normalizedRight });
}

function generateExactSplits(group: number[]): CandidateSplit[] {
  const n = group.length;
  const total = 1 << n;
  const seen = new Set<string>();
  const results: CandidateSplit[] = [];

  // Force the first layer into the left subset. This removes A|B and B|A
  // duplicates while still enumerating every unordered binary partition once.
  for (let mask = 1; mask < total - 1; mask += 1) {
    if ((mask & 1) === 0) {
      continue;
    }

    const left: number[] = [];
    const right: number[] = [];

    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) {
        left.push(group[i]);
      } else {
        right.push(group[i]);
      }
    }

    pushUnique(results, seen, left, right);
  }

  return results;
}

function generateGreedySplits(
  heights: number[][],
  group: number[],
  config: ScourConfig
): CandidateSplit[] {
  const seen = new Set<string>();
  const results: CandidateSplit[] = [];
  const add = (left: number[], right: number[]) => {
    pushUnique(results, seen, left, right);
  };

  const byVariation = group
    .slice()
    .sort((a, b) => {
      const va = layerVariationScore(heights, a, config.lambdaTurn);
      const vb = layerVariationScore(heights, b, config.lambdaTurn);
      if (va !== vb) {
        return va - vb;
      }
      return a - b;
    });
  addMedianSplit(byVariation, add);

  const T = heights[0]?.length ?? 0;
  const meanThickness = (i: number) => {
    const row = heights[i] ?? [];
    let sum = 0;
    for (let t = 0; t < T; t += 1) {
      sum += row[t] ?? 0;
    }
    return sum / Math.max(1, T);
  };
  const byMean = group
    .slice()
    .sort((a, b) => {
      const ma = meanThickness(a);
      const mb = meanThickness(b);
      if (ma !== mb) {
        return ma - mb;
      }
      return a - b;
    });
  addMedianSplit(byMean, add);

  const peakTime = (i: number) => {
    const row = heights[i] ?? [];
    let best = -Infinity;
    let bestT = 0;
    for (let t = 0; t < row.length; t += 1) {
      const value = row[t] ?? 0;
      if (value > best) {
        best = value;
        bestT = t;
      }
    }
    return bestT;
  };
  const byPeak = group
    .slice()
    .sort((a, b) => {
      const ta = peakTime(a);
      const tb = peakTime(b);
      if (ta !== tb) {
        return ta - tb;
      }
      return a - b;
    });
  addMedianSplit(byPeak, add);

  const topCount = Math.min(3, group.length - 1);
  const byHighVariation = byVariation.slice().reverse();
  for (let i = 0; i < topCount; i += 1) {
    const one = byHighVariation[i];
    add([one], group.filter((v) => v !== one));
  }

  const seed = config.seed + group.reduce((acc, v) => Math.imul(acc, 31) + v, 17);
  const rng = splitMix32(seed);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shuffled = group.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    const half = Math.floor(shuffled.length / 2);
    const pivot = shuffled.length % 2 === 0 || rng.next() < 0.5 ? half : half + 1;
    add(shuffled.slice(0, pivot), shuffled.slice(pivot));
  }

  return results;
}

function addMedianSplit(
  ordered: number[],
  add: (left: number[], right: number[]) => void
): void {
  const midpoint = Math.floor(ordered.length / 2);
  add(ordered.slice(0, midpoint), ordered.slice(midpoint));
}

function splitMix32(seed: number) {
  let state = seed | 0;
  return {
    next(): number {
      state = (state + 0x9e3779b9) | 0;
      let z = state;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      z ^= z >>> 16;
      return (z >>> 0) / 4294967296;
    }
  };
}
