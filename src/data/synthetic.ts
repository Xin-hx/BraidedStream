/**
 * Deterministic synthetic streamgraph dataset generator.
 */
import type { LayerInput } from "../core/types";

export interface SyntheticDataset {
  times: number[];
  layers: LayerInput[];
  order: string[];
}


// 生成平滑的分层时间序列数据集，包含不确定性带。
export function generateSyntheticDataset(tLength = 180, kLength = 8): SyntheticDataset {
  const startUtc = Date.UTC(2020, 0, 1);
  const stepMs = 24 * 60 * 60 * 1000;
  const times = Array.from({ length: tLength }, (_, i) => startUtc + i * stepMs);
  const layers: LayerInput[] = [];

  for (let k = 0; k < kLength; k += 1) {
    const id = `L${k + 1}`;
    const mean = new Array<number>(tLength).fill(0);
    const unc = new Array<number>(tLength).fill(0);
    const lower = new Array<number>(tLength).fill(0);
    const upper = new Array<number>(tLength).fill(0);

    for (let t = 0; t < tLength; t += 1) {
      const x = t / (tLength - 1);
      const phase = k * 0.45;
      const base = 2.2 + 1.3 * Math.sin(2 * Math.PI * x + phase) + 0.8 * Math.sin(6 * Math.PI * x + phase * 0.5);
      const peakA = 3.0 * Math.exp(-Math.pow((x - (0.18 + k * 0.035)) / 0.085, 2));
      const peakB = 2.1 * Math.exp(-Math.pow((x - (0.68 - k * 0.03)) / 0.09, 2));
      const trend = 0.25 * (k + 1) * (0.5 + 0.5 * Math.sin(Math.PI * x));
      const meanValue = Math.max(0.25, base + peakA + peakB + trend);

      const uncertaintyWave = 0.45 + 0.55 * Math.abs(Math.sin(8 * Math.PI * x + k * 0.9));
      const uncValue = Math.max(0.05, 0.11 * meanValue + 0.33 * uncertaintyWave);

      mean[t] = meanValue;
      unc[t] = uncValue;
      lower[t] = Math.max(0, meanValue - uncValue);
      upper[t] = meanValue + uncValue;
    }

    layers.push({ id, height: mean, unc, lower, upper });
  }

  const order = layers.map((layer) => layer.id);
  return { times, layers, order };
}

export function generateBelievableDataset(layerCount = 15, timeCount = 30): SyntheticDataset {
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
