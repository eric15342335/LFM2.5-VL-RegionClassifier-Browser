export type SelectionShape = "rect" | "circle";

export interface NormalizedSelection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Region extends NormalizedSelection {
  shape: SelectionShape;
}

export interface InferenceConfig {
  prompt: string;
  maxOutputTokens: number;
  contextTokens: number;
  imageTokens: number;
  cropPadding: number;
  imageSide: number;
  jpegQuality: number;
  maxImageBytes: number;
  maxImagePixels: number;
  inferenceTimeoutSeconds: number;
  modelLoadTimeoutSeconds: number;
  resampling: string;
  logprobs: boolean;
  model: ModelManifest;
}

export interface ModelArtifact {
  role: "configuration" | "tokenizer" | "processor" | "embedding" | "vision" | "decoder" | "license";
  path: string;
  dtype?: "fp16" | "q4f16";
  expected_bytes?: number;
  sha256?: string;
  resolved_url?: string;
}

export interface ModelManifest {
  manifest_version?: number;
  repository: string;
  revision: string;
  transformers_js_version: string;
  runtime: "webgpu";
  estimated_download_bytes: number;
  size_status?: "estimated" | "verified";
  integrity_status?: "pending-release-verification" | "verified";
  dtype: {
    embed_tokens: "fp16";
    vision_encoder: "fp16";
    decoder_model_merged: "q4f16";
  };
  artifacts: ModelArtifact[];
  license: string;
}

export interface ImageDescriptor {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
}

export interface ProgressEvent {
  event: "status" | "error";
  stage: string;
  message: string;
  progress: number;
  elapsedMs: number;
  detail?: Record<string, unknown>;
}

export interface CropDetails {
  selectionBox: number[];
  selectionPixels: number[];
  cropBox: number[];
  cropPixels: number[];
  sourceSize: number[];
  cropSizeBeforeResize: number[];
  modelImageSize: number[];
  selectedAreaPixels: number;
  cropAreaPixels: number;
  selectedFractionOfSource: number;
  selectedFractionOfCrop: number;
  paddingRatio: number;
  resampling: string;
  prepareMs: number;
  encodedJpegBytes?: number;
}

export interface ClassificationResult {
  requestId: string;
  imageId: string;
  label: string;
  tokenProbability: number | null;
  selection: {
    shape: SelectionShape;
    box: number[];
  };
  crop: CropDetails;
  generation: {
    rawOutput: string;
    finishReason: string | null;
    tokenLogprobs: number[];
    usage: Record<string, unknown>;
    engineTimings: Record<string, unknown>;
    processor?: Record<string, unknown>;
  };
  performance: {
    preprocessMs: number;
    webgpuInferenceMs: number;
    totalMs: number;
    sourceBytes: number;
    encodedJpegBytes: number;
  };
  runtime: {
    executionLocation: "browser";
    engine: string;
    device: string;
    model: string;
    revision: string;
    transformersJsVersion: string;
  };
}

export interface ClassifyRequest {
  imageId: string;
  region: Region;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface InferenceEngine {
  readonly name: string;
  probe(): Promise<BrowserCapability>;
  prepare(onProgress?: (event: ProgressEvent) => void): Promise<void>;
  isPrepared(): boolean;
  loadImage(file: File, descriptor: ImageDescriptor, signal?: AbortSignal): Promise<void>;
  releaseImage(imageId: string): Promise<void>;
  classify(request: ClassifyRequest): Promise<ClassificationResult>;
  cancel(): void;
  dispose(): Promise<void>;
}

export interface BrowserCapability {
  supported: boolean;
  secureContext: boolean;
  hasWebgpu: boolean;
  adapterAcquired: boolean;
  deviceAcquired: boolean;
  shaderF16: boolean;
  storage?: {
    quota?: number;
    usage?: number;
    available?: number;
    required: number;
  };
  adapterInfo?: Record<string, unknown>;
  limits?: Record<string, number>;
  reason?: string;
}

export type WorkerRequest =
  | { id: number; type: "PROBE"; config: InferenceConfig }
  | { id: number; type: "PREPARE"; config: InferenceConfig; warmup?: boolean }
  | {
      id: number;
      type: "LOAD_IMAGE";
      descriptor: ImageDescriptor;
      bytes: ArrayBuffer;
      config: InferenceConfig;
    }
  | { id: number; type: "RELEASE_IMAGE"; imageId: string }
  | { id: number; type: "CLASSIFY"; imageId: string; region: Region; config: InferenceConfig; jobId: number }
  | { id: number; type: "CANCEL"; jobId?: number }
  | { id: number; type: "GET_STATUS" }
  | { id: number; type: "DISPOSE" };

export type WorkerResponse =
  | { id: number; type: "RESULT"; value: unknown }
  | { id: number; type: "ERROR"; error: { name: string; message: string; stack?: string } }
  | { id: number; type: "PROGRESS"; event: ProgressEvent }
  | { id: number; type: "DEVICE_LOST"; reason: string };
