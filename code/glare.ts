/**
 * Deterministic analytic approximation of Zhou et al.'s glare component.
 * This is parameter-adapted: the original physical kernel parameters and
 * source code are unavailable, so it reproduces the bloom/halos/corona
 * mechanism without claiming an exact physical replication.
 */
export const GLARE_THRESHOLD = 0.4;
export const GLARE_ALPHA = 0.6;
export const GLARE_CARRIER_WIDTH_PX = 3;

export interface CarrierPoint { x: number; y: number }
export interface GlareSource extends CarrierPoint {
  layer: number;
  time: number;
  strength: number;
  carrierWidthPx: number;
}

/** One strongest sample per contiguous region at or above the threshold. */
export function detectGlareSources(
  u: number[][],
  carriers: CarrierPoint[][],
  threshold = GLARE_THRESHOLD,
  carrierWidthPx = GLARE_CARRIER_WIDTH_PX
): GlareSource[] {
  const sources: GlareSource[] = [];
  for (let layer = 0; layer < u.length; layer += 1) {
    let start = -1;
    for (let t = 0; t <= u[layer].length; t += 1) {
      const active = t < u[layer].length && u[layer][t] >= threshold;
      if (active && start < 0) start = t;
      if (!active && start >= 0) {
        let peak = start;
        for (let k = start + 1; k < t; k += 1) if (u[layer][k] > u[layer][peak]) peak = k;
        const point = carriers[layer][peak];
        sources.push({
          layer,
          time: peak,
          x: point.x,
          y: point.y,
          strength: u[layer][peak],
          carrierWidthPx,
        });
        start = -1;
      }
    }
  }
  return sources;
}

export interface GlareKernelSample {
  bloom: number;
  cyanHalo: number;
  amberHalo: number;
  corona: number;
  total: number;
}

/** Central bloom + two colored rings + a deterministic 12-ray corona. */
export function glareKernel(dx: number, dy: number, sourceKey = 0): GlareKernelSample {
  const radius = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const bloom = Math.exp(-(radius * radius) / 50);
  const cyanHalo = 0.16 * ring(radius, 10, 1.8);
  const amberHalo = 0.12 * ring(radius, 16, 2.4);
  const ray = Math.pow(Math.max(0, Math.cos(12 * angle + sourceKey * 0.73)), 10);
  const corona = 0.12 * Math.exp(-radius / 18) * ray * (radius / (radius + 2));
  return { bloom, cyanHalo, amberHalo, corona, total: bloom + cyanHalo + amberHalo + corona };
}

/** Screen blend of one normalized channel with a glare response. */
export function screenChannel(base: number, glare: number, alpha = GLARE_ALPHA): number {
  const b = clamp01(base);
  const g = clamp01(alpha * Math.max(0, glare));
  return 1 - (1 - b) * (1 - g);
}

function ring(radius: number, center: number, width: number): number {
  const d = (radius - center) / width;
  return Math.exp(-0.5 * d * d);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
