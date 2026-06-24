/**
 * SVG path generation for streamgraph bands.
 *
 * The public factory `createAreaPath` dispatches between three styles:
 *   1. raw linear          — d3.curveLinear, no smoothing.
 *   2. shape-preserving    — PCHIP (piecewise cubic Hermite) with monotonicity
 *      constraints and local-extrema flattening, applied independently to the
 *      bottom and top curves.
 *   3. jagged-edge         — triangle-wave noise modulated by per-time uncertainty.
 *
 * ── PCHIP interpolation ─────────────────────────────────────────────────────
 *
 * Why PCHIP?  It preserves the shape of the data better than Catmull-Rom or
 * natural cubic splines: no overshoot beyond the data y-range within each
 * segment, and local monotonicity is enforced so that the curve never "wiggles"
 * where the data is monotonic.
 *
 * The algorithm proceeds in four stages inside `evaluateShapePreservingSpline`:
 *
 *   Stage 1 — PCHIP slopes (Fritsch-Carlson 1980)
 *     For each interior data point i, compute the secant slopes d[i-1] and d[i].
 *     If they have opposite signs, slope m[i] = 0 (flat at inflection).  Otherwise
 *     m[i] is the harmonic-mean weighted slope that preserves monotonicity.
 *     Endpoint slopes use a one-sided quadratic formula.
 *
 *   Stage 2 — Local-extrema flattening
 *     Any data point that is a local maximum or minimum gets its slope forced to
 *     0.  This prevents the spline from "overshooting" flat peaks / troughs —
 *     a common failure mode of cubic interpolation on noisy data.
 *
 *   Stage 3 — Interval monotonicity enforcement (Fritsch-Carlson constraints)
 *     Within each interval [x_i, x_{i+1}], if the data values are monotonic,
 *     the Hermite tangents m[i], m[i+1] are scaled so that each tangent's ratio
 *     to the secant slope satisfies α² + β² ≤ 9.  This guarantees the cubic
 *     Hermite polynomial has no interior extremum.  When the secant slope is
 *     (near-)zero, both tangents are forced to 0 (flat plateau).
 *
 *   Stage 4 — Hermite evaluation
 *     Each interval is subdivided into `substeps` equally-spaced sub-points.
 *     The cubic Hermite basis functions h00…h11 are evaluated at each
 *     normalised u ∈ [0,1], and the result is clamped to [min(y0,y1), max(y0,y1)]
 *     as a final safety net.
 *
 * ⚠ Known limitation: the bottom and top curves of the same layer are
 *   interpolated independently.  When a layer's thickness changes sharply
 *   (e.g. a sudden onset from 0 to a large value, common in sine_bank data),
 *   the independently-computed PCHIP slopes can cause the interpolated top
 *   to dip below the bottom at sub-sample points.  A paired-interpolation
 *   (smoothing the thickness curve separately) would be more robust; the
 *   per-segment clamping mitigates but does not eliminate this risk.
 *
 * ── Jagged-edge mode ────────────────────────────────────────────────────────
 *
 * When `jagged: true`, each point along the top and bottom boundaries is
 * displaced in screen-space by a pseudo-random triangle-wave signal whose
 * amplitude is proportional to the layer's local uncertainty.  This produces
 * a "fuzzy" edge that communicates uncertainty visually.  The noise seed is
 * derived from a hash of the layer id so that it is reproducible across
 * renders.
 */

import * as d3 from "d3";
import { clamp, clamp01, nearlyEqual, percentile, withFixedSeed } from "../core/utils";

