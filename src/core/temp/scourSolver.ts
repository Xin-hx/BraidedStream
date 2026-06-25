/**
 * Recursive scour-minimized streamgraph solver.
 *
 * F(S) = min(
 *   E_chain(S),
 *   min_{A subset S} F(A) + F(S \ A) + P(A, S \ A)
 * ).
 *
 * A split is accepted only when its total cost is strictly lower than the
 * chain cost for the same group.
 */

import type {
  ScourChainNode,
  ScourConfig,
  ScourDebug,
  ScourLeafNode,
  ScourSplitSide,
  ScourTreeNode
} from "./scourTypes";
import {
  aggregateThickness,
  chainCost,
  computeMovingInterface,
  movingInterfaceEnergy,
  splitPenalty
} from "./scourEnergy";
import { generateCandidateSplits } from "./scourSplits";

export interface ScourSolverResult {
  tree: ScourTreeNode;
  debug: ScourDebug;
}

/**
 * Solve the recursive scour problem for a complete layer set.
 *
 * @param heights  Thickness matrix [layer][time], with non-negative values.
 * @param config   Solver hyper-parameters.
 */
export function solveRecursiveScour(
  heights: number[][],
  config: ScourConfig
): ScourSolverResult {
  const group = heights.map((_row, i) => i);
  const memo = new Map<string, ScourTreeNode>();

  const solve = (subset: number[], depth: number): ScourTreeNode => {
    const layers = sortedGroup(subset);
    const key = memoKey(layers, depth, config.maxDepth);
    const cached = memo.get(key);
    if (cached) {
      return cached;
    }

    if (layers.length === 1) {
      const node = makeLeaf(layers[0]);
      memo.set(key, node);
      return node;
    }

    if (layers.length <= config.minGroupSize || depth >= config.maxDepth) {
      const node = makeChain(heights, layers, config);
      memo.set(key, node);
      return node;
    }

    const chainNode = makeChain(heights, layers, config);
    let bestNode: ScourTreeNode = chainNode;

    for (const { left, right } of generateCandidateSplits(heights, layers, config)) {
      const leftNode = solve(left, depth + 1);
      const rightNode = solve(right, depth + 1);
      const penalty = splitPenalty(heights, left, right, config);
      const direction = chooseSplitDirection(heights, leftNode, rightNode, config);
      const splitCost =
        leftNode.cost +
        rightNode.cost +
        penalty +
        Math.max(0, config.movingInterfaceWeight) * direction.energy;

      if (splitCost < bestNode.cost) {
        bestNode = {
          type: "split",
          nodeId: groupKey(layers),
          layers,
          left: leftNode,
          right: rightNode,
          upper: direction.upper,
          lower: direction.lower,
          interface: direction.movingInterface,
          interfaceEnergy: direction.energy,
          splitPenalty: penalty,
          cost: splitCost
        };
      }
    }

    memo.set(key, bestNode);
    return bestNode;
  };

  const tree = solve(group, 0);
  const topChainCost = chainCost(heights, group, config).cost;
  const debug = buildDebug(tree, topChainCost);

  return { tree, debug };
}

function sortedGroup(group: number[]): number[] {
  return [...new Set(group)].sort((a, b) => a - b);
}

function groupKey(group: number[]): string {
  return sortedGroup(group).join(",");
}

/**
 * The depth limit makes the subproblem depend on remaining recursion budget.
 * Include that budget in the memo key so a shallow solution is not reused after
 * the caller has less depth available.
 */
function memoKey(group: number[], depth: number, maxDepth: number): string {
  return `${groupKey(group)}@remaining=${Math.max(0, maxDepth - depth)}`;
}

function makeLeaf(layerIndex: number): ScourLeafNode {
  return {
    type: "leaf",
    layers: [layerIndex],
    order: [layerIndex],
    cost: 0
  };
}

function makeChain(
  heights: number[][],
  layers: number[],
  config: ScourConfig
): ScourChainNode {
  const { cost, order } = chainCost(heights, layers, config);
  return {
    type: "chain",
    layers,
    order,
    cost
  };
}

interface SplitDirectionResult {
  upper: ScourSplitSide;
  lower: ScourSplitSide;
  movingInterface: number[];
  energy: number;
}

function chooseSplitDirection(
  heights: number[][],
  leftNode: ScourTreeNode,
  rightNode: ScourTreeNode,
  config: ScourConfig
): SplitDirectionResult {
  const leftHeight = aggregateThickness(heights, leftNode.layers);
  const rightHeight = aggregateThickness(heights, rightNode.layers);
  const leftUpper = evaluateSplitDirection(leftHeight, rightHeight, "left", "right", config);
  const rightUpper = evaluateSplitDirection(rightHeight, leftHeight, "right", "left", config);

  if (rightUpper.energy < leftUpper.energy) {
    return rightUpper;
  }

  return leftUpper;
}

function evaluateSplitDirection(
  hUpper: number[],
  hLower: number[],
  upper: ScourSplitSide,
  lower: ScourSplitSide,
  config: ScourConfig
): SplitDirectionResult {
  const movingInterface = computeMovingInterface(hUpper, hLower, {
    lambda: config.movingInterfaceLambda,
    anchorWeight: config.movingInterfaceAnchorWeight,
    mode: config.movingInterfaceMode
  });
  const energy = movingInterfaceEnergy(
    hUpper,
    hLower,
    movingInterface,
    config.movingInterfaceLambda,
    config.movingInterfaceAnchorWeight
  );

  return {
    upper,
    lower,
    movingInterface,
    energy
  };
}

function buildDebug(tree: ScourTreeNode, topChainCost: number): ScourDebug {
  let treeStructure = "";
  let chainCostVal: number | null = null;
  let splitCostVal: number | null = null;
  let splitPenaltyVal: number | null = null;
  let selectedSplit: string | null = null;

  const describe = (node: ScourTreeNode, depth: number): void => {
    const indent = "  ".repeat(depth);

    if (node.type === "leaf" || node.type === "chain") {
      treeStructure += `${indent}${node.type} [${node.layers.join(",")}] cost=${node.cost.toFixed(2)}\n`;
      if (depth === 0) {
        chainCostVal = node.cost;
      }
      return;
    }

    treeStructure +=
      `${indent}split [${node.layers.join(",")}] ` +
      `upper=${node.upper} cost=${node.cost.toFixed(2)} interface=${node.interfaceEnergy.toFixed(2)}\n`;
    if (depth === 0) {
      splitCostVal = node.cost;
      selectedSplit =
        `upper=${node.upper === "left" ? "L" : "R"} ` +
        `L=[${node.left.layers.join(",")}] R=[${node.right.layers.join(",")}]`;
      splitPenaltyVal = node.splitPenalty;
    }

    describe(node.left, depth + 1);
    describe(node.right, depth + 1);
  };

  describe(tree, 0);

  if (chainCostVal === null) {
    chainCostVal = topChainCost;
  }

  return {
    treeType: tree.type,
    treeStructure: treeStructure.trimEnd(),
    totalCost: tree.cost,
    chainCost: chainCostVal,
    splitCost: splitCostVal,
    splitPenalty: splitPenaltyVal,
    selectedSplit,
    recursionDepth: maxDepth(tree)
  };
}

function maxDepth(node: ScourTreeNode): number {
  if (node.type === "leaf" || node.type === "chain") {
    return 0;
  }
  return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));
}
