import { describe, expect, it } from "vitest";
import {
  canvasPointFromClient,
  isUsableSelection,
  normalizedSelection,
  selectionEnd,
} from "../selection-geometry";

describe("selection geometry", () => {
  const canvas = { width: 200, height: 100 };

  it("maps and clamps client coordinates to the canvas", () => {
    expect(
      canvasPointFromClient(-40, 95, { left: 10, top: 20, width: 100, height: 50 }, canvas)
    ).toEqual({ x: 0, y: 100 });
    expect(
      canvasPointFromClient(60, 45, { left: 10, top: 20, width: 100, height: 50 }, canvas)
    ).toEqual({ x: 100, y: 50 });
  });

  it("normalizes reverse rectangle drags", () => {
    expect(normalizedSelection({ x: 180, y: 80 }, { x: 20, y: 10 }, "rect", canvas)).toEqual({
      x1: 0.1,
      y1: 0.1,
      x2: 0.9,
      y2: 0.8,
    });
  });

  it("keeps circle selections square in every drag direction", () => {
    expect(selectionEnd({ x: 100, y: 100 }, { x: 50, y: 130 }, "circle")).toEqual({
      x: 50,
      y: 150,
    });
    expect(
      normalizedSelection({ x: 100, y: 100 }, { x: 50, y: 130 }, "circle", {
        width: 200,
        height: 200,
      })
    ).toEqual({
      x1: 0.25,
      y1: 0.5,
      x2: 0.5,
      y2: 0.75,
    });
  });

  it("requires at least one percent span in both dimensions", () => {
    expect(isUsableSelection({ x1: 0, y1: 0, x2: 0.01, y2: 0.01 })).toBe(true);
    expect(isUsableSelection({ x1: 0, y1: 0, x2: 0.009, y2: 0.02 })).toBe(false);
  });
});
