import { describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";
import type { InferenceClientPort, InferenceLifecycleListener } from "../../inference/client";
import type {
  BrowserCapability,
  ClassificationResult,
  ClassifyRequest,
  ImageDescriptor,
  ProgressEvent,
} from "../../types";
import { appMachine, primaryActionFor, type ImageDecoder } from "../app.machine";

const capability: BrowserCapability = {
  supported: true,
  secureContext: true,
  hasWebgpu: true,
  adapterAcquired: true,
  deviceAcquired: true,
  shaderF16: true,
};

const descriptor: ImageDescriptor = {
  id: "image-1",
  name: "sample.png",
  mimeType: "image/png",
  bytes: 128,
  width: 640,
  height: 480,
};

const result: ClassificationResult = {
  requestId: "request-1",
  imageId: descriptor.id,
  label: "traffic light",
  tokenProbability: 0.91,
  selection: { box: [0.1, 0.2, 0.5, 0.6] },
  crop: {
    selectionBox: [0.1, 0.2, 0.5, 0.6],
    selectionPixels: [64, 96, 320, 288],
    cropBox: [32, 72, 352, 312],
    cropPixels: [32, 72, 352, 312],
    sourceSize: [640, 480],
    cropSizeBeforeResize: [320, 240],
    modelImageSize: [512, 512],
    selectedAreaPixels: 49_152,
    cropAreaPixels: 76_800,
    selectedFractionOfSource: 0.16,
    selectedFractionOfCrop: 0.64,
    paddingRatio: 0.1,
    resampling: "bilinear",
    prepareMs: 10,
  },
  generation: {
    rawOutput: "traffic light",
    finishReason: "stop",
    tokenLogprobs: [-0.09],
    usage: {},
  },
  performance: {
    preprocessMs: 10,
    inferenceMs: 30,
    totalMs: 40,
    sourceBytes: 128,
    encodedJpegBytes: 96,
  },
  runtime: {
    executionLocation: "browser",
    engine: "Transformers.js WebGPU",
    device: "webgpu",
    model: "LiquidAI/LFM2.5-VL-1.6B",
    revision: "main",
    transformersJsVersion: "4.2.0",
  },
};

class FakeClient implements InferenceClientPort {
  readonly name = "fake";
  loadedImages: string[] = [];
  lifecycleListeners = new Set<InferenceLifecycleListener>();
  capabilityResult = capability;
  classifyImpl: (request: ClassifyRequest) => Promise<ClassificationResult> = async () => result;

  async probe(): Promise<BrowserCapability> {
    return this.capabilityResult;
  }

  async prepare(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    onProgress?.({
      event: "status",
      stage: "ready",
      message: "Model ready",
      progress: 1,
      elapsedMs: 10,
    });
  }

  async loadImage(_file: File, image: ImageDescriptor): Promise<void> {
    this.loadedImages.push(image.id);
  }

  async releaseImage(imageId: string): Promise<void> {
    this.loadedImages = this.loadedImages.filter((id) => id !== imageId);
  }

  classify(request: ClassifyRequest): Promise<ClassificationResult> {
    return this.classifyImpl(request);
  }

  cancel(): void {}

  async dispose(): Promise<void> {}

  subscribeLifecycle(listener: InferenceLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);

    return () => this.lifecycleListeners.delete(listener);
  }

  loseDevice(message = "Device lost"): void {
    for (const listener of this.lifecycleListeners) listener(new Error(message));
  }
}

function file(): File {
  return new File([new Uint8Array(128)], "sample.png", { type: "image/png" });
}

function decoder(close = vi.fn()): ImageDecoder {
  return async () => ({
    previewBitmap: { width: 640, height: 480, close } as unknown as ImageBitmap,
    descriptor,
  });
}

async function startOperational(client = new FakeClient()) {
  const actor = createActor(appMachine, { input: { client, decodeImage: decoder() } }).start();

  await waitFor(actor, (snapshot) => snapshot.matches("operational"));

  return { actor, client };
}

