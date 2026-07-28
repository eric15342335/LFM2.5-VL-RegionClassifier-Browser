import * as v from "valibot";

const finiteNumber = v.pipe(v.number(), v.finite());
const normalizedNumber = v.pipe(finiteNumber, v.minValue(0), v.maxValue(1));
const numericRecord = v.record(v.string(), finiteNumber);
const unknownRecord = v.record(v.string(), v.unknown());

export const RegionSchema = v.object({
  x1: normalizedNumber,
  y1: normalizedNumber,
  x2: normalizedNumber,
  y2: normalizedNumber,
});

export const ImageDescriptorSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.string(),
  mimeType: v.string(),
  bytes: v.pipe(finiteNumber, v.minValue(0)),
  width: v.pipe(finiteNumber, v.minValue(1)),
  height: v.pipe(finiteNumber, v.minValue(1)),
});

export const ProgressEventSchema = v.object({
  event: v.picklist(["status", "error"]),
  stage: v.string(),
  message: v.string(),
  progress: finiteNumber,
  elapsedMs: finiteNumber,
  detail: v.optional(unknownRecord),
});

const ModelArtifactSchema = v.object({
  role: v.picklist([
    "configuration",
    "tokenizer",
    "processor",
    "embedding",
    "vision",
    "decoder",
    "license",
  ]),
  path: v.pipe(v.string(), v.minLength(1)),
  dtype: v.optional(v.picklist(["fp16", "q4", "q4f16"])),
  sha256: v.optional(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/i))),
  resolved_url: v.optional(v.pipe(v.string(), v.minLength(1))),
});

export const ModelManifestSchema = v.object({
  manifest_version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  repository: v.pipe(v.string(), v.minLength(1)),
  revision: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/i)),
  transformers_js_version: v.pipe(v.string(), v.minLength(1)),
  runtime: v.literal("webgpu"),
  integrity_status: v.optional(v.picklist(["pending-release-verification", "verified"])),
  dtype: v.object({
    embed_tokens: v.picklist(["fp16", "q4", "q4f16"]),
    vision_encoder: v.picklist(["fp16", "q4", "q4f16"]),
    decoder_model_merged: v.picklist(["fp16", "q4", "q4f16"]),
  }),
  artifacts: v.array(ModelArtifactSchema),
  license: v.pipe(v.string(), v.minLength(1)),
});

const CropDetailsSchema = v.object({
  selectionBox: v.array(finiteNumber),
  selectionPixels: v.array(finiteNumber),
  cropBox: v.array(finiteNumber),
  cropPixels: v.array(finiteNumber),
  sourceSize: v.array(finiteNumber),
  cropSizeBeforeResize: v.array(finiteNumber),
  modelImageSize: v.array(finiteNumber),
  selectedAreaPixels: finiteNumber,
  cropAreaPixels: finiteNumber,
  selectedFractionOfSource: finiteNumber,
  selectedFractionOfCrop: finiteNumber,
  paddingRatio: finiteNumber,
  resampling: v.string(),
  prepareMs: finiteNumber,
});

export const ClassificationResultSchema = v.object({
  requestId: v.string(),
  imageId: v.string(),
  label: v.string(),
  tokenProbability: v.nullable(finiteNumber),
  selection: v.object({
    box: v.array(finiteNumber),
  }),
  crop: CropDetailsSchema,
  generation: v.object({
    rawOutput: v.string(),
    finishReason: v.nullable(v.string()),
    tokenLogprobs: v.array(finiteNumber),
    usage: unknownRecord,
    processor: v.optional(unknownRecord),
  }),
  performance: v.object({
    preprocessMs: finiteNumber,
    webgpuInferenceMs: finiteNumber,
    totalMs: finiteNumber,
    sourceBytes: finiteNumber,
    encodedJpegBytes: finiteNumber,
  }),
  runtime: v.object({
    executionLocation: v.literal("browser"),
    engine: v.string(),
    device: v.string(),
    model: v.string(),
    revision: v.string(),
    transformersJsVersion: v.string(),
  }),
});

export const BrowserCapabilitySchema = v.object({
  supported: v.boolean(),
  secureContext: v.boolean(),
  hasWebgpu: v.boolean(),
  adapterAcquired: v.boolean(),
  deviceAcquired: v.boolean(),
  shaderF16: v.boolean(),
  storage: v.optional(
    v.object({
      quota: v.optional(finiteNumber),
      usage: v.optional(finiteNumber),
      available: v.optional(finiteNumber),
      download: v.optional(finiteNumber),
      required: v.optional(finiteNumber),
    })
  ),
  adapterInfo: v.optional(unknownRecord),
  limits: v.optional(numericRecord),
  reason: v.optional(v.string()),
});

export type ModelManifest = v.InferOutput<typeof ModelManifestSchema>;

export function parseModelManifest(input: unknown): ModelManifest {
  return v.parse(ModelManifestSchema, input);
}
