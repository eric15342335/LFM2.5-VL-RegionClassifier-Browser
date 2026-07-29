/// <reference lib="webworker" />

import {
  AutoModelForImageTextToText,
  AutoProcessor,
  env,
  InterruptableStoppingCriteria,
  Lfm2VlImageProcessor,
  RawImage,
} from "@huggingface/transformers";
import { expose } from "comlink";
import * as v from "valibot";
import { ImageDescriptorSchema, RegionSchema } from "../domain/schemas";
import { validateImageContainer } from "../image-format";
import { prepareCrop, roundTo, type DecodedImage } from "../preprocess";
import {
  expectedLfm2VlMaxNumPatches,
  lfm2VlProcessorControls,
  lfm2VlVisualTokenCount,
  multimodalBudgetMessage,
} from "../processor-controls";
import type {
  BrowserCapability,
  ClassificationResult,
  ImageDescriptor,
  InferenceConfig,
  ProgressEvent,
} from "../types";
import { probeBrowserCapability } from "./capability";
import {
  assertExecutionProfileCompatible,
  profileUsesWebGpu,
  selectExecutionProfile,
  type DtypeProfile,
  type ExecutionProfile,
} from "./execution-profile";
import type {
  DeviceLostListener,
  ProgressListener,
  WorkerApi,
  WorkerClassifyRequest,
} from "./worker-api";

type UnknownRecord = Record<string, unknown>;
type ModelImage = Pick<DecodedImage, "width" | "height">;
type ProcessorInputs = UnknownRecord & {
  input_ids?: unknown;
  attention_mask?: unknown;
  pixel_values?: unknown;
  spatial_shapes?: unknown;
};
type ProcessorConfigSurface = UnknownRecord & {
  config?: UnknownRecord;
  image_processor_config?: UnknownRecord;
};
type RuntimeImageProcessor = ProcessorConfigSurface & {
  do_image_splitting?: unknown;
  min_image_tokens?: unknown;
  max_image_tokens?: unknown;
  min_tiles?: unknown;
  max_tiles?: unknown;
  resample?: unknown;
  downsample_factor?: unknown;
  tile_size?: unknown;
  encoder_patch_size?: unknown;
  max_num_patches?: unknown;
};
type RuntimeProcessor = ProcessorConfigSurface & {
  image_processor?: RuntimeImageProcessor;
  components?: { image_processor?: RuntimeImageProcessor };
  apply_chat_template(
    messages: readonly {
      role: string;
      content: readonly { type: string; text?: string }[];
    }[],
    options: { add_generation_prompt: boolean }
  ): string;
  batch_decode(tensor: unknown, options: { skip_special_tokens: boolean }): readonly unknown[];
} & ((
    image: ModelImage,
    prompt: string,
    options: { add_special_tokens: boolean }
  ) => Promise<ProcessorInputs>);
type RuntimeModel = {
  config?: { image_token_id?: unknown };
  generate(
    options: ProcessorInputs & {
      do_sample: boolean;
      num_beams: number;
      max_new_tokens: number;
      use_cache: boolean;
      return_dict_in_generate: boolean;
      output_scores: boolean;
      stopping_criteria: InterruptableStoppingCriteria;
    }
  ): Promise<unknown>;
  dispose?: () => unknown;
};
type RuntimeOnnxBackend = {
  wasm?: { proxy?: boolean };
  webgpu?: { powerPreference?: GPUPowerPreference; device?: GPUDevice };
};
type RuntimeBackends = { onnx?: RuntimeOnnxBackend };
type SliceableTensor = {
  slice(axis: null, range: [number | null, number | null]): unknown;
};
type HuggingFaceTreeEntry = { path?: unknown; size?: unknown };

const sources = new Map<string, DecodedImage & { descriptor: ImageDescriptor }>();
const stoppingCriteria = new InterruptableStoppingCriteria();

let model: RuntimeModel | null = null;
let processor: RuntimeProcessor | null = null;
let preparedModelKey: string | null = null;
let preparedModelWarmedUp = false;
let preparePromise: Promise<void> | null = null;
let currentJobId: number | null = null;

type QueuedClassification = WorkerClassifyRequest & {
  id: number;
  resolve: (result: ClassificationResult) => void;
  reject: (error: unknown) => void;
};

