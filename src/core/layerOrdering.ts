import type { LayerInput, PreparedDataset } from "./types";

/** Preserve the dataset order, appending any layers omitted from the order list. */
export function normalizedInputOrder(dataset: PreparedDataset): string[] {
  const layerIds = dataset.layers.map((layer) => layer.id);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of dataset.order) {
    if (layerIds.includes(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of layerIds) {
    if (!seen.has(id)) {
      order.push(id);
    }
  }
  return order;
}

/** Alternate a sorted ranking outward from the streamgraph center. */
export function buildCenterOutOrder(sortedOrder: string[]): string[] {
  const n = sortedOrder.length;
  if (n <= 2) {
    return sortedOrder.slice();
  }

  const out = new Array<string>(n);
  const centerLeft = Math.floor((n - 1) / 2);
  let left = centerLeft;
  let right = centerLeft + 1;

  for (let i = 0; i < n; i += 1) {
    const id = sortedOrder[i];
    if (i === 0) {
      out[centerLeft] = id;
      left -= 1;
      continue;
    }

    const placeUpper = i % 2 === 1;
    if (placeUpper) {
      if (right < n) {
        out[right] = id;
        right += 1;
      } else if (left >= 0) {
        out[left] = id;
        left -= 1;
      }
    } else if (left >= 0) {
      out[left] = id;
      left -= 1;
    } else if (right < n) {
      out[right] = id;
      right += 1;
    }
  }

  return out.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Classic inside-out ordering by total layer mass. */
export function buildInsideOutOrder(layers: LayerInput[], inputOrder: string[]): string[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const totals = inputOrder
    .map((id) => ({ id, total: byId.get(id)?.mean.reduce((acc, value) => acc + Math.max(0, value), 0) ?? 0 }))
    .sort((a, b) => {
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

