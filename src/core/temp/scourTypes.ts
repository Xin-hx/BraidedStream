/**
 * Types for the recursive scour-minimized streamgraph layout.
 *
 * The tree is binary: a group is either a single layer, a conventional chain,
 * or a split whose two children are placed on opposite sides of a local support
 * interface.
 */

/** Configuration knobs for the scour solver. */
export interface ScourConfig {
  /** Weight on second-difference turning energy. */
  lambdaTurn: number;
  /** Fixed base penalty for every binary split. */
  rhoSplit: number;
  /** Weight on the split height penalty. */
  etaHeight: number;
  /** Weight on the split balance penalty. */
  betaBalance: number;
  /** Maximum recursion depth, with the root at depth 0. */
  maxDepth: number;
  /** Groups with this many layers or fewer are kept as a chain. */
  minGroupSize: number;
  /** Exact is exhaustive for groups of size <= 12; greedy is bounded. */
  searchMode: "greedy" | "exact";
  /** Fixed seed for reproducible random splits in greedy mode. */
  seed: number;
  /** Weight on the second-difference term in each moving interface energy. */
  movingInterfaceLambda: number;
  /** Pulls each node-local interface toward its local zero support line. */
  movingInterfaceAnchorWeight: number;
  /** Weight applied when adding moving-interface energy to split cost. */
  movingInterfaceWeight: number;
  /** Moving-interface solver mode. */
  movingInterfaceMode: ScourMovingInterfaceMode;
}

export const DEFAULT_SCOUR_CONFIG: ScourConfig = {
  lambdaTurn: 0.2,
  rhoSplit: 0.05,
  etaHeight: 0.01,
  betaBalance: 0.1,
  maxDepth: 4,
  minGroupSize: 1,
  searchMode: "greedy",
  seed: 42,
  movingInterfaceLambda: 0.2,
  movingInterfaceAnchorWeight: 0,
  movingInterfaceWeight: 0.25,
  movingInterfaceMode: "optimized"
};

export type ScourSplitSide = "left" | "right";
export type ScourMovingInterfaceMode = "symmetric" | "optimized" | "fixed";

export interface ScourMovingInterface {
  nodeId: string;
  layers: number[];
  upper: ScourSplitSide;
  lower: ScourSplitSide;
  interface: number[];
  energy: number;
}

/** Degenerate terminal node for a single layer. */
export interface ScourLeafNode {
  type: "leaf";
  /** A one-element layer list, kept as an array for API uniformity. */
  layers: number[];
  /** Equal to layers for a leaf. */
  order: number[];
  /** Always 0 for a valid single layer. */
  cost: number;
}

/** Terminal node rendered as one conventional stack. */
export interface ScourChainNode {
  type: "chain";
  /** Sorted layer indices in this group. */
  layers: number[];
  /** Display order within the chain, from support interface outward. */
  order: number[];
  cost: number;
}

/** Binary split node: two sub-groups on opposite sides of a local interface. */
export interface ScourSplitNode {
  type: "split";
  /** Stable id, currently the sorted layer set, for node-wise diagnostics. */
  nodeId: string;
  layers: number[];
  left: ScourTreeNode;
  right: ScourTreeNode;
  /** Which child is placed above this node's moving interface. */
  upper: ScourSplitSide;
  /** Which child is placed below this node's moving interface. */
  lower: ScourSplitSide;
  /** Local dynamic support interface b_v(t), before parent embedding. */
  interface: number[];
  /** E_v(b_v) for the chosen upper/lower assignment. */
  interfaceEnergy: number;
  /** Split penalty P(left,right), kept for diagnostics. */
  splitPenalty: number;
  cost: number;
}

export type ScourTerminalNode = ScourLeafNode | ScourChainNode;
export type ScourTreeNode = ScourTerminalNode | ScourSplitNode;

/** Result of solving the recursive scour problem. */
export interface ScourResult {
  tree: ScourTreeNode;
  totalCost: number;
}

/**
 * Flattened per-layer geometry for rendering.
 *
 * Each entry gives the final yBottom / yTop values at every time step, suitable
 * for existing area-path renderers.
 */
export interface ScourLayout {
  /** yBottom per layer: layerCount x timeCount. */
  yBottom: number[][];
  /** yTop per layer: layerCount x timeCount. */
  yTop: number[][];
  /** Layer ids ordered back-to-front for rendering. */
  order: number[];
  /** Root support interface after the final global shift. */
  centerline: number[];
  /** One entry per internal split node: (T, sigma_v, b_v(t)). */
  nodeWiseMovingInterfaces: ScourMovingInterface[];
}

/** Debug and diagnostic information exposed by the solver. */
export interface ScourDebug {
  treeType: ScourTreeNode["type"];
  treeStructure: string;
  totalCost: number;
  chainCost: number | null;
  splitCost: number | null;
  splitPenalty: number | null;
  selectedSplit: string | null;
  recursionDepth: number;
}
