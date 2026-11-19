import { describe, expect, it } from "vitest";
import { runPipeline } from "braided-stream/core";
import type { InputDataset, ProbabilityMeasure } from "braided-stream/core";

const atom = (value: number, mass = 1) => ({ kind: "atom" as const, value, mass });
const uniform = (low: number, high: number, mass = 1) => ({ kind: "uniform" as const, low, high, mass });
const measure = (...components: ProbabilityMeasure["components"]): ProbabilityMeasure => ({ components });

describe("unified measure pipeline", () => {
  it("keeps raw statistics and D=U invariant across bandwidths", () => {
    const dataset: InputDataset = {
      times: ["right", "left"],
      layers: [{
        id: "two-point",
        measures: [measure(atom(0, 2 / 3), atom(10, 1 / 3)), measure(atom(0, 1 / 3), atom(10, 2 / 3))],
      }],
    };
    const narrow = runPipeline(dataset, { braided: { bandwidthRatio: 0.3, debug: true } });
    const wide = runPipeline(dataset, { braided: { bandwidthRatio: 1.2, debug: true } });
    const points = narrow.braided.layers[0].debug!;
    const widePoints = wide.braided.layers[0].debug!;

    expect(points[0].H).toBe(0);
    expect(points[0].deviationLow).toBe(0);
    expect(points[0].deviationHigh).toBeCloseTo(10 / 3, 14);
    expect(points[1].H).toBe(10);
    expect(points[1].deviationLow).toBeCloseTo(10 / 3, 14);
    expect(points[1].deviationHigh).toBe(0);
    for (const time of [0, 1]) {
      expect(widePoints[time].H).toBeCloseTo(points[time].H, 14);
      expect(widePoints[time].deviationLow).toBeCloseTo(points[time].deviationLow, 14);
      expect(widePoints[time].deviationHigh).toBeCloseTo(points[time].deviationHigh, 14);
      expect(points[time].actualSpace).toBeCloseTo(points[time].dispersion, 14);
      expect(widePoints[time].actualSpace).toBeCloseTo(points[time].actualSpace, 14);
    }
  });

  it("conserves branch thickness, gap budget, and handles zero variance/median explicitly", () => {
    const dataset: InputDataset = {
      times: ["zero", "spread"],
      layers: [{ id: "a", measures: [measure(atom(0)), measure(atom(0, 0.75), atom(4, 0.25))] }],
    };
    const result = runPipeline(dataset, { braided: { debug: true } });
    const geometry = result.braided.layers[0];
    const [zero, spread] = geometry.debug!;
    expect(zero.H).toBe(0);
    expect(zero.dispersion).toBe(0);
    expect(zero.branchCount).toBe(1);
    expect(zero.bandwidth).toBe(0);
    expect(spread.H).toBe(0);
    for (const [time, point] of geometry.debug!.entries()) {
      const branchThickness = point.branchIntervals.reduce((sum, branch) => sum + branch.y1 - branch.y0, 0);
      expect(branchThickness).toBeCloseTo(point.H, 12);
      expect(point.gaps.reduce((sum, gap) => sum + gap, 0)).toBeCloseTo(point.dispersion, 12);
      expect(point.envelopeHigh - point.envelopeLow).toBeCloseTo(point.H + point.dispersion, 12);
      expect(geometry.actualSpace[time]).toBeCloseTo(point.dispersion, 12);
    }
  });

  it("uses common-valid times for TPID and leaves missing cells missing", () => {
    const dataset: InputDataset = {
      times: ["t0", "t1", "t2"],
      layers: [
        { id: "a", measures: [measure(atom(1)), null, measure(atom(2))] },
        { id: "b", measures: [measure(atom(2)), measure(atom(3)), measure(atom(4))] },
        { id: "all-missing", measures: [null, null, null] },
      ],
    };
    const result = runPipeline(dataset, { braided: { debug: true } });
    expect(result.pid.referenceTimeIndices).toEqual([]);
    expect(result.pid.defined).toBe(false);
    const a = result.braided.layers.find((layer) => layer.layerId === "a")!;
    expect(a.missing).toEqual([false, true, false]);
    expect(a.branchCount[1]).toBe(0);
  });

  it("gives equivalent component decompositions the same observable analysis", () => {
    const dataset: InputDataset = {
      times: ["t"],
      layers: [
        { id: "whole", measures: [measure(uniform(0, 10))] },
        { id: "split", measures: [measure(uniform(0, 4, 0.4), uniform(4, 10, 0.6))] },
      ],
    };
    const result = runPipeline(dataset, { braided: { debug: true } });
    const whole = result.braided.layers.find((layer) => layer.layerId === "whole")!.debug![0];
    const split = result.braided.layers.find((layer) => layer.layerId === "split")!.debug![0];
    for (const key of ["H", "mean", "deviationLow", "deviationHigh", "dispersion", "bandwidth"] as const) {
      expect(split[key]).toBeCloseTo(whole[key], 12);
    }
    expect(split.branchCount).toBe(whole.branchCount);
    expect(split.branchMasses).toEqual(whole.branchMasses);
  });

  it("preserves prototype-named layer ids in PID records", () => {
    const ids = ["__proto__", "constructor", "toString"];
    const result = runPipeline({
      times: ["t"],
      layers: ids.map((id, index) => ({ id, measures: [measure(atom(index + 1))] })),
    }, {});
    for (const id of ids) {
      expect(Object.hasOwn(result.pid.depth, id)).toBe(true);
      expect(Number.isFinite(result.pid.depth[id])).toBe(true);
    }
  });
});
