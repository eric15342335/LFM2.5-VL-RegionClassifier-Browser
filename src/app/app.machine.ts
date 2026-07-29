import {
  and,
  assign,
  fromCallback,
  fromPromise,
  raise,
  setup,
  stateIn,
  type SnapshotFrom,
} from "xstate";
import { INFERENCE_CONFIG } from "../config";
import type { InferenceClientPort } from "../inference/client";
import type {
  BrowserCapability,
  ClassificationResult,
  ImageDescriptor,
  NormalizedSelection,
  ProgressEvent,
} from "../types";
import { closeImageBitmap, createPreviewBitmap } from "./image-preview";

export type LoadedImage = Readonly<{
  descriptor: ImageDescriptor;
  previewBitmap: ImageBitmap;
}>;

export type LatestResult = ClassificationResult & {
  browser: { roundTripMs: number };
};

export type ImageDecoder = (
  file: File,
  signal: AbortSignal
) => Promise<LoadedImage & { bytes: ArrayBuffer }>;

export type AppInput = Readonly<{
  client: InferenceClientPort;
  decodeImage?: ImageDecoder;
}>;

type ParentPort = Readonly<{ send: (event: AppEvent) => void }>;

type AppContext = {
  client: InferenceClientPort;
  decodeImage: ImageDecoder;
  capability: BrowserCapability | null;
  pendingFile: File | null;
  image: LoadedImage | null;
  selection: NormalizedSelection | null;
  result: LatestResult | null;
  progress: ProgressEvent | null;
  events: ProgressEvent[];
  message: string;
  technicalError: string | null;
  operationStartedAt: number | null;
  elapsedMs: number;
};

export type AppEvent =
  | { type: "RETRY_PROBE" }
  | { type: "LOAD_MODEL" }
  | { type: "FILE_SELECTED"; file: File }
  | { type: "SELECTION_CHANGED"; selection: NormalizedSelection | null }
  | { type: "SELECTION_COMPLETED"; selection: NormalizedSelection }
  | { type: "CLASSIFY" }
  | { type: "CANCEL" }
  | { type: "CLEAR_EVENTS" }
  | { type: "PROGRESS"; event: ProgressEvent }
  | { type: "WORKER_RESET"; error: Error }
  | { type: "IMAGE_REPLACED" };

type PrepareInput = Readonly<{ client: InferenceClientPort; parent: ParentPort }>;
type LoadImageInput = Readonly<{
  client: InferenceClientPort;
  decodeImage: ImageDecoder;
  file: File;
  previous: LoadedImage | null;
}>;
type ClassifyInput = Readonly<{
  client: InferenceClientPort;
  imageId: string;
  selection: NormalizedSelection;
  parent: ParentPort;
}>;

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}

async function defaultDecodeImage(file: File, signal: AbortSignal): ReturnType<ImageDecoder> {
  if (file.size > INFERENCE_CONFIG.maxImageBytes) {
    throw new Error(`Image exceeds ${INFERENCE_CONFIG.maxImageBytes} bytes`);
  }
  const bytes = await file.arrayBuffer();
  const decodedBitmap = await createImageBitmap(new Blob([bytes], { type: file.type }), {
    imageOrientation: "from-image",
  });
  let decodedBitmapOwned = true;

  try {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException("Image loading cancelled", "AbortError");
    }
    const { width, height } = decodedBitmap;

    if (width * height > INFERENCE_CONFIG.maxImagePixels) {
      throw new Error("Image has too many decoded pixels");
    }

    const previewPromise = createPreviewBitmap(decodedBitmap, signal);

    decodedBitmapOwned = false;
    const previewBitmap = await previewPromise;

    return {
      previewBitmap,
      descriptor: {
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: file.size,
        width,
        height,
      },
      bytes,
    };
  } catch (error) {
    if (decodedBitmapOwned) closeImageBitmap(decodedBitmap);
    throw error;
  }
}

const probeActor = fromPromise<BrowserCapability, InferenceClientPort>(({ input }) =>
  input.probe()
);

const prepareActor = fromPromise<number, PrepareInput>(async ({ input }) => {
  const started = performance.now();

  await input.client.prepare((event) => input.parent.send({ type: "PROGRESS", event }));

  return performance.now() - started;
});