export interface AreaPathOptions {
  /** Enable triangle-wave noise modulation for uncertainty edges. */
  jagged?: boolean;
  /** Use PCHIP shape-preserving spline between data points. */
  smoothInterpolation?: boolean;
  /** Number of sub-sample points inserted between each pair of data points. */
  interpolationSubsteps?: number;
  /** Jagged-mode amplitude ceiling in pixels. */
  amplitudePx?: number;
  /** Jagged-mode base frequency. */
  frequency?: number;
  /** Human-readable seed component (mixed with fixedSeed). */
  seed?: string;
  /** Deterministic seed for reproducible noise. */
  fixedSeed?: number;
  /** Per-time uncertainty values driving jagged amplitude. */
  uncertainty?: number[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/** Create one closed area path for a layer band. */
export function createAreaPath(
  times: number[],
  yBottom: number[],
  yTop: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  options?: AreaPathOptions
): string {
  if (options?.jagged) {
    return createJaggedAreaPath(times, yBottom, yTop, xScale, yScale, options);
  }
  if (options?.smoothInterpolation) {
    return createSmoothedAreaPath(times, yBottom, yTop, xScale, yScale, options.interpolationSubsteps ?? 2);
  }
  // Fallback: piecewise-linear — fastest, no smoothing artefacts.
  const area = d3
    .area<number>()
    .x((_, i) => xScale(times[i]))
    .y0((_, i) => yScale(yBottom[i]))
    .y1((_, i) => yScale(yTop[i]))
    .curve(d3.curveLinear);

  return area(times) ?? "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Smoothed (PCHIP) path
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a smoothed area path by upsampling the bottom and top curves via
 * shape-preserving PCHIP splines, then connecting the dense samples with
 * linear segments.
 */
function createSmoothedAreaPath(
  times: number[],
  yBottom: number[],
  yTop: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  interpolationSubsteps: number
): string {
  if (times.length < 2) {
    const fallback = d3
      .area<number>()
      .x((_, i) => xScale(times[i]))
      .y0((_, i) => yScale(yBottom[i]))
      .y1((_, i) => yScale(yTop[i]))
      .curve(d3.curveLinear);
    return fallback(times) ?? "";
  }

  const substeps = Math.max(2, Math.floor(interpolationSubsteps));
  const bottomDense = evaluateShapePreservingSpline(times, yBottom, substeps);
  const topDense = evaluateShapePreservingSpline(times, yTop, substeps);

  const area = d3
    .area<number>()
    .x((_, i) => xScale(bottomDense.x[i]))
    .y0((_, i) => yScale(bottomDense.y[i]))
    .y1((_, i) => yScale(topDense.y[i]))
    .curve(d3.curveLinear); // dense-enough samples make linear segments invisible

  return area(bottomDense.x as unknown as number[]) ?? "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PCHIP evaluation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upsample a single curve (x, y) using a shape-preserving PCHIP spline.
 *
 * Returns dense {x, y} arrays with `substeps` equally-spaced sub-points
 * inserted between each pair of original data points.
 */
function evaluateShapePreservingSpline(
  x: number[],
  y: number[],
  interpolationSubsteps: number
): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length);
  if (n === 0) {
    return { x: [], y: [] };
  }
  if (n === 1) {
    return { x: [x[0]], y: [y[0]] };
  }

  const xs = x.slice(0, n);
  const ys = y.slice(0, n);

  // ── interval widths (h) and secant slopes (d) ───────────────────────────
  const h = new Array<number>(n - 1).fill(0);
  const d = new Array<number>(n - 1).fill(0);
  for (let i = 0; i < n - 1; i += 1) {
    const dt = Math.max(1e-9, xs[i + 1] - xs[i]);
    h[i] = dt;
    d[i] = (ys[i + 1] - ys[i]) / dt;
  }

  // ── Stage 1: PCHIP slopes ───────────────────────────────────────────────
  const m = computePchipSlopes(h, d);

  // ── Stage 2: flatten local extrema ──────────────────────────────────────
  const extrema = findLocalExtrema(ys);
  for (const idx of extrema) {
    m[idx] = 0;
  }
  // Also flatten zero-slope plateaus.
  for (let i = 0; i < n - 1; i += 1) {
    if (nearlyEqual(ys[i], ys[i + 1], 1e-9)) {
      m[i] = 0;
      m[i + 1] = 0;
    }
  }

  // ── Stage 3: Fritsch-Carlson monotonicity ───────────────────────────────
  enforceMonotonicIntervalConstraints(m, d);

  // ── Stage 4: Hermite evaluation per segment ─────────────────────────────
  const outX: number[] = [];
  const outY: number[] = [];
  const substeps = Math.max(2, Math.floor(interpolationSubsteps));

  for (let i = 0; i < n - 1; i += 1) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const y0 = ys[i];
    const y1 = ys[i + 1];
    const dt = h[i];
    const low = Math.min(y0, y1);
    const high = Math.max(y0, y1);

    for (let s = 0; s < substeps; s += 1) {
      const u = s / substeps;
      const xx = x0 + (x1 - x0) * u;
      let yy: number;
      if (nearlyEqual(y0, y1, 1e-9)) {
        yy = y0; // constant segment — skip Hermite to avoid needless computation
      } else {
        yy = hermiteAt(y0, y1, m[i], m[i + 1], dt, u);
      }
      // Final clamp: guarantee no out-of-bounds value escapes.
      outX.push(xx);
      outY.push(clamp(yy, low, high));
    }
  }

  // Append the last data point exactly.
  outX.push(xs[n - 1]);
  outY.push(ys[n - 1]);

  return { x: outX, y: outY };
}

/**
 * Compute PCHIP (Fritsch-Carlson) slopes.
 *
 * For interior points, slope m[i] is the harmonic mean of the left and right
 * secant slopes d[i-1] and d[i], weighted by interval widths:
 *
 *   m[i] = (w₁ + w₂) / (w₁/d₀ + w₂/d₁)   where w₁=2h[i]+h[i-1], w₂=h[i]+2h[i-1]
 *
 * If d₀ and d₁ have opposite signs, m[i] = 0 (the point is a local extremum
 * in the piecewise-linear sense).
 */
function computePchipSlopes(h: number[], d: number[]): number[] {
  const n = d.length + 1;
  const m = new Array<number>(n).fill(0);

  if (n === 2) {
    // Only two points: both endpoints share the single secant slope.
    m[0] = d[0];
    m[1] = d[0];
    return m;
  }

  for (let i = 1; i < n - 1; i += 1) {
    const d0 = d[i - 1];
    const d1 = d[i];
    if (d0 === 0 || d1 === 0 || d0 * d1 < 0) {
      m[i] = 0;
      continue;
    }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
  }

  // Endpoint slopes via one-sided quadratic formula.
  m[0] = endpointSlope(h[0], h[1], d[0], d[1]);
  m[n - 1] = endpointSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  return m;
}

/** One-sided quadratic slope estimate for curve endpoints. */
function endpointSlope(h0: number, h1: number, d0: number, d1: number): number {
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / Math.max(1e-9, h0 + h1);
  // Clamp: must not point opposite the one-sided secant slope.
  if (m * d0 <= 0) {
    m = 0;
  } else if (d0 * d1 < 0 && Math.abs(m) > 3 * Math.abs(d0)) {
    m = 3 * d0;
  }
  return m;
}

/**
 * Fritsch-Carlson monotonicity constraints on each Hermite interval.
 *
 * For a monotonic interval (secant slope d ≠ 0), the tangent magnitudes
 * are scaled so that α² + β² ≤ 9 where α = m[i]/d, β = m[i+1]/d.
 * This is necessary and sufficient for a cubic Hermite polynomial to be
 * monotonic on [0,1].
 *
 * When d ≈ 0 (flat segment), both tangents are forced to 0.
 */
function enforceMonotonicIntervalConstraints(m: number[], d: number[]): void {
  for (let i = 0; i < d.length; i += 1) {
    const di = d[i];
    if (nearlyEqual(di, 0, 1e-9)) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }

    // Tangents must point in the same direction as the secant.
    if (m[i] * di < 0) {
      m[i] = 0;
    }
    if (m[i + 1] * di < 0) {
      m[i + 1] = 0;
    }

    // Scale down to the Fritsch-Carlson ellipse: α² + β² ≤ 9.
    const a = m[i] / di;
    const b = m[i + 1] / di;
    const norm2 = a * a + b * b;
    if (norm2 > 9) {
      const tau = 3 / Math.sqrt(norm2);
      m[i] = tau * a * di;
      m[i + 1] = tau * b * di;
    }
  }
}