let activeRequest: QueuedClassification | null = null;
let pendingRequest: QueuedClassification | null = null;
let nextOperationId = 1;
const requestStartedAt = new Map<number, number>();
const progressListeners = new Map<number, ProgressListener>();
let deviceLostListener: DeviceLostListener | undefined;
let subscribedDevice: GPUDevice | null = null;
let successfulCapability: BrowserCapability | null = null;
let activeExecutionProfile: ExecutionProfile | null = null;

class ProcessorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessorConfigurationError";
  }
}

class MultimodalInputBudgetError extends Error {
  constructor(inputLength: number, contextTokens: number, imagePlaceholderCount?: number) {
    super(multimodalBudgetMessage(inputLength, contextTokens, imagePlaceholderCount));
    this.name = "MultimodalInputBudgetError";
  }
}

function startOperation(onProgress?: ProgressListener): number {
  const id = nextOperationId++;

  requestStartedAt.set(id, performance.now());
  if (onProgress) progressListeners.set(id, onProgress);

  return id;
}

function finishOperation(id: number): void {
  requestStartedAt.delete(id);
  progressListeners.delete(id);
}

function progress(
  id: number,
  stage: string,
  message: string,
  percentage: number,
  detail?: Record<string, unknown>
): void {
  const event: ProgressEvent = {
    event: "status",
    stage,
    message,
    progress: percentage,
    elapsedMs: roundTo(performance.now() - (requestStartedAt.get(id) ?? performance.now()), 3),
    detail,
  };

  void progressListeners.get(id)?.(event);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return Boolean(value && typeof value === "object" && "length" in value);
}

function runtimeBackends(): RuntimeBackends | undefined {
  return asRecord(asRecord(env)?.backends) as RuntimeBackends | undefined;
}

function requiredModel(): RuntimeModel {
  if (!model) throw new Error("Browser model is not loaded");

  return model;
}

function requiredProcessor(): RuntimeProcessor {
  if (!processor) throw new Error("Browser processor is not loaded");

  return processor;
}

function selectedArtifactPaths(config: InferenceConfig, dtype: DtypeProfile): Set<string> {
  return new Set(
    config.model.artifacts
      .filter((artifact) => {
        if (artifact.role === "license") return false;
        if (!artifact.dtype) return true;
        const key =
          artifact.role === "embedding"
            ? "embed_tokens"
            : artifact.role === "vision"
              ? "vision_encoder"
              : "decoder_model_merged";

        return artifact.dtype === dtype[key];
      })
      .map((artifact) => artifact.path)
  );
}

async function modelDownloadBytes(
  config: InferenceConfig,
  dtype: DtypeProfile
): Promise<number | undefined> {
  const response = await fetch(
    `https://huggingface.co/api/models/${config.model.repository}/tree/${config.model.revision}?recursive=true&expand=false`
  );

  if (!response.ok) return undefined;
  const files = await response.json();

  if (!Array.isArray(files)) return undefined;
  const paths = selectedArtifactPaths(config, dtype);
  let total = 0;
  let found = 0;

  for (const file of files as HuggingFaceTreeEntry[]) {
    if (
      !paths.has(String(file.path)) ||
      typeof file.size !== "number" ||
      !Number.isFinite(file.size)
    )
      continue;
    total += file.size;
    found += 1;
  }

  return found === paths.size ? total : undefined;
}

async function probe(config: InferenceConfig): Promise<BrowserCapability> {
  const capability = successfulCapability ?? (await probeBrowserCapability());

  if (!capability.supported) return capability;

  const profile = selectExecutionProfile(capability, config.model.dtype);

  assertExecutionProfileCompatible(capability, profile);
  successfulCapability = capability;
  const download = await modelDownloadBytes(config, profile.dtype).catch(() => undefined);

  return download === undefined
    ? capability
    : { ...capability, storage: { ...capability.storage, download } };
}