const loadImageActor = fromPromise<LoadedImage & { elapsedMs: number }, LoadImageInput>(
  async ({ input, signal }) => {
    const started = performance.now();
    let previewBitmap: ImageBitmap | null = null;
    let loadedImageId: string | null = null;
    const closeUntransferredPreview = () => {
      closeImageBitmap(previewBitmap);
      previewBitmap = null;
    };

    signal.addEventListener("abort", closeUntransferredPreview, { once: true });

    try {
      const decoded = await input.decodeImage(input.file, signal);

      previewBitmap = decoded.previewBitmap;
      const { descriptor, bytes } = decoded;

      if (signal.aborted) {
        throw signal.reason ?? new DOMException("Image loading cancelled", "AbortError");
      }
      await input.client.loadImage(bytes, descriptor);
      loadedImageId = descriptor.id;
      if (signal.aborted) {
        await input.client.releaseImage(descriptor.id);
        loadedImageId = null;
        throw signal.reason ?? new DOMException("Image loading cancelled", "AbortError");
      }
      if (input.previous) await input.client.releaseImage(input.previous.descriptor.id);
      if (signal.aborted) {
        await input.client.releaseImage(descriptor.id);
        loadedImageId = null;
        throw signal.reason ?? new DOMException("Image loading cancelled", "AbortError");
      }

      if (!previewBitmap)
        throw new Error("Image preview was released before it could be displayed");
      const loadedImage = {
        descriptor,
        previewBitmap,
        elapsedMs: performance.now() - started,
      };

      previewBitmap = null;
      loadedImageId = null;

      return loadedImage;
    } catch (error) {
      if (loadedImageId) await input.client.releaseImage(loadedImageId).catch(() => undefined);
      closeUntransferredPreview();
      throw error;
    } finally {
      signal.removeEventListener("abort", closeUntransferredPreview);
    }
  }
);

const classifyActor = fromPromise<LatestResult, ClassifyInput>(async ({ input, signal }) => {
  const started = performance.now();
  const result = await input.client.classify({
    imageId: input.imageId,
    region: input.selection,
    signal,
    onProgress: (event) => input.parent.send({ type: "PROGRESS", event }),
  });

  return { ...result, browser: { roundTripMs: performance.now() - started } };
});

const lifecycleActor = fromCallback<AppEvent, InferenceClientPort>(({ input, sendBack }) =>
  input.subscribeLifecycle((error) => sendBack({ type: "WORKER_RESET", error }))
);

function outputOf<T>(event: unknown): T {
  return (event as { output: T }).output;
}

function errorOf(event: unknown): unknown {
  return (event as { error: unknown }).error;
}

