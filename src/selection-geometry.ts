import type { NormalizedSelection, SelectionShape } from "./types";

export type Point = Readonly<{ x: number; y: number }>;

export type CanvasBounds = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type CanvasSize = Readonly<{ width: number; height: number }>;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function canvasPointFromClient(
  clientX: number,
  clientY: number,
  bounds: CanvasBounds,
  canvas: CanvasSize
): Point {
  return {
    x: clamp(((clientX - bounds.left) * canvas.width) / bounds.width, 0, canvas.width),
    y: clamp(((clientY - bounds.top) * canvas.height) / bounds.height, 0, canvas.height),
  };
}

export function selectionEnd(start: Point, end: Point, shape: SelectionShape): Point {
  if (shape !== "circle") return end;
  const side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return {
    x: start.x + Math.sign(end.x - start.x || 1) * side,
    y: start.y + Math.sign(end.y - start.y || 1) * side,
  };
}

export function normalizedSelection(
  start: Point,
  end: Point,
  shape: SelectionShape,
  canvas: CanvasSize
): NormalizedSelection {
  const final = selectionEnd(start, end, shape);
  return {
    x1: clamp(Math.min(start.x, final.x) / canvas.width, 0, 1),
    y1: clamp(Math.min(start.y, final.y) / canvas.height, 0, 1),
    x2: clamp(Math.max(start.x, final.x) / canvas.width, 0, 1),
    y2: clamp(Math.max(start.y, final.y) / canvas.height, 0, 1),
  };
}

export function isUsableSelection(selection: NormalizedSelection, minimumSpan = 0.01): boolean {
  return selection.x2 - selection.x1 >= minimumSpan && selection.y2 - selection.y1 >= minimumSpan;
}
