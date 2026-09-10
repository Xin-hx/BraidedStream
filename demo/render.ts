/**
 * SVG renderer — native DOM, no libraries.
 */
import { computeSineBaseline } from "../code/baseline";
import { area, axisBottom, axisLeft, curveBasis, curveLinear, line, scaleLinear, select, stack, stackOffsetWiggle } from "d3";
import {
  publicationCalmRegions,
  publicationEventAttributes,
  selectPublicationEvents,
} from "../code/publication";
import type { BaseLayout, BraidedLayout, Layer, PipelineResult, PresentationMode } from "../code/types";

export const W = 1180;
export const H = 720;
export const M = { top: 24, right: 28, bottom: 168, left: 64 };
const IW = W - M.left - M.right;

const NS = "http://www.w3.org/2000/svg";
export const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#56B4E9", "#D55E00", "#CC79A7", "#F0E442", "#000000", "#8C8C8C", "#66C2A5"];
export const PUBLICATION_PALETTE = [
  "#9ecae1", "#f2c98a", "#9fd8c2", "#c5b5d9", "#e8a89a",
  "#d8b5cf", "#d9d38f", "#aebfd0", "#b8c9a8", "#d6b59c",
];

export interface ViewGeometry {
  order: string[];
  bottom: number[][];
  top: number[][];
  braided?: BraidedLayout;
}

export interface RenderInput {
  layers: Layer[]; // source order
  times: string[];
  result: PipelineResult; // PID-ordered pipeline
  baseInput: BaseLayout; // wiggle in INPUT order (for "base" mode)
  mode: "base" | "pid" | "braided";
  /** Smooth river contours with the conventional basis spline. */
  smoothContours: boolean;
  showRef: boolean;
  forceBase: boolean;
  /** hover index or null */
  hover: number | null;
  highlightLayer: string | null;
  presentation: PresentationMode;
}

