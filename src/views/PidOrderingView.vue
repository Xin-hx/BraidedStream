<script setup lang="ts">
import * as d3 from "d3";
import { onMounted, ref, watch } from "vue";
import { computeBaseline } from "../core/baseline";
import { normalizeOrderForComparison } from "../core/orderCompare";
import { buildPidCenterOutOrder, computePidOrdering } from "../core/pidOrdering";
import { computeStackedBoundaries } from "../core/stack";
import type { BaselineMode, LayerInput, OptimizeMethod, PreparedDataset, ROI, StackLayout } from "../core/types";
import type { AppState } from "../state/appState";
import { orderLayers } from "../core/validate";
import { layerColor } from "../styles/palette";

const props = defineProps<{
  dataset: PreparedDataset | null;
  sineOrder: string[];
  roi: ROI | null;
  state: AppState;
}>();

const emit = defineEmits<{
  (e: "hover", value: { x: number; y: number; text: string } | null): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);

const width = 1140;
const margin = { top: 24, right: 18, bottom: 52, left: 58 };
const innerWidth = width - margin.left - margin.right;
const streamPanelHeight = 190;
const panelGap = 58;
const slopeRowHeight = 18;
const slopeHeaderPadding = 96;
const slopePanelGap = 46;
// Reserve a fixed header band in slope panels so titles never collide with lines/labels.
const slopeHeaderTop = 62;
const slopeFooterPad = 16;

interface StreamPanelState {
  key: "basic" | "optimized";
  title: string;
  top: number;
  height: number;
  layout: StackLayout;
  yScale: d3.ScaleLinear<number, number>;
}

interface SlopeLineState {
  id: string;
  label: string;
  leftRank: number;
  rightRank: number;
  delta: number;
  depth: number;
  color: string;
  leftY: number;
  rightY: number;
}

interface RenderState {
  times: number[];
  activeTimes: number[];
  activeIndices: number[];
  orderedLayers: LayerInput[];
  pidDepthByLayerId: Map<string, number>;
  xScale: d3.ScaleLinear<number, number>;
  streamPanels: StreamPanelState[];
  innerHeight: number;
  slopePanels: SlopePanelState[];
}

interface SlopePanelState {
  key: "order-value" | "y-top-down";
  title: string;
  subtitle: string;
  top: number;
  height: number;
  leftTitle: string;
  rightTitle: string;
  panel: {
    top: number;
    height: number;
    leftX: number;
    rightX: number;
    lines: SlopeLineState[];
  };
}

let currentRender: RenderState | null = null;
let currentCanvasHeight = 760;

const STATE_FULL_NAME_BY_CODE: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia"
};

onMounted(() => {
  renderChart();
});

watch(
  () => [
    props.dataset,
    props.sineOrder,
    props.roi,
    props.state.optimizeMethod,
    props.state.optimization.wiggleWeightL1,
    props.state.optimization.wiggleWeightL2,
    props.state.optimization.centerAnchorWeight,
    props.state.optimization.irlsIterations,
    props.state.optimization.irlsEps,
    props.state.optimization.baselineCenterType
  ],
  () => {
    renderChart();
  },
  { deep: true }
);