describe("appMachine", () => {
  it("explains the Q8 WASM fallback when shader-f16 is unavailable", async () => {
    const client = new FakeClient();

    client.capabilityResult = { ...capability, shaderF16: false };
    const { actor } = await startOperational(client);

    expect(actor.getSnapshot().context.message).toBe(
      "WebGPU is available without shader-f16. The model will run on CPU via WASM."
    );
    actor.stop();
  });

  it("coordinates model, image, selection, and classification workflows", async () => {
    const { actor, client } = await startOperational();

    expect(primaryActionFor(actor.getSnapshot(), "model size").intent).toBe("load-model");

    actor.send({ type: "LOAD_MODEL" });
    actor.send({ type: "FILE_SELECTED", file: file() });

    await waitFor(
      actor,
      (snapshot) => snapshot.hasTag("modelReady") && snapshot.hasTag("imageReady")
    );

    expect(client.loadedImages).toEqual([descriptor.id]);
    expect(primaryActionFor(actor.getSnapshot(), "model size").intent).toBe("focus-selection");

    actor.send({
      type: "SELECTION_CHANGED",
      selection: { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 },
    });
    expect(primaryActionFor(actor.getSnapshot(), "model size").intent).toBe("classify");

    actor.send({ type: "CLASSIFY" });
    await waitFor(actor, (snapshot) => snapshot.hasTag("classificationSuccess"));

    expect(actor.getSnapshot().context.result?.label).toBe("traffic light");
    expect(actor.getSnapshot().context.events.some((event) => event.stage === "ready")).toBe(true);
    actor.stop();
  });

  it("ignores classification requests until all prerequisites exist", async () => {
    const { actor } = await startOperational();

    actor.send({ type: "CLASSIFY" });

    expect(actor.getSnapshot().hasTag("classificationIdle")).toBe(true);
    expect(actor.getSnapshot().context.result).toBeNull();
    actor.stop();
  });

  it("classifies automatically when a selection gesture completes", async () => {
    const { actor } = await startOperational();

    actor.send({ type: "LOAD_MODEL" });
    actor.send({ type: "FILE_SELECTED", file: file() });
    await waitFor(
      actor,
      (snapshot) => snapshot.hasTag("modelReady") && snapshot.hasTag("imageReady")
    );

    actor.send({
      type: "SELECTION_COMPLETED",
      selection: { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 },
    });

    await waitFor(actor, (snapshot) => snapshot.hasTag("classificationSuccess"));
    expect(actor.getSnapshot().context.result?.label).toBe("traffic light");
    actor.stop();
  });

  it("cancels an active classification through the invoked actor signal", async () => {
    const { actor, client } = await startOperational();

    client.classifyImpl = (request) =>
      new Promise((_resolve, reject) => {
        request.signal?.addEventListener(
          "abort",
          () => reject(request.signal?.reason ?? new DOMException("Cancelled", "AbortError")),
          { once: true }
        );
      });

    actor.send({ type: "LOAD_MODEL" });
    actor.send({ type: "FILE_SELECTED", file: file() });
    await waitFor(
      actor,
      (snapshot) => snapshot.hasTag("modelReady") && snapshot.hasTag("imageReady")
    );
    actor.send({
      type: "SELECTION_CHANGED",
      selection: { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 },
    });
    actor.send({ type: "CLASSIFY" });
    await waitFor(actor, (snapshot) => snapshot.hasTag("classifying"));

    actor.send({ type: "CANCEL" });
    await waitFor(actor, (snapshot) => snapshot.hasTag("classificationCancelled"));

    expect(actor.getSnapshot().context.technicalError).toBeNull();
    expect(actor.getSnapshot().context.message).toBe("Classification cancelled.");
    actor.stop();
  });

  it("derives readiness from the model state and restores it from a ready progress event", async () => {
    const { actor, client } = await startOperational();

    actor.send({ type: "LOAD_MODEL" });
    await waitFor(actor, (snapshot) => snapshot.hasTag("modelReady"));

    client.loseDevice("GPU adapter reset");
    await waitFor(actor, (snapshot) => snapshot.hasTag("modelError"));

    expect("modelPrepared" in actor.getSnapshot().context).toBe(false);
    expect(actor.getSnapshot().context.technicalError).toContain("GPU adapter reset");
    expect(primaryActionFor(actor.getSnapshot(), "model size").intent).toBe("load-model");

    actor.send({
      type: "PROGRESS",
      event: {
        event: "status",
        stage: "ready",
        message: "Model recovered",
        progress: 100,
        elapsedMs: 25,
      },
    });
    await waitFor(actor, (snapshot) => snapshot.hasTag("modelReady"));
    expect(primaryActionFor(actor.getSnapshot(), "model size").intent).toBe("choose-image");
    actor.stop();
  });
});
