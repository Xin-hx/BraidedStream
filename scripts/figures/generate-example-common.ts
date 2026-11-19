/**
 * Shared deterministic paper-example exporter.
 * Run either case entry point from the repository root:
 *   npx vite-node scripts/figures/generate-covid.ts
 *   npx vite-node scripts/figures/generate-tcm.ts
 *
 * Manual tuning starts in the constants and paperStyle sections below. The
 * analysis pipeline always runs on the full input datasets; date windows only
 * crop what is displayed.
 *
 * Quick guide:
 *   1. constants: time windows, snapshots, and dimensions;
 *   2. paperStyle and addDistributionMatrix: COVID panel styling;
 *   3. arrangeTcmPanel: TCM stream emphasis and visit guides;
 *   4. case-specific stories and export validation.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { Resvg } from "@resvg/resvg-js";
import { scaleLog } from "d3";
import { convertCovidCase } from "../../examples/converters/covidConverter";
import { convertTcmCase, TCM_COLORS, type TcmDisplayMetadata } from "../../examples/converters/tcmConverter";
import { buildAnalysisDistribution } from "braided-stream/core";
import type { AnalysisDistribution } from "braided-stream/core";
import { runPipeline } from "braided-stream/core";
import { colorForLayer, diseaseDay, renderChart, W, H, M, type DisplayLayer } from "braided-stream";
import type { InputDataset, ProbabilityMeasure } from "braided-stream/core";
import type { PipelineResult } from "braided-stream/core";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  SVGElement: dom.window.SVGElement,
  SVGSVGElement: dom.window.SVGSVGElement,
  XMLSerializer: dom.window.XMLSerializer,
});

// === 1. Manual tuning: figure size, displayed windows, and panel layout ===
// Change these values first when adapting the paper layout.
const NS = "http://www.w3.org/2000/svg";
const OUTPUT_DIR = resolve("artifacts/figures");
const PNG_WIDTH = 2139;
const COVID_PNG_WIDTH = 2480;
const MAIN_HEIGHT = H;
const COVID_HEIGHT = H;
const COVID_STATES = ["Alabama", "Kentucky", "Mississippi", "Tennessee"];
const COVID_SNAPSHOTS = ["2022-01-29", "2022-02-19", "2022-04-02"];
// COVID main figure: the streamgraph-to-distribution width ratio is about 1:2.
// Keep enough left margin for the black state labels when adjusting STREAM_X.
const COVID_STREAM_X = 118;
const COVID_STREAM_WIDTH = 315;
const COVID_DISTRIBUTION_X = 526;
const COVID_DISTRIBUTION_WIDTH = 630;
// TPID uses all visits; the paper panel stops before the sparse tail.
const TCM_HEIGHT = H;
const TCM_END = "visit 20";
const TCM_SNAPSHOTS = ["visit 5", "visit 20"];
const TCM_TARGETS = ["凉血止血类", "补虚药"] as const;
// Two-thirds of a standard 180 mm double-column publication width.
const TCM_MAIN_WIDTH_MM = 120;
const TCM_KDE_WIDTH_MM = 40;
const TCM_CCDF_WIDTH_MM = 40;
const TCM_PRIMARY_FONT = 20;
const TCM_AXIS_FONT = 16;

type CaseLayer = DisplayLayer & { measures: readonly (ProbabilityMeasure | null)[] };
type CaseData = {
  dataset: InputDataset;
  times: string[];
  layers: CaseLayer[];
  sampleSize: Readonly<Record<string, readonly number[]>>;
  tcmMetadata?: TcmDisplayMetadata;
};
type CaseId = "covid" | "tcm";
type Panel = {
  svg: string;
  data: CaseData;
  result: PipelineResult;
  start: number;
  end: number;
  height: number;
};

function caseData(
  dataset: InputDataset,
  sampleSize: Readonly<Record<string, readonly number[]>>,
  colors: Readonly<Record<string, string>> = {},
  tcmMetadata?: TcmDisplayMetadata,
): CaseData {
  return {
    dataset,
    times: [...dataset.times],
    layers: dataset.layers.map((layer) => ({
      id: layer.id,
      measures: layer.measures,
      ...(colors[layer.id] ? { color: colors[layer.id] } : {}),
    })),
    sampleSize,
    tcmMetadata,
  };
}

// === 2. SVG helpers and shared full-pipeline geometry ===
function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function text(parent: Element, value: string, x: number, y: number, className: string, anchor = "start") {
  const element = node("text", { x, y, class: className, "text-anchor": anchor });
  element.textContent = value;
  parent.appendChild(element);
  return element;
}

function visibleIndices(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function chartScales(result: PipelineResult, times: string[], start: number, end: number) {
  const indices = visibleIndices(start, end);
  const bottoms = result.braided.layers.map((layer) => layer.slotY0);
  const tops = result.braided.layers.map((layer) => layer.slotY1);
  const values = [
    ...bottoms.flatMap((layer) => indices.map((time) => layer[time])),
    ...tops.flatMap((layer) => indices.map((time) => layer[time])),
  ];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.06 || 1;
  const y = (value: number) => H - M.bottom - (value - (low - pad)) /
    (high - low + 2 * pad) * (H - M.top - M.bottom);
  const days = times.map(diseaseDay);
  const coordinates = days.every(Number.isFinite) ? days : times.map((_, index) => index);
  const x = (index: number) => M.left + (coordinates[index] - coordinates[start]) /
    Math.max(1, coordinates[end] - coordinates[start]) * (W - M.left - M.right);
  return { x, y };
}

function layerPoint(panel: Panel, layerId: string, time: string) {
  const geometry = panel.result.braided.layers.find((layer) => layer.layerId === layerId)!;
  const timeIndex = panel.data.times.indexOf(time);
  const { x, y } = chartScales(panel.result, panel.data.times, panel.start, panel.end);
  return { x: x(timeIndex), y: y((geometry.slotY0[timeIndex] + geometry.slotY1[timeIndex]) / 2) };
}

function positiveDoseCount(data: CaseData, layerId: string, time: number) {
  return data.tcmMetadata?.values[layerId]?.[time].filter((value) => value > 0).length ?? 0;
}

function tcmTargets(data: CaseData, result: PipelineResult) {
  const indices = TCM_SNAPSHOTS.map((time) => data.times.indexOf(time));
  if (indices.some((index) => index < 0)) throw new Error("TCM snapshot visit is absent");
  const [center, outer] = TCM_TARGETS;
  if (TCM_TARGETS.some((id) => !data.layers.some((layer) => layer.id === id)) ||
      result.pid.ranking[0] !== center) {
    throw new Error("TCM target categories or full-period TPID rank changed");
  }
  return { center, outer, indices };
}

function addRegionMarker(svg: SVGSVGElement, panel: Panel, id: string, layerId: string, time: string) {
  const position = layerPoint(panel, layerId, time);
  const group = node("g", { class: "region-marker", transform: `translate(${position.x},${position.y})` });
  group.appendChild(node("circle", { r: 17 }));
  text(group, id, 0, 6, "region-marker-text", "middle");
  svg.appendChild(group);
}

function tagLayerElements(svg: SVGSVGElement) {
  const layers = svg.querySelector("g.layers");
  let current = "";
  for (const child of [...(layers?.children ?? [])] as SVGElement[]) {
    current = child.getAttribute("data-id") ?? child.getAttribute("data-owner-layer") ?? current;
    if (current) child.setAttribute("data-export-layer", current);
  }
}

function directLabels(
  svg: SVGSVGElement,
  panel: Panel,
  ids: string[],
  names: Record<string, string> = {},
) {
  const { y } = chartScales(panel.result, panel.data.times, panel.start, panel.end);
  const labels = ids.map((id) => {
    const geometry = panel.result.braided.layers.find((layer) => layer.layerId === id)!;
    return {
      id,
      y: y((geometry.slotY0[panel.end] + geometry.slotY1[panel.end]) / 2),
      color: colorForLayer(panel.data.layers, id),
    };
  }).sort((a, b) => a.y - b.y);
  for (let index = 1; index < labels.length; index += 1) {
    labels[index].y = Math.max(labels[index].y, labels[index - 1].y + 22);
  }
  for (const label of labels) {
    const x = W - M.right - 8;
    svg.appendChild(node("line", {
      x1: x - 34, x2: x - 6, y1: label.y, y2: label.y,
      class: "direct-label-line", stroke: label.color,
    }));
    const labelNode = text(svg, names[label.id] ?? label.id, x, label.y + 6, "direct-label", "end");
    labelNode.setAttribute("fill", "#1a1a1a");
  }
}

// === 3. Paper styling ===
// Adjust fonts, neutral axes, and non-data strokes here. Data fills remain stroke-free.
function paperStyle() {
  return `
    .paper-figure text { font-family: sans-serif; font-size: 20px; fill: #1a1a1a; }
    .paper-figure .axis .tick text, .paper-figure .axis-label { font-size: 20px; fill: #6b7280; }
    .paper-figure .axis path, .paper-figure .axis line { stroke: #6b7280; }
    .paper-figure .grid line { stroke: #d1d5db; stroke-opacity: .48; }
    .paper-figure .grid path { stroke: none; }
    .paper-figure .envelope-stroke { stroke: #66717d; stroke-width: .7; stroke-opacity: .68; stroke-linejoin: round; stroke-linecap: round; }
    .paper-figure .representative-stroke { stroke: #374151; stroke-width: .75; stroke-opacity: .82; stroke-linejoin: round; stroke-linecap: round; }
    .paper-figure .direct-label { font-size: 20px; font-weight: 600; paint-order: stroke; stroke: #e8f1f8; stroke-width: 3px; stroke-linejoin: round; }
    .paper-figure .direct-label-line { stroke-width: 1px; }
    .paper-figure .region-marker circle { fill: #fff; stroke: #111827; stroke-width: 2px; }
    .paper-figure .region-marker-text, .paper-figure .detail-region-label, .paper-figure .detail-time,
    .paper-figure .snapshot-date, .paper-figure .snapshot-state { font-size: 20px; font-weight: 600; }
    .paper-figure .case-layer-label { font-size: 20px; font-weight: 600; fill: #1a1a1a; paint-order: stroke; stroke: #1a1a1a; stroke-width: .6px; stroke-linejoin: round; }
    .paper-figure .snapshot-density { stroke: none; }
    .paper-figure .snapshot-guide { stroke: #6b7280; stroke-width: .8; stroke-opacity: .62; stroke-dasharray: 5 5; }
    .paper-figure .distribution-grid-line { stroke: #e1e6eb; stroke-width: .5; }
    .paper-figure .distribution-axis-line { stroke: #b8c0c9; stroke-width: .6; }
    .paper-figure .distribution-axis-tick { stroke: #b8c0c9; stroke-width: .6; }
    .paper-figure .distribution-tick-label, .paper-figure .distribution-axis-title { font-size: 12px; font-weight: 400; fill: #6b7280; }
    .paper-figure.tcm-figure text { font-size: ${TCM_PRIMARY_FONT}px; }
    .paper-figure.tcm-figure .axis .tick text,
    .paper-figure.tcm-figure .axis-label,
    .paper-figure.tcm-figure .distribution-tick-label,
    .paper-figure.tcm-figure .distribution-axis-title { font-size: ${TCM_AXIS_FONT}px; }
    .paper-figure.tcm-figure .snapshot-guide { stroke-width: 1.2; }
    .paper-figure.tcm-figure .distribution-axis-line,
    .paper-figure.tcm-figure .distribution-axis-tick { stroke-width: 1.2; }
  `;
}

function prepareSvg(svg: SVGSVGElement) {
  svg.setAttribute("class", "paper-figure");
  svg.setAttribute("role", "img");
  const style = node("style");
  style.textContent = paperStyle();
  svg.insertBefore(style, svg.firstChild);
  svg.querySelectorAll('path[d=""], .envelope-hit, .space-hit').forEach((element) => element.remove());
  [...svg.querySelectorAll("text")].forEach((element) => {
    if (element.textContent?.startsWith("high-value side")) element.remove();
  });
  tagLayerElements(svg);
}

function standaloneSvg(width: number, height: number, physicalWidthMm: number, label: string) {
  const svg = node("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width: `${physicalWidthMm}mm`,
    height: `${(physicalWidthMm * height / width).toFixed(2)}mm`,
    role: "img",
    "aria-label": label,
  });
  document.body.appendChild(svg);
  prepareSvg(svg);
  svg.setAttribute("class", "paper-figure tcm-figure");
  svg.insertBefore(node("rect", { width, height, fill: "#fff" }), svg.firstChild);
  return svg;
}

// === 4. Case distribution matrices ===
// Each cell has independent x and density domains, with conventional three-tick axes.
function densityAreaPath(
  density: (value: number) => number,
  maximumValue: number,
  maximumDensity: number,
  left: number,
  width: number,
  baseline: number,
  height: number,
) {
  const points = Array.from({ length: 129 }, (_, index) => {
    const value = maximumValue * index / 128;
    const x = left + width * index / 128;
    const y = baseline - height * density(value) / Math.max(Number.EPSILON, maximumDensity);
    return [x, y] as const;
  });
  return `M${left},${baseline}L${points.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join("L")}L${left + width},${baseline}Z`;
}

function compactLimit(value: number, density = false) {
  if (value === 0) return "0";
  if (density) return value.toExponential(1).replace("e-", "e−");
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function addDistributionMatrix(
  svg: SVGSVGElement,
  data: CaseData,
  layerOrder: string[],
  snapshots: string[],
  layout: {
    x: number; width: number; rowHeight: number; top?: number; densityTitleX?: number;
    headerY?: number; headerLabels?: string[]; plotPaddingLeft?: number; plotPaddingRight?: number;
    showDensityTicks?: boolean; tickLabelOffset?: number;
  },
) {
  const top = layout.top ?? 54;
  const { x: matrixX, width: matrixWidth, rowHeight } = layout;
  const columnWidth = matrixWidth / snapshots.length;
  const plotPaddingLeft = layout.plotPaddingLeft ?? 58;
  const plotPaddingRight = layout.plotPaddingRight ?? 10;
  const plotPaddingTop = 8;
  const plotPaddingBottom = 34;
  const plotWidth = columnWidth - plotPaddingLeft - plotPaddingRight;
  const densityHeight = rowHeight - plotPaddingTop - plotPaddingBottom;
  const snapshotIndices = snapshots.map((time) => data.times.indexOf(time));
  const analyses = snapshotIndices.map((time) => layerOrder.map((state) => {
    const layer = data.layers.find((item) => item.id === state)!;
    return buildAnalysisDistribution(layer.measures[time] ?? null, 0.3)!;
  }));
  const group = node("g", { class: "snapshot-grid" });
  for (let column = 1; column < snapshots.length; column += 1) {
    const x = matrixX + column * columnWidth;
    group.appendChild(node("line", {
      x1: x,
      x2: x,
      y1: top,
      y2: top + rowHeight * layerOrder.length,
      class: "distribution-grid-line",
    }));
  }
  for (let row = 1; row < layerOrder.length; row += 1) {
    const y = top + row * rowHeight;
    group.appendChild(node("line", {
      x1: matrixX,
      x2: matrixX + matrixWidth,
      y1: y,
      y2: y,
      class: "distribution-grid-line",
    }));
  }
  const densityTitleX = layout.densityTitleX ?? matrixX - 12;
  const densityTitleY = top + rowHeight * layerOrder.length / 2;
  const densityTitle = text(
    group,
    "density",
    densityTitleX,
    densityTitleY,
    "distribution-axis-title",
    "middle",
  );
  densityTitle.setAttribute("transform", `rotate(-90 ${densityTitleX} ${densityTitleY})`);

  snapshotIndices.forEach((time, column) => {
    const cellLeft = matrixX + column * columnWidth;
    const plotLeft = cellLeft + plotPaddingLeft;
    text(group, layout.headerLabels?.[column] ?? shortTime(data.times[time]), cellLeft + columnWidth / 2, layout.headerY ?? 30, "snapshot-date", "middle");

    analyses[column].forEach((analysis, row) => {
      const state = layerOrder[row];
      const rowTop = top + row * rowHeight;
      const plotTop = rowTop + plotPaddingTop;
      const baseline = rowTop + rowHeight - plotPaddingBottom;
      const maximumValue = analysis.quantile(0.995);
      const maximumDensity = Math.max(...Array.from({ length: 129 }, (_, index) =>
        analysis.density(maximumValue * index / 128)));
      const color = colorForLayer(data.layers, state);
      group.appendChild(node("path", {
        d: densityAreaPath(
          analysis.density,
          maximumValue,
          maximumDensity,
          plotLeft,
          plotWidth,
          baseline,
          densityHeight,
        ),
        class: "snapshot-density",
        fill: color,
        "fill-opacity": .7,
      }));
      group.appendChild(node("line", {
        x1: plotLeft,
        x2: plotLeft,
        y1: plotTop,
        y2: baseline,
        class: "distribution-axis-line",
      }));
      group.appendChild(node("line", {
        x1: plotLeft,
        x2: plotLeft + plotWidth,
        y1: baseline,
        y2: baseline,
        class: "distribution-axis-line",
      }));
      for (const fraction of [0, .5, 1]) {
        const tickX = plotLeft + fraction * plotWidth;
        group.appendChild(node("line", {
          x1: tickX,
          x2: tickX,
          y1: baseline,
          y2: baseline + 4,
          class: "distribution-axis-tick",
        }));
        text(
          group,
          compactLimit(maximumValue * fraction),
          tickX,
          baseline + (layout.tickLabelOffset ?? 16),
          "distribution-tick-label",
          fraction === 0 ? "start" : fraction === 1 ? "end" : "middle",
        );

        if (layout.showDensityTicks !== false) {
          const tickY = baseline - fraction * densityHeight;
          group.appendChild(node("line", {
            x1: plotLeft - 4,
            x2: plotLeft,
            y1: tickY,
            y2: tickY,
            class: "distribution-axis-tick",
          }));
          text(
            group,
            compactLimit(maximumDensity * fraction, true),
            plotLeft - 7,
            tickY + 4,
            "distribution-tick-label",
            "end",
          );
        }
      }
      text(
        group,
        "x",
        plotLeft + plotWidth / 2,
        rowTop + rowHeight - 5,
        "distribution-axis-title",
        "middle",
      );
    });
  });
  svg.appendChild(group);
}

function renderTcmKde(data: CaseData, layerId: string, visit: string) {
  const width = W * TCM_KDE_WIDTH_MM / TCM_MAIN_WIDTH_MM;
  const height = 265;
  const svg = standaloneSvg(width, height, TCM_KDE_WIDTH_MM, `TCM ${layerId} KDE at ${visit}`);
  addDistributionMatrix(svg, data, [layerId], [visit], {
    x: 0,
    width,
    rowHeight: 230,
    top: 15,
    plotPaddingLeft: 88,
    plotPaddingRight: 18,
    tickLabelOffset: 24,
  });
  svg.querySelectorAll(".snapshot-date, .distribution-axis-title").forEach((element) => element.remove());
  const serialized = new XMLSerializer().serializeToString(svg);
  svg.remove();
  return serialized;
}

function ccdfPath(
  analysis: AnalysisDistribution,
  maxDose: number,
  x: (dose: number) => number,
  top: number,
  height: number,
) {
  const bottom = top + height;
  const endDose = Math.min(maxDose, analysis.upper);
  return Array.from({ length: 129 }, (_, index) => {
    const dose = endDose * index / 128;
    const xPosition = x(dose);
    const y = bottom - height * analysis.survival(dose);
    return `${index ? "L" : "M"}${xPosition.toFixed(3)},${y.toFixed(3)}`;
  }).join("");
}

function renderTcmCcdf(data: CaseData) {
  const svgWidth = W * TCM_CCDF_WIDTH_MM / TCM_MAIN_WIDTH_MM;
  const svg = standaloneSvg(svgWidth, H, TCM_CCDF_WIDTH_MM, "TCM CCDF spaghetti across all visits");
  const left = 80;
  const width = svgWidth - left - 28;
  const plotHeight = 185;
  const rows = TCM_TARGETS.map((id) => ({
    id,
    analyses: data.times.map((visit, time) => ({
      visit,
      analysis: buildAnalysisDistribution(
        data.layers.find((item) => item.id === id)!.measures[time] ?? null,
        0.3,
      ),
    })),
  }));
  const maxDose = Math.max(1, ...rows.flatMap(({ analyses }) =>
    analyses.map(({ analysis }) => analysis?.upper ?? 0)));
  const xScale = scaleLog().domain([1, maxDose + 1]).range([left, left + width]);
  const x = (dose: number) => xScale(dose + 1);
  const xTicks = [...[0, 1, 10, 50].filter((value) => value < maxDose * .7), maxDose];
  svg.setAttribute("data-x-domain", `0 ${maxDose}`);
  svg.setAttribute("data-x-scale", "log1p");
  rows.forEach(({ id, analyses }, row) => {
    const color = colorForLayer(data.layers, id);
    const top = 78 + row * 270;
    const bottom = top + plotHeight;
    for (const fraction of [0, .5, 1]) {
      const y = bottom - fraction * plotHeight;
      svg.appendChild(node("line", { x1: left, x2: left + width, y1: y, y2: y, class: "distribution-grid-line" }));
      text(svg, String(fraction), left - 10, y + 5, "distribution-tick-label", "end");
    }
    for (const dose of xTicks) {
      const tickX = x(dose);
      svg.appendChild(node("line", { x1: tickX, x2: tickX, y1: bottom, y2: bottom + 5, class: "distribution-axis-tick" }));
      text(svg, compactLimit(dose), tickX, bottom + 20, "distribution-tick-label",
        dose === 0 ? "start" : dose === maxDose ? "end" : "middle");
    }
    svg.appendChild(node("line", { x1: left, x2: left, y1: top, y2: bottom, class: "distribution-axis-line" }));
    svg.appendChild(node("line", { x1: left, x2: left + width, y1: bottom, y2: bottom, class: "distribution-axis-line" }));
    for (const [time, { visit, analysis }] of analyses.entries()) {
      if (!analysis) continue;
      const opacity = (.12 + .78 * time / Math.max(1, analyses.length - 1)).toFixed(3);
      if (analysis.pointMass !== null) {
        const rugX = x(analysis.pointMass);
        svg.appendChild(node("line", {
          x1: rugX, x2: rugX, y1: bottom - 9, y2: bottom - 2,
          class: "ccdf-point-mass", "data-layer": id, "data-visit": visit, "data-visit-index": time + 1,
          stroke: color, "stroke-width": 2.2, "stroke-opacity": opacity, "stroke-linecap": "round",
        }));
        continue;
      }
      svg.appendChild(node("path", {
        d: ccdfPath(analysis, maxDose, x, top, plotHeight),
        class: "ccdf-curve", "data-layer": id, "data-visit": visit, "data-visit-index": time + 1,
        fill: "none", stroke: color, "stroke-width": 1.8,
        "stroke-opacity": opacity,
        "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
    }
  });
  text(svg, "dose (log(1+x) scale)", left + width / 2, H - 18,
    "distribution-axis-title", "middle");
  const serialized = new XMLSerializer().serializeToString(svg);
  svg.remove();
  return serialized;
}

// === 5. Main and detail figure assembly ===
function arrangeCovidPanel(svg: SVGSVGElement, panel: Panel) {
  svg.querySelectorAll("g.axis").forEach((element) => element.remove());
  const layers = svg.querySelector("g.layers")!;
  const stream = node("svg", {
    x: COVID_STREAM_X,
    y: 0,
    width: COVID_STREAM_WIDTH,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    overflow: "hidden",
  });
  stream.appendChild(layers);
  svg.appendChild(stream);

  const { x, y } = chartScales(panel.result, panel.data.times, panel.start, panel.end);
  const streamX = (time: number) => COVID_STREAM_X + x(time) / W * COVID_STREAM_WIDTH;
  for (const time of COVID_SNAPSHOTS) {
    const index = panel.data.times.indexOf(time);
    const guideX = streamX(index);
    svg.appendChild(node("line", {
      x1: guideX,
      x2: guideX,
      y1: M.top,
      y2: H - M.bottom,
      class: "snapshot-guide",
    }));
    text(svg, shortTime(time), guideX, H - 25, "detail-time", "middle");
  }

  const labelX = COVID_STREAM_X + M.left / W * COVID_STREAM_WIDTH - 9;
  const labels = panel.result.pid.order.map((state) => {
    const geometry = panel.result.braided.layers.find((layer) => layer.layerId === state)!;
    return {
      state,
      y: y((geometry.slotY0[panel.start] + geometry.slotY1[panel.start]) / 2),
    };
  }).sort((a, b) => a.y - b.y);
  for (let index = 1; index < labels.length; index += 1) {
    labels[index].y = Math.max(labels[index].y, labels[index - 1].y + 22);
  }
  for (const label of labels) {
    text(svg, label.state, labelX, label.y + 5, "case-layer-label", "end");
  }
  addDistributionMatrix(svg, panel.data, labels.map((label) => label.state), COVID_SNAPSHOTS, {
    x: COVID_DISTRIBUTION_X,
    width: COVID_DISTRIBUTION_WIDTH,
    rowHeight: 126,
  });
}

// The complete cohort determines TPID; this panel displays the supported prefix.
function arrangeTcmPanel(svg: SVGSVGElement, panel: Panel) {
  svg.querySelectorAll("text, g.axis, g.grid, .axis-label").forEach((element) => element.remove());
  const { center, outer } = tcmTargets(panel.data, panel.result);
  for (const element of [...svg.querySelectorAll("path.layer.branch, path.allocated-space")] as SVGElement[]) {
    const layerId = element.getAttribute("data-owner-layer") ?? element.getAttribute("data-export-layer");
    const selected = layerId === center || layerId === outer;
    element.setAttribute("fill-opacity", selected ? ".96" : ".28");
    element.setAttribute("stroke", "none");
  }
  svg.querySelectorAll(".representative-stroke").forEach((element) => element.remove());
  for (const element of [...svg.querySelectorAll(".envelope-stroke")] as SVGElement[]) {
    const layerId = element.getAttribute("data-owner-layer") ?? element.getAttribute("data-export-layer");
    if (layerId !== center && layerId !== outer) element.remove();
    else {
      element.setAttribute("stroke", "#27313b");
      element.setAttribute("stroke-width", "1.1");
      element.setAttribute("stroke-opacity", "1");
    }
  }
  const { x } = chartScales(panel.result, panel.data.times, panel.start, panel.end);
  for (const visit of TCM_SNAPSHOTS) {
    const index = panel.data.times.indexOf(visit);
    const guideX = x(index);
    svg.appendChild(node("line", {
      x1: guideX, x2: guideX, y1: M.top, y2: H - M.bottom,
      class: "snapshot-guide",
    }));
    text(svg, visit, guideX, H - 25, "detail-time",
      index === panel.end ? "end" : "middle");
  }
}

function renderBase(
  data: CaseData,
  result: PipelineResult,
  start: number,
  end: number,
  showYAxis: boolean,
  showOutlines = true,
) {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  document.body.appendChild(svg);
  renderChart(svg, {
    layers: data.layers,
    times: data.times,
    result,
    start,
    end,
    visMethod: "braided",
    smoothContours: true,
    showEnvelopeStroke: showOutlines,
    showRepresentativeStroke: showOutlines,
    showTimeCell: false,
    showBranchStroke: false,
    showYAxis,
    hover: null,
    highlightLayer: null,
  });
  prepareSvg(svg);
  return svg;
}

function renderMain(
  caseId: CaseId,
  data: CaseData,
  result: PipelineResult,
  start: number,
  end: number,
): Panel {
  const height = caseId === "covid" ? COVID_HEIGHT : TCM_HEIGHT;
  const physicalWidthMm = caseId === "tcm" ? TCM_MAIN_WIDTH_MM : 210;
  const panel: Panel = { svg: "", data, result, start, end, height };
  const svg = renderBase(data, result, start, end, false, caseId === "tcm");
  svg.setAttribute("viewBox", `0 0 ${W} ${height}`);
  svg.setAttribute("width", `${physicalWidthMm}mm`);
  svg.setAttribute("height", `${(physicalWidthMm * height / W).toFixed(2)}mm`);
  if (caseId === "tcm") svg.setAttribute("class", "paper-figure tcm-figure");
  svg.setAttribute("aria-label", caseId === "covid" ? "COVID forecast case" : "TCM prescription case");
  const background = node("rect", { width: W, height, fill: "#fff" });
  svg.insertBefore(background, svg.firstChild);

  if (caseId === "covid") {
    arrangeCovidPanel(svg, panel);
  } else {
    arrangeTcmPanel(svg, panel);
  }
  panel.svg = new XMLSerializer().serializeToString(svg);
  svg.remove();
  return panel;
}

function shortTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, monthNumber, day] = value.split("-");
  return `${Number(day)} ${month[Number(monthNumber) - 1]}`;
}

function renderDetail(
  caseId: CaseId,
  data: CaseData,
  result: PipelineResult,
  start: number,
  end: number,
  ids: string[],
  regionId: string,
  names: Record<string, string> = {},
) {
  const panel: Panel = { svg: "", data, result, start, end, height: MAIN_HEIGHT };
  const svg = renderBase(data, result, start, end, false);
  svg.querySelectorAll("g.grid,g.axis,.axis-label").forEach((element) => element.remove());
  [...svg.children]
    .filter((element) => element.tagName.toLowerCase() === "line")
    .forEach((element) => element.remove());
  for (const element of [...svg.querySelectorAll("[data-export-layer]")] as SVGElement[]) {
    if (!ids.includes(element.getAttribute("data-export-layer")!)) element.remove();
  }

  const { y } = chartScales(result, data.times, start, end);
  const indices = visibleIndices(start, end);
  const bounds = ids.flatMap((id) => {
    const layer = result.braided.layers.find((item) => item.layerId === id)!;
    return indices.flatMap((time) => [y(layer.slotY0[time]), y(layer.slotY1[time])]);
  });
  const minY = Math.min(...bounds);
  const maxY = Math.max(...bounds);
  const center = (minY + maxY) / 2;
  const contentHeight = Math.max(180, maxY - minY + 80);
  const cropHeight = Math.max(245, contentHeight + 42);
  const cropY = Math.max(0, Math.min(H - cropHeight, center - (cropHeight - 42) / 2));
  const cropX = M.left - 12;
  const cropWidth = W - M.left - M.right + 24;
  const axisY = cropY + cropHeight - 28;

  const background = node("rect", { x: cropX, y: cropY, width: cropWidth, height: cropHeight, fill: "#fff" });
  svg.insertBefore(background, svg.firstChild);
  const axis = node("line", { x1: M.left, x2: W - M.right, y1: axisY, y2: axisY, stroke: "#6b7280", "stroke-width": 1 });
  svg.appendChild(axis);
  for (const [x, value, anchor] of [
    [M.left, data.times[start], "start"],
    [W - M.right, data.times[end], "end"],
  ] as const) {
    svg.appendChild(node("line", { x1: x, x2: x, y1: axisY, y2: axisY + 7, stroke: "#6b7280", "stroke-width": 1 }));
    text(svg, shortTime(value), x, axisY + 23, "detail-time", anchor);
  }
  text(svg, regionId, cropX + 14, cropY + 24, "detail-region-label");
  directLabels(svg, panel, ids, names);

  svg.setAttribute("viewBox", `${cropX} ${cropY} ${cropWidth} ${cropHeight}`);
  svg.setAttribute("width", "3.48in");
  svg.setAttribute("height", `${(3.48 * cropHeight / cropWidth).toFixed(3)}in`);
  svg.setAttribute("aria-label", `${regionId} detail view`);
  const serialized = new XMLSerializer().serializeToString(svg);
  svg.remove();
  return serialized;
}

function renderCovidAprDetail(data: CaseData, result: PipelineResult) {
  const start = data.times.indexOf("2022-03-19");
  const end = data.times.indexOf("2022-04-16");
  const focus = data.times.indexOf("2022-04-02");
  const svg = renderBase(data, result, start, end, false, false);
  svg.querySelectorAll("g.axis").forEach((element) => element.remove());
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "3.48in");
  svg.setAttribute("height", `${(3.48 * H / W).toFixed(3)}in`);
  svg.setAttribute("aria-label", "COVID detail around 2 April 2022");
  svg.insertBefore(node("rect", { width: W, height: H, fill: "#fff" }), svg.firstChild);

  const insetX = 22;
  const insetWidth = W - 44;
  const layers = svg.querySelector("g.layers")!;
  const stream = node("svg", {
    x: insetX,
    y: 0,
    width: insetWidth,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    overflow: "hidden",
  });
  stream.appendChild(layers);
  svg.appendChild(stream);

  const { x } = chartScales(result, data.times, start, end);
  const scaledX = (time: number) => insetX + x(time) / W * insetWidth;
  const guideX = scaledX(focus);
  svg.appendChild(node("line", {
    x1: guideX,
    x2: guideX,
    y1: M.top,
    y2: H - M.bottom,
    class: "snapshot-guide",
  }));
  text(svg, "2 Apr", guideX, H - 25, "detail-time", "middle");
  const serialized = new XMLSerializer().serializeToString(svg);
  svg.remove();
  return serialized;
}

// === 6. Export artifacts, metrics, captions, and reproducibility metadata ===
function writePng(svg: string, filename: string, width = PNG_WIDTH) {
  const renderer = new Resvg(svg, {
    background: "#fff",
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
  });
  writeFileSync(resolve(OUTPUT_DIR, filename), renderer.render().asPng());
}

function csvCell(value: unknown) {
  const string = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function metrics(caseId: CaseId, panel: Panel) {
  return panel.result.braided.layers.flatMap((geometry) => {
    const source = panel.data.layers.find((layer) => layer.id === geometry.layerId)!;
    return visibleIndices(panel.start, panel.end).map((time) => {
      const debug = geometry.debug![time];
      return {
        case: caseId,
        layer: geometry.layerId,
        time: panel.data.times[time],
        time_index: time,
        representative: debug.H,
        deviation_low: debug.deviationLow,
        deviation_high: debug.deviationHigh,
        allocated_space: debug.actualSpace,
        envelope_thickness: debug.envelopeHigh - debug.envelopeLow,
        envelope_share: debug.actualSpace / Math.max(Number.EPSILON, debug.envelopeHigh - debug.envelopeLow),
        balance: debug.balance,
        branch_count: debug.branchCount,
        branch_masses: debug.branchMasses.join(";"),
        mode_locations: debug.modeLocations.join(";"),
        separations: debug.separations.join(";"),
        allocated_gaps: debug.gaps.join(";"),
        sample_size: panel.data.sampleSize[source.id]?.[time] ?? "",
      };
    });
  });
}

function writeCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0]);
  writeFileSync(resolve(OUTPUT_DIR, filename), [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    "",
  ].join("\n"), "utf8");
}

// === 7. Case-specific narratives and reproducibility metadata ===
function writeCovidStory(data: CaseData, result: PipelineResult) {
  const middle = data.times.indexOf(COVID_SNAPSHOTS[1]);
  const branchCounts = COVID_STATES.map((state) =>
    result.braided.layers.find((layer) => layer.layerId === state)!.debug![middle].branchCount);
  const englishCounts = COVID_STATES.map((state, index) => `${state} ${branchCounts[index]}`).join(", ");
  const chineseCounts = COVID_STATES.map((state, index) => `${state} 为 ${branchCounts[index]}`).join("、");
  const story = `# COVID example narrative and caption

## English caption

**Fig. X. COVID-19 forecast distributions during the post-peak contraction.** The figure shows the interval enlarged in the teaser, from 29 January to 2 April 2022. The braided streamgraph retains the ordering computed from the complete dataset and crops only the displayed time range. Three dashed guides mark 29 January, 19 February, and 2 April. The corresponding distributions form a 4 × 3 matrix: rows follow the streamgraph's top-to-bottom layer order and columns are dates. On 19 February, the detected branch counts are ${englishCounts}.

## English narrative

The COVID example follows the same post-peak interval enlarged in the teaser. The central magnitudes contract rapidly, but the four forecast distributions do not simply shrink as single peaks. The 29 January snapshots begin with broad post-peak distributions, 19 February captures the intermediate split, and by 2 April the forecasts have narrowed substantially while retaining state-specific shapes. Each matrix cell uses its own forecast-value x domain and probability-density y domain so that its modality remains legible; conventional x and density axes show zero, midpoint, and upper-limit ticks for both independent scales. The plots are centered within equal cells separated by thin gray rules, without outlining the density shapes. The 210 mm-wide figure uses 20 px primary labels and smaller gray axis labels; its streamgraph and distribution matrix occupy an approximately 1:2 width ratio without changing the full-data analysis or ordering. A separate unlabeled detail view covers 19 March–16 April and centers the 2 April guide for later inset composition.

## 中文图注

**图 X. 峰后收缩阶段的 COVID-19 预测分布。** 图中显示 teaser 放大框对应的 2022 年 1 月 29 日至 4 月 2 日。编织流图保留由完整数据计算得到的排序，只裁剪显示时间范围。三条虚线分别标记 1 月 29 日、2 月 19 日和 4 月 2 日；右侧分布采用 4 × 3 矩阵，行顺序与河流图从上到下的层顺序一致，列对应三个日期。2 月 19 日检测到的分支数分别为：${chineseCounts}。

## 中文叙事

COVID 示例与 teaser 中放大的峰后区间一致。四州的中心预测快速收缩，但预测分布并非以单峰形式同步缩小：1 月 29 日仍呈现较宽的峰后分布，2 月 19 日展示中间分叉，至 4 月 2 日整体范围已明显收窄，但各州仍保留不同的分布形态。每个矩阵单元格分别使用自己的预测值 x 值域和概率密度 y 值域，以保持分叉形态清晰；标准的 x 与 density 坐标轴分别标出零值、中点和上限刻度，明确提示这些尺度相互独立。各分布画布在等大的单元格内居中排列，矩阵仅用简约细灰线分隔，不为密度形状增加轮廓。主图宽度为 210 mm，主要标签为 20 px，坐标轴采用更小的灰色文字；河流图与分布矩阵约按 1:2 分配宽度，但不改变完整数据上的分析与排序。另提供覆盖 3 月 19 日至 4 月 16 日、以 4 月 2 日为中心标记且不含州名的独立局部图，供后续拼接放大视窗。

## Interpretation boundary

- COVID patterns describe disagreement among submitted forecast distributions. They do not identify epidemiological causes or model quality.
- COVID 分布只反映提交预测之间的差异，不用于推断疫情变化原因或模型优劣。
`;
  writeFileSync(resolve(OUTPUT_DIR, "covid-story.md"), story, "utf8");
}

function writeTcmStory(data: CaseData, result: PipelineResult) {
  const [early, later] = TCM_SNAPSHOTS;
  const { center, outer, indices } = tcmTargets(data, result);
  const support = indices.map((time) => data.sampleSize[data.layers[0].id]?.[time]);
  const positive = [center, outer].map((id) => {
    return indices.map((time) => positiveDoseCount(data, id, time));
  });
  const branchTotals = indices.map((time) => result.braided.layers.reduce(
    (sum, layer) => sum + layer.debug![time].branchCount, 0));
  const centerGeometry = result.braided.layers.find((layer) => layer.layerId === center)!;
  const centerBranches = indices.map((time) => centerGeometry.debug![time].branchCount);
  const secondaryRank = result.pid.ranking.indexOf(outer) + 1;
  const story = `# TCM example narrative and caption

## English caption

**Fig. Y. TCM braided streamgraph.** TPID and layer order use all ${data.times.length} observed ordinal visits and ${data.layers.length} medicine categories across ${data.sampleSize[data.layers[0].id]?.[0]} patients; the 120 mm-wide SVG displays visits 1–20, ending at n=${data.sampleSize[data.layers[0].id]?.[data.times.indexOf(TCM_END)]}. Only the upper and lower envelopes of the highlighted categories are outlined: ${center} (TPID rank 1/${result.pid.ranking.length}) and ${outer} (rank ${secondaryRank}/${result.pid.ranking.length}; the requested tonifying-deficiency category). Dashed cross-sections label ${early} (n=${support[0]}) and ${later} (n=${support[1]}). Total branch counts are ${branchTotals[0]} and ${branchTotals[1]}, while the central category has ${centerBranches[0]} and ${centerBranches[1]} branches. Four separate KDE SVGs show the two highlighted categories at visits 5 and 20 for later inset composition; the CCDF panels use the same log(1+dose) axis, with opacity increasing by visit and degenerate single-dose visits shown as compact x-axis rug marks.

## English narrative

The full-period TPID calculation is separate from the displayed window. tcm-samples.csv contains one observed patient dose per row for the two highlighted categories at ${early} and ${later}, including zeros. Its columns are visit,layer,sample_index,dose; sample indices restart within each category and visit and are not patient identifiers. Positive-dose counts are ${center}: ${positive[0][0]}/${support[0]} and ${positive[0][1]}/${support[1]}; ${outer}: ${positive[1][0]}/${support[0]} and ${positive[1][1]}/${support[1]}. The KDE and CCDF SVGs use the same analysis distribution as the stream (bandwidth ratio 0.3); the CCDF is P(dose > x). A point-mass visit is encoded by a rug mark at its single dose instead of a full-width step curve, and zero-valued curve extensions beyond each numerical tail are omitted. These observations describe prescriptions, not treatment effects.

## 中文图注

**图 Y. TCM 编织河流图。** TPID 和层顺序使用全部 ${data.times.length} 次诊次、${data.layers.length} 个药物类别、${data.sampleSize[data.layers[0].id]?.[0]} 位患者的数据计算；120 mm 宽的 SVG 仅显示 visit 1–20，末端有 ${data.sampleSize[data.layers[0].id]?.[data.times.indexOf(TCM_END)]} 位患者。仅为高亮的“${center}”（TPID 第 1/${result.pid.ranking.length}）和“${outer}”（第 ${secondaryRank}/${result.pid.ranking.length}，对应指定的“补虚类”）绘制 envelope 上下边界，不描画各 cell 边界。虚线截面标注 ${early}（n=${support[0]}）和 ${later}（n=${support[1]}）；总分支数分别为 ${branchTotals[0]}、${branchTotals[1]}，中心层分支数分别为 ${centerBranches[0]}、${centerBranches[1]}。两类别在 visit 5 和 visit 20 的剂量密度拆为 4 个独立 KDE SVG，供后续拼接放大视窗；两个 CCDF 子图共用 log(1+剂量) 轴，以随诊次递增的不透明度编码时间，并将单点分布压缩为 x 轴 rug 标记。

## 中文叙事

TPID 在完整 ${data.times.length} 次诊次上计算，河流图只裁剪展示时间。tcm-samples.csv 按 visit,layer,sample_index,dose 列出两个目标层在两个对照诊次的全部已观测患者剂量，包含零剂量。sample_index 在每个类别和诊次内重新编号，不代表患者 ID。非零剂量人数：“${center}”为 ${positive[0][0]}/${support[0]}、${positive[0][1]}/${support[1]}；“${outer}”为 ${positive[1][0]}/${support[0]}、${positive[1][1]}/${support[1]}。KDE 和 CCDF SVG 使用与河流图相同的分析分布（带宽比例 0.3），其中 CCDF 为 P(剂量 > x)；单点分布不再绘制贯穿全图的阶梯线，而是在其唯一剂量处绘制短 rug，同时省略各曲线数值尾界以外无信息的零值延长段。TCM 图中文字按最终物理尺寸为 6.9–11.5 px；结果只描述处方分布，不能推断疗效。

## Interpretation boundary

- TCM patterns describe prescription-dose distributions among the observed patients. They do not establish efficacy, safety, or causal treatment effects.
- TCM 分布只反映观测患者的处方剂量差异，不构成疗效、安全性或治疗因果关系的证据。
`;
  writeFileSync(resolve(OUTPUT_DIR, "tcm-story.md"), story, "utf8");
}

function writeSelection(filename: string, selection: Record<string, unknown>) {
  writeFileSync(resolve(OUTPUT_DIR, filename), `${JSON.stringify(selection, null, 2)}\n`, "utf8");
}

function validateGenerated(generated: string[]) {
  if (generated.some((svg) => /NaN|undefined| d=""/.test(svg))) throw new Error("invalid SVG output");
  if (generated.some((svg) => /March–April|envelope share stays|median rises|strongest intermediate/.test(svg))) {
    throw new Error("explanatory prose leaked into a figure");
  }
}

function removeLegacyCombinedArtifacts() {
  for (const filename of [
    "examples-combined.svg",
    "examples-combined.png",
    "examples-story.md",
    "examples-metrics.csv",
    "examples-selection.json",
  ]) {
    const path = resolve(OUTPUT_DIR, filename);
    if (existsSync(path)) unlinkSync(path);
  }
}

function removeObsoleteTcmArtifacts() {
  for (const filename of [
    "tcm-dampness-transition-detail.svg",
    "tcm-deficiency-branches-detail.svg",
    "tcm-heat-branches-detail.svg",
    "tcm-dist-kde.svg",
    "tcm-case.png",
    "tcm-metrics.csv",
    "tcm-selection.json",
  ]) {
    const path = resolve(OUTPUT_DIR, filename);
    if (existsSync(path)) unlinkSync(path);
  }
}

// === 8. Case-specific deterministic export entry points ===
// Each entry recomputes its own full-data pipeline, then crops only the display.
export function generateCovidExample() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  removeLegacyCombinedArtifacts();
  const converted = convertCovidCase(readFileSync("examples/data/covid_inc_case_trained_members.json", "utf8"));
  const data = caseData(converted.dataset, converted.metadata.sampleSize);
  const result = runPipeline(data.dataset, {
    baselineMode: "wiggle",
    braided: { bandwidthRatio: 0.3, debug: true },
  });
  const start = data.times.indexOf("2022-01-29");
  const end = data.times.indexOf("2022-04-02");
  const panel = renderMain("covid", data, result, start, end);
  const detail = renderCovidAprDetail(data, result);
  writeFileSync(resolve(OUTPUT_DIR, "covid-case.svg"), panel.svg, "utf8");
  writePng(panel.svg, "covid-case.png", COVID_PNG_WIDTH);
  writeFileSync(resolve(OUTPUT_DIR, "covid-apr02-detail.svg"), detail, "utf8");
  writeCsv("covid-metrics.csv", metrics("covid", panel));
  writeCovidStory(data, result);
  const middle = data.times.indexOf(COVID_SNAPSHOTS[1]);
  writeSelection("covid-selection.json", {
    case: "covid",
    source: "examples/data/covid_inc_case_trained_members.json",
    range: [data.times[start], data.times[end]],
    snapshots: COVID_SNAPSHOTS,
    analysis: { bandwidthRatio: .3, baselineMode: "wiggle", debug: true },
    rendering: {
      width: "210mm",
      png_width_pixels: COVID_PNG_WIDTH,
      interpolation_subdivisions: 32,
      primary_text_size_px: 20,
      axis_text_size_px: 13,
      streamgraph_to_distribution_width_ratio: "approximately 1:2",
      per_cell_axes: "independent x and density domains; zero, midpoint, and upper-limit ticks",
    },
    evidence: Object.fromEntries(COVID_STATES.map((state) => [
      state,
      result.braided.layers.find((layer) => layer.layerId === state)!.debug![middle].branchCount,
    ])),
    detail_view: "artifacts/figures/covid-apr02-detail.svg",
  });
  validateGenerated([panel.svg, detail]);
  console.log("Wrote COVID main figure, detail SVG, metrics, story, and selection.");
}

export function generateTcmExample() {
  const source = resolve("examples/data/private/TCMRecord.csv");
  if (!existsSync(source)) throw new Error("Local TCM records not found: examples/data/private/TCMRecord.csv");
  mkdirSync(OUTPUT_DIR, { recursive: true });
  removeLegacyCombinedArtifacts();
  removeObsoleteTcmArtifacts();
  const converted = convertTcmCase(readFileSync(source, "utf8"));
  const data = caseData(converted.dataset, converted.metadata.sampleSize, TCM_COLORS, converted.metadata);
  const result = runPipeline(data.dataset, {
    baselineMode: "wiggle",
    braided: { bandwidthRatio: 0.3, debug: true },
  });
  const end = data.times.indexOf(TCM_END);
  if (end < 0) throw new Error(`TCM display endpoint absent: ${TCM_END}`);
  const panel = renderMain("tcm", data, result, 0, end);
  const kdePanels = TCM_SNAPSHOTS.flatMap((visit) => TCM_TARGETS.map((id) => ({
    filename: `tcm-kde-${visit.replace(" ", "")}-${id === TCM_TARGETS[0] ? "liangxue-zhixue" : "buxu"}.svg`,
    svg: renderTcmKde(data, id, visit),
  })));
  const ccdf = renderTcmCcdf(data);
  const { center, outer, indices } = tcmTargets(data, result);
  const tcmSvgEvidence = {
    lastReferenceTime: result.pid.referenceTimeIndices.at(-1),
    envelopeStrokes: panel.svg.match(/class="envelope-stroke"/g)?.length ?? 0,
    snapshotGuides: panel.svg.match(/class="snapshot-guide"/g)?.length ?? 0,
    textElements: panel.svg.match(/<text\b/g)?.length ?? 0,
    forbiddenMarks: /class="snapshot-density"|class="branch-stroke"|class="representative-stroke"/.test(panel.svg),
  };
  if (tcmSvgEvidence.lastReferenceTime !== data.times.length - 1 ||
      tcmSvgEvidence.envelopeStrokes !== 4 || tcmSvgEvidence.snapshotGuides !== 2 ||
      tcmSvgEvidence.textElements !== 2 || tcmSvgEvidence.forbiddenMarks) {
    throw new Error(`TCM SVG evidence mismatch: ${JSON.stringify(tcmSvgEvidence)}`);
  }
  const samples = [center, outer].flatMap((id) => indices.flatMap((time, snapshot) => {
    const values = data.tcmMetadata!.values[id][time];
    if (values.length !== data.sampleSize[data.layers[0].id]?.[time]) {
      throw new Error(`TCM sample count mismatch: ${id} at ${TCM_SNAPSHOTS[snapshot]}`);
    }
    return values.map((dose, sample) => ({
      visit: TCM_SNAPSHOTS[snapshot], layer: id, sample_index: sample + 1, dose,
    }));
  }));
  writeFileSync(resolve(OUTPUT_DIR, "tcm-case.svg"), panel.svg, "utf8");
  for (const { filename, svg } of kdePanels) writeFileSync(resolve(OUTPUT_DIR, filename), svg, "utf8");
  writeFileSync(resolve(OUTPUT_DIR, "tcm-ccdf-spaghetti.svg"), ccdf, "utf8");
  writeCsv("tcm-samples.csv", samples);
  writeTcmStory(data, result);
  validateGenerated([panel.svg, ...kdePanels.map(({ svg }) => svg), ccdf]);
  if (kdePanels.length !== 4 || kdePanels.some(({ svg }) =>
        (svg.match(/class="snapshot-density"/g)?.length ?? 0) !== 1) ||
      (ccdf.match(/class="ccdf-(?:curve|point-mass)"/g)?.length ?? 0) !==
        [center, outer].reduce((count, id) => count + data.layers.find((layer) => layer.id === id)!
          .measures.filter((measure) => measure !== null).length, 0)) {
    throw new Error("TCM density panels or full-visit CCDF marks are incomplete");
  }
  console.log("Wrote TCM stream, four KDE panels, CCDF SVG, visit samples, and story.");
}