function renderChart(): void {
  if (!svgRef.value) {
    return;
  }
  emit("hover", null);
  currentRender = null;

  const svg = d3.select(svgRef.value);
  svg.selectAll("*").remove();

  if (!props.dataset || props.dataset.layers.length === 0 || props.dataset.times.length === 0) {
    const emptyHeight = 220;
    currentCanvasHeight = emptyHeight;
    svg.attr("viewBox", `0 0 ${width} ${emptyHeight}`).attr("height", emptyHeight);
    const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    root
      .append("text")
      .attr("x", 0)
      .attr("y", 18)
      .attr("fill", "#334155")
      .attr("font-size", 14)
      .text("No data available for PID ordering");
    return;
  }

  const dataset = props.dataset;
  const slopeHeight = Math.max(180, dataset.layers.length * slopeRowHeight + slopeHeaderPadding);
  const streamTop = 0;
  const optimizedTop = streamTop + streamPanelHeight + panelGap;
  const slopeOrderTop = optimizedTop + streamPanelHeight + panelGap;
  const slopeYTop = slopeOrderTop + slopeHeight + slopePanelGap;
  const innerHeight = streamPanelHeight * 2 + panelGap * 2 + slopeHeight * 2 + slopePanelGap;
  const canvasHeight = innerHeight + margin.top + margin.bottom;
  currentCanvasHeight = canvasHeight;
  svg.attr("viewBox", `0 0 ${width} ${canvasHeight}`).attr("height", canvasHeight);
  const root = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const [left, right] = roiBounds(dataset.times.length, props.roi);
  const activeIndices = d3.range(left, right + 1);
  const activeTimes = activeIndices.map((index) => dataset.times[index]);

  const pid = computePidOrdering(dataset.layers, {
    excludeSelf: true,
    widthPenaltyPower: 1,
    minComparators: 2
  });
  const layerIds = dataset.layers.map((layer) => layer.id);
  const sineBaseOrder = normalizeOrderForComparison(props.sineOrder, layerIds, dataset.order);
  const pidDepthOrder = normalizeOrderForComparison(pid.order, layerIds, dataset.order);
  const sineDisplayOrder = buildPidCenterOutOrder(sineBaseOrder);
  const pidDisplayOrder = buildPidCenterOutOrder(pidDepthOrder);
  const orderedLayers = orderLayers(dataset.layers, pidDisplayOrder);
  const colorIndexById = new Map<string, number>(dataset.order.map((id, index) => [id, index]));

  const centerBaseline = computeBaseline(dataset.times, orderedLayers, "center");
  const centerLayout = computeStackedBoundaries(centerBaseline, orderedLayers);
  const optimizeMode = optimizeMethodToBaselineMode(props.state.optimizeMethod);
  const optimizedBaseline = computeBaseline(dataset.times, orderedLayers, optimizeMode, baselineHooksFromState(props.state));
  const optimizedLayout = computeStackedBoundaries(optimizedBaseline, orderedLayers);

  const xScale = d3
    .scaleLinear()
    .domain([activeTimes[0], activeTimes[activeTimes.length - 1]])
    .range([0, innerWidth]);

  const streamPanels: StreamPanelState[] = [];
  streamPanels.push(
    drawStreamPanel(root, {
      key: "basic",
      top: streamTop,
      height: streamPanelHeight,
      title: "PID ordering: reference river (center baseline)",
      dataset,
      orderedLayers,
      activeIndices,
      layout: centerLayout,
      xScale
    })
  );
  streamPanels.push(
    drawStreamPanel(root, {
      key: "optimized",
      top: optimizedTop,
      height: streamPanelHeight,
      title: `PID ordering: optimized river (${baselineModeLabel(optimizeMode)})`,
      dataset,
      orderedLayers,
      activeIndices,
      layout: optimizedLayout,
      xScale
    })
  );

  const slopePanels: SlopePanelState[] = [];
  slopePanels.push(
    drawSlopePanel(root, {
      key: "order-value",
      title: "Sine ordering vs PID ordering: rank change",
      subtitle: "rank metric: bottom -> top order value",
      leftTitle: "Sine ordering",
      rightTitle: "PID depth ordering",
      top: slopeOrderTop,
      height: slopeHeight,
      layerIds,
      leftOrder: sineBaseOrder,
      rightOrder: pidDepthOrder,
      rankMode: "bottom-to-top",
      depthByLayerId: pid.depthByLayerId,
      colorIndexById
    })
  );
  slopePanels.push(
    drawSlopePanel(root, {
      key: "y-top-down",
      title: "Sine ordering vs PID ordering: y change after center-out placement",
      subtitle: "rank metric: top -> bottom display y",
      leftTitle: "Sine center-out display",
      rightTitle: "PID center-out display",
      top: slopeYTop,
      height: slopeHeight,
      layerIds,
      leftOrder: sineDisplayOrder,
      rightOrder: pidDisplayOrder,
      rankMode: "top-to-bottom",
      depthByLayerId: pid.depthByLayerId,
      colorIndexById
    })
  );

  currentRender = {
    times: dataset.times,
    activeTimes,
    activeIndices,
    orderedLayers,
    pidDepthByLayerId: pid.depthByLayerId,
    xScale,
    streamPanels,
    innerHeight,
    slopePanels
  };
}