export function renderChart(svg: SVGElement, input: RenderInput): void {
  const tLen = input.times.length;
  const braided = input.mode === "braided" && !input.forceBase;

  // choose geometry
  let bottom: number[][];
  let top: number[][];
  let layerIds: string[];
  if (input.mode === "base") {
    bottom = input.baseInput.yBottom;
    top = input.baseInput.yTop;
    layerIds = input.layers.map((l) => l.id); // base mode = input order
  } else {
    bottom = braided ? input.result.braided.yBottomStar : input.result.base.yBottom;
    top = braided ? input.result.braided.yTopStar : input.result.base.yTop;
    layerIds = input.result.pid.order;
  }

  // D3 owns the display coordinate system; this code only chooses its domain.
  const values = [...bottom.flat(), ...top.flat()];
  if (input.showRef) values.push(...input.result.base.yTop.at(-1)!);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const pad = (yMax - yMin) * 0.06 || 1;
  yMin -= pad;
  yMax += pad;

  const x = scaleLinear().domain([0, Math.max(1, tLen - 1)]).range([M.left, W - M.right]);
  const y = scaleLinear().domain([yMin, yMax]).range([H - M.bottom, M.top]);
  const curve = input.smoothContours ? curveBasis : curveLinear;
  const indices = Array.from({ length: tLen }, (_, t) => t);
  const makeArea = (lo: number[], hi: number[]) => area<number>()
    .curve(curve).x((t) => x(t)).y0((t) => y(lo[t])).y1((t) => y(hi[t]))(indices) ?? "";
  const makeLine = (values: number[]) => line<number>()
    .curve(curve).x((t) => x(t)).y((t) => y(values[t]))(indices) ?? "";

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("data-presentation-mode", input.presentation);
  const root = select(svg);
  root.selectAll("*").remove();

  // --- grid + axes ---
  const ticks = 5;
  if (input.presentation === "diagnostic") {
    root.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(${M.left},0)`)
      .call(axisLeft(y).ticks(ticks).tickSize(-IW).tickFormat(() => ""))
      .select(".domain").remove();
  }

  const xTicks: number[] = [];
  const step = Math.max(1, Math.ceil(tLen / (input.presentation === "publication" ? 6 : 10)));
  for (let t = 0; t < tLen; t += step) xTicks.push(t);
  if (xTicks[xTicks.length - 1] !== tLen - 1) xTicks.push(tLen - 1);

  root.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`)
    .call(axisBottom(x).tickValues(xTicks).tickFormat((t) => tickLabel(input.times[Number(t)] ?? "")));
  if (input.presentation === "publication" && input.times.every((label) => /^t\d+$/.test(label))) {
    root.append("text")
      .attr("class", "axis-title")
      .attr("x", M.left + IW / 2)
      .attr("y", H - M.bottom + 42)
      .attr("text-anchor", "middle")
      .text("time (synthetic index)");
  }
  if (input.presentation === "diagnostic") {
    root.append("g")
      .attr("class", "axis axis-y")
      .attr("transform", `translate(${M.left},0)`)
      .call(axisLeft(y).ticks(ticks).tickFormat((value) => fmtNum(Number(value))));
  }

  if (input.presentation === "publication" && braided) {
    for (const calm of publicationCalmRegions(input.result.braided.seam)) {
      const x0 = x(calm.start);
      const x1 = x(calm.end);
      const bracketY = M.top + 10;
      const group = el("g", {
        class: "calm-bracket",
        "data-calm-region": calm.edge,
        "data-calm-start": calm.start,
        "data-calm-end": calm.end,
      });
      group.appendChild(el("path", {
        d: `M${x0.toFixed(2)},${(bracketY + 5).toFixed(2)} V${bracketY.toFixed(2)} H${x1.toFixed(2)} V${(bracketY + 5).toFixed(2)}`,
      }));
      const label = el("text", {
        x: (x0 + x1) / 2,
        y: bracketY - 3,
        "text-anchor": "middle",
      });
      label.textContent = "closed";
      group.appendChild(label);
      svg.appendChild(group);
    }
  }

  // --- reference silhouette (Σq50) ---
  if (input.showRef) {
    const h0Top = input.result.base.yTop[input.result.base.yTop.length - 1];
    const baseBtm = input.result.base.yBottom[0];
    root.append("path").attr("d", makeLine(h0Top)).attr("class", "ref-silhouette");
    root.append("path").attr("d", makeLine(baseBtm)).attr("class", "ref-silhouette").attr("stroke-opacity", 0.5);
  }

  // --- layers ---
  const colorOf = (idx: number): string => {
    if (input.presentation === "publication") return PUBLICATION_PALETTE[idx % PUBLICATION_PALETTE.length];
    const id = layerIds[idx];
    const src = input.layers.find((l) => l.id === id);
    return src?.color ?? PALETTE[idx % PALETTE.length];
  };

  root.append("g").attr("class", "layers").selectAll("path")
    .data(layerIds)
    .join("path")
    .attr("d", (_, i) => makeArea(bottom[i], top[i]))
    .attr("class", (id) => `layer${input.presentation === "publication" ? " publication-layer" : ""}${input.highlightLayer && id !== input.highlightLayer ? " dim" : ""}`)
    .attr("fill", (_, i) => colorOf(i))
    .attr("fill-opacity", input.presentation === "publication" ? 0.72 : 0.82)
    .attr("stroke", (_, i) => input.presentation === "publication" ? "#64748b" : colorOf(i))
    .attr("stroke-opacity", input.presentation === "publication" ? 0.32 : 1)
    .attr("stroke-width", input.presentation === "publication" ? 0.7 : 0.8)
    .attr("data-idx", (_, i) => i)
    .attr("data-id", (id) => id);

  if (input.presentation === "publication" && braided) {
    // Treat active display space as a designed, very light cool-gray channel
    // rather than an accidental hole in the paper. Exact-zero seams still
    // collapse to a degenerate polygon and therefore disappear exactly.
    // class: "corridor-fill" — retained as a stable DOM hook for exports/tests.
    root.append("g").attr("class", "corridors").selectAll("path")
      .data(input.result.braided.seam)
      .join("path")
      .attr("d", (_, seam) => makeArea(input.result.braided.yTopStar[seam], input.result.braided.yBottomStar[seam + 1]))
      .attr("class", "corridor-fill")
      .attr("data-corridor-seam", (_, seam) => seam);

    const events = selectPublicationEvents(input.result.braided.seam);
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const seamY = (t: number): number => y(
        (input.result.braided.yTopStar[event.seam][t] +
          input.result.braided.yBottomStar[event.seam + 1][t]) / 2
      );
      const labelY = Math.max(M.top + 22, seamY(event.peak) - 24 - (index % 2) * 12);
      const group = el("g", {
        class: "event-annotation",
        ...publicationEventAttributes(event),
      });
      const centerPoints: [number, number][] = [];
      for (let t = event.start; t <= event.end; t += 1) centerPoints.push([x(t), seamY(t)]);
      group.appendChild(el("path", {
        d: polyline(centerPoints),
        class: "event-centerline",
      }));
      group.appendChild(el("path", {
        d: `M${x(event.peak).toFixed(2)},${seamY(event.peak).toFixed(2)} L${x(event.peak).toFixed(2)},${labelY.toFixed(2)}`,
        class: "event-leader",
      }));
      for (const t of [event.start, event.peak, event.end]) {
        group.appendChild(el("circle", { cx: x(t), cy: seamY(t), r: t === event.peak ? 4.5 : 3 }));
      }
      const label = el("text", {
        x: x(event.peak),
        y: labelY - 6,
        "text-anchor": "middle",
        "aria-label": `event ${String.fromCharCode(65 + index)}`,
      });
      label.textContent = String.fromCharCode(65 + index);
      group.appendChild(label);
      svg.appendChild(group);
    }

    const key = el("g", { class: "svg-encoding-key", "aria-label": "visual encoding key" });
    const keyY = H - M.bottom + 75;
    key.appendChild(el("rect", { x: M.left, y: keyY - 11, width: 28, height: 12, rx: 3, fill: PUBLICATION_PALETTE[0] }));
    appendText(key, M.left + 38, keyY, "band = median q50 thickness");
    key.appendChild(el("rect", { x: M.left + 286, y: keyY - 11, width: 28, height: 12, fill: "#dce8ef", stroke: "#8298aa", "stroke-width": 1.2 }));
    appendText(key, M.left + 324, keyY, "corridor = shared-scale uncertainty; not missing data");
    key.appendChild(el("line", { x1: M.left + 782, x2: M.left + 816, y1: keyY - 5, y2: keyY - 5, class: "key-reference" }));
    appendText(key, M.left + 826, keyY, "dashed = total median");

    const eventY = keyY + 23;
    key.appendChild(el("line", { x1: M.left, x2: M.left + 48, y1: eventY - 4, y2: eventY - 4, class: "key-event-line" }));
    for (const dx of [0, 24, 48]) {
      key.appendChild(el("circle", { cx: M.left + dx, cy: eventY - 4, r: dx === 24 ? 3 : 2, class: "key-event-node" }));
    }
    appendText(key, M.left + 64, eventY, "circles = open, peak, rejoin; A–C = selected adjacent-layer separation–rejoining intervals");

    const layerY = eventY + 26;
    const semantics: Record<string, string> = {
      c0: "cons-A", c1: "early", c2: "cons-B", c3: "early-mid", c4: "mid",
      c5: "outlier", c6: "late", c7: "low-u", c8: "thin/high-u",
    };
    appendText(key, M.left, layerY, "layer identities:");
    let layerX = M.left + 118;
    for (let i = 0; i < layerIds.length; i += 1) {
      const id = layerIds[i];
      key.appendChild(el("rect", { x: layerX, y: layerY - 11, width: 13, height: 13, rx: 2, fill: colorOf(i), stroke: "#64748b", "stroke-width": 0.7 }));
      appendText(key, layerX + 18, layerY, `${id} ${semantics[id] ?? ""}`);
      layerX += 105;
    }
    svg.appendChild(key);
  }

  // --- hover guide ---
  if (input.presentation === "diagnostic" && input.hover !== null) {
    const t = input.hover;
    const line = el("line", { class: "hover-line", x1: x(t), x2: x(t), y1: M.top, y2: H - M.bottom });
    svg.appendChild(line);
  }
}

