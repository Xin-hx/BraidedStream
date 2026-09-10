/**
 * Encoding comparison page (compare.html): same data, same base layout,
 * four candidate encodings for within-category uncertainty —
 *   1. Braided (corridor amplitude + frequency, the paper method)
 *   2. Star markers (glyph size ∝ u)
 *   3. Glow (blurred boundary halo, "zhou's paper" style)
 *   4. Color + blur (segment fill saturation ∝ u; layer blur ∝ u)
 * Static render for side-by-side inspection / publication figures.
 */
import { runPipeline } from "../code/index";
import { area, axisBottom, curveBasis, hsl, scaleLinear, select, symbol, symbolStar } from "d3";
import { generateSynthetic } from "../code/synthetic";
import { computeWiggleBaseline } from "../code/baseline";
import { PALETTE } from "./render";
import type { Layer, PipelineResult } from "../code/types";

const W = 560;
const H = 300;
const M = { top: 16, right: 14, bottom: 24, left: 46 };
const NS = "http://www.w3.org/2000/svg";

export type CompareMode = "braided" | "star" | "glow" | "color-blur";

export interface CompareInput {
  mode: CompareMode;
  layers: Layer[];
  times: string[];
  result: PipelineResult; // PID-ordered pipeline
}

/** shared y-domain across panels so all four use the same scale */
export function sharedYDomain(result: PipelineResult, times: string[]): [number, number] {
  const tLen = times.length;
  const n = result.braided.yBottomStar.length;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < n; i += 1) {
    for (let t = 0; t < tLen; t += 1) {
      const lo = result.braided.yBottomStar[i][t];
      const hi = result.braided.yTopStar[i][t];
      if (lo < yMin) yMin = lo;
      if (hi > yMax) yMax = hi;
    }
  }
  const pad = (yMax - yMin) * 0.08 || 1;
  return [yMin - pad, yMax + pad];
}

export function renderPanel(
  svg: SVGSVGElement,
  input: CompareInput,
  yDomain: [number, number]
): void {
  const { mode, layers, times, result } = input;
  const tLen = times.length;
  const n = result.pid.order.length;
  const [yMin, yMax] = yDomain;

  const x = scaleLinear().domain([0, Math.max(1, tLen - 1)]).range([M.left, W - M.right]);
  const y = scaleLinear().domain([yMin, yMax]).range([H - M.bottom, M.top]);
  const areaPath = (lo: number[], hi: number[], start = 0, end = tLen - 1) => area<number>()
    .curve(curveBasis).x((t) => x(t)).y0((t) => y(lo[t])).y1((t) => y(hi[t]))
    (Array.from({ length: end - start + 1 }, (_, index) => start + index)) ?? "";

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const defs = document.createElementNS(NS, "defs");
  svg.appendChild(defs);

  const step = Math.max(1, Math.ceil(tLen / 8));
  const xTicks = Array.from({ length: Math.ceil(tLen / step) }, (_, index) => index * step).filter((t) => t < tLen);
  const axisX = document.createElementNS(NS, "g");
  axisX.setAttribute("transform", `translate(0,${H - M.bottom})`);
  svg.appendChild(axisX);
  select(axisX).call(axisBottom(x).tickValues(xTicks).tickFormat((t) => times[Number(t)] ?? ""));
  axisX.querySelectorAll("text").forEach((label) => {
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#9ca3af");
  });

  const order = result.pid.order;
  const colorOf = (idx: number): string => {
    const id = order[idx];
    const src = layers.find((l) => l.id === id);
    return src?.color ?? PALETTE[idx % PALETTE.length];
  };

  if (mode === "braided") {
    // layer bands with corridors (method)
    for (let i = 0; i < n; i += 1) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", areaPath(result.braided.yBottomStar[i], result.braided.yTopStar[i]));
      path.setAttribute("fill", colorOf(i));
      path.setAttribute("fill-opacity", "0.85");
      path.setAttribute("stroke", colorOf(i));
      path.setAttribute("stroke-width", "0.8");
      svg.appendChild(path);
    }
    return;
  }

  // base geometry (same layout for all three baselines)
  const base = computeWiggleBaseline(layers, order);
  const segLen = Math.max(1, Math.ceil(tLen / 14)); // segments for per-segment encoding

  for (let i = 0; i < n; i += 1) {
    const color = colorOf(i);
    const uRow = result.uncertainty.u[i];

    if (mode === "star") {
      // whole-layer fill + star glyphs sized by u
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", areaPath(base.yBottom[i], base.yTop[i]));
      path.setAttribute("fill", color);
      path.setAttribute("fill-opacity", "0.82");
      svg.appendChild(path);
      // stars every 6 steps at the vertical center of the band
      for (let t = 0; t < tLen; t += 6) {
        const u = uRow[t];
        const r = 1.5 + 9 * u;
        if (r < 2) continue;
        const cy = y((base.yBottom[i][t] + base.yTop[i][t]) / 2);
        const star = document.createElementNS(NS, "path");
        star.setAttribute("d", symbol().type(symbolStar).size(r * r * 7)() ?? "");
        star.setAttribute("transform", `translate(${x(t)},${cy})`);
        star.setAttribute("fill", color);
        star.setAttribute("fill-opacity", "0.9");
        star.setAttribute("stroke", "#ffffff");
        star.setAttribute("stroke-width", "0.8");
        svg.appendChild(star);
      }
      continue;
    }

    // segment paths (shared by glow and color-blur)
    for (let s = 0; s < tLen; s += segLen) {
      const t0 = s;
      const t1 = Math.min(tLen - 1, s + segLen);
      let uSeg = 0;
      for (let t = t0; t <= t1; t += 1) uSeg += uRow[t];
      uSeg /= Math.max(1, t1 - t0 + 1);

      const d = areaPath(base.yBottom[i], base.yTop[i], t0, t1);

      if (mode === "glow") {
        // halo: blurred wide stroke on the segment outline
        const fill = document.createElementNS(NS, "path");
        fill.setAttribute("d", d);
        fill.setAttribute("fill", color);
        fill.setAttribute("fill-opacity", "0.82");
        svg.appendChild(fill);
        const fid = `glow-${i}-${s}`;
        const filter = document.createElementNS(NS, "filter");
        filter.setAttribute("id", fid);
        filter.setAttribute("x", "-60%");
        filter.setAttribute("y", "-60%");
        filter.setAttribute("width", "220%");
        filter.setAttribute("height", "220%");
        const blur = document.createElementNS(NS, "feGaussianBlur");
        blur.setAttribute("stdDeviation", String(2 + 10 * uSeg));
        filter.appendChild(blur);
        defs.appendChild(filter);
        const halo = document.createElementNS(NS, "path");
        halo.setAttribute("d", d);
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", color);
        halo.setAttribute("stroke-width", String(3 + 14 * uSeg));
        halo.setAttribute("stroke-opacity", String(0.25 + 0.55 * uSeg));
        halo.setAttribute("filter", `url(#${fid})`);
        svg.appendChild(halo);
      } else {
        // color-blur: segment saturation ∝ u; layer blur ∝ mean u
        let uMean = 0;
        for (let t = 0; t < tLen; t += 1) uMean += uRow[t];
        uMean /= tLen;
        const { h, l } = hsl(color);
        const sat = Math.min(100, 12 + 78 * uSeg);
        const fillColor = `hsl(${h}, ${sat.toFixed(0)}%, ${(l * 100).toFixed(0)}%)`;
        const fid = `blur-${i}`;
        if (!defs.querySelector(`#${fid}`)) {
          const filter = document.createElementNS(NS, "filter");
          filter.setAttribute("id", fid);
          filter.setAttribute("x", "-20%");
          filter.setAttribute("y", "-20%");
          filter.setAttribute("width", "140%");
          filter.setAttribute("height", "140%");
          const blur = document.createElementNS(NS, "feGaussianBlur");
          blur.setAttribute("stdDeviation", String(0.4 + 3.2 * uMean));
          filter.appendChild(blur);
          defs.appendChild(filter);
        }
        const seg = document.createElementNS(NS, "path");
        seg.setAttribute("d", d);
        seg.setAttribute("fill", fillColor);
        seg.setAttribute("fill-opacity", "0.85");
        seg.setAttribute("filter", `url(#${fid})`);
        svg.appendChild(seg);
      }
    }
  }
}