function drawStreamPanel(
  root: d3.Selection<SVGGElement, unknown, null, undefined>,
  args: {
    key: "basic" | "optimized";
    top: number;
    height: number;
    title: string;
    dataset: PreparedDataset;
    orderedLayers: LayerInput[];
    activeIndices: number[];
    layout: StackLayout;
    xScale: d3.ScaleLinear<number, number>;
  }
): StreamPanelState {
  const { top, height, title, dataset, orderedLayers, activeIndices, layout, xScale } = args;
  const panel = root.append("g").attr("transform", `translate(0,${top})`);
  panel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", height)
    .attr("fill", "rgba(248, 250, 252, 0.72)")
    .attr("stroke", "rgba(148, 163, 184, 0.44)");

  const [minValue, maxValue] = layoutExtent(layout, activeIndices);
  const pad = (maxValue - minValue) * 0.06 + 1e-6;
  const yScale = d3.scaleLinear().domain([minValue - pad, maxValue + pad]).range([height, 0]);

  panel
    .selectAll<SVGPathElement, { id: string; index: number }>("path.pid-layer")
    .data(
      orderedLayers.map((layer, index) => ({ id: layer.id, index })),
      (d) => d.id
    )
    .join((enter) => enter.append("path").attr("class", "pid-layer"), (update) => update, (exit) => exit.remove())
    .attr("d", (d) =>
      d3
        .area<number>()
        .x((t) => xScale(dataset.times[t]))
        .y0((t) => yScale(layout.yBottom[d.index][t]))
        .y1((t) => yScale(layout.yTop[d.index][t]))
        .curve(d3.curveMonotoneX)(activeIndices) ?? ""
    )
    .attr("fill", (d) => layerColor(d.index, d.id))
    .attr("fill-opacity", 0.83)
    .attr("stroke", "#f8fafc")
    .attr("stroke-width", 0.7);

  panel
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(Math.max(3, Math.floor(innerWidth / 220)))
        .tickFormat((value) => formatTimeTick(Number(value)))
    );
  panel
    .selectAll<SVGTextElement, unknown>(".x-axis text")
    .attr("text-anchor", "end")
    .attr("dx", "-0.42em")
    .attr("dy", "0.34em")
    .attr("transform", "rotate(-35)");

  panel.append("g").attr("class", "y-axis").call(d3.axisLeft(yScale).ticks(5));

  panel
    .append("text")
    .attr("x", 0)
    .attr("y", -8)
    .attr("fill", "#0f172a")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text(title);

  return {
    key: args.key,
    title,
    top,
    height,
    layout,
    yScale
  };
}