/** Find indices where the data has a strict local extremum (peak or valley). */
function findLocalExtrema(y: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < y.length - 1; i += 1) {
    const left = y[i] - y[i - 1];
    const right = y[i + 1] - y[i];
    if ((left > 0 && right < 0) || (left < 0 && right > 0)) {
      out.push(i);
    }
  }
  return out;
}

/**
 * Evaluate the cubic Hermite polynomial at parameter u ∈ [0,1].
 *
 *   H(u) = h00(u)·y0 + h10(u)·h·m0 + h01(u)·y1 + h11(u)·h·m1
 *
 * where h00…h11 are the standard Hermite basis functions.
 */
function hermiteAt(y0: number, y1: number, m0: number, m1: number, h: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Jagged-edge (uncertainty) path
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create area path with noise-modulated top/bottom edges.
 *
 * Each edge point is displaced in screen y by a triangle-wave signal whose
 * amplitude scales with the layer's local uncertainty percentile.  The top
 * edge noise and bottom edge noise use independent pseudo-random seeds so
 * the two boundaries vary independently.
 */
function createJaggedAreaPath(
  times: number[],
  yBottom: number[],
  yTop: number[],
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  options: AreaPathOptions
): string {
  const amp = Math.max(0, options.amplitudePx ?? 0);
  const freq = Math.max(0.1, options.frequency ?? 1);
  const unc = options.uncertainty ?? [];
  const scale = robustScale(unc);
  const seedBase = hash32(withFixedSeed(options.seed ?? "jagged", options.fixedSeed));

  // Top edge: displace upward (negative y in SVG).
  const topPixels = yTop.map((v, i) => {
    const x = xScale(times[i]);
    const y = yScale(v);
    const ratio = scale > 0 ? clamp01((unc[i] ?? 0) / scale) : 0;
    const noise = triangleWave(i * freq + pseudo(seedBase, i) * 2) * amp * ratio;
    return [x, y - noise] as const;
  });
  // Bottom edge: displace downward (positive y), top-bottom seeds differ.
  const bottomPixels = yBottom.map((v, i) => {
    const x = xScale(times[i]);
    const y = yScale(v);
    const ratio = scale > 0 ? clamp01((unc[i] ?? 0) / scale) : 0;
    const noise = triangleWave(i * freq + pseudo(seedBase ^ 0x9e3779b9, i) * 2) * amp * ratio;
    return [x, y + noise] as const;
  });

  const topLine = d3
    .line<readonly [number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .curve(d3.curveLinear);
  const bottomLine = d3
    .line<readonly [number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .curve(d3.curveLinear);

  const topPath = topLine(topPixels) ?? "";
  const bottomPath = bottomLine(bottomPixels.slice().reverse()) ?? "";
  if (topPath === "" || bottomPath === "") {
    return "";
  }
  return `${topPath} ${bottomPath} Z`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Noise helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Triangle wave in [-1, 1] with period 1. */
function triangleWave(v: number): number {
  const t = v - Math.floor(v);
  return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
}

/** 90th-percentile robust scale for noise modulation. */
function robustScale(values: number[]): number {
  return Math.max(0, percentile(values, 0.9));
}

/** FNV-1a 32-bit hash for reproducible pseudo-random seeds. */
function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Simple pseudo-random in [0,1) from a 32-bit seed and index. */
function pseudo(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 1103515245)) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967295;
}
