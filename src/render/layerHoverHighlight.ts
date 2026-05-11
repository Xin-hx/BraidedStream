import type * as d3 from "d3";

export interface LayerHoverDatum {
  id: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface LayerHoverHighlightOptions {
  dimFillOpacity: number;
  dimStrokeOpacity: number;
  hoverFillBoost: number;
  hoverStroke: string;
  hoverStrokeOpacity: number;
  hoverStrokeWidthFactor: number;
}

export function applyLayerHoverHighlight<T extends LayerHoverDatum>(
  selection: d3.Selection<SVGPathElement, T, SVGGElement, unknown>,
  layerId: string | null,
  options: LayerHoverHighlightOptions
): void {
  let hasHoveredDatum = false;
  if (layerId !== null) {
    selection.each((d) => {
      if (d.id === layerId) {
        hasHoveredDatum = true;
      }
    });
  }
  const hasHover = layerId !== null && hasHoveredDatum;
  selection
    .attr("fill-opacity", (d) =>
      hasHover ? (d.id === layerId ? Math.min(1, d.fillOpacity + options.hoverFillBoost) : options.dimFillOpacity) : d.fillOpacity
    )
    .attr("stroke", (d) => (hasHover && d.id === layerId ? options.hoverStroke : d.stroke))
    .attr("stroke-opacity", (d) =>
      hasHover ? (d.id === layerId ? options.hoverStrokeOpacity : options.dimStrokeOpacity) : d.strokeOpacity
    )
    .attr("stroke-width", (d) =>
      hasHover && d.id === layerId ? Math.max(d.strokeWidth * options.hoverStrokeWidthFactor, d.strokeWidth + 0.8) : d.strokeWidth
    )
    .classed("is-hover-muted", (d) => hasHover && d.id !== layerId)
    .classed("is-hover-focused", (d) => hasHover && d.id === layerId);

  if (hasHover) {
    selection.filter((d) => d.id === layerId).raise();
  }
}
