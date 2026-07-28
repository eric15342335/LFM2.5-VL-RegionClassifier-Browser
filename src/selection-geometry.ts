import type { PercentCrop } from "react-image-crop";
import type { NormalizedSelection } from "./types";

export const MINIMUM_SELECTION_SPAN = 0.01;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function stable(value: number): number {
  return Number(value.toPrecision(15));
}

export function canonicalSelection(selection: NormalizedSelection): NormalizedSelection {
  const x1 = clamp(finite(selection.x1, "x1"), 0, 1);
  const y1 = clamp(finite(selection.y1, "y1"), 0, 1);
  const x2 = clamp(finite(selection.x2, "x2"), 0, 1);
  const y2 = clamp(finite(selection.y2, "y2"), 0, 1);
  return {
    x1: stable(Math.min(x1, x2)),
    y1: stable(Math.min(y1, y2)),
    x2: stable(Math.max(x1, x2)),
    y2: stable(Math.max(y1, y2)),
  };
}

export function percentCropToNormalized(crop: PercentCrop): NormalizedSelection {
  const x = finite(crop.x, "crop.x");
  const y = finite(crop.y, "crop.y");
  const width = finite(crop.width, "crop.width");
  const height = finite(crop.height, "crop.height");
  return canonicalSelection({
    x1: x / 100,
    y1: y / 100,
    x2: (x + width) / 100,
    y2: (y + height) / 100,
  });
}

export function normalizedToPercentCrop(selection: NormalizedSelection): PercentCrop {
  const normalized = canonicalSelection(selection);
  return {
    unit: "%",
    x: stable(normalized.x1 * 100),
    y: stable(normalized.y1 * 100),
    width: stable((normalized.x2 - normalized.x1) * 100),
    height: stable((normalized.y2 - normalized.y1) * 100),
  };
}

export function isUsableSelection(
  selection: NormalizedSelection,
  minimumSpan = MINIMUM_SELECTION_SPAN
): boolean {
  const normalized = canonicalSelection(selection);
  return (
    stable(normalized.x2 - normalized.x1) >= minimumSpan &&
    stable(normalized.y2 - normalized.y1) >= minimumSpan
  );
}
