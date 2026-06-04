/**
 * SVG path generation for streamgraph bands.
 *
 * The public factory chooses between raw, shape-preserving smoothed, and
 * uncertainty-jagged paths; helper functions keep geometry and noise separate.
 */
import * as d3 from "d3";
import { withFixedSeed } from "../core/seed";
import { clamp, clamp01, nearlyEqual, percentile } from "../core/utils";
/** Create one closed area path for a layer band. */
export function createAreaPath(times, yBottom, yTop, xScale, yScale, options) {
    if (options?.jagged) {
        return createJaggedAreaPath(times, yBottom, yTop, xScale, yScale, options);
    }
    if (options?.smoothInterpolation) {
        return createSmoothedAreaPath(times, yBottom, yTop, xScale, yScale, options.interpolationSubsteps ?? 2);
    }
    const area = d3
        .area()
        .x((_, i) => xScale(times[i]))
        .y0((_, i) => yScale(yBottom[i]))
        .y1((_, i) => yScale(yTop[i]))
        // Keep temporal geometry at raw sample granularity (no smooth interpolation).
        .curve(d3.curveLinear);
    return area(times) ?? "";
}
function createSmoothedAreaPath(times, yBottom, yTop, xScale, yScale, interpolationSubsteps) {
    if (times.length < 2) {
        const fallback = d3
            .area()
            .x((_, i) => xScale(times[i]))
            .y0((_, i) => yScale(yBottom[i]))
            .y1((_, i) => yScale(yTop[i]))
            .curve(d3.curveLinear);
        return fallback(times) ?? "";
    }
    const substeps = Math.max(2, Math.floor(interpolationSubsteps));
    const bottomDense = evaluateShapePreservingSpline(times, yBottom, substeps);
    const topDense = evaluateShapePreservingSpline(times, yTop, substeps);
    const denseTimes = bottomDense.x;
    const denseBottom = bottomDense.y;
    const denseTop = topDense.y;
    const area = d3
        .area()
        .x((_, i) => xScale(denseTimes[i]))
        .y0((_, i) => yScale(denseBottom[i]))
        .y1((_, i) => yScale(denseTop[i]))
        // Use the computed spline samples directly to preserve constraints.
        .curve(d3.curveLinear);
    return area(denseTimes) ?? "";
}
function evaluateShapePreservingSpline(x, y, interpolationSubsteps) {
    const n = Math.min(x.length, y.length);
    if (n === 0) {
        return { x: [], y: [] };
    }
    if (n === 1) {
        return { x: [x[0]], y: [y[0]] };
    }
    const xs = x.slice(0, n);
    const ys = y.slice(0, n);
    const h = new Array(n - 1).fill(0);
    const d = new Array(n - 1).fill(0);
    for (let i = 0; i < n - 1; i += 1) {
        const dt = Math.max(1e-9, xs[i + 1] - xs[i]);
        h[i] = dt;
        d[i] = (ys[i + 1] - ys[i]) / dt;
    }
    const m = computePchipSlopes(h, d);
    const extrema = findLocalExtrema(ys);
    for (const idx of extrema) {
        m[idx] = 0;
    }
    for (let i = 0; i < n - 1; i += 1) {
        if (nearlyEqual(ys[i], ys[i + 1], 1e-9)) {
            m[i] = 0;
            m[i + 1] = 0;
        }
    }
    enforceMonotonicIntervalConstraints(m, d);
    const outX = [];
    const outY = [];
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
            let yy;
            if (nearlyEqual(y0, y1, 1e-9)) {
                yy = y0;
            }
            else {
                yy = hermiteAt(y0, y1, m[i], m[i + 1], dt, u);
            }
            outX.push(xx);
            outY.push(clamp(yy, low, high));
        }
    }
    outX.push(xs[n - 1]);
    outY.push(ys[n - 1]);
    return { x: outX, y: outY };
}
function computePchipSlopes(h, d) {
    const n = d.length + 1;
    const m = new Array(n).fill(0);
    if (n === 2) {
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
    m[0] = endpointSlope(h[0], h[1], d[0], d[1]);
    m[n - 1] = endpointSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    return m;
}
function endpointSlope(h0, h1, d0, d1) {
    let m = ((2 * h0 + h1) * d0 - h0 * d1) / Math.max(1e-9, h0 + h1);
    if (m * d0 <= 0) {
        m = 0;
    }
    else if (d0 * d1 < 0 && Math.abs(m) > 3 * Math.abs(d0)) {
        m = 3 * d0;
    }
    return m;
}
function enforceMonotonicIntervalConstraints(m, d) {
    for (let i = 0; i < d.length; i += 1) {
        const di = d[i];
        if (nearlyEqual(di, 0, 1e-9)) {
            m[i] = 0;
            m[i + 1] = 0;
            continue;
        }
        if (m[i] * di < 0) {
            m[i] = 0;
        }
        if (m[i + 1] * di < 0) {
            m[i + 1] = 0;
        }
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
function findLocalExtrema(y) {
    const out = [];
    for (let i = 1; i < y.length - 1; i += 1) {
        const left = y[i] - y[i - 1];
        const right = y[i + 1] - y[i];
        if ((left > 0 && right < 0) || (left < 0 && right > 0)) {
            out.push(i);
        }
    }
    return out;
}
function hermiteAt(y0, y1, m0, m1, h, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}
function createJaggedAreaPath(times, yBottom, yTop, xScale, yScale, options) {
    const amp = Math.max(0, options.amplitudePx ?? 0);
    const freq = Math.max(0.1, options.frequency ?? 1);
    const unc = options.uncertainty ?? [];
    const scale = robustScale(unc);
    const seedBase = hash32(withFixedSeed(options.seed ?? "jagged", options.fixedSeed));
    const topPixels = yTop.map((v, i) => {
        const x = xScale(times[i]);
        const y = yScale(v);
        const ratio = scale > 0 ? clamp01((unc[i] ?? 0) / scale) : 0;
        const noise = triangleWave(i * freq + pseudo(seedBase, i) * 2) * amp * ratio;
        return [x, y - noise];
    });
    const bottomPixels = yBottom.map((v, i) => {
        const x = xScale(times[i]);
        const y = yScale(v);
        const ratio = scale > 0 ? clamp01((unc[i] ?? 0) / scale) : 0;
        const noise = triangleWave(i * freq + pseudo(seedBase ^ 0x9e3779b9, i) * 2) * amp * ratio;
        return [x, y + noise];
    });
    const topLine = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveLinear);
    const bottomLine = d3
        .line()
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
function triangleWave(v) {
    const t = v - Math.floor(v);
    return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
}
function robustScale(values) {
    return Math.max(0, percentile(values, 0.9));
}
function hash32(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function pseudo(seed, i) {
    let x = (seed ^ Math.imul(i + 1, 1103515245)) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967295;
}
