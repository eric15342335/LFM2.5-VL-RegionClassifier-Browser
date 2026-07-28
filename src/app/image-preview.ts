export const PREVIEW_MAX_SIDE = 1200;

export type PreviewDimensions = Readonly<{
  width: number;
  height: number;
  scale: number;
}>;

export function previewDimensions(sourceWidth: number, sourceHeight: number): PreviewDimensions {
  const scale = Math.min(1, PREVIEW_MAX_SIDE / sourceWidth, PREVIEW_MAX_SIDE / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

export function closeImageBitmap(bitmap: ImageBitmap | null | undefined): void {
  bitmap?.close();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Image preview creation cancelled", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function canvasPreview(
  source: ImageBitmap,
  width: number,
  height: number
): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create a canvas preview context");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return createImageBitmap(canvas);
}

/** Consumes the source bitmap, transferring ownership to the returned preview on success. */
export async function createPreviewBitmap(
  source: ImageBitmap,
  signal?: AbortSignal
): Promise<ImageBitmap> {
  const { width, height, scale } = previewDimensions(source.width, source.height);

  if (scale === 1) {
    try {
      throwIfAborted(signal);
      return source;
    } catch (error) {
      closeImageBitmap(source);
      throw error;
    }
  }

  let preview: ImageBitmap | null = null;
  try {
    throwIfAborted(signal);
    try {
      preview = await createImageBitmap(source, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      });
    } catch {
      throwIfAborted(signal);
      preview = await canvasPreview(source, width, height);
    }
    throwIfAborted(signal);
    closeImageBitmap(source);
    return preview;
  } catch (error) {
    closeImageBitmap(preview);
    closeImageBitmap(source);
    throw error;
  }
}

function clampPreviewEdge(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

export function sourceCropToPreviewPixels(
  cropPixels: readonly number[],
  sourceWidth: number,
  sourceHeight: number,
  previewWidth: number,
  previewHeight: number
): [number, number, number, number] {
  const [left = 0, top = 0, right = sourceWidth, bottom = sourceHeight] = cropPixels;
  const scaleX = previewWidth / sourceWidth;
  const scaleY = previewHeight / sourceHeight;
  const mappedLeft = clampPreviewEdge(left * scaleX, previewWidth);
  const mappedTop = clampPreviewEdge(top * scaleY, previewHeight);
  const mappedRight = clampPreviewEdge(right * scaleX, previewWidth);
  const mappedBottom = clampPreviewEdge(bottom * scaleY, previewHeight);

  return [
    Math.min(mappedLeft, mappedRight),
    Math.min(mappedTop, mappedBottom),
    Math.max(mappedLeft, mappedRight),
    Math.max(mappedTop, mappedBottom),
  ];
}
