/**
 * Helpers for comparing partial or computed layer orders.
 */
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