function drawSlopePanel(
  root: d3.Selection<SVGGElement, unknown, null, undefined>,
  args: {
    key: "order-value" | "y-top-down";
    title: string;
    subtitle: string;
    leftTitle: string;
    rightTitle: string;
    top: number;
    height: number;
    layerIds: string[];
    leftOrder: string[];
    rightOrder: string[];
    rankMode: "bottom-to-top" | "top-to-bottom";
    depthByLayerId: Map<string, number>;
    colorIndexById: Map<string, number>;
  }
): SlopePanelState {
  const panel = root.append("g").attr("transform", `translate(0,${args.top})`);
  panel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", args.height)
    .attr("fill", "rgba(248, 250, 252, 0.72)")
    .attr("stroke", "rgba(148, 163, 184, 0.44)");

  const leftOrder = normalizeOrderForComparison(args.leftOrder, args.layerIds, args.layerIds);
  const rightOrder = normalizeOrderForComparison(args.rightOrder, args.layerIds, args.layerIds);
  const leftRankMap = args.rankMode === "top-to-bottom" ? rankMapTopToBottom(leftOrder) : rankMapBottomToTop(leftOrder);
  const rightRankMap = args.rankMode === "top-to-bottom" ? rankMapTopToBottom(rightOrder) : rankMapBottomToTop(rightOrder);
  const n = Math.max(1, args.layerIds.length);
  const rankScale = d3.scaleLinear().domain([1, n]).range([slopeHeaderTop, args.height - slopeFooterPad]);
  const leftX = innerWidth * 0.24;
  const rightX = innerWidth * 0.76;

  const lines: SlopeLineState[] = args.layerIds.map((id, index) => {
    const leftRank = leftRankMap.get(id) ?? n;
    const rightRank = rightRankMap.get(id) ?? n;
    const depth = args.depthByLayerId.get(id) ?? 0;
    return {
      id,
      label: slopeLabel(id),
      leftRank,
      rightRank,
      delta: rightRank - leftRank,
      depth,
      color: layerColor(args.colorIndexById.get(id) ?? index, id),
      leftY: rankScale(leftRank),
      rightY: rankScale(rightRank)
    };
  });

  panel
    .append("line")
    .attr("x1", leftX)
    .attr("x2", leftX)
    .attr("y1", slopeHeaderTop - 8)
    .attr("y2", args.height - slopeFooterPad + 6)
    .attr("stroke", "rgba(71, 85, 105, 0.45)");
  panel
    .append("line")
    .attr("x1", rightX)
    .attr("x2", rightX)
    .attr("y1", slopeHeaderTop - 8)
    .attr("y2", args.height - slopeFooterPad + 6)
    .attr("stroke", "rgba(71, 85, 105, 0.45)");

  panel
    .selectAll<SVGLineElement, SlopeLineState>("line.pid-slope-link")
    .data(lines, (d) => d.id)
    .join((enter) => enter.append("line").attr("class", "pid-slope-link"), (update) => update, (exit) => exit.remove())
    .attr("x1", leftX)
    .attr("x2", rightX)
    .attr("y1", (d) => d.leftY)
    .attr("y2", (d) => d.rightY)
    .attr("stroke", (d) => d.color)
    .attr("stroke-width", (d) => (d.delta === 0 ? 0.9 : 1.45))
    .attr("stroke-opacity", (d) => 0.26 + Math.min(0.6, Math.abs(d.delta) / Math.max(1, n * 0.35)));

  panel
    .selectAll<SVGCircleElement, SlopeLineState>("circle.pid-left-dot")
    .data(lines, (d) => d.id)
    .join((enter) => enter.append("circle").attr("class", "pid-left-dot"), (update) => update, (exit) => exit.remove())
    .attr("cx", leftX)
    .attr("cy", (d) => d.leftY)
    .attr("r", 1.9)
    .attr("fill", (d) => d.color)
    .attr("opacity", 0.86);

  panel
    .selectAll<SVGCircleElement, SlopeLineState>("circle.pid-right-dot")
    .data(lines, (d) => d.id)
    .join((enter) => enter.append("circle").attr("class", "pid-right-dot"), (update) => update, (exit) => exit.remove())
    .attr("cx", rightX)
    .attr("cy", (d) => d.rightY)
    .attr("r", 1.9)
    .attr("fill", (d) => d.color)
    .attr("opacity", 0.86);

  const tickValues = rankTicks(n);
  panel
    .append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(${leftX - 12},0)`)
    .call(d3.axisLeft(rankScale).tickValues(tickValues).tickFormat((value) => `#${Number(value)}`));
  panel
    .append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(${rightX + 12},0)`)
    .call(d3.axisRight(rankScale).tickValues(tickValues).tickFormat((value) => `#${Number(value)}`));

  panel
    .append("text")
    .attr("x", 0)
    .attr("y", 16)
    .attr("fill", "#0f172a")
    .attr("font-size", 12)
    .attr("font-weight", 700)
    .text(args.title);
  panel
    .append("text")
    .attr("x", 0)
    .attr("y", 32)
    .attr("fill", "#475569")
    .attr("font-size", 10.5)
    .text(args.subtitle);
  panel
    .append("text")
    .attr("x", leftX)
    .attr("y", 48)
    .attr("text-anchor", "middle")
    .attr("fill", "#334155")
    .attr("font-size", 11)
    .attr("font-weight", 700)
    .text(args.leftTitle);
  panel
    .append("text")
    .attr("x", rightX)
    .attr("y", 48)
    .attr("text-anchor", "middle")
    .attr("fill", "#334155")
    .attr("font-size", 11)
    .attr("font-weight", 700)
    .text(args.rightTitle);
  const stats = summarizeShift(lines);
  panel
    .append("text")
    .attr("x", innerWidth)
    .attr("y", 16)
    .attr("text-anchor", "end")
    .attr("fill", "#475569")
    .attr("font-size", 11)
    .text(`changed=${stats.moved}/${n} | avg |delta|=${stats.avgAbsShift.toFixed(2)} | max |delta|=${stats.maxAbsShift}`);

  const leftLabels = lines.slice().sort((a, b) => a.leftRank - b.leftRank || a.id.localeCompare(b.id));
  const rightLabels = lines.slice().sort((a, b) => a.rightRank - b.rightRank || a.id.localeCompare(b.id));
  panel
    .selectAll<SVGTextElement, SlopeLineState>("text.pid-left-label")
    .data(leftLabels, (d) => d.id)
    .join((enter) => enter.append("text").attr("class", "pid-left-label"), (update) => update, (exit) => exit.remove())
    .attr("x", leftX - 16)
    .attr("y", (d) => d.leftY + 3)
    .attr("text-anchor", "end")
    .attr("fill", (d) => d.color)
    .attr("font-size", 10)
    .text((d) => d.label);
  panel
    .selectAll<SVGTextElement, SlopeLineState>("text.pid-right-label")
    .data(rightLabels, (d) => d.id)
    .join((enter) => enter.append("text").attr("class", "pid-right-label"), (update) => update, (exit) => exit.remove())
    .attr("x", rightX + 16)
    .attr("y", (d) => d.rightY + 3)
    .attr("fill", (d) => d.color)
    .attr("font-size", 10)
    .text((d) => d.label);

  return {
    key: args.key,
    title: args.title,
    subtitle: args.subtitle,
    top: args.top,
    height: args.height,
    leftTitle: args.leftTitle,
    rightTitle: args.rightTitle,
    panel: {
      top: args.top,
      height: args.height,
      leftX,
      rightX,
      lines
    }
  };
}

