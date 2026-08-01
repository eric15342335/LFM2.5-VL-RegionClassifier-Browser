import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import { createExecutionProfile } from "../inference/execution-profile";
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
  env: {} as Record<string, unknown>,
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
    env: workerMocks.env,
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

function createProcessor(maxNumPatches = 256, imagePlaceholderCount = 0): unknown {
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
      attention_mask: { dims: [1, imagePlaceholderCount], data: [1] },
      input_ids: {
        dims: [1, imagePlaceholderCount],
        data: Array.from({ length: imagePlaceholderCount }, () => 1),
      },
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
      vi.fn(async () => ({ json: async () => [], ok: true }))
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
    delete workerMocks.env.backends;
    workerMocks.adapterFeatures = new Set(["shader-f16"]);
    workerMocks.modelFromPretrained.mockReset();
    workerMocks.modelFromPretrained.mockImplementation(async () => workerMocks.model);
    workerMocks.requestDevice.mockReset();
    workerMocks.requestDevice.mockResolvedValue({ destroy: vi.fn() });
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

  it("uses plain Q4 WebGPU without shader-f16", async () => {
    workerMocks.adapterFeatures = new Set();
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();

    await expect(api.probe(INFERENCE_CONFIG)).resolves.toMatchObject({
      supported: true,
      shaderF16: false,
    });
    await api.prepare(INFERENCE_CONFIG, false);

    expect(workerMocks.requestDevice).toHaveBeenCalledWith(undefined);
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledWith(
      INFERENCE_CONFIG.model.repository,
      expect.objectContaining({
        device: {
          embed_tokens: "webgpu",
          vision_encoder: "webgpu",
          decoder_model_merged: "webgpu",
        },
        dtype: { embed_tokens: "q4", vision_encoder: "q4", decoder_model_merged: "q4" },
      })
    );
  });

  it("probes WebGPU without requesting remote model metadata", async () => {
    vi.mocked(navigator.storage.estimate).mockRejectedValueOnce(new Error("unavailable"));
    vi.mocked(fetch).mockClear();

    await expect(api.probe(INFERENCE_CONFIG)).resolves.toMatchObject({
      supported: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes a selected mixed CPU and WebGPU profile to Transformers.js", async () => {
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    const profile = createExecutionProfile(
      { embed_tokens: "q4", vision_encoder: "q8", decoder_model_merged: "q4" },
      { embed_tokens: "webgpu", vision_encoder: "wasm", decoder_model_merged: "webgpu" }
    );

    await api.prepare(INFERENCE_CONFIG, false, undefined, profile);

    expect(workerMocks.modelFromPretrained).toHaveBeenCalledWith(
      INFERENCE_CONFIG.model.repository,
      expect.objectContaining({ device: profile.device, dtype: profile.dtype })
    );
  });

  it("preserves the configured profile and WebGPU placement when shader-f16 is supported", async () => {
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();

    await api.prepare(INFERENCE_CONFIG, false);

    expect(workerMocks.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["shader-f16"],
    });
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledWith(
      INFERENCE_CONFIG.model.repository,
      expect.objectContaining({
        device: {
          embed_tokens: "webgpu",
          vision_encoder: "webgpu",
          decoder_model_merged: "webgpu",
        },
        dtype: INFERENCE_CONFIG.model.dtype,
      })
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

  it("rechecks concurrent preparation requests", async () => {
    let releaseFirstLoad!: () => void;
    const firstModel = createModel();
    const secondModel = createModel();
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
    workerMocks.modelFromPretrained
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            releaseFirstLoad = () => resolve(firstModel);
          })
      )
      .mockResolvedValueOnce(secondModel);

    const firstPrepare = api.prepare(INFERENCE_CONFIG, false);

    await vi.waitFor(() => expect(workerMocks.modelFromPretrained).toHaveBeenCalledOnce());
    const secondPrepare = api.prepare(alternateConfig, true);

    releaseFirstLoad();
    workerMocks.processor = createProcessor(256, alternateConfig.imageTokens);
    await Promise.all([firstPrepare, secondPrepare]);

    expect(workerMocks.modelFromPretrained).toHaveBeenCalledTimes(2);
    expect(secondModel.generate).toHaveBeenCalledOnce();
  });

  it("disposes only the model relinquished during replacement", async () => {
    const previousModel = {
      ...createModel(),
      dispose: vi.fn(() => {
        throw new Error("Old model disposal failed");
      }),
    };
    const failedModel = {
      ...createModel(),
      dispose: vi.fn().mockRejectedValue(new Error("New model disposal failed")),
    };
    const replacementModel = { ...createModel(), dispose: vi.fn() };
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

    workerMocks.model = previousModel;
    workerMocks.processor = createProcessor();
    await api.prepare(INFERENCE_CONFIG, false);

    workerMocks.model = failedModel;
    workerMocks.processor = createProcessor(255);
    await expect(api.prepare(alternateConfig, false)).rejects.toMatchObject({
      name: "ProcessorConfigurationError",
    });
    expect(failedModel.dispose).toHaveBeenCalledOnce();
    expect(previousModel.dispose).not.toHaveBeenCalled();

    workerMocks.model = replacementModel;
    workerMocks.processor = createProcessor();
    await api.prepare(alternateConfig, false);
    expect(previousModel.dispose).toHaveBeenCalledOnce();
    expect(replacementModel.dispose).not.toHaveBeenCalled();
  });

  it("ignores loss from a replaced WebGPU device and subscribes to its replacement", async () => {
    let loseFirstDevice!: (info: GPUDeviceLostInfo) => void;
    let loseSecondDevice!: (info: GPUDeviceLostInfo) => void;
    const firstDevice = {
      lost: new Promise<GPUDeviceLostInfo>((resolve) => {
        loseFirstDevice = resolve;
      }),
    } as GPUDevice;
    const secondDevice = {
      lost: new Promise<GPUDeviceLostInfo>((resolve) => {
        loseSecondDevice = resolve;
      }),
    } as GPUDevice;
    const webgpu = { device: firstDevice };
    const listener = vi.fn();
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

    workerMocks.env.backends = { onnx: { webgpu } };
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    await api.setDeviceLostListener(listener);
    await api.prepare(INFERENCE_CONFIG, false);

    webgpu.device = secondDevice;
    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    await api.prepare(alternateConfig, false);

    loseFirstDevice({ message: "stale", reason: "unknown" } as GPUDeviceLostInfo);
    await Promise.resolve();
    await api.prepare(alternateConfig, false);
    expect(listener).not.toHaveBeenCalled();
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledTimes(2);

    loseSecondDevice({ message: "active", reason: "unknown" } as GPUDeviceLostInfo);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("unknown: active"));
  });

  it("does not mark a failed warm-up as ready", async () => {
    workerMocks.model = {
      ...createModel(),
      generate: vi.fn(async () => {
        throw new Error("Warm-up failed");
      }),
    };
    workerMocks.processor = createProcessor();
    const progress = vi.fn();

    await expect(api.prepare(INFERENCE_CONFIG, true, progress)).rejects.toThrow("Warm-up failed");
    expect(progress.mock.calls.some(([event]) => event.stage === "ready")).toBe(false);

    workerMocks.model = createModel();
    workerMocks.processor = createProcessor();
    await api.prepare(INFERENCE_CONFIG, false);
    expect(workerMocks.modelFromPretrained).toHaveBeenCalledTimes(2);
  });

  it("requires the warm-up decoder to generate a token", async () => {
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
