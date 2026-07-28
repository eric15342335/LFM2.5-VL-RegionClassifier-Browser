import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import type { WorkerApi } from "../inference/worker-api";
import type { ImageDescriptor } from "../types";

const workerMocks = vi.hoisted(() => ({
  expose: vi.fn(),
  model: undefined as unknown,
  processor: undefined as unknown,
  rawImageFromBlob: vi.fn(),
  modelFromPretrained: vi.fn(),
  requestDevice: vi.fn(),
  adapterFeatures: new Set<string>(["shader-f16"]),
}));

vi.mock("comlink", () => ({ expose: workerMocks.expose }));

vi.mock("@huggingface/transformers", () => {
  class InterruptableStoppingCriteria {
    interrupt = vi.fn();
    reset = vi.fn();
  }

  class Lfm2VlImageProcessor {
    constructor(config: Record<string, unknown>) {
      Object.assign(this, config);
    }
  }

  class RawImage {
    static fromBlob = workerMocks.rawImageFromBlob;

    constructor(
      readonly _data: Uint8Array,
      readonly width: number,
      readonly height: number,
      readonly _channels: number
    ) {}
  }

  return {
    AutoModelForImageTextToText: {
      from_pretrained: workerMocks.modelFromPretrained,
    },
    AutoProcessor: {
      from_pretrained: vi.fn(async () => workerMocks.processor),
    },
    env: {},
    InterruptableStoppingCriteria,
    Lfm2VlImageProcessor,
    RawImage,
  };
});

const decodedRgba = new Uint8ClampedArray(
  Array.from({ length: 16 }, (_, pixel) => [pixel, pixel + 20, pixel + 40, 255]).flat()
);

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
  readonly drawImage = vi.fn();
  readonly getImageData = vi.fn(() => ({ data: decodedRgba }) as ImageData);
  readonly putImageData = vi.fn();
}

class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = [];
  static encodedBlob: Blob | null = null;

  readonly context = new FakeCanvasContext();
  readonly convertToBlob = vi.fn(async () => {
    if (!FakeOffscreenCanvas.encodedBlob) throw new Error("Missing expected JPEG Blob");
    return FakeOffscreenCanvas.encodedBlob;
  });

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

function createProcessor(maxNumPatches = 256): unknown {
  let imageProcessor: Record<string, unknown> = {
    config: {
      downsample_factor: 2,
      tile_size: 512,
      encoder_patch_size: 16,
      max_num_patches: maxNumPatches,
    },
    downsample_factor: 2,
    tile_size: 512,
    encoder_patch_size: 16,
    max_num_patches: maxNumPatches,
  };
  const processor = Object.assign(
    async () => ({
      attention_mask: { dims: [1, 1], data: [1] },
      input_ids: { dims: [1, 1], data: [0] },
      pixel_values: { dims: [1, 3, 2, 2] },
      spatial_shapes: { data: [16, 16], dims: [1, 2] },
    }),
    {
      apply_chat_template: () => "prompt",
      batch_decode: () => ["cat"],
    }
  );
  Object.defineProperty(processor, "image_processor", {
    enumerable: true,
    get: () => imageProcessor,
  });
  Object.defineProperty(processor, "components", {
    enumerable: true,
    value: {
      get image_processor() {
        return imageProcessor;
      },
      set image_processor(value: Record<string, unknown>) {
        imageProcessor = value;
      },
    },
  });
  return processor;
}

function createModel(): Record<string, unknown> {
  return {
    config: { image_token_id: 1 },
    generate: vi.fn(async () => ({
      sequences: {
        slice: () => ({ data: [42] }),
      },
      token_logprobs: [[-0.1]],
    })),
  };
}

const descriptor: ImageDescriptor = {
  id: "image-1",
  name: "fixture.jpg",
  mimeType: "image/jpeg",
  bytes: 3,
  width: 4,
  height: 4,
};

function metadataResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () =>
      INFERENCE_CONFIG.model.artifacts.map(({ path }) => ({
        path,
        size: path.length,
      })),
  } as Response;
}

function q4MetadataSize(): number {
  return INFERENCE_CONFIG.model.artifacts
    .filter(({ dtype }) => dtype === undefined || dtype === "q4")
    .reduce((total, { path }) => total + path.length, 0);
}

