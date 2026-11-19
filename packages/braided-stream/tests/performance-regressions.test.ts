import { describe, expect, it, vi } from "vitest";
import { preparePipeline, runPipeline, type InputDataset, type ProbabilityMeasure } from "braided-stream/core";
import { measureCdf, measureQuantile, measureQuantiles } from "../src/engine/measure";
import { analysisOverlap, buildAnalysisDistribution } from "../src/engine/braided";
import { computePidFromAnalysis } from "../src/engine/pid";
import { interpolateBraidedGeometry } from "../src/render";

const dataset: InputDataset = {
  times: ["t0", "t1", "t2"],
  layers: ["b", "a"].map((id, index) => ({ id, measures: [1, 2, 3].map(value => ({ components: [
    { kind: "atom", value, mass: .3 }, { kind: "uniform", low: value, high: value + 2 + index, mass: .7 },
  ] })) })),
};

function referenceQuantile(measure: ProbabilityMeasure, p: number): number {
  const xs = [...new Set(measure.components.flatMap(c => c.kind === "atom" ? [c.value] : [c.low, c.high]))].sort((a, b) => a - b);
  if (p === 0) return xs[0];
  for (let i = 0; i < xs.length; i++) {
    const cdf = measureCdf(measure, xs[i]);
    if (cdf >= p) return xs[i];
    if (i + 1 === xs.length) return xs[i];
    const density = measure.components.reduce((s, c) => s + (c.kind === "uniform" && c.low <= xs[i] && c.high >= xs[i + 1] ? c.mass / (c.high - c.low) : 0), 0);
    if (density > 0 && cdf + density * (xs[i + 1] - xs[i]) >= p) return Math.min(xs[i + 1], xs[i] + (p - cdf) / density);
  }
  return xs.at(-1)!;
}

describe("exact performance optimizations", () => {
  it("matches direct CDF inversion for weighted atoms, overlaps, plateaus and reordered components", () => {
    let seed = 17;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let trial = 0; trial < 100; trial++) {
      const parts = Array.from({ length: 20 }, (_, i) => {
        const low = Math.floor(random() * 10);
        return i % 2 ? { kind: "atom" as const, value: low, mass: 1 + Math.floor(random() * 10) }
          : { kind: "uniform" as const, low, high: low + 1 + Math.floor(random() * 5), mass: 1 + Math.floor(random() * 10) };
      });
      const total = parts.reduce((s, part) => s + part.mass, 0);
      const measure = { components: parts.map(part => ({ ...part, mass: part.mass / total })) };
      const ps = [1, .975, .5, 0, .025, .1, .25, .75, .9];
      const values = measureQuantiles(measure, ps);
      ps.forEach((p, i) => expect(values[i]).toBeCloseTo(referenceQuantile(measure, p), 11));
      expect(measureQuantiles({ components: [...measure.components].reverse() }, ps)).toEqual(values);
    }
    expect(measureQuantile({ components: [{ kind: "atom", value: 0, mass: .5 }, { kind: "atom", value: 20, mass: .5 }] }, .5)).toBe(0);
    expect(() => measureQuantiles(dataset.layers[0].measures[0]!, [Number.NaN])).toThrow(/probability/);
  });

  it("reuses bandwidth analysis for layout changes and invalidates it for bandwidth changes", () => {
    const prepared = preparePipeline(dataset);
    const first = prepared.run({ braided: { debug: true } });
    const changed = prepared.run({ baselineMode: "sine", layoutOrder: ["a", "b"], braided: { debug: true } });
    expect(changed.pid).toBe(first.pid);
    expect(changed).toEqual(runPipeline(dataset, { baselineMode: "sine", layoutOrder: ["a", "b"], braided: { debug: true } }));
    expect(prepared.run({ braided: { bandwidthRatio: .8 } }).pid).not.toBe(first.pid);
    expect(() => prepared.run({ layoutOrder: ["a", "a"] })).toThrow(/each layer/);
    expect(() => prepared.run({ braided: { bandwidthRatio: 0 } })).toThrow(/positive/);
  });

  it("keeps finite quantiles when an interval density overflows", () => {
    const result = measureQuantiles({ components: [{ kind: "uniform", low: 0, high: 1e-310, mass: 1 }] }, [0, .25, .5, 1]);
    result.forEach((value, i) => expect(value / 1e-310).toBeCloseTo([0, .25, .5, 1][i], 10));
  });

  it("owns an independent snapshot and retains missing observations", () => {
    const mutable = structuredClone(dataset) as { times: string[]; layers: { id: string; measures: (ProbabilityMeasure | null)[] }[] };
    mutable.layers[0].measures[1] = null;
    const prepared = preparePipeline(mutable);
    const expected = runPipeline(mutable);
    mutable.layers[0].measures[0] = { components: [{ kind: "atom", value: 100, mass: 1 }] };
    expect(prepared.run()).toEqual(expected);
    expect(expected.braided.layers.find(layer => layer.layerId === "b")!.missing).toEqual([false, true, false]);
    expect(expected).not.toHaveProperty("densityProfiles");
  });

  it("shares exact survival evaluations without changing overlap quadrature", () => {
    const cell = buildAnalysisDistribution(dataset.layers[0].measures[0], .3)!;
    const other = buildAnalysisDistribution(dataset.layers[1].measures[0], .3)!;
    const survival = vi.fn(cell.survival);
    const a = { ...cell, survival };
    const overlap = analysisOverlap(a, a) + analysisOverlap(a, other);
    const directCalls = survival.mock.calls.length;
    survival.mockClear();
    const pid = computePidFromAnalysis(["a", "b"], [[a], [other]]);
    expect(pid.inclusionIn.a).toBeCloseTo(overlap / (2 * a.smoothedMean), 14);
    expect(survival.mock.calls.length).toBeLessThan(directCalls);
  });

  it("keeps envelope-only interpolation equivalent and preserves missing boundaries", () => {
    const result = runPipeline(dataset);
    const full = interpolateBraidedGeometry(result.braided, [0, 1, 3], 0, 2, 8, true);
    const simple = interpolateBraidedGeometry(result.braided, [0, 1, 3], 0, 2, 8, true, true);
    expect(simple.x).toEqual(full.x);
    simple.layers.forEach((layer, i) => {
      expect(layer.branches).toEqual([]);
      expect(layer.spaces).toEqual([]);
      expect(layer.defined).toEqual(full.layers[i].defined);
      layer.envelope.y0.forEach((value, sample) => expect(value).toBeCloseTo(full.layers[i].envelope.y0[sample], 12));
      layer.envelope.y1.forEach((value, sample) => expect(value).toBeCloseTo(full.layers[i].envelope.y1[sample], 12));
    });
  });
});
