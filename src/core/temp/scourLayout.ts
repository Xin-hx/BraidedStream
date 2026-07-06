/**
 * Recursive layout renderer for scour trees with node-wise moving interfaces.
 *
 * Every split node stores its own local dynamic support interface b_v(t). Parent
 * nodes allocate a vertical slot for each child subtree; if that child is itself
 * a split, its local interface is embedded into the allocated slot by a
 * time-varying translation. This preserves the binary tree structure while
 * avoiding a single fixed horizontal support line for every split.
 */

import type {
  ScourLayout,
  ScourMovingInterface,
  ScourSplitNode,
  ScourSplitSide,
  ScourTerminalNode,
  ScourTreeNode
} from "./scourTypes";
import { aggregateThickness } from "./scourEnergy";

type Side = 1 | -1;

export function layoutScourTree(
  heights: number[][],
  tree: ScourTreeNode
): ScourLayout {
  const T = heights[0]?.length ?? 0;
  const n = heights.length;
  const yBottom: number[][] = Array.from({ length: n }, () => new Array<number>(T).fill(0));
  const yTop: number[][] = Array.from({ length: n }, () => new Array<number>(T).fill(0));
  const renderOrder: number[] = [];
  const spanMemo = new Map<string, number[]>();
  const nodeWiseMovingInterfaces: ScourMovingInterface[] = [];

  let centerline: number[];
  if (tree.type === "split") {
    centerline = tree.interface.slice();
    layoutSplitAtInterface(
      tree,
      heights,
      centerline,
      spanMemo,
      yBottom,
      yTop,
      renderOrder,
      nodeWiseMovingInterfaces
    );
  } else {
    centerline = aggregateThickness(heights, tree.layers).map((value) => -0.5 * value);
    layoutTerminal(tree, heights, centerline, 1, yBottom, yTop, renderOrder);
  }

  return {
    yBottom,
    yTop,
    order: bottomToTopOrder(tree),
    centerline,
    nodeWiseMovingInterfaces
  };
}

function layoutSplitAtInterface(
  node: ScourSplitNode,
  heights: number[][],
  globalInterface: number[],
  spanMemo: Map<string, number[]>,
  yBottom: number[][],
  yTop: number[][],
  renderOrder: number[],
  nodeWiseMovingInterfaces: ScourMovingInterface[]
): void {
  nodeWiseMovingInterfaces.push({
    nodeId: node.nodeId,
    layers: node.layers.slice(),
    upper: node.upper,
    lower: node.lower,
    interface: globalInterface.slice(),
    energy: node.interfaceEnergy
  });

  const upperChild = childForSide(node, node.upper);
  const lowerChild = childForSide(node, node.lower);
  layoutSubtreeInSlot(
    upperChild,
    heights,
    globalInterface,
    1,
    spanMemo,
    yBottom,
    yTop,
    renderOrder,
    nodeWiseMovingInterfaces
  );
  layoutSubtreeInSlot(
    lowerChild,
    heights,
    globalInterface,
    -1,
    spanMemo,
    yBottom,
    yTop,
    renderOrder,
    nodeWiseMovingInterfaces
  );
}

function layoutSubtreeInSlot(
  node: ScourTreeNode,
  heights: number[][],
  slotBoundary: number[],
  side: Side,
  spanMemo: Map<string, number[]>,
  yBottom: number[][],
  yTop: number[][],
  renderOrder: number[],
  nodeWiseMovingInterfaces: ScourMovingInterface[]
): void {
  if (node.type !== "split") {
    layoutTerminal(node, heights, slotBoundary, side, yBottom, yTop, renderOrder);
    return;
  }

  const upperChild = childForSide(node, node.upper);
  const lowerChild = childForSide(node, node.lower);
  const hUpper = nodeSpan(upperChild, heights, spanMemo);
  const hLower = nodeSpan(lowerChild, heights, spanMemo);
  const localTop = addSeries(node.interface, hUpper);
  const localBottom = subtractSeries(node.interface, hLower);
  const offset = side === 1
    ? subtractSeries(slotBoundary, localBottom)
    : subtractSeries(slotBoundary, localTop);
  const globalInterface = addSeries(offset, node.interface);

  layoutSplitAtInterface(
    node,
    heights,
    globalInterface,
    spanMemo,
    yBottom,
    yTop,
    renderOrder,
    nodeWiseMovingInterfaces
  );
}

function layoutTerminal(
  node: ScourTerminalNode,
  heights: number[][],
  interfaceLine: number[],
  side: Side,
  yBottom: number[][],
  yTop: number[][],
  renderOrder: number[]
): void {
  const T = interfaceLine.length;
  const prefix = new Array<number>(T).fill(0);

  for (const layerIdx of node.order) {
    const row = heights[layerIdx] ?? [];

    if (side === 1) {
      for (let k = 0; k < T; k += 1) {
        yBottom[layerIdx][k] = interfaceLine[k] + prefix[k];
        yTop[layerIdx][k] = yBottom[layerIdx][k] + (row[k] ?? 0);
      }
    } else {
      for (let k = 0; k < T; k += 1) {
        yTop[layerIdx][k] = interfaceLine[k] - prefix[k];
        yBottom[layerIdx][k] = yTop[layerIdx][k] - (row[k] ?? 0);
      }
    }

    for (let k = 0; k < T; k += 1) {
      prefix[k] += row[k] ?? 0;
    }

    renderOrder.push(layerIdx);
  }
}

function bottomToTopOrder(node: ScourTreeNode): number[] {
  return bottomToTopInSlot(node, 1);
}

function bottomToTopInSlot(node: ScourTreeNode, side: Side): number[] {
  if (node.type !== "split") {
    return side === 1 ? node.order.slice() : node.order.slice().reverse();
  }

  return [
    ...bottomToTopInSlot(childForSide(node, node.lower), -1),
    ...bottomToTopInSlot(childForSide(node, node.upper), 1)
  ];
}

function childForSide(node: ScourSplitNode, side: ScourSplitSide): ScourTreeNode {
  return side === "left" ? node.left : node.right;
}

function nodeSpan(
  node: ScourTreeNode,
  heights: number[][],
  spanMemo: Map<string, number[]>
): number[] {
  const key = node.layers.join(",");
  const cached = spanMemo.get(key);
  if (cached) {
    return cached;
  }

  const span = aggregateThickness(heights, node.layers);
  spanMemo.set(key, span);
  return span;
}

function addSeries(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = a[i] + (b[i] ?? 0);
  }
  return out;
}

function subtractSeries(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = a[i] - (b[i] ?? 0);
  }
  return out;
}
