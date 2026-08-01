export interface NormalizedSelection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Region = NormalizedSelection;

export interface InferenceConfig {
  prompt: string;
  maxOutputTokens: number;
  contextTokens: number;
  imageTokens: number;
  cropPadding: number;
  imageSide: number;
  maxImageBytes: number;
  maxImagePixels: number;
  capabilityProbeTimeoutSeconds: number;
  inferenceTimeoutSeconds: number;
  modelLoadTimeoutSeconds: number;
  resampling: string;
  logprobs: boolean;
  model: import("./domain/schemas").ModelManifest;
}

export type { ModelManifest } from "./domain/schemas";

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
}

export interface ClassificationResult {
  imageId: string;
  label: string;
  tokenProbability: number | null;
  selection: {
    box: number[];
  };
  crop: CropDetails;
  generation: {
    rawOutput: string;
    finishReason: string | null;
    tokenLogprobs: number[];
    tokens: {
      id: number;
      text: string;
      logprob: number | null;
      probability: number | null;
    }[];
    usage: Record<string, unknown>;
    processor?: Record<string, unknown>;
  };
  performance: {
    preprocessMs: number;
    inferenceMs: number;
    totalMs: number;
    sourceBytes: number;
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
  prepare(
    profile: import("./inference/execution-profile").ExecutionProfile,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<void>;
  loadImage(bytes: ArrayBuffer, descriptor: ImageDescriptor): Promise<void>;
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
    download?: number;
    required?: number;
  };
  adapterInfo?: Record<string, unknown>;
  limits?: Record<string, number>;
  reason?: string;
}
