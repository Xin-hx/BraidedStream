/**
 * Layer order optimization using SineStream-style hierarchical ordering.
 *
 * The public entry point prepares distance options and diagnostics; the helper
 * groups below build the hierarchy, solve optimal leaf ordering, and evaluate
 * pairwise distances.
 */
import { FIXED_SEED } from "./seed.js";
import { roiBounds } from "./roi.js";
import { median, seededShuffleIndices } from "./utils.js";
import { layerUncertaintyAt } from "./validate.js";
const ORIENTATION_ENUM = [
    [0, 0, 1, 1],
    [0, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 1, 0, 0]
];
/** Optimize bottom-to-top layer order within an optional ROI. */
export function optimizeLayerOrder(layers, roi, config, initialOrder) {
    if (layers.length <= 1) {
        return {
            order: layers.map((layer) => layer.id),
            clusterByLayerId: new Map(layers.map((layer) => [layer.id, 0])),
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
    const options = {
        weightType: config.weightType ?? "max",
        useThicknessWeight: config.useThicknessWeight !== false,
        useLengthWeight: config.useLengthWeight !== false,
        lengthWeightThreshold: Math.max(1e-9, config.lengthWeightThreshold ?? 9),
        useUncertaintyTerm: config.useUncertaintyTerm === true,
        uncertaintyWeight: Math.max(0, config.uncertaintyWeight ?? 0)
    };
    const shuffleSeed = Number.isFinite(config.shuffleSeed) ? config.shuffleSeed : FIXED_SEED;
    const shuffledLayerIndices = seededShuffleIndices(layers.length, shuffleSeed);
    const leafNodes = buildLeafNodes(layers, shuffledLayerIndices);
    const totalNodeCount = layers.length * 2 - 1;
    const distanceMatrix = Array.from({ length: totalNodeCount }, () => new Array(totalNodeCount).fill(-1));
    for (let i = 0; i < totalNodeCount; i += 1) {
        distanceMatrix[i][i] = 0;
    }
    const nodeByIndex = new Map();
    for (const node of leafNodes) {
        nodeByIndex.set(node.index, node);
    }
    const uncertaintyScale = options.useUncertaintyTerm ? computeUncertaintyScale(layers, left, right) : 1;
    let activeNodes = leafNodes.slice();
    let nextIndex = leafNodes.length;
    while (activeNodes.length > 1) {
        let pickA = 0;
        let pickB = 1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < activeNodes.length - 1; i += 1) {
            for (let j = i + 1; j < activeNodes.length; j += 1) {
                const d = getDistance(activeNodes[i], activeNodes[j], distanceMatrix, left, right, options, uncertaintyScale);
                if (d < bestDistance) {
                    bestDistance = d;
                    pickA = i;
                    pickB = j;
                }
            }
        }
        const merged = mergeNodes(nextIndex, activeNodes[pickA], activeNodes[pickB]);
        nodeByIndex.set(nextIndex, merged);
        nextIndex += 1;
        activeNodes.splice(pickB, 1);
        activeNodes.splice(pickA, 1);
        activeNodes.push(merged);
    }
    const root = activeNodes[0];
    const orderedLeafIndices = getOrderByOptimalLeafOrdering(root, nodeByIndex, distanceMatrix, left, right, options, uncertaintyScale);
    const leafIndexToLayerId = new Map();
    const layerIdToLeafIndex = new Map();
    for (const node of leafNodes) {
        if (!node.layerId) {
            continue;
        }
        leafIndexToLayerId.set(node.index, node.layerId);
        layerIdToLeafIndex.set(node.layerId, node.index);
    }
    const order = [];
    for (const leafIndex of orderedLeafIndices) {
        const layerId = leafIndexToLayerId.get(leafIndex);
        if (layerId && !order.includes(layerId)) {
            order.push(layerId);
        }
    }
    for (const layer of layers) {
        if (!order.includes(layer.id)) {
            order.push(layer.id);
        }
    }
    const fallbackOrder = layers.map((layer) => layer.id);
    const initialIds = initialOrder && initialOrder.length > 0 ? initialOrder : fallbackOrder;
    const initialLeafOrder = initialIds
        .map((id) => layerIdToLeafIndex.get(id))
        .filter((value) => value !== undefined);
    const objectiveBefore = objective(initialLeafOrder, leafNodes, distanceMatrix, left, right, options, uncertaintyScale);
    const objectiveAfter = objective(orderedLeafIndices, leafNodes, distanceMatrix, left, right, options, uncertaintyScale);
    return {
        order,
        clusterByLayerId: new Map(order.map((id) => [id, 0])),
        boundaryPenalty: new Array(Math.max(0, order.length - 1)).fill(1),
        diagnostics: {
            objectiveBefore,
            objectiveAfter,
            clusterCount: 1,
            trunkCluster: 0,
            crossClusterBoundaries: 0
        }
    };
}
function buildLeafNodes(layers, shuffledIndices) {
    const nodes = [];
    for (let i = 0; i < shuffledIndices.length; i += 1) {
        const layerIndex = shuffledIndices[i];
        const layer = layers[layerIndex];
        const size = layer.mean.slice();
        const dFi = toDiff(size);
        const uncertainty = size.map((_v, t) => Math.max(0, layerUncertaintyAt(layer, t)));
        nodes.push({
            index: i,
            isLeaf: true,
            layerId: layer.id,
            layerArrayIndex: layerIndex,
            memberCount: 1,
            size,
            dFi,
            uncertainty
        });
    }
    return nodes;
}
function mergeNodes(index, left, right) {
    const tLength = left.size.length;
    const size = new Array(tLength).fill(0);
    const uncertainty = new Array(tLength).fill(0);
    const memberCount = left.memberCount + right.memberCount;
    for (let t = 0; t < tLength; t += 1) {
        size[t] = left.size[t] + right.size[t];
        uncertainty[t] =
            (left.uncertainty[t] * left.memberCount + right.uncertainty[t] * right.memberCount) / Math.max(1, memberCount);
    }
    return {
        index,
        isLeaf: false,
        layerId: null,
        layerArrayIndex: -1,
        memberCount,
        size,
        dFi: toDiff(size),
        uncertainty,
        leftChild: left,
        rightChild: right
    };
}
function toDiff(values) {
    const out = new Array(Math.max(0, values.length - 1)).fill(0);
    for (let i = 1; i < values.length; i += 1) {
        out[i - 1] = values[i] - values[i - 1];
    }
    return out;
}
function getOrderByOptimalLeafOrdering(root, nodeByIndex, distanceMatrix, left, right, options, uncertaintyScale) {
    const memoLeaves = new Map();
    const memoDp = new Map();
    const recurse = (node) => {
        if (node.isLeaf) {
            const table = new Map();
            table.set(pairKey(node.index, node.index), { cost: 0, order: [node.index] });
            memoDp.set(node.index, table);
            return;
        }
        const leftChild = node.leftChild;
        const rightChild = node.rightChild;
        recurse(leftChild);
        recurse(rightChild);
        const leftTable = memoDp.get(leftChild.index);
        const rightTable = memoDp.get(rightChild.index);
        const [nodesLeftLeft, nodesLeftRight] = boundaryLeaves(leftChild, memoLeaves);
        const [nodesRightLeft, nodesRightRight] = boundaryLeaves(rightChild, memoLeaves);
        const nodesLeft = [nodesLeftLeft, nodesLeftRight];
        const nodesRight = [nodesRightLeft, nodesRightRight];
        const table = new Map();
        for (const [leftOuter, rightOuter, leftInner, rightInner] of ORIENTATION_ENUM) {
            const nodesLL = nodesLeft[leftOuter];
            const nodesRR = nodesRight[rightOuter];
            const nodesLR = nodesLeft[leftInner];
            const nodesRL = nodesRight[rightInner];
            for (const u of nodesLL) {
                for (const w of nodesRR) {
                    let bestCost = Number.POSITIVE_INFINITY;
                    let bestOrder = null;
                    for (const m of nodesLR) {
                        for (const k of nodesRL) {
                            const leftEntry = leftTable.get(pairKey(u, m));
                            const rightEntry = rightTable.get(pairKey(k, w));
                            if (!leftEntry || !rightEntry) {
                                continue;
                            }
                            const middleDistance = getDistance(nodeByIndex.get(m), nodeByIndex.get(k), distanceMatrix, left, right, options, uncertaintyScale);
                            const currentCost = leftEntry.cost + rightEntry.cost + middleDistance;
                            if (currentCost < bestCost) {
                                bestCost = currentCost;
                                bestOrder = leftEntry.order.concat(rightEntry.order);
                            }
                        }
                    }
                    if (!bestOrder) {
                        continue;
                    }
                    storeBetter(table, pairKey(u, w), bestCost, bestOrder);
                    storeBetter(table, pairKey(w, u), bestCost, bestOrder.slice().reverse());
                }
            }
        }
        memoDp.set(node.index, table);
    };
    recurse(root);
    const rootTable = memoDp.get(root.index);
    if (!rootTable || rootTable.size === 0) {
        return allLeaves(root, memoLeaves);
    }
    let bestCost = Number.POSITIVE_INFINITY;
    let bestOrder = [];
    for (const value of rootTable.values()) {
        if (value.cost < bestCost) {
            bestCost = value.cost;
            bestOrder = value.order.slice();
        }
    }
    if (bestOrder.length === 0) {
        return allLeaves(root, memoLeaves);
    }
    return bestOrder;
}
function boundaryLeaves(node, memoLeaves) {
    if (node.isLeaf) {
        return [[node.index], [node.index]];
    }
    return [allLeaves(node.leftChild, memoLeaves), allLeaves(node.rightChild, memoLeaves)];
}
function allLeaves(node, memoLeaves) {
    const cached = memoLeaves.get(node.index);
    if (cached) {
        return cached;
    }
    if (node.isLeaf) {
        const leaves = [node.index];
        memoLeaves.set(node.index, leaves);
        return leaves;
    }
    const leaves = allLeaves(node.leftChild, memoLeaves).concat(allLeaves(node.rightChild, memoLeaves));
    memoLeaves.set(node.index, leaves);
    return leaves;
}
function pairKey(a, b) {
    return `${a}_${b}`;
}
function storeBetter(table, key, cost, order) {
    const prev = table.get(key);
    if (!prev || cost < prev.cost) {
        table.set(key, { cost, order: order.slice() });
    }
}
function objective(leafOrder, leafNodes, distanceMatrix, left, right, options, uncertaintyScale) {
    if (leafOrder.length <= 1) {
        return 0;
    }
    const leafByIndex = new Map(leafNodes.map((node) => [node.index, node]));
    let total = 0;
    for (let i = 0; i < leafOrder.length - 1; i += 1) {
        const a = leafByIndex.get(leafOrder[i]);
        const b = leafByIndex.get(leafOrder[i + 1]);
        if (!a || !b) {
            continue;
        }
        total += getDistance(a, b, distanceMatrix, left, right, options, uncertaintyScale);
    }
    return total;
}
function getDistance(nodeA, nodeB, distanceMatrix, left, right, options, uncertaintyScale) {
    const cached = distanceMatrix[nodeA.index]?.[nodeB.index];
    if (cached !== undefined && cached >= 0) {
        return cached;
    }
    const computed = computeDistance(nodeA, nodeB, left, right, options, uncertaintyScale);
    const safe = Number.isFinite(computed) && computed >= 0 ? computed : 0;
    distanceMatrix[nodeA.index][nodeB.index] = safe;
    distanceMatrix[nodeB.index][nodeA.index] = safe;
    return safe;
}
function computeDistance(nodeA, nodeB, left, right, options, uncertaintyScale) {
    const safeLeft = Math.max(0, Math.min(left, nodeA.size.length - 1));
    const safeRight = Math.max(0, Math.min(right, nodeA.size.length - 1));
    if (safeRight <= safeLeft) {
        return 0;
    }
    let countD = safeRight - safeLeft;
    let compensation = 0;
    for (let t = safeLeft; t < safeRight; t += 1) {
        const dA = nodeA.dFi[t] ?? 0;
        const dB = nodeB.dFi[t] ?? 0;
        const denom = Math.abs(dA) + Math.abs(dB);
        const sizeNow = nodeA.size[t] + nodeB.size[t];
        const sizeNext = nodeA.size[t + 1] + nodeB.size[t + 1];
        if (denom === 0 && sizeNow === 0 && sizeNext === 0) {
            countD -= 1;
            continue;
        }
        if (denom === 0) {
            continue;
        }
        compensation += Math.abs(dA + dB) / denom;
    }
    if (countD <= 0) {
        return 0;
    }
    let distance = compensation / countD;
    if (options.useThicknessWeight) {
        distance *= thicknessWeight(nodeA, nodeB, safeLeft, safeRight, options.weightType);
    }
    if (options.useLengthWeight) {
        distance *= lengthWeight(nodeA, nodeB, safeLeft, safeRight, options.lengthWeightThreshold);
    }
    if (options.useUncertaintyTerm && options.uncertaintyWeight > 0) {
        const unc = uncertaintyDifference(nodeA, nodeB, safeLeft, safeRight, uncertaintyScale);
        distance += options.uncertaintyWeight * unc;
    }
    return Number.isFinite(distance) ? distance : 0;
}
function thicknessWeight(nodeA, nodeB, left, right, weightType) {
    switch (weightType) {
        case "arithmetic": {
            let sum = 0;
            let count = 0;
            for (let t = left; t <= right; t += 1) {
                const v = nodeA.size[t] + nodeB.size[t];
                if (v !== 0) {
                    sum += v;
                    count += 1;
                }
            }
            return count === 0 ? 0 : sum / count;
        }
        case "geometric": {
            let product = 1;
            let count = 0;
            for (let t = left; t <= right; t += 1) {
                const v = nodeA.size[t] + nodeB.size[t];
                if (v !== 0) {
                    count += 1;
                }
            }
            if (count === 0) {
                return 0;
            }
            for (let t = left; t <= right; t += 1) {
                const v = nodeA.size[t] + nodeB.size[t];
                if (v !== 0) {
                    product *= Math.pow(v, 1 / count);
                }
            }
            return product;
        }
        case "harmonic": {
            let harmonicSum = 0;
            let count = 0;
            for (let t = left; t <= right; t += 1) {
                const v = nodeA.size[t] + nodeB.size[t];
                if (v !== 0) {
                    harmonicSum += 1 / v;
                    count += 1;
                }
            }
            return harmonicSum === 0 ? 0 : count / harmonicSum;
        }
        case "median": {
            const values = [];
            for (let t = left; t <= right; t += 1) {
                values.push(nodeA.size[t] + nodeB.size[t]);
            }
            return median(values);
        }
        case "max":
        default: {
            let maxSize = Number.NEGATIVE_INFINITY;
            for (let t = left; t <= right; t += 1) {
                maxSize = Math.max(maxSize, nodeA.size[t] + nodeB.size[t]);
            }
            return Number.isFinite(maxSize) ? maxSize : 0;
        }
    }
}
function lengthWeight(nodeA, nodeB, left, right, threshold) {
    const roiLength = Math.max(1, right - left + 1);
    let maxA = Number.NEGATIVE_INFINITY;
    let maxB = Number.NEGATIVE_INFINITY;
    for (let t = left; t <= right; t += 1) {
        maxA = Math.max(maxA, nodeA.size[t]);
        maxB = Math.max(maxB, nodeB.size[t]);
    }
    if (!Number.isFinite(maxA)) {
        maxA = 0;
    }
    if (!Number.isFinite(maxB)) {
        maxB = 0;
    }
    let activeA = 0;
    let activeB = 0;
    const minTimes = Math.max(1e-9, threshold);
    for (let t = left; t <= right; t += 1) {
        if (nodeA.size[t] > maxA / minTimes) {
            activeA += 1;
        }
        if (nodeB.size[t] > maxB / minTimes) {
            activeB += 1;
        }
    }
    if (activeA === 0 || activeB === 0) {
        return 1;
    }
    return Math.max(roiLength / activeA, roiLength / activeB);
}
function uncertaintyDifference(nodeA, nodeB, left, right, uncertaintyScale) {
    let acc = 0;
    let count = 0;
    for (let t = left; t <= right; t += 1) {
        acc += Math.abs(nodeA.uncertainty[t] - nodeB.uncertainty[t]);
        count += 1;
    }
    if (count === 0) {
        return 0;
    }
    return (acc / count) / Math.max(1e-9, uncertaintyScale);
}
function computeUncertaintyScale(layers, left, right) {
    let maxMean = 0;
    const safeSpan = Math.max(1, right - left + 1);
    for (const layer of layers) {
        let acc = 0;
        for (let t = left; t <= right; t += 1) {
            acc += Math.max(0, layerUncertaintyAt(layer, t));
        }
        maxMean = Math.max(maxMean, acc / safeSpan);
    }
    return Math.max(1e-9, maxMean);
}