export const appMachine = setup({
  types: {
    context: {} as AppContext,
    events: {} as AppEvent,
    input: {} as AppInput,
  },
  actors: {
    probe: probeActor,
    prepare: prepareActor,
    loadImage: loadImageActor,
    classify: classifyActor,
    lifecycle: lifecycleActor,
  },
  guards: {
    canClassify: and([
      stateIn({ operational: { model: "ready" } }),
      ({ context }) => Boolean(context.image && context.selection),
    ]),
    canAutoClassify: and([
      stateIn({ operational: { model: "ready" } }),
      ({ context, event }) =>
        event.type === "SELECTION_COMPLETED" && Boolean(context.image && event.selection),
    ]),
    isAbortError: ({ event }) => {
      const error = errorOf(event);

      return error instanceof Error && error.name === "AbortError";
    },
    modelReadyProgress: ({ event }) => event.type === "PROGRESS" && event.event.stage === "ready",
  },
  actions: {
    startOperation: assign({
      operationStartedAt: () => performance.now(),
      elapsedMs: () => 0,
      technicalError: () => null,
    }),
    appendProgress: assign({
      progress: ({ event }) => (event.type === "PROGRESS" ? event.event : null),
      events: ({ context, event }) =>
        event.type === "PROGRESS" ? [...context.events, event.event].slice(-100) : context.events,
      message: ({ context, event }) =>
        event.type === "PROGRESS" ? event.event.message : context.message,
    }),
    clearEvents: assign({ events: () => [] }),
    setPendingFile: assign({
      pendingFile: ({ event }) => (event.type === "FILE_SELECTED" ? event.file : null),
      result: () => null,
      selection: () => null,
      progress: () => null,
      technicalError: () => null,
      message: () => "Loading the image...",
    }),
    setSelection: assign({
      selection: ({ event }) =>
        event.type === "SELECTION_CHANGED" || event.type === "SELECTION_COMPLETED"
          ? event.selection
          : null,
      result: () => null,
      technicalError: () => null,
      message: ({ event }) =>
        (event.type === "SELECTION_CHANGED" || event.type === "SELECTION_COMPLETED") &&
        event.selection
          ? "Selection ready. Classify the selected region."
          : "Draw around one object.",
    }),
    clearResult: assign({ result: () => null }),
    markWorkerReset: assign({
      technicalError: ({ event }) =>
        event.type === "WORKER_RESET" ? errorDetails(event.error) : null,
      message: () => "The WebGPU session was lost. Reload the local model to continue.",
    }),
    markModelReady: assign({
      technicalError: () => null,
      message: ({ context }) =>
        context.image
          ? context.selection
            ? "Local model ready. The selected region can be classified."
            : "Local model ready. Draw around one object to classify it."
          : "Local model ready. Choose an image to begin.",
    }),
    modelFailed: assign({
      operationStartedAt: () => null,
      technicalError: ({ event }) => errorDetails(errorOf(event)),
      message: () => "The local model could not be prepared.",
    }),
    imageLoaded: assign(({ event }) => {
      const output = outputOf<LoadedImage & { elapsedMs: number }>(event);

      return {
        image: output,
        pendingFile: null,
        selection: null,
        result: null,
        progress: null,
        operationStartedAt: null,
        elapsedMs: output.elapsedMs,
        technicalError: null,
        message: "Image ready. Draw around one object.",
      };
    }),
    releasePreviousImage: ({ context }) => {
      if (context.image)
        void context.client.releaseImage(context.image.descriptor.id).catch(() => undefined);
    },
    imageFailed: assign({
      image: () => null,
      pendingFile: () => null,
      selection: () => null,
      result: () => null,
      operationStartedAt: () => null,
      technicalError: ({ event }) => errorDetails(errorOf(event)),
      message: ({ event }) => {
        const error = errorOf(event);

        return error instanceof Error && error.name === "AbortError"
          ? "Image loading cancelled."
          : "The image could not be opened.";
      },
    }),
    classificationSucceeded: assign(({ event }) => {
      const output = outputOf<LatestResult>(event);

      return {
        result: output,
        operationStartedAt: null,
        elapsedMs: output.browser.roundTripMs,
        technicalError: null,
        message: `Completed locally: ${output.label}`,
      };
    }),
    classificationFailed: assign({
      operationStartedAt: () => null,
      technicalError: ({ event }) => errorDetails(errorOf(event)),
      message: () => "Classification failed. Review the technical details and try again.",
    }),
    classificationCancelled: assign({
      operationStartedAt: () => null,
      technicalError: () => null,
      message: () => "Classification cancelled.",
    }),
  },
}).createMachine({
  id: "app",
  initial: "probing",
  context: ({ input }) => ({
    client: input.client,
    decodeImage: input.decodeImage ?? defaultDecodeImage,
    capability: null,
    pendingFile: null,
    image: null,
    selection: null,
    result: null,
    progress: null,
    events: [],
    message: "Checking browser support...",
    technicalError: null,
    operationStartedAt: null,
    elapsedMs: 0,
  }),
  states: {
    probing: {
      tags: ["probing"],
      invoke: {
        src: "probe",
        input: ({ context }) => context.client,
        onDone: [
          {
            guard: ({ event }) => outputOf<BrowserCapability>(event).supported,
            target: "operational",
            actions: assign({
              capability: ({ event }) => outputOf<BrowserCapability>(event),
              message: ({ event }) =>
                outputOf<BrowserCapability>(event).shaderF16
                  ? "WebGPU with shader-f16 is available. Load the local model to continue."
                  : "WebGPU is available without shader-f16. The model will run on CPU via WASM.",
              technicalError: () => null,
            }),
          },
          {
            target: "unsupported",
            actions: assign({
              capability: ({ event }) => outputOf<BrowserCapability>(event),
              message: () => "This browser cannot run the local WebGPU model.",
              technicalError: ({ event }) =>
                outputOf<BrowserCapability>(event).reason ??
                "Browser WebGPU capability check failed",
            }),
          },
        ],
        onError: {
          target: "unsupported",
          actions: assign({
            message: () => "This browser could not initialize local WebGPU inference.",
            technicalError: ({ event }) => errorDetails(errorOf(event)),
          }),
        },
      },
    },
    unsupported: {
      tags: ["unsupported"],
      on: { RETRY_PROBE: "probing" },
    },
    operational: {
      type: "parallel",
      invoke: {
        src: "lifecycle",
        input: ({ context }) => context.client,
      },
      on: {
        PROGRESS: { actions: "appendProgress" },
        CLEAR_EVENTS: { actions: "clearEvents" },
      },
      states: {
        model: {
          initial: "idle",
          on: {
            LOAD_MODEL: ".loading",
            WORKER_RESET: { target: ".error", actions: "markWorkerReset" },
          },
          states: {
            idle: { tags: ["modelRequired"] },
            loading: {
              tags: ["modelLoading"],
              entry: ["startOperation", assign({ message: () => "Loading the local model..." })],
              invoke: {
                src: "prepare",
                input: ({ context, self }) => ({ client: context.client, parent: self }),
                onDone: {
                  target: "ready",
                  actions: [
                    assign({
                      elapsedMs: ({ event }) => outputOf<number>(event),
                      operationStartedAt: () => null,
                    }),
                    "markModelReady",
                  ],
                },
                onError: { target: "error", actions: "modelFailed" },
              },
            },
            ready: { tags: ["modelReady"] },
            error: {
              tags: ["modelError"],
              on: {
                PROGRESS: {
                  guard: "modelReadyProgress",
                  target: "ready",
                  actions: ["appendProgress", "markModelReady"],
                },
              },
            },
          },
        },
        image: {
          initial: "empty",
          on: {
            FILE_SELECTED: { target: ".loading", actions: "setPendingFile" },
          },
          states: {
            empty: { tags: ["imageRequired"] },
            loading: {
              tags: ["imageLoading"],
              entry: "startOperation",
              invoke: {
                src: "loadImage",
                input: ({ context }) => ({
                  client: context.client,
                  decodeImage: context.decodeImage,
                  file: context.pendingFile as File,
                  previous: context.image,
                }),
                onDone: {
                  target: "ready",
                  actions: ["imageLoaded", raise({ type: "IMAGE_REPLACED" })],
                },
                onError: {
                  target: "error",
                  actions: [
                    "releasePreviousImage",
                    "imageFailed",
                    raise({ type: "IMAGE_REPLACED" }),
                  ],
                },
              },
            },
            ready: { tags: ["imageReady"] },
            error: { tags: ["imageError"] },
          },
        },
        classification: {
          initial: "idle",
          on: {
            IMAGE_REPLACED: { target: ".idle", actions: "clearResult" },
            SELECTION_CHANGED: { target: ".idle", actions: "setSelection" },
            SELECTION_COMPLETED: [
              { target: ".running", guard: "canAutoClassify", actions: "setSelection" },
              { target: ".idle", actions: "setSelection" },
            ],
            CLASSIFY: { target: ".running", guard: "canClassify" },
          },
          states: {
            idle: { tags: ["classificationIdle"] },
            running: {
              tags: ["classifying"],
              entry: [
                "startOperation",
                assign({ message: () => "Classifying the selected region..." }),
              ],
              on: { CANCEL: { target: "cancelled", actions: "classificationCancelled" } },
              invoke: {
                src: "classify",
                input: ({ context, self }) => ({
                  client: context.client,
                  imageId: context.image?.descriptor.id as string,
                  selection: context.selection as NormalizedSelection,
                  parent: self,
                }),
                onDone: { target: "success", actions: "classificationSucceeded" },
                onError: [
                  {
                    guard: "isAbortError",
                    target: "cancelled",
                    actions: "classificationCancelled",
                  },
                  { target: "error", actions: "classificationFailed" },
                ],
              },
            },
            success: { tags: ["classificationSuccess"] },
            cancelled: { tags: ["classificationCancelled"] },
            error: { tags: ["classificationError"] },
          },
        },
      },
    },
  },
});

