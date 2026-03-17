import * as d3 from "d3";

export function createAreaPath(
  times: number[],
  yBottom: number[],
  yTop: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>
): string {
  const area = d3
    .area<number>()
    .x((_, i) => xScale(times[i]))
    .y0((_, i) => yScale(yBottom[i]))
    .y1((_, i) => yScale(yTop[i]))
    .curve(d3.curveMonotoneX);

  return area(times) ?? "";
}
