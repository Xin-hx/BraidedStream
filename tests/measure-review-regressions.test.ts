import { describe, expect, it } from "vitest";
import { validateInput, type ProbabilityMeasure } from "../code/input";
import { analyzeDistribution, analysisOverlap, buildAnalysisDistribution } from "../code/engine/braided";
import { measureCdf, measureMoments, measureQuantile } from "../code/engine/measure";

const atom = (value: number, mass = 1) => ({ kind: "atom" as const, value, mass });
const uniform = (low: number, high: number, mass = 1) => ({ kind: "uniform" as const, low, high, mass });
const measure = (...components: ProbabilityMeasure["components"]): ProbabilityMeasure => ({ components });

describe("verified measure review regressions", () => {
  it("M1 computes centered variance without catastrophic cancellation", () => {
    expect(measureMoments(measure(atom(1e9, 0.5), atom(1e9 + 1, 0.5))))
      .toEqual({ mean: 1e9 + 0.5, variance: 0.25, standardDeviation: 0.5 });
    expect(measureMoments(measure(atom(1e200))))
      .toEqual({ mean: 1e200, variance: 0, standardDeviation: 0 });
    expect(() => measureMoments(measure(uniform(0, 1e308))))
      .toThrow(/variance.*finite|represent/i);
  });

  it("M2 preserves the exact lower inverse and distinguishes near-half masses", () => {
    expect(measureQuantile(measure(atom(0, 0.499999999999995), atom(1, 0.500000000000005)), 0.5)).toBe(1);
    expect(measureQuantile(measure(atom(0, 0.500000000000005), atom(1, 0.499999999999995)), 0.5)).toBe(0);
    const tenEqualAtoms = measure(...Array.from({ length: 10 }, (_, value) => atom(value, 0.1)));
    expect(measureQuantile(tenEqualAtoms, 0.5)).toBe(4);
  });

  it("M3 does not merge adjacent intervals with materially different tiny densities", () => {
    const normalized = validateInput({
      times: ["t"],
      layers: [{ id: "a", measures: [measure(
        uniform(0, 1e15, 0.9),
        uniform(1e15, 2e15, 0.1),
      )] }],
    }).layers[0].measures[0]!;
    expect(measureCdf(normalized, 1e15)).toBeCloseTo(0.9, 14);
    expect(normalized.components).toHaveLength(2);
  });

  it("M4 finds narrow modes on translated support", () => {
    const result = analyzeDistribution(measure(atom(1000, 0.5), atom(1001, 0.5)), 0.3)!;
    expect(result.modes).toHaveLength(2);
    expect(result.modes[0].location).toBeCloseTo(1000, 1);
    expect(result.modes[1].location).toBeCloseTo(1001, 1);
  });

  it("M4 keeps TPID overlap integration accurate after translating narrow measures", () => {
    const base = buildAnalysisDistribution(measure(atom(100, 0.5), atom(101, 0.5)), 0.3)!;
    const shifted = buildAnalysisDistribution(measure(atom(1100, 0.5), atom(1101, 0.5)), 0.3)!;
    expect(shifted.summary.kdeMedian - base.summary.kdeMedian).toBeCloseTo(1000, 8);
    expect(shifted.quantile(0.25) - base.quantile(0.25)).toBeCloseTo(1000, 8);
    expect(analysisOverlap(shifted, shifted) - analysisOverlap(base, base)).toBeCloseTo(1000, 6);
  });
});
