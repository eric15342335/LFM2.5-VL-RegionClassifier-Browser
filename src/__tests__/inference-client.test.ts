import { describe, expect, it, vi } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import { withTimeout } from "../inference/capability";
import { BrowserInferenceClient, type WorkerConnectionFactory } from "../inference/client";
import { selectExecutionProfile } from "../inference/execution-profile";
import type { WorkerApi } from "../inference/worker-api";
import type { ClassificationResult, ImageDescriptor } from "../types";

const profile = selectExecutionProfile(
  {
    supported: true,
    secureContext: true,
    hasWebgpu: true,
    adapterAcquired: true,
    deviceAcquired: true,
    shaderF16: true,
  },
  INFERENCE_CONFIG.model.dtype
);

const descriptor: ImageDescriptor = {
  id: "image-1",
  name: "fixture.png",
  mimeType: "image/png",
  bytes: 4,
  width: 10,
  height: 10,
};

function result(label = "cat"): ClassificationResult {
  return {
    imageId: descriptor.id,
    label,
    tokenProbability: 0.75,
    selection: { box: [0.1, 0.1, 0.9, 0.9] },
    crop: {
      selectionBox: [0.1, 0.1, 0.9, 0.9],
      selectionPixels: [1, 1, 9, 9],
      cropBox: [0, 0, 1, 1],
      cropPixels: [0, 0, 10, 10],
      sourceSize: [10, 10],
      cropSizeBeforeResize: [10, 10],
      modelImageSize: [10, 10],
      selectedAreaPixels: 64,
      cropAreaPixels: 100,
      selectedFractionOfSource: 0.64,
      selectedFractionOfCrop: 0.64,
      paddingRatio: 0.08,
      resampling: "bilinear",
      prepareMs: 1,
    },
    generation: {
      rawOutput: label,
      finishReason: "stop",
      tokenLogprobs: [-0.2],
      tokens: [{ id: 42, text: label, logprob: -0.2, probability: 0.818731 }],
      usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
      processor: { image_placeholder_count: 64 },
    },
    performance: {
      preprocessMs: 1,
      inferenceMs: 5,
      totalMs: 6,
      sourceBytes: descriptor.bytes,
    },
    runtime: {
      executionLocation: "browser",
      engine: "transformers.js",
      device: "webgpu",
      model: INFERENCE_CONFIG.model.repository,
      revision: INFERENCE_CONFIG.model.revision,
      transformersJsVersion: INFERENCE_CONFIG.model.transformers_js_version,
    },
  };
}

function baseApi(overrides: Partial<WorkerApi> = {}): WorkerApi {
  return {
    probe: async () => ({
      supported: true,
      secureContext: true,
      hasWebgpu: true,
      adapterAcquired: true,
      deviceAcquired: true,
      shaderF16: true,
    }),
    prepare: async () => undefined,
    loadImage: async () => undefined,
    releaseImage: async () => true,
    classify: async () => result(),
    cancel: async () => undefined,
    setDeviceLostListener: async () => undefined,
    dispose: async () => undefined,
    ...overrides,
  };
}

describe("Comlink inference client lifecycle", () => {
  it("rebuilds once and replays retained images with the same profile", async () => {
    const replayed: string[] = [];
    const preparedProfiles: string[] = [];
    const progress: string[] = [];
    let connection = 0;
    const factory: WorkerConnectionFactory = () => {
      connection += 1;
      const current = connection;

      return {
        api: baseApi({
          prepare: async (_config, _warmup, _onProgress, selectedProfile) => {
            preparedProfiles.push(selectedProfile?.id ?? "missing");
          },
          loadImage: async (image) => {
            replayed.push(`${current}:${image.id}`);
          },
          classify: async () => {
            if (current === 1) throw new Error("device failed");

            return result("dog");
          },
        }),
        terminate: vi.fn(),
      };
    };
    const client = new BrowserInferenceClient(INFERENCE_CONFIG, factory);
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;

    await client.prepare(profile);
    await client.loadImage(bytes, descriptor);
    const output = await client.classify({
      imageId: descriptor.id,
      region: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
      onProgress: (event) => progress.push(event.stage),
    });

    expect(output.label).toBe("dog");
    expect(connection).toBe(2);
    expect(replayed).toEqual(["1:image-1", "2:image-1"]);
    expect(preparedProfiles).toEqual([profile.id, profile.id]);
    expect(progress).toContain("recovery");
  });

  it("propagates cancellation to the active worker job", async () => {
    let rejectClassification: ((error: unknown) => void) | undefined;
    const cancel = vi.fn(async () => {
      rejectClassification?.(new DOMException("cancelled", "AbortError"));
    });
    const factory: WorkerConnectionFactory = () => ({
      api: baseApi({
        cancel,
        classify: () =>
          new Promise<ClassificationResult>((_resolve, reject) => {
            rejectClassification = reject;
          }),
      }),
      terminate: vi.fn(),
    });
    const client = new BrowserInferenceClient(INFERENCE_CONFIG, factory);
    const controller = new AbortController();

    await client.prepare(profile);

    const operation = client.classify({
      imageId: descriptor.id,
      region: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
      signal: controller.signal,
    });

    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("checks browser support without creating the inference worker", async () => {
    const factory = vi.fn<WorkerConnectionFactory>();
    const client = new BrowserInferenceClient(INFERENCE_CONFIG, factory);

    await client.probe();
    expect(factory).not.toHaveBeenCalled();
  });

  it("times out a browser capability check", async () => {
    vi.useFakeTimers();
    try {
      const result = expect(withTimeout(new Promise(() => undefined), 1000)).rejects.toMatchObject({
        name: "TimeoutError",
        message: "Browser capability check timed out",
      });

      await vi.advanceTimersByTimeAsync(1000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
