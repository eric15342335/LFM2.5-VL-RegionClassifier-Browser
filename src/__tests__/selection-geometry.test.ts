import { describe, expect, it } from "vitest";
import {
  isUsableSelection,
  normalizedToPercentCrop,
  percentCropToNormalized,
} from "../selection-geometry";

describe("rectangular selection coordinate conversion", () => {
  it("maps full-image, top-left, bottom-right, and fractional crops", () => {
    expect(percentCropToNormalized({ unit: "%", x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
    });
    expect(percentCropToNormalized({ unit: "%", x: 0, y: 0, width: 10, height: 20 })).toEqual({
      x1: 0,
      y1: 0,
      x2: 0.1,
      y2: 0.2,
    });
    expect(percentCropToNormalized({ unit: "%", x: 90, y: 80, width: 10, height: 20 })).toEqual({
      x1: 0.9,
      y1: 0.8,
      x2: 1,
      y2: 1,
    });
    expect(
      percentCropToNormalized({ unit: "%", x: 12.345, y: 6.789, width: 45.678, height: 23.456 })
    ).toEqual({ x1: 0.12345, y1: 0.06789, x2: 0.58023, y2: 0.30245 });
  });

  it("canonicalizes every drag direction and reversed normalized coordinates", () => {
    for (const crop of [
      { unit: "%" as const, x: 80, y: 70, width: -60, height: -50 },
      { unit: "%" as const, x: 80, y: 20, width: -60, height: 50 },
      { unit: "%" as const, x: 20, y: 70, width: 60, height: -50 },
      { unit: "%" as const, x: 20, y: 20, width: 60, height: 50 },
    ])
      expect(percentCropToNormalized(crop)).toEqual({ x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.7 });

    expect(normalizedToPercentCrop({ x1: 0.8, y1: 0.7, x2: 0.2, y2: 0.1 })).toEqual({
      unit: "%",
      x: 20,
      y: 10,
      width: 60,
      height: 60,
    });
  });

  it("clamps out-of-bounds inputs and rejects non-finite values", () => {
    expect(percentCropToNormalized({ unit: "%", x: -10, y: -20, width: 150, height: 130 })).toEqual(
      { x1: 0, y1: 0, x2: 1, y2: 1 }
    );
    expect(percentCropToNormalized({ unit: "%", x: 120, y: 110, width: 10, height: 10 })).toEqual({
      x1: 1,
      y1: 1,
      x2: 1,
      y2: 1,
    });
    expect(() =>
      percentCropToNormalized({ unit: "%", x: Number.NaN, y: 0, width: 1, height: 1 })
    ).toThrow("finite");
    expect(() => normalizedToPercentCrop({ x1: 0, y1: 0, x2: Infinity, y2: 1 })).toThrow("finite");
  });

  it("enforces the normalized minimum while allowing zero-size intermediate crops", () => {
    expect(percentCropToNormalized({ unit: "%", x: 10, y: 10, width: 0, height: 0 })).toEqual({
      x1: 0.1,
      y1: 0.1,
      x2: 0.1,
      y2: 0.1,
    });
    expect(isUsableSelection({ x1: 0, y1: 0, x2: 0.01, y2: 0.01 })).toBe(true);
    expect(isUsableSelection({ x1: 0, y1: 0, x2: 0.009, y2: 0.02 })).toBe(false);
  });

  it("is stable across repeated normalized-percent round trips", () => {
    const initial = { x1: 0.123456789, y1: 0.234567891, x2: 0.876543219, y2: 0.765432198 };
    let current = initial;
    for (let count = 0; count < 100; count += 1)
      current = percentCropToNormalized(normalizedToPercentCrop(current));
    expect(current).toEqual(initial);
  });
});