function onMouseMove(event: MouseEvent): void {
  if (!svgRef.value || !currentRender) {
    return;
  }
  const local = localPoint(svgRef.value, event);
  const x = local.x - margin.left;
  const y = local.y - margin.top;

  if (x < 0 || x > innerWidth || y < 0 || y > currentRender.innerHeight) {
    emit("hover", null);
    return;
  }

  for (const panel of currentRender.streamPanels) {
    if (y >= panel.top && y <= panel.top + panel.height) {
      const timeValue = currentRender.xScale.invert(x);
      const localIndex = nearestByValue(currentRender.activeTimes, timeValue);
      const index = currentRender.activeIndices[localIndex] ?? currentRender.activeIndices[0] ?? 0;
      const yValue = panel.yScale.invert(y - panel.top);
      const layer = pickLayerAtY(index, yValue, panel.layout, currentRender.orderedLayers);
      if (!layer) {
        emit("hover", null);
        return;
      }
      const depth = currentRender.pidDepthByLayerId.get(layer.id) ?? 0;
      const label = [
        panel.title,
        `t=${formatTimeTick(currentRender.times[index])}`,
        `layer=${layerLabel(layer.id)} | pidDepth=${depth.toFixed(3)}`,
        `mean=${formatValue(layer.mean[index] ?? 0)}`
      ].join("\n");
      emit("hover", { x: event.clientX, y: event.clientY, text: label });
      return;
    }
  }

  for (const slopePanel of currentRender.slopePanels) {
    const slope = slopePanel.panel;
    if (y >= slope.top && y <= slope.top + slope.height && x >= slope.leftX - 12 && x <= slope.rightX + 12) {
      const alphaRaw = (x - slope.leftX) / Math.max(1e-6, slope.rightX - slope.leftX);
      const alpha = clamp(alphaRaw, 0, 1);
      let best: SlopeLineState | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const line of slope.lines) {
        const yLine = line.leftY + (line.rightY - line.leftY) * alpha;
        const dist = Math.abs(y - slope.top - yLine);
        if (dist < bestDist) {
          bestDist = dist;
          best = line;
        }
      }
      if (!best || bestDist > 18) {
        emit("hover", null);
        return;
      }
      const text = [
        slopePanel.title,
        `layer=${best.label}`,
        `${slopePanel.leftTitle} rank=#${best.leftRank}, ${slopePanel.rightTitle} rank=#${best.rightRank}, delta=${signed(best.delta)}`,
        `pidDepth=${best.depth.toFixed(3)}`
      ].join("\n");
      emit("hover", { x: event.clientX, y: event.clientY, text });
      return;
    }
  }

  emit("hover", null);
}

function onMouseLeave(): void {
  emit("hover", null);
}

function optimizeMethodToBaselineMode(method: OptimizeMethod): BaselineMode {
  if (method === "l1") {
    return "l1";
  }
  if (method === "l2") {
    return "l2";
  }
  return "sineStream";
}

function baselineModeLabel(mode: BaselineMode): string {
  if (mode === "l1") {
    return "L1 wiggle";
  }
  if (mode === "l2") {
    return "L2 wiggle";
  }
  if (mode === "sineStream") {
    return "SineStream";
  }
  return mode;
}

