import { describe, expect, it } from "vitest";
import { orderedBox, pixelBox, roundHalfEven, validateRegion } from "../preprocess";

const rectangle = {
  x1: 0.8,
  y1: 0.7,
  x2: 0.2,
  y2: 0.1,
};

describe("browser preprocessing math", () => {
  it("uses bankers rounding for exact halves", () => {
    expect([0.5, 1.5, 2.5, 3.5, -0.5, -1.5].map(roundHalfEven)).toEqual([0, 2, 2, 4, 0, -2]);
  });

  it("orders reversed normalized coordinates", () => {
    expect(orderedBox(rectangle)).toEqual([0.2, 0.1, 0.8, 0.7]);
  });

  it("uses floor/ceil crop padding and clips at image edges", () => {
    expect(pixelBox(rectangle, 100, 80, 0.08)).toEqual([15, 3, 85, 61]);
    expect(pixelBox({ ...rectangle, x1: 0.01, x2: 0.2 }, 100, 80, 0.5)).toEqual([0, 0, 44, 80]);
  });

  it("rejects small and non-finite selections", () => {
    expect(() => validateRegion({ ...rectangle, x2: 0.805 })).toThrow("too small");
    expect(() => validateRegion({ ...rectangle, x1: Number.NaN })).toThrow("finite");
  });
});
