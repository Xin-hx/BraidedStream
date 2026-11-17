import type { PipelineResult } from "braided-stream/core";
function fmt(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(1);
}
export function tooltipRows(result: PipelineResult, t: number, layerId: string,
  datasetId: string, sampleSize: number | undefined, spaceKind?: string): string[][] {
  const layer = { id: layerId };
  const i = result.layoutOrder.indexOf(layerId);
  const geometry = result.braided.layers[i];
  const point = geometry.debug?.[t];
  const magnitude = result.base.yTop[i][t] - result.base.yBottom[i][t];
  return [
    ["representative thickness H = raw P median", fmt(magnitude)],
    ["raw P: U / A- / A+ / b", point
      ? `${fmt(point.dispersion)} / ${fmt(point.deviationLow)} / ${fmt(point.deviationHigh)} / ${geometry.balance[t].toFixed(3)}`
      : "n/a"],
    ["modes K / basin masses π", point
      ? `${geometry.branchCount[t]} / ${point.branchMasses.map((mass) => mass.toFixed(3)).join(", ")}`
      : "n/a"],
    ["allocated gaps g", point ? point.gaps.map(fmt).join(", ") : "n/a"],
    ...(spaceKind ? [["space owner", `${spaceKind} · ${layer.id}`]] : []),
    ...(sampleSize === null || sampleSize === undefined
      ? []
      : [[datasetId === "covid-inc"
        ? "model members"
        : datasetId === "illustration" ? "ensemble members" : "patient sample", String(sampleSize)]]),
  ];
}
