// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewBitmap,
  PREVIEW_MAX_SIDE,
  previewDimensions,
  sourceCropToPreviewPixels,
} from "../image-preview";

type BitmapStub = ImageBitmap & { close: ReturnType<typeof vi.fn> };

function bitmap(width: number, height: number): BitmapStub {
  return { width, height, close: vi.fn() } as unknown as BitmapStub;
}

const createImageBitmapMock = vi.fn();

beforeEach(() => {
  createImageBitmapMock.mockReset();
  vi.stubGlobal("createImageBitmap", createImageBitmapMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bounded UI image previews", () => {
  it("caps landscape and portrait previews while retaining source dimensions separately", () => {
    expect(PREVIEW_MAX_SIDE).toBe(1200);
    expect(previewDimensions(4000, 2000)).toEqual({ width: 1200, height: 600, scale: 0.3 });
    expect(previewDimensions(2000, 4000)).toEqual({ width: 600, height: 1200, scale: 0.3 });
    expect(previewDimensions(640, 480)).toEqual({ width: 640, height: 480, scale: 1 });
  });

  it("uses high-quality ImageBitmap resizing and releases the full-resolution temporary", async () => {
    const source = bitmap(4000, 2000);
    const preview = bitmap(1200, 600);

    createImageBitmapMock.mockResolvedValueOnce(preview);

    expect(await createPreviewBitmap(source)).toBe(preview);
    expect(createImageBitmapMock).toHaveBeenCalledWith(source, {
      resizeWidth: 1200,
      resizeHeight: 600,
      resizeQuality: "high",
    });
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(preview.close).not.toHaveBeenCalled();
  });

  it("falls back to a high-quality canvas preview when ImageBitmap resize options fail", async () => {
    const source = bitmap(2000, 4000);
    const preview = bitmap(600, 1200);
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low" as ImageSmoothingQuality,
      drawImage: vi.fn(),
    };

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((contextId: string) =>
      contextId === "2d"
        ? (context as unknown as CanvasRenderingContext2D)
        : null) as HTMLCanvasElement["getContext"]);
    createImageBitmapMock.mockRejectedValueOnce(new TypeError("resize unsupported"));
    createImageBitmapMock.mockResolvedValueOnce(preview);

    expect(await createPreviewBitmap(source)).toBe(preview);
    const canvas = createImageBitmapMock.mock.calls[1]?.[0] as HTMLCanvasElement;

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(1200);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 600, 1200);
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("closes every owned bitmap when preview creation is aborted", async () => {
    const source = bitmap(4000, 2000);
    const preview = bitmap(1200, 600);
    let resolvePreview: ((value: ImageBitmap) => void) | undefined;

    createImageBitmapMock.mockImplementation(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolvePreview = resolve;
        })
    );
    const controller = new AbortController();
    const promise = createPreviewBitmap(source, controller.signal);

    controller.abort();
    resolvePreview?.(preview);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(preview.close).toHaveBeenCalledTimes(1);
  });

  it("maps source crop edges into clamped preview-bitmap coordinates", () => {
    expect(sourceCropToPreviewPixels([400, 200, 3600, 1800], 4000, 2000, 1200, 600)).toEqual([
      120, 60, 1080, 540,
    ]);
    expect(sourceCropToPreviewPixels([-10, 0, 5000, 3000], 4000, 2000, 1200, 600)).toEqual([
      0, 0, 1200, 600,
    ]);
    expect(sourceCropToPreviewPixels([400, 801, 1201, 3201], 2000, 4000, 600, 1200)).toEqual([
      120, 240, 360, 960,
    ]);
  });
});
