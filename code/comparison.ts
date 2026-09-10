import { runPipeline } from "./index";
import { generateSynthetic } from "./synthetic";
import type { Layer, PipelineResult } from "./types";

export const ROUTE_A_SEED = 20260811;
export const ROUTE_A_WIDTH = 560;
export const ROUTE_A_HEIGHT = 300;
export const ROUTE_A_MARGIN = { top: 16, right: 14, bottom: 24, left: 46 } as const;
export const ROUTE_A_PALETTE = [
  "#0072B2", "#E69F00", "#009E73", "#56B4E9", "#D55E00",
  "#CC79A7", "#F0E442", "#000000", "#8C8C8C", "#66C2A5",
] as const;

export interface RouteAComparison {
  layers: Layer[];
  times: string[];
  result: PipelineResult;
  colors: string[];
  yDomain: [number, number];
}

export function createRouteAComparison(): RouteAComparison {
  const { layers } = generateSynthetic({ seed: ROUTE_A_SEED });
  const times = Array.from({ length: layers[0].q.p50.length }, (_, t) => `t${t}`);
  const yExtent = Math.max(...times.map((_, t) => layers.reduce((sum, layer) => sum + layer.q.p50[t], 0)));
  const result = runPipeline(layers, {
    normalize: "global",
    smoothWindow: 0,
    corridors: {
      participationThreshold: 0.3,
      amplitudeMax: 0.03 * yExtent,
      clearance: 0.002 * yExtent,
      gamma: 1,
      encoding: "both",
      frequencyMin: 0.5,
      frequencyMax: 4,
      windowSmooth: 5,
      budgetEta: 1.6,
      phaseMode: "sine",
    },
  });
  const colors = result.pid.order.map((id, i) =>
    layers.find((layer) => layer.id === id)?.color ?? ROUTE_A_PALETTE[i % ROUTE_A_PALETTE.length]
  );
  return { layers, times, result, colors, yDomain: comparisonYDomain(result) };
}

function comparisonYDomain(result: PipelineResult): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < result.braided.yBottomStar.length; i += 1) {
    for (let t = 0; t < result.braided.yBottomStar[i].length; t += 1) {
      low = Math.min(low, result.braided.yBottomStar[i][t]);
      high = Math.max(high, result.braided.yTopStar[i][t]);
    }
  }
  const pad = (high - low) * 0.08 || 1;
  return [low - pad, high + pad];
}
