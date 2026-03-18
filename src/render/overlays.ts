import * as d3 from "d3";
import type { ROI } from "../core/types";

export function drawInsetConnectors(
  svg: SVGSVGElement,
  mainRect: DOMRect,
  insetRect: DOMRect,
  roi: ROI | null,
  roiX0: number,
  roiX1: number
): void {
  const selection = d3.select(svg).selectAll<SVGLineElement, number>("line.inset-connector").data(roi ? [0, 1] : []);
  selection
    .join((enter) => enter.append("line").attr("class", "inset-connector"), (update) => update, (exit) => exit.remove())
    .attr("x1", (d) => (d === 0 ? mainRect.left + roiX0 : mainRect.left + roiX1))
    .attr("y1", mainRect.bottom)
    .attr("x2", (d) => (d === 0 ? insetRect.left : insetRect.right))
    .attr("y2", insetRect.top)
    .attr("stroke", "#0c4a6e")
    .attr("stroke-width", 1.2)
    .attr("stroke-dasharray", "5,3")
    .attr("opacity", 0.75);
}