/** export one panel svg as a standalone file */
export function exportPanelSvg(svg: SVGElement, filename: string): void {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", NS);
  clone.setAttribute("width", String(W));
  clone.setAttribute("height", String(H));
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type { Layer, PipelineResult };

/** Auto-init when the compare page is present. */
export function initCompare(): void {
  const host = document.getElementById("compare-grid");
  if (!host) return;
  const { layers } = generateSynthetic({ seed: 20260811 });
  const times = Array.from({ length: layers[0].q.p50.length }, (_, t) => `t${t}`);
  const yExtent = Math.max(1, layers.reduce((acc, l) => {
    let m = 0;
    for (const v of l.q.p50) if (v > m) m = v;
    return acc + m;
  }, 0));
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
  const domain = sharedYDomain(result, times);

  const modes: { id: string; mode: CompareMode; title: string; note: string }[] = [
    { id: "cmp-braided", mode: "braided", title: "Braided (method)", note: "corridor amplitude + oscillation frequency ∝ u; q50 thickness preserved" },
    { id: "cmp-star", mode: "star", title: "Star markers", note: "glyph size ∝ u at band center; thickness untouched" },
    { id: "cmp-glow", mode: "glow", title: "Glow halo", note: "blurred boundary glow, width/opacity ∝ u" },
    { id: "cmp-color", mode: "color-blur", title: "Color + blur", note: "segment fill saturation ∝ u; layer blur ∝ mean u" },
  ];

  for (const spec of modes) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const title = document.createElement("div");
    title.className = "cell-title";
    title.textContent = spec.title;
    const svg = document.createElementNS(NS, "svg");
    svg.id = spec.id;
    svg.setAttribute("role", "img");
    const note = document.createElement("div");
    note.className = "cell-note";
    note.textContent = spec.note;
    const btn = document.createElement("button");
    btn.textContent = "SVG";
    btn.className = "cell-export";
    btn.addEventListener("click", () => exportPanelSvg(svg, `compare-${spec.mode}.svg`));
    const header = document.createElement("div");
    header.className = "cell-header";
    header.appendChild(title);
    header.appendChild(btn);
    cell.appendChild(header);
    cell.appendChild(svg);
    cell.appendChild(note);
    host.appendChild(cell);
    renderPanel(svg, { mode: spec.mode, layers, times, result }, domain);
  }

  // shared legend
  const legend = document.getElementById("cmp-legend");
  if (legend) {
    const order = result.pid.order;
    legend.innerHTML = order
      .map((id, idx) => {
        const src = layers.find((l) => l.id === id);
        const color = src?.color ?? PALETTE[idx % PALETTE.length];
        return `<span class="sw" style="background:${color}"></span>${id}`;
      })
      .join("&nbsp;&nbsp;");
  }
}

initCompare();