export type AppSnapshot = SnapshotFrom<typeof appMachine>;

export type PrimaryAction = Readonly<{
  label: string;
  enabled: boolean;
  intent: "none" | "load-model" | "choose-image" | "focus-selection" | "classify";
}>;

export function primaryActionFor(snapshot: AppSnapshot, modelSize?: string): PrimaryAction {
  if (snapshot.hasTag("probing")) {
    return { label: "Checking browser...", enabled: false, intent: "none" };
  }
  if (snapshot.hasTag("unsupported")) {
    return { label: "WebGPU unavailable", enabled: false, intent: "none" };
  }
  if (snapshot.hasTag("classifying")) {
    return { label: "Classifying...", enabled: false, intent: "none" };
  }
  if (snapshot.hasTag("imageLoading")) {
    return { label: "Preparing image...", enabled: false, intent: "none" };
  }
  if (snapshot.hasTag("modelLoading")) {
    return { label: "Loading model...", enabled: false, intent: "none" };
  }
  if (!snapshot.hasTag("modelReady")) {
    return {
      label: modelSize ? `Load model (${modelSize})` : "Load model",
      enabled: true,
      intent: "load-model",
    };
  }
  if (!snapshot.hasTag("imageReady")) {
    return { label: "Choose an image", enabled: true, intent: "choose-image" };
  }
  if (!snapshot.context.selection) {
    return { label: "Draw around an object", enabled: true, intent: "focus-selection" };
  }

  return {
    label: snapshot.hasTag("classificationSuccess") ? "Classify again" : "Classify selection",
    enabled: true,
    intent: "classify",
  };
}