describe("browser inference worker JPEG model input", () => {
  let api: WorkerApi;

  beforeAll(async () => {
    vi.stubGlobal("ImageData", FakeImageData);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: vi.fn(), height: 4, width: 4 }))
    );
    vi.stubGlobal("crypto", { randomUUID: () => "request-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => metadataResponse())
    );
    workerMocks.modelFromPretrained.mockImplementation(async () => workerMocks.model);
    workerMocks.requestDevice.mockResolvedValue({ destroy: vi.fn() });
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({})),
      },
      gpu: {
        requestAdapter: vi.fn(async () => ({
          features: workerMocks.adapterFeatures,
          limits: {},
          requestDevice: workerMocks.requestDevice,
        })),
      },
    });
    vi.stubGlobal("self", { isSecureContext: true });

    await import("../inference/browser-inference.worker");
    api = workerMocks.expose.mock.calls[0]?.[0] as WorkerApi;
  });

  afterEach(async () => {
    await api.dispose();
    workerMocks.adapterFeatures = new Set(["shader-f16"]);
    workerMocks.modelFromPretrained.mockReset();
    workerMocks.modelFromPretrained.mockImplementation(async () => workerMocks.model);
    workerMocks.requestDevice.mockReset();
    workerMocks.requestDevice.mockResolvedValue({ destroy: vi.fn() });
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue(metadataResponse());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("passes the encoded crop JPEG Blob directly to RawImage.fromBlob", async () => {
    const encodedJpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const config = { ...INFERENCE_CONFIG, cropPadding: 0.25, imageSide: 2 };
    FakeOffscreenCanvas.encodedBlob = encodedJpeg;
    FakeOffscreenCanvas.instances = [];
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    workerMocks.rawImageFromBlob.mockResolvedValue({ height: 2, width: 2 });

    const preparationProgress = vi.fn();
    await api.prepare(config, false, preparationProgress);
    await api.loadImage(descriptor, new Uint8Array([0xff, 0xd8, 0xff]).buffer, config);
    const result = await api.classify({
      config,
      imageId: descriptor.id,
      jobId: 1,
      region: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
    });

    expect(workerMocks.rawImageFromBlob).toHaveBeenCalledWith(encodedJpeg);
    expect(encodedJpeg).toMatchObject({ size: 4, type: "image/jpeg" });
    expect(FakeOffscreenCanvas.instances[2]?.convertToBlob).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      label: "cat",
      performance: { encodedJpegBytes: 4 },
    });
    expect(result.crop).not.toHaveProperty("encodedJpegBytes");
    expect(result.generation).not.toHaveProperty("engineTimings");
    expect(result.generation.processor).not.toHaveProperty("processor_warnings");
    for (const [event] of preparationProgress.mock.calls)
      expect(event.detail?.processor_warnings).toBeUndefined();
  });

  it("throws a configuration error when processor controls do not match", async () => {
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor(255);

    await expect(api.prepare(INFERENCE_CONFIG, false)).rejects.toMatchObject({
      name: "ProcessorConfigurationError",
    });
  });

  it("uses all-Q4 without requesting shader-f16 when the adapter lacks it", async () => {
    workerMocks.adapterFeatures = new Set();
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();

    const progress = vi.fn();
    await api.prepare(INFERENCE_CONFIG, false, progress);

    expect(workerMocks.requestDevice).toHaveBeenCalledWith({ requiredFeatures: [] });
    expect(workerMocks.requestDevice.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0] as number
    );
    expect(fetch).toHaveBeenCalledWith(
      `https://huggingface.co/api/models/${INFERENCE_CONFIG.model.repository}/tree/${INFERENCE_CONFIG.model.revision}?recursive=true&expand=true`
    );
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledWith(
      INFERENCE_CONFIG.model.repository,
      expect.objectContaining({
        revision: INFERENCE_CONFIG.model.revision,
        device: "webgpu",
        dtype: {
          embed_tokens: "q4",
          vision_encoder: "q4",
          decoder_model_merged: "q4",
        },
      })
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Q4 compatibility profile"),
        detail: expect.objectContaining({
          storage: expect.objectContaining({
            download: q4MetadataSize(),
          }),
        }),
      })
    );
  });

  it("reports profile download size when browser quota metadata is unavailable", async () => {
    workerMocks.adapterFeatures = new Set();
    vi.mocked(navigator.storage.estimate).mockRejectedValueOnce(new Error("unavailable"));

    await expect(api.probe(INFERENCE_CONFIG)).resolves.toMatchObject({
      supported: true,
      storage: {
        download: q4MetadataSize(),
      },
    });
  });

  it("does not reject WebGPU when Hugging Face size metadata is unavailable", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));

    await expect(api.probe(INFERENCE_CONFIG)).resolves.toMatchObject({
      supported: true,
      deviceAcquired: true,
    });
  });

  it("preserves the configured profile and shader-f16 request when supported", async () => {
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();

    await api.prepare(INFERENCE_CONFIG, false);

    expect(workerMocks.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["shader-f16"],
    });
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledWith(
      INFERENCE_CONFIG.model.repository,
      expect.objectContaining({ dtype: INFERENCE_CONFIG.model.dtype })
    );
  });

  it("does not reuse readiness across dtype profiles", async () => {
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    await api.prepare(INFERENCE_CONFIG, false);

    const alternateConfig = {
      ...INFERENCE_CONFIG,
      model: {
        ...INFERENCE_CONFIG.model,
        dtype: {
          embed_tokens: "q4",
          vision_encoder: "q4",
          decoder_model_merged: "q4",
        } as const,
      },
    };
    workerMocks.processor = createProcessor();
    await api.prepare(alternateConfig, false);

    expect(workerMocks.modelFromPretrained).toHaveBeenCalledTimes(2);
  });

  it("does not mark a failed Q4 warm-up as ready", async () => {
    workerMocks.adapterFeatures = new Set();
    workerMocks.model = {
      ...createModel(),
      generate: vi.fn(async () => {
        throw new Error("Q4 warm-up failed");
      }),
    };
    workerMocks.processor = createProcessor();
    const progress = vi.fn();

    await expect(api.prepare(INFERENCE_CONFIG, true, progress)).rejects.toThrow(
      "Q4 warm-up failed"
    );
    expect(progress.mock.calls.some(([event]) => event.stage === "ready")).toBe(false);

    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    await api.prepare(INFERENCE_CONFIG, false);
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledTimes(2);
  });

  it("requires the warm-up decoder to generate a token", async () => {
    workerMocks.adapterFeatures = new Set();
    workerMocks.model = {
      ...createModel(),
      generate: vi.fn(async () => ({
        sequences: { slice: () => ({ data: [] }) },
      })),
    };
    workerMocks.processor = createProcessor();

    await expect(api.prepare(INFERENCE_CONFIG, true)).rejects.toThrow(
      "Warm-up produced no output token"
    );
  });
});