function baselineHooksFromState(state: AppState) {
  return {
    centerType: state.optimization.baselineCenterType ?? "median",
    wiggleWeightL1: state.optimization.wiggleWeightL1,
    wiggleWeightL2: state.optimization.wiggleWeightL2,
    centerAnchorWeight: state.optimization.centerAnchorWeight,
    irlsIterations: state.optimization.irlsIterations,
    irlsEps: state.optimization.irlsEps
  };
}

function rankMapBottomToTop(order: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) {
    out.set(order[i], i + 1);
  }
  return out;
}

function rankMapTopToBottom(order: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = order.length;
  for (let i = 0; i < order.length; i += 1) {
    out.set(order[i], n - i);
  }
  return out;
}

function summarizeShift(lines: SlopeLineState[]): { moved: number; avgAbsShift: number; maxAbsShift: number } {
  if (lines.length === 0) {
    return {
      moved: 0,
      avgAbsShift: 0,
      maxAbsShift: 0
    };
  }
  const moved = lines.filter((line) => line.delta !== 0).length;
  const avgAbsShift = d3.mean(lines.map((line) => Math.abs(line.delta))) ?? 0;
  const maxAbsShift = d3.max(lines.map((line) => Math.abs(line.delta))) ?? 0;
  return { moved, avgAbsShift, maxAbsShift };
}

function rankTicks(n: number): number[] {
  if (n <= 0) {
    return [1];
  }
  const step = n > 40 ? 10 : n > 20 ? 5 : n > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let rank = 1; rank <= n; rank += step) {
    ticks.push(rank);
  }
  if (ticks[ticks.length - 1] !== n) {
    ticks.push(n);
  }
  return ticks;
}

function layoutExtent(layout: StackLayout, indices: number[]): [number, number] {
  if (indices.length === 0) {
    return [-1, 1];
  }
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const row of layout.yBottom) {
    for (const t of indices) {
      const value = row[t];
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }
  }
  for (const row of layout.yTop) {
    for (const t of indices) {
      const value = row[t];
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue === maxValue) {
    return [-1, 1];
  }
  return [minValue, maxValue];
}

function pickLayerAtY(timeIndex: number, yValue: number, layout: StackLayout, orderedLayers: LayerInput[]): LayerInput | null {
  for (let k = orderedLayers.length - 1; k >= 0; k -= 1) {
    const bottom = layout.yBottom[k][timeIndex];
    const top = layout.yTop[k][timeIndex];
    if (yValue >= bottom && yValue <= top) {
      return orderedLayers[k];
    }
  }
  return null;
}

function nearestByValue(values: number[], target: number): number {
  if (values.length <= 1) {
    return 0;
  }
  let left = 0;
  let right = values.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (values[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  if (left <= 0) {
    return 0;
  }
  const previous = left - 1;
  return Math.abs(values[left] - target) < Math.abs(values[previous] - target) ? left : previous;
}

function localPoint(svg: SVGSVGElement, event: MouseEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * width) / Math.max(1e-6, rect.width);
  const y = ((event.clientY - rect.top) * currentCanvasHeight) / Math.max(1e-6, rect.height);
  return { x, y };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function formatTimeTick(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return d3.utcFormat("%Y-%m-%d")(new Date(value));
}

function layerLabel(layerId: string): string {
  return layerId.split("|")[0] ?? layerId;
}

function slopeLabel(layerId: string): string {
  const token = layerLabel(layerId).toUpperCase();
  return STATE_FULL_NAME_BY_CODE[token] ?? layerLabel(layerId);
}

function signed(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value > 0 ? `+${value}` : `${value}`;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(1);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

function roiBounds(length: number, roi: ROI | null): [number, number] {
  if (length <= 0) {
    return [0, 0];
  }
  if (!roi) {
    return [0, length - 1];
  }
  const left = clamp(Math.round(roi.t0Index), 0, length - 1);
  const right = clamp(Math.round(roi.t1Index), 0, length - 1);
  return left <= right ? [left, right] : [right, left];
}

defineExpose({
  getPidOrderingSvg: () => svgRef.value
});
</script>

<template>
  <section>
    <svg
      ref="svgRef"
      id="pid-ordering-chart"
      preserveAspectRatio="xMidYMid meet"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    />
  </section>
</template>