function configureRuntime(): void {
  const onnx = runtimeBackends()?.onnx;

  if (onnx?.wasm) onnx.wasm.proxy = false;
  if (onnx?.webgpu) onnx.webgpu.powerPreference = "high-performance";
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

export function modelKey(config: InferenceConfig, profile: ExecutionProfile): string {
  return JSON.stringify({
    repository: config.model.repository,
    revision: config.model.revision,
    profile: profile.id,
    dtype: profile.dtype,
    device: profile.device,
  });
}

function assertEffectiveProcessorControls(config: InferenceConfig): void {
  const target = requiredProcessor().image_processor;

  if (!target) throw new ProcessorConfigurationError("LFM2-VL image processor is unavailable");

  const controls = lfm2VlProcessorControls(config);
  const mismatches = Object.entries(controls).filter(([key, expected]) => target[key] !== expected);
  const downsampleFactor = Number(target.downsample_factor);
  const tileSize = Number(target.tile_size);
  const encoderPatchSize = Number(target.encoder_patch_size);
  const expectedMaxNumPatches = expectedLfm2VlMaxNumPatches(
    controls.max_image_tokens,
    downsampleFactor,
    controls.do_image_splitting,
    tileSize,
    encoderPatchSize
  );

  if (!Number.isFinite(expectedMaxNumPatches) || expectedMaxNumPatches !== target.max_num_patches) {
    mismatches.push(["max_num_patches", expectedMaxNumPatches]);
  }
  if (mismatches.length) {
    const rendered = mismatches.map(([key, expected]) => `${key}=${String(expected)}`).join(", ");

    throw new ProcessorConfigurationError(
      `LFM2-VL processor controls were not applied: ${rendered}`
    );
  }
}

function configureProcessorParityControls(config: InferenceConfig): void {
  const activeProcessor = requiredProcessor();
  const currentImageProcessor = activeProcessor.image_processor;
  const currentConfig = asRecord(currentImageProcessor?.config);

  if (!currentConfig || !activeProcessor.components) {
    throw new ProcessorConfigurationError(
      "LFM2-VL processor does not expose a reconstructible image processor"
    );
  }

  const controls = lfm2VlProcessorControls(config);

  activeProcessor.components.image_processor = new Lfm2VlImageProcessor({
    ...currentConfig,
    ...controls,
  }) as unknown as RuntimeImageProcessor;
  assertEffectiveProcessorControls(config);
}

function subscribeToDeviceLoss(): void {
  const device = runtimeBackends()?.onnx?.webgpu?.device;

  if (!device?.lost || subscribedDevice === device) return;
  subscribedDevice = device;
  void device.lost.then((info) => {
    if (subscribedDevice !== device || runtimeBackends()?.onnx?.webgpu?.device !== device) return;
    preparedModelKey = null;
    preparedModelWarmedUp = false;
    model = null;
    processor = null;
    activeExecutionProfile = null;
    successfulCapability = null;
    subscribedDevice = null;
    void deviceLostListener?.(`${info.reason}: ${info.message}`);
  });
}

async function disposeModel(model: RuntimeModel | null): Promise<void> {
  try {
    await model?.dispose?.();
  } catch {
    // Model cleanup is best-effort.
  }
}

async function prepareModel(id: number, config: InferenceConfig, warmup = true): Promise<void> {
  while (preparePromise) await preparePromise.catch(() => undefined);

  const previousModel = model;
  const previousProcessor = processor;
  const previousModelKey = preparedModelKey;
  const previousModelWarmedUp = preparedModelWarmedUp;
  const previousExecutionProfile = activeExecutionProfile;
  const previousCapability = successfulCapability;
  const loadedModel: { value: RuntimeModel | null } = { value: null };

  preparePromise = (async () => {
    configureRuntime();
    const capability = await probe(config);

    if (!capability.supported)
      throw new Error(capability.reason ?? "Browser WebGPU inference is unsupported");
    const profile = selectExecutionProfile(capability, config.model.dtype);

    assertExecutionProfileCompatible(capability, profile);
    const key = modelKey(config, profile);

    if (model && processor && preparedModelKey === key) {
      if (warmup && !preparedModelWarmedUp) {
        await warmupModel(id, config);
        preparedModelWarmedUp = true;
      }

      return;
    }
    progress(
      id,
      "probe",
      capability.shaderF16
        ? "WebGPU with shader-f16 is available."
        : "WebGPU is available without shader-f16. The model will run on CPU via WASM.",
      4,
      {
        ...capability,
        execution_profile: profile.id,
        dtype_profile: profile.dtype,
        device_profile: profile.device,
        shaderF16: capability.shaderF16,
      } as unknown as Record<string, unknown>
    );
    const baseOptions = {
      revision: config.model.revision,
    };

    progress(id, "install", "Downloading required model files", 20);
    const [processorResult, modelResult] = await Promise.allSettled([
      AutoProcessor.from_pretrained(config.model.repository, baseOptions),
      AutoModelForImageTextToText.from_pretrained(config.model.repository, {
        ...baseOptions,
        device: profile.device,
        dtype: profile.dtype,
      }),
    ]);

    if (modelResult.status === "fulfilled")
      loadedModel.value = modelResult.value as unknown as RuntimeModel;
    if (processorResult.status === "rejected") throw processorResult.reason;
    if (modelResult.status === "rejected") throw modelResult.reason;
    processor = processorResult.value as unknown as RuntimeProcessor;
    model = loadedModel.value;
    configureProcessorParityControls(config);
    preparedModelKey = key;
    preparedModelWarmedUp = false;
    activeExecutionProfile = profile;
    if (profileUsesWebGpu(profile)) subscribeToDeviceLoss();
    progress(id, "compile", "Model loaded", 85);
    if (warmup) {
      await warmupModel(id, config);
      preparedModelWarmedUp = true;
    }
    progress(id, "ready", "Browser model is ready", 100);
  })();

  try {
    await preparePromise;
  } catch (error) {
    model = previousModel;
    processor = previousProcessor;
    preparedModelKey = previousModelKey;
    preparedModelWarmedUp = previousModelWarmedUp;
    activeExecutionProfile = previousExecutionProfile;
    successfulCapability = previousCapability;
    if (loadedModel.value && loadedModel.value !== previousModel)
      await disposeModel(loadedModel.value);
    throw error;
  } finally {
    preparePromise = null;
  }

  if (loadedModel.value && loadedModel.value !== previousModel) await disposeModel(previousModel);
}

function tensorLastDimension(tensor: unknown): number {
  const dims = asRecord(tensor)?.dims;

  return Array.isArray(dims) ? Number(dims.at(-1) ?? 0) : 0;
}

function tensorData(tensor: unknown): ArrayLike<unknown> {
  const data = asRecord(tensor)?.data;

  return isArrayLike(data) ? data : [];
}

function isSliceableTensor(value: unknown): value is SliceableTensor {
  return typeof asRecord(value)?.slice === "function";
}

function sliceGenerated(sequences: unknown, inputLength: number): unknown {
  if (!isSliceableTensor(sequences)) throw new Error("Generated sequence is not sliceable");

  return sequences.slice(null, [inputLength, null]);
}

function cleanLabel(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0] || "unknown";
  let cleaned = firstLine.toLowerCase().replace(/^[\s"'`]+|[\s"'`]+$/g, "");

  cleaned = cleaned.replace(/^(?:the|an|a)\s+/, "").split(/[.!?;:\n]/, 1)[0] ?? "";
  const words = cleaned.match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) ?? [];

  return words.slice(0, 4).join(" ") || "unknown";
}

function geometricMeanTokenProbability(tokenLogprobs: readonly unknown[]): {
  probability: number | null;
  logprobs: number[];
} {
  const logprobs = tokenLogprobs
    .map(Number)
    .filter(Number.isFinite)
    .map((value) => roundTo(value, 6));

  if (!logprobs.length) return { probability: null, logprobs };
  const mean = logprobs.reduce((sum, value) => sum + value, 0) / logprobs.length;

  return { probability: roundTo(Math.exp(mean), 6), logprobs };
}

function processorDiagnostics(
  inputs: ProcessorInputs,
  prepared: ModelImage
): Record<string, unknown> {
  const inputIds = inputs?.input_ids;
  const attentionMask = inputs?.attention_mask;
  const pixelValues = inputs?.pixel_values;
  const spatialShapes = inputs?.spatial_shapes;
  const imageTokenId = model?.config?.image_token_id;
  const pixelValueRecord = asRecord(pixelValues);
  const spatialShapeRecord = asRecord(spatialShapes);
  const spatialShapeData = spatialShapeRecord?.data;
  const spatialShapeValues = spatialShapeData
    ? Array.from(tensorData(spatialShapes), Number)
    : undefined;
  const encoderPatchSize = Number(processor?.image_processor?.encoder_patch_size);
  const [patchRows, patchColumns] = spatialShapeValues ?? [];
  const processedImageDimensions =
    patchRows !== undefined && patchColumns !== undefined && Number.isFinite(encoderPatchSize)
      ? [patchRows * encoderPatchSize, patchColumns * encoderPatchSize]
      : undefined;
  const ids = tensorData(inputIds);
  let placeholders: number | undefined;

  if (imageTokenId !== undefined) {
    placeholders = 0;
    for (let index = 0; index < ids.length; index += 1) {
      if (Number(ids[index]) === Number(imageTokenId)) placeholders += 1;
    }
  }

  return {
    prepared_image_dimensions: [prepared.width, prepared.height],
    pixel_tensor_shape: pixelValueRecord?.dims,
    spatial_shapes: spatialShapeValues ?? spatialShapeRecord?.dims,
    processed_image_dimensions: processedImageDimensions,
    tile_count: Array.isArray(pixelValueRecord?.dims) ? pixelValueRecord.dims[0] : undefined,
    text_sequence_length: tensorLastDimension(inputIds),
    image_placeholder_count: placeholders,
    attention_mask_length: tensorLastDimension(attentionMask),
  };
}

async function processInputs(
  rawImage: ModelImage,
  config: InferenceConfig
): Promise<ProcessorInputs> {
  const activeProcessor = requiredProcessor();

  assertEffectiveProcessorControls(config);
  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: config.prompt }, { type: "image" }],
    },
  ];
  const chatPrompt = activeProcessor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });
  const inputs = await activeProcessor(rawImage, chatPrompt, {
    add_special_tokens: false,
  });
  const inputLength = tensorLastDimension(inputs?.input_ids);

  if (inputLength > config.contextTokens) {
    const imageTokenId = model?.config?.image_token_id;
    const ids = tensorData(inputs.input_ids);
    let imagePlaceholderCount: number | undefined;

    if (imageTokenId !== undefined) {
      imagePlaceholderCount = 0;
      for (let index = 0; index < ids.length; index += 1) {
        if (Number(ids[index]) === Number(imageTokenId)) imagePlaceholderCount += 1;
      }
    }
    throw new MultimodalInputBudgetError(inputLength, config.contextTokens, imagePlaceholderCount);
  }

  return inputs;
}

