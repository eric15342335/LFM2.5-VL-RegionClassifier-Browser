import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import { orderedBox, pixelBox, prepareCrop, roundHalfEven, validateRegion } from "../preprocess";
import { MINIMUM_SELECTION_SPAN } from "../selection-geometry";

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
    expect(() =>
      validateRegion({ x1: 0, y1: 0, x2: MINIMUM_SELECTION_SPAN, y2: MINIMUM_SELECTION_SPAN })
    ).not.toThrow();
    expect(() => validateRegion({ x1: 0.1, y1: 0.1, x2: 0.11, y2: 0.11 })).not.toThrow();
    expect(() => validateRegion({ ...rectangle, x2: 0.805 })).toThrow("too small");
    expect(() => validateRegion({ ...rectangle, x1: Number.NaN })).toThrow("finite");
  });
});

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}

class FakeCanvasContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  readonly putImageData = vi.fn();
  readonly drawImage = vi.fn();
  readonly getImageData = vi.fn(
    () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]) }) as ImageData
  );
}

class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = [];

  readonly context = new FakeCanvasContext();
  readonly convertToBlob = vi.fn(
    async (options?: ImageEncodeOptions) => new Blob(["jpeg"], { type: options?.type })
  );

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    FakeOffscreenCanvas.instances.push(this);
  }

  getContext(): OffscreenCanvasRenderingContext2D {
    return this.context as unknown as OffscreenCanvasRenderingContext2D;
  }
}

describe("browser crop preparation", () => {
  beforeEach(() => {
    FakeOffscreenCanvas.instances = [];
    vi.stubGlobal("ImageData", FakeImageData);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves crop masking, low-quality resize, and JPEG encoding details", async () => {
    const rgba = new Uint8ClampedArray(
      Array.from({ length: 16 }, (_, pixel) => [pixel, pixel + 20, pixel + 40, 128]).flat()
    );

    const prepared = await prepareCrop(
      { width: 4, height: 4, rgba },
      { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
      { ...INFERENCE_CONFIG, cropPadding: 0.25, imageSide: 2, jpegQuality: 85 }
    );

    const [source, target] = FakeOffscreenCanvas.instances;
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    expect(prepared.details).toMatchObject({
      selectionPixels: [1, 1, 3, 3],
      cropPixels: [0, 0, 4, 4],
      cropSizeBeforeResize: [4, 4],
      modelImageSize: [2, 2],
      selectedAreaPixels: 9,
      cropAreaPixels: 16,
      selectedFractionOfSource: 0.5625,
      selectedFractionOfCrop: 0.5625,
    });
    expect(prepared.blob).toMatchObject({ type: "image/jpeg", size: 4 });

    const masked = source?.context.putImageData.mock.calls[0]?.[0] as FakeImageData;
    expect(masked.data).toEqual(
      new Uint8ClampedArray([
        8, 28, 48, 255, 8, 28, 48, 255, 8, 28, 48, 255, 8, 28, 48, 255, 8, 28, 48, 255, 5, 25, 45,
        255, 6, 26, 46, 255, 7, 27, 47, 255, 8, 28, 48, 255, 9, 29, 49, 255, 10, 30, 50, 255, 11,
        31, 51, 255, 8, 28, 48, 255, 13, 33, 53, 255, 14, 34, 54, 255, 15, 35, 55, 255,
      ])
    );
    expect(target?.context.drawImage).toHaveBeenCalledWith(source, 0, 0, 4, 4, 0, 0, 2, 2);
    expect(target?.context.imageSmoothingEnabled).toBe(true);
    expect(target?.context.imageSmoothingQuality).toBe("low");
    expect(target?.context.getImageData).not.toHaveBeenCalled();
    expect(target?.convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.85 });
  });
});
