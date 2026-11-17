import { describe, expect, it } from "vitest";
import { runPipeline } from "braided-stream/core";

describe("DOM-free core", () => {
  it("imports and computes without browser globals", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    const result = runPipeline({ times: ["t1"], layers: [{ id: "a", measures: [{ components: [{ kind: "atom", value: 3, mass: 1 }] }] }] });
    expect(result.layoutOrder).toEqual(["a"]);
    expect(result.base.yTop[0][0] - result.base.yBottom[0][0]).toBe(3);
  });
});