async function generate(
  rawImage: ModelImage,
  config: InferenceConfig
): Promise<{
  rawOutput: string;
  probability: number | null;
  logprobs: number[];
  diagnostics: Record<string, unknown>;
  inputLength: number;
  outputTokens: number;
}> {
  const inputs = await processInputs(rawImage, config);
  const activeModel = requiredModel();
  const activeProcessor = requiredProcessor();
  const inputLength = tensorLastDimension(inputs.input_ids);

  stoppingCriteria.reset();
  const generated = await activeModel.generate({
    ...inputs,
    do_sample: false,
    num_beams: 1,
    max_new_tokens: config.maxOutputTokens,
    use_cache: true,
    return_dict_in_generate: config.logprobs,
    output_scores: config.logprobs,
    stopping_criteria: stoppingCriteria,
  });
  const generatedRecord = asRecord(generated);
  const sequences = generatedRecord?.sequences ?? generated;
  const generatedTensor = sliceGenerated(sequences, inputLength);
  const decoded = activeProcessor.batch_decode(generatedTensor, {
    skip_special_tokens: true,
  });
  const rawOutput = String(decoded?.[0] ?? "");
  const tokenIds = tensorData(generatedTensor);
  const tokenLogprobs = Array.isArray(generatedRecord?.token_logprobs)
    ? generatedRecord.token_logprobs[0]
    : [];
  const scoreResult = config.logprobs
    ? geometricMeanTokenProbability(Array.isArray(tokenLogprobs) ? tokenLogprobs : [])
    : { probability: null, logprobs: [] };

  if (!rawOutput && tokenIds.length === 0)
    throw new Error("Warm-up/generation produced no finite output");

  return {
    rawOutput,
    probability: scoreResult.probability,
    logprobs: scoreResult.logprobs,
    diagnostics: processorDiagnostics(inputs, rawImage),
    inputLength,
    outputTokens: tokenIds.length,
  };
}

