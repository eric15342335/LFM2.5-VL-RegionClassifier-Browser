import { proxy, releaseProxy, transfer, wrap } from "comlink";
import * as v from "valibot";
import { BrowserCapabilitySchema, ClassificationResultSchema } from "../domain/schemas";
import type {
  BrowserCapability,
  ClassificationResult,
  ClassifyRequest,
  ImageDescriptor,
  InferenceConfig,
  InferenceEngine,
  ProgressEvent,
} from "../types";
import { probeBrowserCapability, withTimeout } from "./capability";
import type { WorkerApi } from "./worker-api";

export type InferenceLifecycleListener = (error: Error) => void;

export interface InferenceClientPort extends InferenceEngine {
  subscribeLifecycle(listener: InferenceLifecycleListener): () => void;
}

export type WorkerConnection = Readonly<{
  api: WorkerApi;
  terminate: () => void;
}>;

export type WorkerConnectionFactory = (
  onFailure: (error: Error) => void,
  onDeviceLost: (reason: string) => void
) => WorkerConnection;

type RetainedImage = Readonly<{ bytes: ArrayBuffer; descriptor: ImageDescriptor }>;

const CANCELLATION_GRACE_PERIOD_MS = 1500;

function errorWithName(name: string, message: string): Error {
  const error = new Error(message);

  error.name = name;

  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function createComlinkConnection(
  onFailure: (error: Error) => void,
  onDeviceLost: (reason: string) => void
): WorkerConnection {
  const worker = new Worker(new URL("./browser-inference.worker.ts", import.meta.url), {
    type: "module",
    name: "lfm-browser-inference",
  });

  worker.addEventListener("error", (event) =>
    onFailure(new Error(event.message || "Browser inference worker failed"))
  );
  worker.addEventListener("messageerror", () =>
    onFailure(new Error("Browser inference worker returned an unreadable response"))
  );

  const remote = wrap<WorkerApi>(worker);

  void remote
    .setDeviceLostListener(proxy(onDeviceLost))
    .catch((error) => onFailure(toError(error)));

  return {
    api: remote as unknown as WorkerApi,
    terminate: () => {
      remote[releaseProxy]();
      worker.terminate();
    },
  };
}

export class BrowserInferenceClient implements InferenceClientPort {
  readonly name = "Transformers.js WebGPU";

  private connection: WorkerConnection | null = null;
  private readonly retainedImages = new Map<string, RetainedImage>();
  private readonly pendingRejectors = new Set<(error: Error) => void>();
  private readonly lifecycleListeners = new Set<InferenceLifecycleListener>();
  private nextJobId = 1;
  private currentJobId: number | null = null;
  private cancelFallback: ReturnType<typeof setTimeout> | null = null;
  private prepared = false;

  constructor(
    private readonly config: InferenceConfig,
    private readonly connectionFactory: WorkerConnectionFactory = createComlinkConnection
  ) {}

  private ensureConnection(): WorkerConnection {
    if (this.connection) return this.connection;
    this.connection = this.connectionFactory(
      (error) => this.hardReset(error),
      (reason) => this.hardReset(new Error(`WebGPU device lost: ${reason}`))
    );

    return this.connection;
  }

  private invoke<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const rejectPending = (error: Error) => reject(error);

      this.pendingRejectors.add(rejectPending);
      operation
        .then(resolve, (error) => reject(toError(error)))
        .finally(() => {
          this.pendingRejectors.delete(rejectPending);
        });
    });
  }

  private hardReset(error: Error, notify = true): void {
    for (const reject of this.pendingRejectors) reject(error);
    this.pendingRejectors.clear();
    this.prepared = false;
    this.currentJobId = null;
    if (this.cancelFallback) clearTimeout(this.cancelFallback);
    this.cancelFallback = null;
    this.connection?.terminate();
    this.connection = null;
    if (notify) for (const listener of this.lifecycleListeners) listener(error);
  }

  private scheduleCancellationReset(jobId: number, error: Error): void {
    if (this.cancelFallback) clearTimeout(this.cancelFallback);

    this.cancelFallback = setTimeout(() => {
      if (this.currentJobId !== jobId) return;
      this.hardReset(error);
    }, CANCELLATION_GRACE_PERIOD_MS);
  }

  subscribeLifecycle(listener: InferenceLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);

    return () => this.lifecycleListeners.delete(listener);
  }

  async probe(): Promise<BrowserCapability> {
    const capability = await withTimeout(
      probeBrowserCapability(),
      this.config.capabilityProbeTimeoutSeconds * 1000
    );

    return v.parse(BrowserCapabilitySchema, capability);
  }

  async prepare(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    const operation = this.invoke(
      this.ensureConnection().api.prepare(
        this.config,
        true,
        onProgress ? proxy(onProgress) : undefined
      )
    );
    const timeout = setTimeout(() => {
      this.hardReset(errorWithName("TimeoutError", "Browser model loading timed out"));
    }, this.config.modelLoadTimeoutSeconds * 1000);

    try {
      await operation;
      this.prepared = true;
    } finally {
      clearTimeout(timeout);
    }
  }

  async loadImage(bytes: ArrayBuffer, descriptor: ImageDescriptor): Promise<void> {
    const copy = bytes.slice(0);

    await this.invoke(
      this.ensureConnection().api.loadImage(descriptor, transfer(copy, [copy]), this.config)
    );
    this.retainedImages.set(descriptor.id, { bytes, descriptor });
  }

  async releaseImage(imageId: string): Promise<void> {
    this.retainedImages.delete(imageId);
    if (!this.connection) return;
    await this.invoke(this.connection.api.releaseImage(imageId));
  }

  private async classifyOnce(request: ClassifyRequest): Promise<ClassificationResult> {
    const jobId = this.nextJobId++;

    this.currentJobId = jobId;
    const abort = () => {
      void this.connection?.api.cancel(jobId).catch(() => undefined);
      this.scheduleCancellationReset(
        jobId,
        errorWithName("AbortError", "Browser classification cancelled")
      );
    };

    request.signal?.addEventListener("abort", abort, { once: true });

    try {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new DOMException("Classification cancelled", "AbortError");
      }
      const operation = this.invoke(
        this.ensureConnection().api.classify(
          {
            imageId: request.imageId,
            region: request.region,
            config: this.config,
            jobId,
          },
          request.onProgress ? proxy(request.onProgress) : undefined
        )
      );
      const timeout = setTimeout(() => {
        void this.connection?.api.cancel(jobId).catch(() => undefined);
        this.scheduleCancellationReset(
          jobId,
          errorWithName("TimeoutError", "Browser classification timed out")
        );
      }, this.config.inferenceTimeoutSeconds * 1000);

      try {
        return v.parse(ClassificationResultSchema, await operation);
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      request.signal?.removeEventListener("abort", abort);
      if (this.currentJobId === jobId) {
        this.currentJobId = null;
        if (this.cancelFallback) clearTimeout(this.cancelFallback);
        this.cancelFallback = null;
      }
    }
  }

  private async rebuild(onProgress?: (event: ProgressEvent) => void): Promise<void> {
    const retained = [...this.retainedImages.values()];

    this.hardReset(new Error("Recreating browser inference worker"), false);
    await this.prepare(onProgress);
    for (const { bytes, descriptor } of retained) await this.loadImage(bytes, descriptor);
  }

  async classify(request: ClassifyRequest): Promise<ClassificationResult> {
    if (!this.prepared) throw new Error("Load and warm up the browser model before classifying");
    try {
      return await this.classifyOnce(request);
    } catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      request.onProgress?.({
        event: "status",
        stage: "recovery",
        message: "Browser inference failed; rebuilding the WebGPU session once",
        progress: 5,
        elapsedMs: 0,
        detail: { error: toError(error).message },
      });
      await this.rebuild(request.onProgress);

      return this.classifyOnce(request);
    }
  }

  cancel(): void {
    if (this.currentJobId === null || !this.connection) return;
    const jobId = this.currentJobId;

    void this.connection.api.cancel(jobId).catch(() => undefined);
    this.scheduleCancellationReset(
      jobId,
      errorWithName("AbortError", "Browser classification cancelled")
    );
  }

  async dispose(): Promise<void> {
    this.cancel();
    if (this.connection) {
      try {
        await this.invoke(this.connection.api.dispose());
      } catch {
        // Termination is the final cleanup path.
      }
      this.connection.terminate();
    }
    this.connection = null;
    this.pendingRejectors.clear();
    this.retainedImages.clear();
    this.lifecycleListeners.clear();
    this.prepared = false;
    this.currentJobId = null;
    if (this.cancelFallback) clearTimeout(this.cancelFallback);
    this.cancelFallback = null;
  }
}
