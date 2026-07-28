import { isUsableSelection, MINIMUM_SELECTION_SPAN } from "./selection-geometry";
import type { CropDetails, InferenceConfig, Region } from "./types";

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface PreparedCrop {
  blob: Blob;
  details: CropDetails;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) return value;
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return roundHalfEven(value * factor) / factor;
}

export function validateRegion(region: Region): void {
  const values = [region.x1, region.y1, region.x2, region.y2];

  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Coordinates must be finite and between 0 and 1");
  }
  if (!isUsableSelection(region, MINIMUM_SELECTION_SPAN)) {
    throw new Error("Selected region is too small");
  }
}

export function orderedBox(region: Region): [number, number, number, number] {
  return [
    Math.min(region.x1, region.x2),
    Math.min(region.y1, region.y2),
    Math.max(region.x1, region.x2),
    Math.max(region.y1, region.y2),
  ];
}

export function pixelBox(
  region: Region,
  imageWidth: number,
  imageHeight: number,
  padding = 0
): [number, number, number, number] {
  const [left, top, right, bottom] = orderedBox(region);
  const width = (right - left) * imageWidth;
  const height = (bottom - top) * imageHeight;
  const margin = padding * Math.max(width, height);

  return [
    Math.max(0, Math.floor(left * imageWidth - margin)),
    Math.max(0, Math.floor(top * imageHeight - margin)),
    Math.min(imageWidth, Math.ceil(right * imageWidth + margin)),
    Math.min(imageHeight, Math.ceil(bottom * imageHeight + margin)),
  ];
}

function averageRgb(rgba: Uint8ClampedArray): [number, number, number] {
  const pixels = Math.max(1, rgba.length / 4);
  let red = 0;
  let green = 0;
  let blue = 0;

  for (let index = 0; index < rgba.length; index += 4) {
    red += rgba[index] ?? 0;
    green += rgba[index + 1] ?? 0;
    blue += rgba[index + 2] ?? 0;
  }
  return [roundHalfEven(red / pixels), roundHalfEven(green / pixels), roundHalfEven(blue / pixels)];
}

function extractCrop(
  image: DecodedImage,
  box: [number, number, number, number]
): Uint8ClampedArray {
  const [left, top, right, bottom] = box;
  const width = right - left;
  const height = bottom - top;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * image.width + left) * 4;
    const targetStart = y * width * 4;
    output.set(image.rgba.subarray(sourceStart, sourceStart + width * 4), targetStart);
  }
  return output;
}

function isolateSelection(
  cropRgba: Uint8ClampedArray,
  width: number,
  height: number,
  localBox: [number, number, number, number]
): number {
  const background = averageRgb(cropRgba);
  let selectedPixels = 0;
  const [left, top, right, bottom] = localBox;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const selected = x >= left && x <= right && y >= top && y <= bottom;
      const index = (y * width + x) * 4;
      if (selected) {
        selectedPixels += 1;
        cropRgba[index + 3] = 255;
      } else {
        cropRgba[index] = background[0];
        cropRgba[index + 1] = background[1];
        cropRgba[index + 2] = background[2];
        cropRgba[index + 3] = 255;
      }
    }
  }
  return selectedPixels;
}

function toCanvasImageData(rgba: Uint8ClampedArray, width: number, height: number): ImageData {
  // ImageData requires an ArrayBuffer-backed view. Copying also prevents a caller's
  // SharedArrayBuffer-backed view from being retained by the canvas implementation.
  return new ImageData(new Uint8ClampedArray(rgba), width, height);
}

function rgbaToCanvas(rgba: Uint8ClampedArray, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: false,
  });
  if (!context) throw new Error("2D canvas is unavailable");
  context.putImageData(toCanvasImageData(rgba, width, height), 0, 0);
  return canvas;
}

async function resizeAndEncode(
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  jpegQuality: number
): Promise<Blob> {
  const sourceCanvas = rgbaToCanvas(rgba, sourceWidth, sourceHeight);
  const targetCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = targetCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("2D canvas is unavailable");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "low";
  context.drawImage(sourceCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
  return targetCanvas.convertToBlob({
    type: "image/jpeg",
    quality: jpegQuality / 100,
  });
}

function normalizedPixelBox(
  box: [number, number, number, number],
  width: number,
  height: number
): number[] {
  return [
    roundTo(box[0] / width, 6),
    roundTo(box[1] / height, 6),
    roundTo(box[2] / width, 6),
    roundTo(box[3] / height, 6),
  ];
}

export async function prepareCrop(
  image: DecodedImage,
  region: Region,
  config: InferenceConfig
): Promise<PreparedCrop> {
  const started = performance.now();
  validateRegion(region);

  const selectionBox = pixelBox(region, image.width, image.height);
  const cropBox = pixelBox(region, image.width, image.height, config.cropPadding);
  const localBox: [number, number, number, number] = [
    selectionBox[0] - cropBox[0],
    selectionBox[1] - cropBox[1],
    selectionBox[2] - cropBox[0],
    selectionBox[3] - cropBox[1],
  ];

  const beforeWidth = Math.max(1, cropBox[2] - cropBox[0]);
  const beforeHeight = Math.max(1, cropBox[3] - cropBox[1]);
  const isolated = extractCrop(image, cropBox);
  const selectedPixels = isolateSelection(isolated, beforeWidth, beforeHeight, localBox);
  const scale = Math.min(1, config.imageSide / Math.max(beforeWidth, beforeHeight));
  const modelWidth = Math.max(1, roundHalfEven(beforeWidth * scale));
  const modelHeight = Math.max(1, roundHalfEven(beforeHeight * scale));
  const blob = await resizeAndEncode(
    isolated,
    beforeWidth,
    beforeHeight,
    modelWidth,
    modelHeight,
    config.jpegQuality
  );

  const cropArea = Math.max(1, beforeWidth * beforeHeight);
  const sourceArea = Math.max(1, image.width * image.height);

  return {
    blob,
    details: {
      selectionBox: orderedBox(region).map((value) => roundTo(value, 6)),
      selectionPixels: [...selectionBox],
      cropBox: normalizedPixelBox(cropBox, image.width, image.height),
      cropPixels: [...cropBox],
      sourceSize: [image.width, image.height],
      cropSizeBeforeResize: [beforeWidth, beforeHeight],
      modelImageSize: [modelWidth, modelHeight],
      selectedAreaPixels: selectedPixels,
      cropAreaPixels: cropArea,
      selectedFractionOfSource: roundTo(selectedPixels / sourceArea, 6),
      selectedFractionOfCrop: roundTo(selectedPixels / cropArea, 6),
      paddingRatio: config.cropPadding,
      resampling: config.resampling,
      prepareMs: roundTo(performance.now() - started, 3),
    },
  };
}