async function warmupModel(id: number, config: InferenceConfig): Promise<void> {
  progress(id, "warmup", "Warming up the model", 90);
  const width = 32;
  const height = 32;
  const data = new Uint8Array(width * height * 3).fill(127);
  const image = new RawImage(data, width, height, 3);
  const warmupConfig = { ...config, maxOutputTokens: 1, logprobs: false };
  const result = await generate(image, warmupConfig);

  if (result.outputTokens < 1) throw new Error("Warm-up produced no output token");
  const imagePlaceholderCount = Number(result.diagnostics.image_placeholder_count);

  if (!Number.isInteger(imagePlaceholderCount) || imagePlaceholderCount !== config.imageTokens) {
    throw new ProcessorConfigurationError(
      `Warm-up expected ${config.imageTokens} image placeholders but prepared ${String(result.diagnostics.image_placeholder_count)}`
    );
  }
  const processedDimensions = result.diagnostics.processed_image_dimensions;
  const imageProcessor = requiredProcessor().image_processor;
  const processedHeight = Array.isArray(processedDimensions) ? Number(processedDimensions[0]) : NaN;
  const processedWidth = Array.isArray(processedDimensions) ? Number(processedDimensions[1]) : NaN;
  const observedVisualTokens = lfm2VlVisualTokenCount(
    processedHeight,
    processedWidth,
    Number(imageProcessor?.encoder_patch_size),
    Number(imageProcessor?.downsample_factor)
  );

  if (observedVisualTokens !== config.imageTokens) {
    throw new ProcessorConfigurationError(
      `Warm-up processed ${String(processedDimensions)} into ${observedVisualTokens} visual tokens; expected ${config.imageTokens}`
    );
  }
  progress(id, "warmup", "Warm-up completed", 97, {
    input_tokens: result.inputLength,
    output_tokens: result.outputTokens,
    processor: result.diagnostics,
  });
}

