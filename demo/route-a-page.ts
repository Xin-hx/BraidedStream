import {
  ROUTE_A_HEIGHT,
  ROUTE_A_MARGIN,
  ROUTE_A_WIDTH,
  createRouteAComparison,
  type RouteAComparison,
} from "../code/comparison";
import {
  GLARE_ALPHA,
  GLARE_THRESHOLD,
  detectGlareSources,
  glareKernel,
} from "../code/glare";
import {
  TWIST_KAPPA,
  buildTwistGeometry,
  foldCreases,
  twistG,
  twistPhase,
  twistStrength,
} from "../code/twist";

type Mode = "braided" | "zhou-glare" | "twist";
type Point = [number, number];

const NS = "http://www.w3.org/2000/svg";
const fixture = createRouteAComparison();
const mode = document.body.dataset.mode as Mode;
const svg = document.querySelector<SVGSVGElement>("#route-a-plot");
if (!svg || !["braided", "zhou-glare", "twist"].includes(mode)) {
  throw new Error("Route-A page is missing a valid plot or mode");
}

render(svg, mode, fixture);
document.querySelector("#export-svg")?.addEventListener("click", () => exportSvg(svg, `compare-${mode}.svg`));

function render(target: SVGSVGElement, selected: Mode, data: RouteAComparison): void {
  const { result, times } = data;
  const innerWidth = ROUTE_A_WIDTH - ROUTE_A_MARGIN.left - ROUTE_A_MARGIN.right;
  const innerHeight = ROUTE_A_HEIGHT - ROUTE_A_MARGIN.top - ROUTE_A_MARGIN.bottom;
  const x = (t: number) => ROUTE_A_MARGIN.left + (t / Math.max(1, times.length - 1)) * innerWidth;
  const y = (value: number) => {
    const [low, high] = data.yDomain;
    return ROUTE_A_MARGIN.top + (1 - (value - low) / (high - low)) * innerHeight;
  };

  target.setAttribute("viewBox", `0 0 ${ROUTE_A_WIDTH} ${ROUTE_A_HEIGHT}`);
  target.setAttribute("width", String(ROUTE_A_WIDTH));
  target.setAttribute("height", String(ROUTE_A_HEIGHT));
  target.replaceChildren();
  target.appendChild(node("rect", {
    x: ROUTE_A_MARGIN.left,
    y: ROUTE_A_MARGIN.top,
    width: innerWidth,
    height: innerHeight,
    rx: 3,
    fill: "#111827",
  }));
  drawAxes(target, data, x, y);

  const u = result.pid.order.map((id) => result.uncertainty.u[data.layers.findIndex((layer) => layer.id === id)]);
  if (selected === "braided") {
    drawBands(target, result.braided.yBottomStar, result.braided.yTopStar, data.colors, x, y);
  } else {
    drawBands(target, result.base.yBottom, result.base.yTop, data.colors, x, y);
    if (selected === "zhou-glare") drawGlare(target, data, u, x, y);
    else drawTwist(target, data, u, x, y);
  }
}

function drawBands(
  svg: SVGSVGElement,
  bottom: number[][],
  top: number[][],
  colors: string[],
  x: (t: number) => number,
  y: (value: number) => number
): void {
  for (let layer = 0; layer < bottom.length; layer += 1) {
    svg.appendChild(node("path", {
      d: bandPath(bottom[layer], top[layer], x, y),
      fill: colors[layer],
      "fill-opacity": 0.82,
      stroke: colors[layer],
      "stroke-width": 0.8,
      "stroke-opacity": 0.95,
    }));
  }
}

