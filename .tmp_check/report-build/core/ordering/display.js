/** Preserve the dataset order, appending any layers omitted from the order list. */
export function normalizedInputOrder(dataset) {
    const layerIds = dataset.layers.map((layer) => layer.id);
    return normalizeOrderForComparison(dataset.order, layerIds, layerIds);
}
/** Alternate a sorted ranking outward from the streamgraph center. */
export function buildCenterOutOrder(sortedOrder) {
    const n = sortedOrder.length;
    if (n <= 2) {
        return sortedOrder.slice();
    }
    const out = new Array(n);
    const slots = centerOutSlots(n);
    for (let i = 0; i < n; i += 1) {
        out[slots[i]] = sortedOrder[i];
    }
    return out;
}
/** Classic inside-out ordering by total layer mass. */
export function buildInsideOutOrder(layers, inputOrder) {
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const totals = inputOrder
        .map((id) => ({ id, total: byId.get(id)?.mean.reduce((acc, value) => acc + Math.max(0, value), 0) ?? 0 }))
        .sort((a, b) => {
        if (b.total !== a.total) {
            return b.total - a.total;
        }
        return a.id.localeCompare(b.id);
    });
    const lower = [];
    const upper = [];
    let lowerLoad = 0;
    let upperLoad = 0;
    for (const item of totals) {
        if (lowerLoad <= upperLoad) {
            lower.unshift(item.id);
            lowerLoad += item.total;
        }
        else {
            upper.push(item.id);
            upperLoad += item.total;
        }
    }
    return lower.concat(upper);
}
/** Normalize an order to contain each allowed layer exactly once. */
export function normalizeOrderForComparison(candidate, layerIds, fallbackOrder) {
    const allowed = new Set(layerIds);
    const out = [];
    const seen = new Set();
    for (const id of candidate) {
        if (!allowed.has(id) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        out.push(id);
    }
    for (const id of fallbackOrder) {
        if (!allowed.has(id) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        out.push(id);
    }
    for (const id of layerIds) {
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        out.push(id);
    }
    return out;
}
/** Build 1-based rank lookup for an ordered id list. */
export function rankMap(order) {
    const out = new Map();
    for (let i = 0; i < order.length; i += 1) {
        out.set(order[i], i + 1);
    }
    return out;
}
function centerOutSlots(length) {
    const slots = [];
    let left = Math.floor((length - 1) / 2);
    let right = left + 1;
    slots.push(left);
    left -= 1;
    while (slots.length < length) {
        if (right < length) {
            slots.push(right);
            right += 1;
        }
        if (left >= 0) {
            slots.push(left);
            left -= 1;
        }
    }
    return slots;
}