async function decodeImage(
  descriptor: ImageDescriptor,
  bytes: ArrayBuffer,
  config: InferenceConfig
): Promise<DecodedImage & { descriptor: ImageDescriptor }> {
  if (bytes.byteLength > config.maxImageBytes) throw new Error("Image is too large");
  const array = new Uint8Array(bytes);

  validateImageContainer(array);
  const blob = new Blob([array], { type: descriptor.mimeType });
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  try {
    if (bitmap.width * bitmap.height > config.maxImagePixels)
      throw new Error("Image has too many decoded pixels");
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });

    if (!context) throw new Error("2D canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;

    return { width: bitmap.width, height: bitmap.height, rgba, descriptor };
  } finally {
    bitmap.close();
  }
}

async function classifyRequest(request: QueuedClassification): Promise<ClassificationResult> {
  const started = performance.now();

  await prepareModel(request.id, request.config, false);
  const source = sources.get(request.imageId);

  if (!source) throw new Error("Browser image data is missing; load the image again");
  currentJobId = request.jobId;
  progress(request.id, "accepted", "Starting classification", 2, {
    job_id: request.jobId,
  });
  const preprocessStarted = performance.now();
  const crop = await prepareCrop(source, request.region, request.config);
  const rawImage = await RawImage.fromBlob(crop.blob);
  const preprocessMs = performance.now() - preprocessStarted;

  progress(
    request.id,
    "crop",
    "Preparing the selected region",
    35,
    crop.details as unknown as Record<string, unknown>
  );
  progress(request.id, "inference", "Classifying the selected region", 55);
  const inferenceStarted = performance.now();
  const generation = await generate(rawImage, request.config);
  const inferenceMs = performance.now() - inferenceStarted;

  if (currentJobId !== request.jobId)
    throw new DOMException("Classification was superseded", "AbortError");
  const totalMs = performance.now() - started;
  const label = cleanLabel(generation.rawOutput);

  progress(request.id, "complete", `Completed in browser: ${label}`, 100, {
    totalMs: roundTo(totalMs, 3),
  });

  return {
    requestId: crypto.randomUUID(),
    imageId: request.imageId,
    label,
    tokenProbability: generation.probability,
    selection: {
      box: [request.region.x1, request.region.y1, request.region.x2, request.region.y2],
    },
    crop: crop.details,
    generation: {
      rawOutput: generation.rawOutput,
      finishReason: generation.outputTokens >= request.config.maxOutputTokens ? "length" : "stop",
      tokenLogprobs: generation.logprobs,
      usage: {
        prompt_tokens: generation.inputLength,
        completion_tokens: generation.outputTokens,
        total_tokens: generation.inputLength + generation.outputTokens,
      },
      processor: generation.diagnostics,
    },
    performance: {
      preprocessMs: roundTo(preprocessMs, 3),
      inferenceMs: roundTo(inferenceMs, 3),
      totalMs: roundTo(totalMs, 3),
      sourceBytes: source.descriptor.bytes,
      encodedJpegBytes: crop.blob.size,
    },
    runtime: {
      engine: "transformers.js",
      device: activeExecutionProfile?.device.embed_tokens ?? "webgpu",
      model: request.config.model.repository,
      revision: request.config.model.revision,
      transformersJsVersion: request.config.model.transformers_js_version,
      executionLocation: "browser",
    },
  };
}