/** build a layer's bottom/top polygons in INPUT order (base mode) */
export function baseGeometryInInputOrder(
  layers: Layer[],
  times: string[],
  baselineMode: "wiggle" | "sine" = "wiggle"
): BaseLayout {
  if (baselineMode === "sine") {
    return computeSineBaseline(layers, layers.map((l) => l.id));
  }
  const ids = layers.map((layer) => layer.id);
  const rows = times.map((_, t) => Object.fromEntries(layers.map((layer) => [layer.id, layer.q.p50[t]])) as Record<string, number>);
  const series = stack<Record<string, number>>().keys(ids).offset(stackOffsetWiggle)(rows);
  const yBottom = series.map((layer) => layer.map(([bottom]) => bottom));
  const yTop = series.map((layer) => layer.map(([, top]) => top));
  const shift = -(Math.min(...yBottom.flat()) + Math.max(...yTop.flat())) / 2;
  return {
    baseline: yBottom[0].map((value) => value + shift),
    yBottom: yBottom.map((layer) => layer.map((value) => value + shift)),
    yTop: yTop.map((layer) => layer.map((value) => value + shift)),
  };
}

function tickLabel(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(label)) {
    const [y, m] = label.split("-");
    return `${y.slice(2)}-${m}`;
  }
  return label;
}