function drawGlare(
  svg: SVGSVGElement,
  data: RouteAComparison,
  u: number[][],
  x: (t: number) => number,
  y: (value: number) => number
): void {
  const carriers = data.result.base.yBottom.map((row, layer) =>
    row.map((low, t) => ({ x: x(t), y: y((low + data.result.base.yTop[layer][t]) / 2) }))
  );
  const sources = detectGlareSources(u, carriers, GLARE_THRESHOLD);
  const defs = node("defs");
  const bloom = node("radialGradient", { id: "glare-bloom", cx: "50%", cy: "50%", r: "50%" });
  for (const [offset, color, opacity] of [
    ["0%", "#ffffff", 1],
    ["18%", "#ffffff", 0.98],
    ["42%", "#fffbea", 0.72],
    ["72%", "#fff4c4", 0.22],
    ["100%", "#ffffff", 0],
  ] as const) bloom.appendChild(node("stop", { offset, "stop-color": color, "stop-opacity": opacity }));
  defs.appendChild(bloom);

  const bloomSoft = node("filter", { id: "glare-bloom-soft", x: "-60%", y: "-60%", width: "220%", height: "220%" });
  bloomSoft.appendChild(node("feGaussianBlur", { stdDeviation: 2.6 }));
  defs.appendChild(bloomSoft);
  const haloSoft = node("filter", { id: "glare-halo-soft", x: "-35%", y: "-35%", width: "170%", height: "170%" });
  haloSoft.appendChild(node("feGaussianBlur", { stdDeviation: 1.45 }));
  defs.appendChild(haloSoft);
  const coronaSoft = node("filter", { id: "glare-corona-soft", x: "-35%", y: "-35%", width: "170%", height: "170%" });
  coronaSoft.appendChild(node("feGaussianBlur", { stdDeviation: 1.2 }));
  defs.appendChild(coronaSoft);
  svg.appendChild(defs);

  const group = node("g");
  for (const source of sources) {
    const key = source.layer * 131 + source.time;
    const strength = source.strength * GLARE_ALPHA;
    const cyan = glareKernel(10, 0, key);
    const amber = glareKernel(16, 0, key);
    const sourceGroup = node("g", { style: "mix-blend-mode:screen" });
    const rays = node("g", { fill: "none", "stroke-linecap": "round" });
    for (let ray = 0; ray < 12; ray += 1) {
      const jitter = (((key + 11) * (ray + 3)) % 9 - 4) * 0.018;
      const angle = (2 * Math.PI * ray) / 12 - key * 0.73 / 12 + jitter;
      const length = 14 + ((key * 3 + ray * 7) % 12);
      const response = glareKernel(Math.cos(angle) * 12, Math.sin(angle) * 12, key).corona;
      rays.appendChild(node("line", {
        x1: source.x + Math.cos(angle) * 4,
        y1: source.y + Math.sin(angle) * 4,
        x2: source.x + Math.cos(angle) * length,
        y2: source.y + Math.sin(angle) * length,
        stroke: ray % 2 ? "#fef3c7" : "#bae6fd",
        "stroke-width": 0.7 + ((key + ray * 5) % 3) * 0.18,
        opacity: Math.min(0.46, strength * response * (8 + ((key + ray) % 5))),
      }));
    }
    const softRays = rays.cloneNode(true) as SVGGElement;
    softRays.setAttribute("filter", "url(#glare-corona-soft)");
    softRays.setAttribute("opacity", "0.55");
    softRays.setAttribute("stroke-width", "2.2");
    sourceGroup.append(softRays, rays);
    sourceGroup.appendChild(node("ellipse", {
      cx: source.x, cy: source.y, rx: 10.5, ry: 6.8,
      fill: "none", stroke: "#67e8f9", "stroke-width": 3.2,
      "stroke-linecap": "round", "stroke-dasharray": "13 6 7 10",
      transform: `rotate(${(key % 17) - 8} ${source.x} ${source.y})`,
      filter: "url(#glare-halo-soft)", opacity: strength * cyan.cyanHalo * 1.25,
    }));
    sourceGroup.appendChild(node("ellipse", {
      cx: source.x, cy: source.y, rx: 17, ry: 10.5,
      fill: "none", stroke: "#fbbf24", "stroke-width": 3.8,
      "stroke-linecap": "round", "stroke-dasharray": "17 9 10 16",
      transform: `rotate(${(key % 23) - 11} ${source.x} ${source.y})`,
      filter: "url(#glare-halo-soft)", opacity: strength * amber.amberHalo,
    }));
    sourceGroup.appendChild(node("circle", {
      cx: source.x, cy: source.y, r: 13,
      fill: "url(#glare-bloom)", filter: "url(#glare-bloom-soft)", opacity: 0.45 + strength * 0.58,
    }));
    sourceGroup.appendChild(node("circle", {
      cx: source.x, cy: source.y, r: 10.5,
      fill: "url(#glare-bloom)", opacity: 0.58 + strength * 0.58,
    }));
    sourceGroup.appendChild(node("circle", {
      cx: source.x, cy: source.y, r: source.carrierWidthPx / 2,
      fill: "#ffffff", opacity: Math.min(1, 0.68 + strength * 0.52),
    }));
    group.appendChild(sourceGroup);
  }
  svg.appendChild(group);
}

