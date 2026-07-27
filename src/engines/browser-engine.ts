import type {
  BrowserCapability,
  ClassificationResult,
  ClassifyRequest,
  ImageDescriptor,
  InferenceConfig,
  InferenceEngine,
  ProgressEvent,
  WorkerRequest,
  WorkerResponse,
} from "../types";

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type WorkerCommand = WithoutId<WorkerRequest>;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (event: ProgressEvent) => void;
};

export class BrowserInferenceEngine implements InferenceEngine {
  readonly name = "Transformers.js WebGPU";

  private worker: Worker | null = null;
  private nextRequestId = 1;
  private nextJobId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly images = new Map<string, { file: File; descriptor: ImageDescriptor }>();
  private currentJobId: number | null = null;
  private cancelFallbackTimer: number | null = null;
  private prepared = false;

  constructor(private readonly config: InferenceConfig) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../worker/browser-inference.worker.ts", import.meta.url), {
      type: "module",
      name: "lfm-browser-inference",
    });
    worker.addEventListener("message", (message: MessageEvent<WorkerResponse>) =>
      this.onMessage(message.data)
    );
    worker.addEventListener("error", (event) =>
      this.failAll(new Error(event.message || "Browser inference worker failed"))
    );
    worker.addEventListener("messageerror", () =>
      this.failAll(new Error("Browser inference worker returned an unreadable response"))
    );
    this.worker = worker;
    return worker;
  }

  private onMessage(response: WorkerResponse): void {
    if (response.type === "DEVICE_LOST") {
      this.failAll(new Error(`WebGPU device lost: ${response.reason}`));
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === "PROGRESS") {
      pending.onProgress?.(response.event);
      return;
    }
    this.pending.delete(response.id);
    if (response.type === "ERROR") {
      const error = new Error(response.error.message);
      error.name = response.error.name;
      if (response.error.stack) error.stack = response.error.stack;
      pending.reject(error);
    } else {
      pending.resolve(response.value);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.prepared = false;
    this.currentJobId = null;
    if (this.cancelFallbackTimer !== null) window.clearTimeout(this.cancelFallbackTimer);
    this.cancelFallbackTimer = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private call<T>(
    request: WorkerCommand,
    onProgress?: (event: ProgressEvent) => void,
    transfer: Transferable[] = []
  ): Promise<T> {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        onProgress,
      });
      this.ensureWorker().postMessage({ ...request, id } as WorkerRequest, transfer);
    });
  }

  async probe(): Promise<BrowserCapability> {
    return this.call<BrowserCapability>({ type: "PROBE", config: this.config });
  }

  async prepare(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    const operation = this.call<boolean>(
      { type: "PREPARE", config: this.config, warmup: true },
      onProgress
    );
    const timeout = window.setTimeout(() => {
      const error = new Error("Browser model loading timed out");
      error.name = "TimeoutError";
      this.failAll(error);
    }, this.config.modelLoadTimeoutSeconds * 1000);
    try {
      await operation;
      this.prepared = true;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  isPrepared(): boolean {
    return this.prepared;
  }

  async loadImage(file: File, descriptor: ImageDescriptor, signal?: AbortSignal): Promise<void> {
    const bytes = await file.arrayBuffer();
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Image loading cancelled", "AbortError");
    }
    await this.call({ type: "LOAD_IMAGE", descriptor, bytes, config: this.config }, undefined, [
      bytes,
    ]);
    this.images.set(descriptor.id, { file, descriptor });
  }

  async releaseImage(imageId: string): Promise<void> {
    this.images.delete(imageId);
    if (!this.worker) return;
    await this.call({ type: "RELEASE_IMAGE", imageId });
  }

  private async classifyOnce(request: ClassifyRequest): Promise<ClassificationResult> {
    const jobId = this.nextJobId++;
    this.currentJobId = jobId;
    const abort = () => void this.call({ type: "CANCEL", jobId }).catch(() => undefined);
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new DOMException("Classification cancelled", "AbortError");
      }
      const operation = this.call<ClassificationResult>(
        {
          type: "CLASSIFY",
          imageId: request.imageId,
          region: request.region,
          config: this.config,
          jobId,
        },
        request.onProgress
      );
      const timeout = window.setTimeout(() => {
        void this.call({ type: "CANCEL", jobId }).catch(() => undefined);
        window.setTimeout(() => {
          if (this.currentJobId !== jobId) return;
          const error = new Error("Browser classification timed out");
          error.name = "TimeoutError";
          this.failAll(error);
        }, 1500);
      }, this.config.inferenceTimeoutSeconds * 1000);
      try {
        return await operation;
      } finally {
        window.clearTimeout(timeout);
      }
    } finally {
      request.signal?.removeEventListener("abort", abort);
      if (this.currentJobId === jobId) {
        this.currentJobId = null;
        if (this.cancelFallbackTimer !== null) window.clearTimeout(this.cancelFallbackTimer);
        this.cancelFallbackTimer = null;
      }
    }
  }

  private async rebuild(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    const retained = [...this.images.values()];
    this.failAll(new Error("Recreating browser inference worker"));
    this.ensureWorker();
    await this.prepare(onProgress);
    for (const { file, descriptor } of retained) await this.loadImage(file, descriptor);
  }

  async classify(request: ClassifyRequest): Promise<ClassificationResult> {
    if (!this.prepared) throw new Error("Load and warm up the browser model before classifying");
    try {
      return await this.classifyOnce(request);
    } catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError"))
        throw error;
      request.onProgress?.({
        event: "status",
        stage: "recovery",
        message: "Browser inference failed; rebuilding the WebGPU session once",
        progress: 5,
        elapsedMs: 0,
        detail: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await this.rebuild(request.onProgress);
      return this.classifyOnce(request);
    }
  }

  cancel(): void {
    if (this.currentJobId === null || !this.worker) return;
    const jobId = this.currentJobId;
    void this.call({ type: "CANCEL", jobId }).catch(() => undefined);
    if (this.cancelFallbackTimer !== null) window.clearTimeout(this.cancelFallbackTimer);
    this.cancelFallbackTimer = window.setTimeout(() => {
      this.cancelFallbackTimer = null;
      if (this.currentJobId !== jobId) return;
      const error = new Error("Browser classification cancelled");
      error.name = "AbortError";
      this.failAll(error);
    }, 1500);
  }

  async dispose(): Promise<void> {
    this.cancel();
    if (this.worker) {
      try {
        await this.call({ type: "DISPOSE" });
      } catch {
        // Worker termination below is the hard cleanup path.
      }
      this.worker.terminate();
    }
    this.worker = null;
    this.pending.clear();
    this.images.clear();
    this.prepared = false;
    this.currentJobId = null;
    if (this.cancelFallbackTimer !== null) window.clearTimeout(this.cancelFallbackTimer);
    this.cancelFallbackTimer = null;
  }
}