function fmtNum(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return v.toFixed(Math.abs(v) < 10 ? 1 : 0);
}

function polyline(pts: [number, number][]): string {
  return pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function appendText(parent: SVGElement, x: number, y: number, text: string): void {
  const node = el("text", { x, y, "text-anchor": "start" });
  node.textContent = text;
  parent.appendChild(node);
}

/** Export the current SVG as a standalone SVG file download. */
export function exportSvg(svg: SVGElement): void {
  const clone = prepareExportClone(svg);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, "braided-streamgraph.svg");
}

/** Rasterize the current SVG to PNG (2x scale) and download. */
export function exportPng(svg: SVGElement): Promise<void> {
  const clone = prepareExportClone(svg);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas 2d unavailable"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) {
          downloadBlob(blob, "braided-streamgraph.png");
          resolve();
        } else {
          reject(new Error("toBlob failed"));
        }
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg rasterization failed"));
    };
    img.src = url;
  });
}

function prepareExportClone(svg: SVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", NS);
  const style = document.createElementNS(NS, "style");
  style.textContent = `
    .ref-silhouette{fill:none;stroke:#7b8794;stroke-width:1.6;stroke-dasharray:8 6}
    .axis text{font-size:15px;fill:#48576a;font-family:monospace}
    .axis-title{fill:#3f4d5d;font:600 15px sans-serif}
    .grid line{stroke:#f0f0f0}.hover-line{stroke:#0072b2;stroke-width:1;opacity:.5}
    .calm-bracket path{fill:none;stroke:#34495e;stroke-width:1.8}.calm-bracket text{fill:#26394d;font:700 16px sans-serif}
    .corridor-fill{fill:#e8f0f5;stroke:#8298aa;stroke-width:1.2;stroke-opacity:.82;pointer-events:none}
    .event-centerline{fill:none;stroke:#34495e;stroke-width:1.6;opacity:.92}.event-leader{fill:none;stroke:#34495e;stroke-width:1.5;opacity:.86}
    .event-annotation circle{fill:#fff;stroke:#34495e;stroke-width:1.6}
    .event-annotation text{fill:#26394d;font:750 18px sans-serif;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}
    .svg-encoding-key text{fill:#344556;font:600 15px sans-serif}.key-reference{stroke:#586b7d;stroke-width:1.8;stroke-dasharray:8 6}.key-event-line{stroke:#34495e;stroke-width:1.6}.key-event-node{fill:#fff;stroke:#34495e;stroke-width:1.6}
  `;
  clone.prepend(style);
  return clone;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
