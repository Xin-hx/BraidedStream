import type { LayerInput, PreparedDataset } from "../types";

/** Reorder layers by id, rejecting missing or duplicate ids. */
export function orderLayers(layers: LayerInput[], order: string[]): LayerInput[] {
  const byId = new Map<string, LayerInput>(layers.map((layer) => [layer.id, layer]));
  const seen = new Set<string>();
  const ordered: LayerInput[] = [];
  for (const id of order) {
    const layer = byId.get(id);
    if (!layer) {
      throw new Error(`order references unknown layer id: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`order contains duplicate id: ${id}`);
    }
    seen.add(id);
    ordered.push(layer);
  }
  if (ordered.length !== layers.length) {
    throw new Error("order length must match layers length");
  }
  return ordered;
}

/** Preserve the dataset order, appending any layers omitted from the order list. */
export function normalizedInputOrder(dataset: PreparedDataset): string[] {
  const layerIds = dataset.layers.map((layer) => layer.id);
  return normalizeOrderForComparison(dataset.order, layerIds, layerIds);
}

/** Alternate a sorted ranking outward from the streamgraph center. */
export function buildCenterOutOrder(sortedOrder: string[]): string[] {
  const n = sortedOrder.length;
  if (n <= 2) {
    return sortedOrder.slice();
  }

  const out = new Array<string>(n);
  const slots = centerOutSlots(n);
  for (let i = 0; i < n; i += 1) {
    out[slots[i]] = sortedOrder[i];
  }
  return out;
}

/** Inside-out ordering with late-onset layers kept near the stream center. */
export function buildInsideOutOrder(layers: LayerInput[], inputOrder: string[]): string[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const totals = inputOrder
    .map((id) => {
      const layer = byId.get(id);
      return {
        id,
        onset: layer ? onsetIndex(layer.height) : 0,
        total: layer?.height.reduce((acc, value) => acc + Math.max(0, value), 0) ?? 0
      };
    })
    .sort((a, b) => {
      if (b.onset !== a.onset) {
        return b.onset - a.onset;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.id.localeCompare(b.id);
    });

  const lower: string[] = [];
  const upper: string[] = [];
  let lowerLoad = 0;
  let upperLoad = 0;
  for (const item of totals) {
    if (lowerLoad <= upperLoad) {
      lower.unshift(item.id);
      lowerLoad += item.total;
    } else {
      upper.push(item.id);
      upperLoad += item.total;
    }
  }
  return lower.concat(upper);
}

/** 2-opt ordering over adjacent layer counter-motion distance. */
export function buildTwoOptOrder(layers: LayerInput[], inputOrder: string[]): string[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const layerIds = layers.map((layer) => layer.id);
  const order = normalizeOrderForComparison(inputOrder, layerIds, layerIds);
  if (order.length <= 3) {
    return order;
  }

  const distance = (a: string, b: string) => adjacencyDistance(byId.get(a)!, byId.get(b)!);
  for (let pass = 0; pass < order.length; pass += 1) {
    let improved = false;
    for (let i = 1; i < order.length - 2; i += 1) {
      for (let k = i + 1; k < order.length - 1; k += 1) {
        const before = distance(order[i - 1], order[i]) + distance(order[k], order[k + 1]);
        const after = distance(order[i - 1], order[k]) + distance(order[i], order[k + 1]);
        if (after + 1e-12 < before) {
          order.splice(i, k - i + 1, ...order.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) {
      break;
    }
  }
  return order;
}

/** Normalize an order to contain each allowed layer exactly once. */
export function normalizeOrderForComparison(candidate: string[], layerIds: string[], fallbackOrder: string[]): string[] {
  const allowed = new Set(layerIds);
  const out: string[] = [];
  const seen = new Set<string>();
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
export function rankMap(order: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) {
    out.set(order[i], i + 1);
  }
  return out;
}

function centerOutSlots(length: number): number[] {
  const slots: number[] = [];
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

function onsetIndex(values: number[]): number {
  const first = values.findIndex((value) => value > 1e-9);
  if (first >= 0) {
    return first;
  }
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) {
      best = i;
    }
  }
  return best;
}

function adjacencyDistance(a: LayerInput, b: LayerInput): number {
  const length = Math.min(a.height.length, b.height.length);
  let weighted = 0;
  let weightSum = 0;
  for (let t = 1; t < length; t += 1) {
    const da = a.height[t] - a.height[t - 1];
    const db = b.height[t] - b.height[t - 1];
    const denom = Math.abs(da) + Math.abs(db);
    if (denom <= 1e-12) {
      continue;
    }
    const weight = Math.max(1e-9, a.height[t] + b.height[t]);
    weighted += weight * (Math.abs(da + db) / denom);
    weightSum += weight;
  }
  return weightSum <= 0 ? 0 : weighted / weightSum;
}
