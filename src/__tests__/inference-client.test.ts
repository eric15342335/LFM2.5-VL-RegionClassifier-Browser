import { describe, expect, it, vi } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import { BrowserInferenceClient, type WorkerConnectionFactory } from "../inference/client";
import type { WorkerApi } from "../inference/worker-api";
import type { ClassificationResult, ImageDescriptor } from "../types";

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
    requestId: "request-1",
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
      usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
      processor: { image_placeholder_count: 64 },
    },
    performance: {
      preprocessMs: 1,
      webgpuInferenceMs: 5,
      totalMs: 6,
      sourceBytes: descriptor.bytes,
      encodedJpegBytes: 100,
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
  it("rebuilds once and replays retained images after a classification failure", async () => {
    const replayed: string[] = [];
    const progress: string[] = [];
    let connection = 0;
    const factory: WorkerConnectionFactory = () => {
      connection += 1;
      const current = connection;
      return {
        api: baseApi({
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
    const file = new File([new Uint8Array([1, 2, 3, 4])], descriptor.name, {
      type: descriptor.mimeType,
    });

    await client.prepare();
    await client.loadImage(file, descriptor);
    const output = await client.classify({
      imageId: descriptor.id,
      region: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
      onProgress: (event) => progress.push(event.stage),
    });

    expect(output.label).toBe("dog");
    expect(connection).toBe(2);
    expect(replayed).toEqual(["1:image-1", "2:image-1"]);
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
    await client.prepare();

    const operation = client.classify({
      imageId: descriptor.id,
      region: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 },
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects outstanding calls when the worker fails", async () => {
    let failWorker: ((error: Error) => void) | undefined;
    const factory: WorkerConnectionFactory = (onFailure) => {
      failWorker = onFailure;
      return {
        api: baseApi({ probe: () => new Promise(() => undefined) }),
        terminate: vi.fn(),
      };
    };
    const client = new BrowserInferenceClient(INFERENCE_CONFIG, factory);
    const operation = client.probe();
    failWorker?.(new Error("worker crashed"));

    await expect(operation).rejects.toThrow("worker crashed");
  });

  it("times out a capability probe that never settles", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const factory: WorkerConnectionFactory = () => ({
      api: baseApi({ probe: () => new Promise(() => undefined) }),
      terminate,
    });
    const client = new BrowserInferenceClient(
      { ...INFERENCE_CONFIG, capabilityProbeTimeoutSeconds: 1 },
      factory
    );
    const rejection = expect(client.probe()).rejects.toMatchObject({
      name: "TimeoutError",
      message: "Browser capability check timed out",
    });

    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
