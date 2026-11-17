import { describe, expect, it } from "vitest";
import { validateInput, type InputDataset, type ProbabilityMeasure } from "braided-stream/core";
import {
  measureCdf,
  measureDeviations,
  measureMoments,
  measureQuantile,
} from "../src/engine/measure";

const atom = (value: number, mass = 1) => ({ kind: "atom" as const, value, mass });
const uniform = (low: number, high: number, mass = 1) => ({ kind: "uniform" as const, low, high, mass });

describe("unified input contract", () => {
  it("validates into an independent normalized copy without mutating input", () => {
    const input: InputDataset = {
      times: ["t0"],
      layers: [{ id: "a", measures: [{ components: [atom(2, 1 + 5e-11)] }] }],
    };
    const before = JSON.stringify(input);
    const output = validateInput(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(output).not.toBe(input);
    expect(output.layers[0]).not.toBe(input.layers[0]);
    expect(output.layers[0].measures[0]).not.toBe(input.layers[0].measures[0]);
    expect(output.layers[0].measures[0]!.components[0].mass).toBe(1);
  });

  it.each([
    [{ times: [], layers: [{ id: "a", measures: [] }] }, /time/i],
    [{ times: ["t", "t"], layers: [{ id: "a", measures: [null, null] }] }, /unique/i],
    [{ times: ["t"], layers: [] }, /layer/i],
    [{ times: ["t"], layers: [{ id: "", measures: [null] }] }, /id/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [null] }, { id: "a", measures: [null] }] }, /unique/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [] }] }, /length/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [{ components: [] }] }] }, /component/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [{ components: [atom(1, 0)] }] }] }, /positive/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [{ components: [atom(1, 0.9)] }] }] }, /mass/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [{ components: [atom(Number.NaN)] }] }] }, /finite/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [{ components: [uniform(2, 1)] }] }] }, /uniform/i],
    [{ times: ["t"], layers: [{ id: "a", measures: [null] }] }, /valid cell/i],
  ] as const)("rejects invalid input %#", (dataset, message) => {
    expect(() => validateInput(dataset as InputDataset)).toThrow(message);
  });

  it("allows an all-missing layer when another layer has data", () => {
    expect(validateInput({
      times: ["t"],
      layers: [
        { id: "missing", measures: [null] },
        { id: "observed", measures: [{ components: [atom(0)] }] },
      ],
    }).layers[0].measures[0]).toBeNull();
  });
});

describe("raw probability measure", () => {
  it("computes analytic CDF, moments, deviations, jumps and half-mass plateaus", () => {
    const halfPlateau: ProbabilityMeasure = { components: [atom(0, 0.5), atom(10, 0.5)] };
    expect(measureCdf(halfPlateau, -1)).toBe(0);
    expect(measureCdf(halfPlateau, 0)).toBe(0.5);
    expect(measureCdf(halfPlateau, 5)).toBe(0.5);
    expect(measureQuantile(halfPlateau, 0.5)).toBe(0);
    expect(measureQuantile(halfPlateau, 0.5000001)).toBe(10);
    expect(measureMoments(halfPlateau)).toEqual({ mean: 5, variance: 25, standardDeviation: 5 });
    expect(measureDeviations(halfPlateau, 0)).toEqual({ deviationLow: 0, deviationHigh: 5, dispersion: 5 });

    const continuous: ProbabilityMeasure = { components: [uniform(2, 6)] };
    expect(measureQuantile(continuous, 0.5)).toBeCloseTo(4, 14);
    expect(measureMoments(continuous).variance).toBeCloseTo(4 / 3, 14);
    expect(measureDeviations(continuous, 4)).toEqual({ deviationLow: 0.5, deviationHigh: 0.5, dispersion: 1 });
  });

  it("is invariant to equivalent component decompositions", () => {
    const whole: ProbabilityMeasure = { components: [uniform(0, 10)] };
    const split: ProbabilityMeasure = { components: [uniform(0, 4, 0.4), uniform(4, 10, 0.6)] };
    for (const x of [0, 1, 4, 7, 10]) expect(measureCdf(split, x)).toBeCloseTo(measureCdf(whole, x), 14);
    for (const p of [0, 0.1, 0.5, 0.9, 1]) expect(measureQuantile(split, p)).toBeCloseTo(measureQuantile(whole, p), 13);
    const wholeMoments = measureMoments(whole);
    const splitMoments = measureMoments(split);
    expect(splitMoments.mean).toBeCloseTo(wholeMoments.mean, 14);
    expect(splitMoments.variance).toBeCloseTo(wholeMoments.variance, 14);
    expect(splitMoments.standardDeviation).toBeCloseTo(wholeMoments.standardDeviation, 14);
    const wholeDeviations = measureDeviations(whole, 5);
    const splitDeviations = measureDeviations(split, 5);
    expect(splitDeviations.deviationLow).toBeCloseTo(wholeDeviations.deviationLow, 14);
    expect(splitDeviations.deviationHigh).toBeCloseTo(wholeDeviations.deviationHigh, 14);
    expect(splitDeviations.dispersion).toBeCloseTo(wholeDeviations.dispersion, 14);

    const atoms: ProbabilityMeasure = { components: [atom(3, 0.2), atom(3, 0.3), atom(8, 0.5)] };
    const merged: ProbabilityMeasure = { components: [atom(3, 0.5), atom(8, 0.5)] };
    expect(measureQuantile(atoms, 0.5)).toBe(3);
    expect(measureMoments(atoms)).toEqual(measureMoments(merged));
  });
});