function abortQueued(request: QueuedClassification, reason: string): void {
  request.reject(new DOMException(reason, "AbortError"));
  finishOperation(request.id);
}

async function drainClassification(request: QueuedClassification): Promise<void> {
  activeRequest = request;
  try {
    request.resolve(await classifyRequest(request));
  } catch (error) {
    request.reject(error);
  } finally {
    finishOperation(request.id);
    currentJobId = null;
    activeRequest = null;
    const next = pendingRequest;

    pendingRequest = null;
    if (next) void drainClassification(next);
  }
}

function enqueueClassification(request: QueuedClassification): void {
  if (!activeRequest) {
    void drainClassification(request);

    return;
  }
  if (pendingRequest)
    abortQueued(pendingRequest, "Classification was superseded by a newer request");
  pendingRequest = request;
  progress(request.id, "queued", "Waiting for the current classification to finish", 45, {
    queued_ahead: 1,
  });
}

async function disposeRuntime(): Promise<void> {
  stoppingCriteria.interrupt();
  if (pendingRequest) abortQueued(pendingRequest, "Worker disposed");
  pendingRequest = null;
  activeRequest = null;
  currentJobId = null;
  sources.clear();
  await model?.dispose?.();
  model = null;
  processor = null;
  preparedModelKey = null;
  preparedModelWarmedUp = false;
  activeExecutionProfile = null;
  preparePromise = null;
  subscribedDevice = null;
  successfulCapability = null;
  progressListeners.clear();
  requestStartedAt.clear();
}

const api: WorkerApi = {
  probe,
  async prepare(config, warmup, onProgress) {
    const id = startOperation(onProgress);

    try {
      await prepareModel(id, config, warmup);
    } finally {
      finishOperation(id);
    }
  },
  async loadImage(descriptorInput, bytes, config) {
    const descriptor = v.parse(ImageDescriptorSchema, descriptorInput);
    const decoded = await decodeImage(descriptor, bytes, config);

    sources.set(descriptor.id, decoded);
  },
  async releaseImage(imageId) {
    return sources.delete(imageId);
  },
  async classify(requestInput, onProgress) {
    const request: WorkerClassifyRequest = {
      ...requestInput,
      region: v.parse(RegionSchema, requestInput.region),
    };
    const id = startOperation(onProgress);

    return new Promise<ClassificationResult>((resolve, reject) => {
      enqueueClassification({ ...request, id, resolve, reject });
    });
  },
  async cancel(jobId) {
    if (jobId === undefined || currentJobId === jobId) stoppingCriteria.interrupt();
    if (pendingRequest && (jobId === undefined || pendingRequest.jobId === jobId)) {
      abortQueued(pendingRequest, "Classification cancelled");
      pendingRequest = null;
    }
  },
  async setDeviceLostListener(listener) {
    deviceLostListener = listener;
  },
  async dispose() {
    await disposeRuntime();
    deviceLostListener = undefined;
  },
};

expose(api);