function drawTwist(
  svg: SVGSVGElement,
  data: RouteAComparison,
  u: number[][],
  x: (t: number) => number,
  y: (value: number) => number
): void {
  const base = data.result.base;
  const geometry = buildTwistGeometry(base, u);
  const defs = node("defs");
  svg.appendChild(defs);
  for (let layer = 0; layer < base.yBottom.length; layer += 1) {
    const clipId = `twist-band-${layer}`;
    const clip = node("clipPath", { id: clipId });
    clip.appendChild(node("path", { d: bandPath(base.yBottom[layer], base.yTop[layer], x, y) }));
    defs.appendChild(clip);
    const effects = node("g", { "clip-path": `url(#${clipId})` });
    effects.appendChild(node("path", {
      d: bandPath(geometry.innerBottom[layer], geometry.innerTop[layer], x, y),
      fill: data.colors[layer],
      "fill-opacity": 0.62,
      stroke: "#ffffff",
      "stroke-opacity": 0.25,
      "stroke-width": 0.8,
    }));
    const xiStops = [-1, -0.5, 0, 0.5, 1];
    for (let t = 0; t < data.times.length - 1; t += 3) {
      const t1 = Math.min(data.times.length - 1, t + 3);
      const tm = (t + t1) / 2;
      const phase = twistPhase(tm, data.times.length, layer);
      const strength = twistStrength((u[layer][t] + u[layer][t1]) / 2);
      for (let band = 0; band + 1 < xiStops.length; band += 1) {
        const xi0 = xiStops[band];
        const xi1 = xiStops[band + 1];
        const response = twistG((xi0 + xi1) / 2, phase) * strength;
        const p = (time: number, xi: number): Point => {
          const low = base.yBottom[layer][time];
          const high = base.yTop[layer][time];
          return [x(time), y((low + high) / 2 + xi * (high - low) / 2)];
        };
        effects.appendChild(node("path", {
          d: polygon([p(t, xi0), p(t1, xi0), p(t1, xi1), p(t, xi1)]),
          fill: response >= 0 ? "#ffffff" : "#000000",
          opacity: Math.min(0.28, Math.abs(response) * 0.42),
        }));
      }
    }
    const creases = foldCreases(data.times.length, layer, u[layer]);
    for (const c of creases) {
      const cx = x(c.t);
      const yTopPx = y(lerpAt(c.t, base.yTop[layer]));
      const yBottomPx = y(lerpAt(c.t, base.yBottom[layer]));
      const sNorm = c.strength / TWIST_KAPPA;
      const dir = c.direction;
      // highlight edge on the fold direction side
      effects.appendChild(node("rect", {
        x: cx + (dir > 0 ? 0 : -2), y: yTopPx, width: 2,
        height: Math.max(0, yBottomPx - yTopPx),
        fill: "#ffffff", opacity: 0.34 * sNorm,
      }));
      // projected shadow on the opposite edge
      effects.appendChild(node("rect", {
        x: cx + (dir > 0 ? -2.5 : 0.5), y: yTopPx, width: 2.5,
        height: Math.max(0, yBottomPx - yTopPx),
        fill: "#000000", opacity: 0.3 * sNorm,
      }));
      // the crease line itself
      effects.appendChild(node("line", {
        x1: cx, y1: yTopPx, x2: cx, y2: yBottomPx,
        stroke: "#ffffff", "stroke-width": 0.9, opacity: 0.6 * sNorm,
      }));
    }
    svg.appendChild(effects);
    svg.appendChild(node("path", {
      d: bandPath(geometry.outerBottom[layer], geometry.outerTop[layer], x, y),
      fill: "none", stroke: data.colors[layer], "stroke-width": 1.15,
    }));
  }
}

function drawAxes(
  svg: SVGSVGElement,
  data: RouteAComparison,
  x: (t: number) => number,
  y: (value: number) => number
): void {
  for (let k = 0; k <= 4; k += 1) {
    const value = data.yDomain[0] + (data.yDomain[1] - data.yDomain[0]) * k / 4;
    svg.appendChild(node("line", {
      x1: ROUTE_A_MARGIN.left, x2: ROUTE_A_WIDTH - ROUTE_A_MARGIN.right,
      y1: y(value), y2: y(value), stroke: "#ffffff", "stroke-opacity": 0.08,
    }));
  }
  const ticks = [0, 20, 40, 60, 80, 100, data.times.length - 1];
  for (const t of ticks) {
    const label = node("text", {
      x: x(t), y: ROUTE_A_HEIGHT - 7, "text-anchor": "middle",
      fill: "#64748b", "font-size": 9, "font-family": "monospace",
    });
    label.textContent = data.times[t];
    svg.appendChild(label);
  }
}

function bandPath(bottom: number[], top: number[], x: (t: number) => number, y: (v: number) => number): string {
  const points: Point[] = bottom.map((value, t) => [x(t), y(value)]);
  for (let t = top.length - 1; t >= 0; t -= 1) points.push([x(t), y(top[t])]);
  return polygon(points);
}

/** Linear interpolation of a per-time data row at a fractional time index. */
function lerpAt(tFrac: number, row: number[]): number {
  const t0 = Math.min(Math.max(0, Math.floor(tFrac)), Math.max(0, row.length - 1));
  const t1 = Math.min(row.length - 1, t0 + 1);
  return row[t0] + (row[t1] - row[t0]) * (tFrac - t0);
}

function polygon(points: Point[]): string {
  return `${linePath(points)} Z`;
}

function linePath(points: Point[]): string {
  return points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
}

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function exportSvg(source: SVGSVGElement, filename: string): void {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", NS);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
