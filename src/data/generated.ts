/**
 * Deterministic generated streamgraph datasets.
 */
import type { LayerInput } from "../core/types";

export interface GeneratedDataset {
  times: number[];
  layers: LayerInput[];
  order: string[];
}

export function generateBelievableDataset(layerCount = 15, timeCount = 30): GeneratedDataset {
  const kLength = sanitizeCount(layerCount, 15, 1, 200);
  const tLength = sanitizeCount(timeCount, 30, 2, 2000);
  const startUtc = Date.UTC(2020, 0, 1);
  const stepMs = 24 * 60 * 60 * 1000;
  const times = Array.from({ length: tLength }, (_, i) => startUtc + i * stepMs);
  const random = new JavaRandom(0);
  const layers: LayerInput[] = [];

  for (let k = 0; k < kLength; k += 1) {
    const height = new Array<number>(tLength).fill(0);
    for (let bumpIndex = 0; bumpIndex < 5; bumpIndex += 1) {
      addBelievableBump(height, random);
    }
    layers.push({
      id: `G${k + 1}`,
      height: height.map((value) => Math.max(0, value))
    });
  }

  return {
    times,
    layers,
    order: layers.map((layer) => layer.id)
  };
}

function addBelievableBump(values: number[], random: JavaRandom): void {
  const height = 1 / (0.1 + random.nextDouble());
  const center = 2 * random.nextDouble() - 0.5;
  const width = 10 / (0.1 + random.nextDouble());
  const divisor = Math.max(1, values.length);

  for (let i = 0; i < values.length; i += 1) {
    const w = (i / divisor - center) * width;
    values[i] += height * Math.exp(-w * w);
  }
}

function sanitizeCount(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

class JavaRandom {
  private seed: bigint;

  constructor(seed: number) {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  }

  nextDouble(): number {
    const high = this.nextBits(26);
    const low = this.nextBits(27);
    return (high * 2 ** 27 + low) / 2 ** 53;
  }

  private nextBits(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
    return Number(this.seed >> BigInt(48 - bits));
  }
}
