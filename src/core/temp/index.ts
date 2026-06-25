/**
 * Recursive scour-minimized streamgraph barrel export.
 *
 * Usage:
 *   import { solveRecursiveScour, layoutScourTree } from "../core/temp";
 */

export {
  solveRecursiveScour,
  type ScourSolverResult
} from "./scourSolver";

export { layoutScourTree } from "./scourLayout";

export {
  aggregateThickness,
  chainCost,
  computeMovingInterface,
  firstDifference,
  heuristicOrder,
  layerVariationScore,
  layerWeights,
  movingInterfaceEnergy,
  secondDifference,
  splitPenalty
} from "./scourEnergy";

export {
  generateCandidateSplits,
  type CandidateSplit
} from "./scourSplits";

export {
  DEFAULT_SCOUR_CONFIG,
  type ScourChainNode,
  type ScourConfig,
  type ScourDebug,
  type ScourLayout,
  type ScourLeafNode,
  type ScourMovingInterfaceMode,
  type ScourMovingInterface,
  type ScourResult,
  type ScourSplitSide,
  type ScourSplitNode,
  type ScourTerminalNode,
  type ScourTreeNode
} from "./scourTypes";
